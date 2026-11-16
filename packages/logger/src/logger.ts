import { EVENT_NAME_PATTERN, LIMITS, LOG_LEVELS, PLATFORMS, levelAtLeast, utf8ByteLength } from '@pixie-logger/shared';
import type { LogBatch, LogLevel } from '@pixie-logger/shared';
import { buildEvent } from './event';
import { makeKeyRedactor } from './sanitize';
import { randomId } from './session';
import { createFetchTransport } from './transport';
import type { Logger, LoggerDeps, LoggerOptions, LogOptions, QueueItem, SendResult } from './types';
import { isRecord, truncate } from './util';

const PREFIX = '[pixie-logger]';
const STORAGE_KEY = 'pixie-logger:queue';
const PERSIST_DEBOUNCE_MS = 1000;

const DEFAULT_MIN_LEVEL: LogLevel = 'debug';
const DEFAULT_FLUSH_INTERVAL_MS = 10_000;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_QUEUE_SIZE = 500;
const MIN_FLUSH_INTERVAL_MS = 1000;
const MAX_TIMER_MS = 2_147_483_647; // setInterval/setTimeout overflow above this and fire immediately
const MAX_PERSIST_BYTES = 512 * 1024;
const PERSIST_WRAPPER_BYTES = 64; // room for '{"v":1,"items":[' … ']}'

type Timeout = ReturnType<typeof setTimeout>;
type Interval = ReturnType<typeof setInterval>;

function alwaysWarn(...args: unknown[]): void {
  try {
    console.warn(PREFIX, ...args);
  } catch {
    // console unavailable: nothing else we can do
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isLevel(v: unknown): v is LogLevel {
  return (LOG_LEVELS as readonly unknown[]).includes(v);
}

/** Integer option with default and lower/upper bounds. */
function intOption(v: unknown, def: number, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : def;
  return Math.min(max, Math.max(min, n));
}

function isQueueItem(v: unknown): v is QueueItem {
  if (!isRecord(v) || !isRecord(v.event)) return false;
  const e = v.event;
  return (
    isLevel(e.level) &&
    typeof e.event === 'string' &&
    e.event.length >= 1 &&
    e.event.length <= LIMITS.eventNameMax &&
    EVENT_NAME_PATTERN.test(e.event) &&
    typeof e.clientTs === 'string' &&
    isNonEmptyString(v.sessionId) &&
    v.sessionId.length <= LIMITS.sessionIdMax &&
    isNonEmptyString(v.appVersion) &&
    v.appVersion.length <= LIMITS.appVersionMax
  );
}

function createNoopLogger(): Logger {
  const noop = (): void => {};
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    log: noop,
    flush: () => Promise.resolve(),
    setEnabled: noop,
    shutdown: () => Promise.resolve(),
    sessionId: '',
  };
}

export function createLogger(options: LoggerOptions, deps?: LoggerDeps): Logger {
  try {
    return createLoggerUnsafe(options, deps);
  } catch (err) {
    alwaysWarn('failed to create logger; logging is disabled', err);
    return createNoopLogger();
  }
}

function createLoggerUnsafe(options: LoggerOptions, deps?: LoggerDeps): Logger {
  if (
    !isRecord(options) ||
    !isNonEmptyString(options.endpoint) ||
    !isNonEmptyString(options.apiKey) ||
    !isNonEmptyString(options.appVersion) ||
    !(PLATFORMS as readonly unknown[]).includes(options.platform)
  ) {
    alwaysWarn(
      'invalid options: endpoint, apiKey, appVersion and platform (web, android or ios) are required; logging is disabled',
    );
    return createNoopLogger();
  }

  const now = deps?.now ?? Date.now;
  const random = deps?.random ?? Math.random;
  const debug = options.debug === true;
  const platform = options.platform;
  const appVersion = truncate(options.appVersion, LIMITS.appVersionMax);
  const minLevel: LogLevel = isLevel(options.minLevel) ? options.minLevel : DEFAULT_MIN_LEVEL;
  const batchSize = intOption(options.batchSize, DEFAULT_BATCH_SIZE, 1, LIMITS.maxEventsPerBatch);
  const maxQueueSize = intOption(options.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE, batchSize);
  const flushIntervalMs = intOption(
    options.flushIntervalMs,
    DEFAULT_FLUSH_INTERVAL_MS,
    MIN_FLUSH_INTERVAL_MS,
    MAX_TIMER_MS,
  );
  const shouldRedact = makeKeyRedactor(Array.isArray(options.redactKeys) ? options.redactKeys : []);
  const storage = options.storage;
  const sessionId = randomId(random);
  const transport =
    deps?.transport ??
    createFetchTransport({ endpoint: options.endpoint, apiKey: options.apiKey, fetch: options.fetch });

  const warn = (...args: unknown[]): void => {
    if (debug) alwaysWarn(...args);
  };

  // ---- state ----
  let queue: QueueItem[] = [];
  let flushing: Promise<void> | null = null;
  let keepaliveRequested = false;
  let saveErrorReported = false;
  let blocked = false;
  let enabled = options.enabled !== false;
  let stopped = false;
  let flushTimeout: Timeout | null = null;
  let persistTimeout: Timeout | null = null;
  let unsubscribeLifecycle: (() => void) | null = null;

  function trimQueue(): void {
    const over = queue.length - maxQueueSize;
    if (over > 0) {
      queue.splice(0, over);
      warn(`queue full, dropped ${over} oldest events`);
    }
  }

  function scheduleFlushSoon(): void {
    if (flushTimeout !== null || stopped) return;
    flushTimeout = setTimeout(() => {
      flushTimeout = null;
      void flush();
    }, 0);
  }

  // ---- persistence ----
  let restoring: Promise<void> = Promise.resolve();

  async function persistNow(): Promise<void> {
    if (!storage) return;
    if (persistTimeout !== null) {
      clearTimeout(persistTimeout);
      persistTimeout = null;
    }
    let serialized: string;
    try {
      // Never overwrite the stored queue before it has been read back.
      await restoring;
      serialized = serializeQueue(queue);
    } catch (err) {
      warn('failed to save queue', err);
      return;
    }
    try {
      await storage.setItem(STORAGE_KEY, serialized);
    } catch (err) {
      if (saveErrorReported) {
        warn('failed to save queue', err);
      } else {
        saveErrorReported = true;
        alwaysWarn('failed to save queue', err);
      }
    }
  }

  /** Newest items that fit in MAX_PERSIST_BYTES, saved oldest-first. The in-memory queue is not trimmed. */
  function serializeQueue(items: QueueItem[]): string {
    const budget = MAX_PERSIST_BYTES - PERSIST_WRAPPER_BYTES;
    const parts: string[] = [];
    let bytes = 0;
    for (let i = items.length - 1; i >= 0; i--) {
      const json = JSON.stringify(items[i]);
      const size = utf8ByteLength(json) + 1; // +1 for the comma
      if (bytes + size > budget) break;
      parts.push(json);
      bytes += size;
    }
    const left = items.length - parts.length;
    if (left > 0) warn(`saved queue capped at 512 KB; ${left} oldest events not saved`);
    return '{"v":1,"items":[' + parts.reverse().join(',') + ']}';
  }

  function schedulePersist(): void {
    if (!storage || persistTimeout !== null) return;
    persistTimeout = setTimeout(() => {
      persistTimeout = null;
      void persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }

  async function restore(): Promise<void> {
    if (!storage) return;
    let raw: string | null;
    try {
      raw = await storage.getItem(STORAGE_KEY);
    } catch (err) {
      warn('failed to read saved queue', err);
      return;
    }
    if (raw === null || raw === undefined) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    if (!isRecord(parsed) || parsed.v !== 1 || !Array.isArray(parsed.items)) {
      warn('saved queue is invalid; discarding it');
      try {
        await storage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      return;
    }

    const restored = parsed.items.filter(isQueueItem);
    if (restored.length === 0) return;
    queue = [...restored, ...queue];
    trimQueue();
    schedulePersist();
    scheduleFlushSoon();
  }

  // ---- sending ----
  function takeBatch(): QueueItem[] {
    const first = queue[0];
    if (!first) return [];
    const items = [first];
    for (let i = 1; i < queue.length && items.length < batchSize; i++) {
      const item = queue[i]!;
      if (item.sessionId !== first.sessionId || item.appVersion !== first.appVersion) break;
      items.push(item);
    }
    return items;
  }

  function removeItems(items: QueueItem[]): void {
    const done = new Set(items);
    queue = queue.filter((item) => !done.has(item));
  }

  async function runFlush(): Promise<void> {
    while (!blocked && queue.length > 0) {
      const items = takeBatch();
      const first = items[0]!;
      const body: LogBatch = {
        appVersion: first.appVersion,
        platform,
        sessionId: first.sessionId,
        events: items.map((item) => item.event),
      };

      let result: SendResult;
      try {
        // Read per batch: a background event during this flush makes the remaining batches keepalive.
        result = await transport.send(body, { keepalive: keepaliveRequested });
      } catch (err) {
        warn('send failed', err);
        result = { outcome: 'retry' };
      }

      switch (result?.outcome) {
        case 'sent':
          removeItems(items);
          schedulePersist();
          if (result.rejected > 0) warn(`server rejected ${result.rejected} of ${items.length} events`);
          continue;
        case 'dropped':
          removeItems(items);
          schedulePersist();
          warn(`dropped a batch of ${items.length} events (HTTP ${result.status})`);
          continue;
        case 'unauthorized':
          blocked = true;
          alwaysWarn('API key rejected; logging paused for this session');
          return;
        default:
          // 'retry' (or an unexpected result): keep the batch for the next flush.
          return;
      }
    }
  }

  function flush(opts?: { keepalive?: boolean }): Promise<void> {
    // Recorded before the "already flushing" check, so a call that joins a running flush still counts.
    if (opts?.keepalive === true) keepaliveRequested = true;
    if (flushing) return flushing;
    flushing = (async () => {
      try {
        await runFlush();
      } catch (err) {
        warn('unexpected error during flush', err);
      } finally {
        flushing = null;
        keepaliveRequested = false;
      }
    })();
    return flushing;
  }

  // ---- logging ----
  function log(level: LogLevel, name: string, opts?: LogOptions): void {
    try {
      if (stopped || blocked || !enabled || !isLevel(level) || !levelAtLeast(level, minLevel)) return;
      const result = buildEvent(level, name, opts, now(), shouldRedact);
      if (!result.ok) {
        warn(result.reason);
        return;
      }
      queue.push({ event: result.event, sessionId, appVersion });
      trimQueue();
      schedulePersist();
      if (queue.length >= batchSize || levelAtLeast(level, 'error')) scheduleFlushSoon();
    } catch (err) {
      warn('unexpected error while logging', err);
    }
  }

  // ---- startup ----
  const interval: Interval = setInterval(() => void flush(), flushIntervalMs);

  restoring = restore().catch((err) => warn('failed to restore queue', err));

  if (options.lifecycle) {
    try {
      unsubscribeLifecycle = options.lifecycle.subscribe({
        onBackground: () => {
          void persistNow();
          void flush({ keepalive: true });
        },
        onForeground: () => void flush(),
      });
    } catch (err) {
      warn('failed to subscribe to lifecycle events', err);
    }
  }

  async function shutdown(): Promise<void> {
    try {
      stopped = true;
      clearInterval(interval);
      if (flushTimeout !== null) {
        clearTimeout(flushTimeout);
        flushTimeout = null;
      }
      if (unsubscribeLifecycle) {
        const unsubscribe = unsubscribeLifecycle;
        unsubscribeLifecycle = null;
        try {
          unsubscribe();
        } catch (err) {
          warn('failed to unsubscribe from lifecycle events', err);
        }
      }
      await flush();
      await persistNow();
    } catch (err) {
      warn('unexpected error during shutdown', err);
    }
  }

  return {
    debug: (event, o) => log('debug', event, o),
    info: (event, o) => log('info', event, o),
    warn: (event, o) => log('warn', event, o),
    error: (event, o) => log('error', event, o),
    fatal: (event, o) => log('fatal', event, o),
    log,
    flush: () => flush({ keepalive: false }),
    setEnabled: (value: boolean) => {
      enabled = value === true;
    },
    shutdown,
    sessionId,
  };
}
