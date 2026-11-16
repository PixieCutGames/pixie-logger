import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { utf8ByteLength } from '@pixie-logger/shared';
import type { LogBatch } from '@pixie-logger/shared';
import { createLogger } from '../src/logger';
import type {
  LifecycleAdapter,
  LifecycleHandlers,
  Logger,
  LoggerOptions,
  SendResult,
  StorageAdapter,
  Transport,
} from '../src/types';

const NOW = 1_700_000_000_000;
const BASE: LoggerOptions = {
  endpoint: 'https://example.test/v1/logs',
  apiKey: 'pxl_test',
  appVersion: '1.0.0',
  platform: 'web',
};
const STORAGE_KEY = 'pixie-logger:queue';

type Call = { batch: LogBatch; keepalive: boolean };
type Script = (batch: LogBatch, callIndex: number) => SendResult | Promise<SendResult>;

function fakeTransport(script: Script = () => ({ outcome: 'sent', rejected: 0 })) {
  const calls: Call[] = [];
  let current = script;
  const transport: Transport = {
    send: async (batch, opts) => {
      calls.push({ batch: structuredClone(batch), keepalive: opts.keepalive });
      return current(batch, calls.length - 1);
    },
  };
  return {
    transport,
    calls,
    setScript(s: Script) {
      current = s;
    },
    names: () => calls.map((c) => c.batch.events.map((e) => e.event)),
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: StorageAdapter = {
    getItem: vi.fn(async (k: string) => data.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => void data.set(k, v)),
    removeItem: vi.fn(async (k: string) => void data.delete(k)),
  };
  return { storage, data };
}

const loggers: Logger[] = [];
function make(options: Partial<LoggerOptions>, transport: Transport): Logger {
  const logger = createLogger({ ...BASE, ...options }, { transport, now: () => NOW, random: () => 0.5 });
  loggers.push(logger);
  return logger;
}

let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  vi.useFakeTimers();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  for (const l of loggers.splice(0)) await l.shutdown();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('invalid options', () => {
  it.each([
    ['missing apiKey', { apiKey: '' }],
    ['unknown platform', { platform: 'windows' }],
  ])('%s → no-op logger with one warning, even without debug', async (_label, override) => {
    const t = fakeTransport();
    const logger = make(override as Partial<LoggerOptions>, t.transport);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    logger.error('boom');
    logger.info('x');
    await logger.flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.calls).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('filtering', () => {
  it('ignores levels below minLevel', async () => {
    const t = fakeTransport();
    const logger = make({ minLevel: 'warn' }, t.transport);
    logger.info('ignored');
    logger.warn('kept');
    await logger.flush();
    expect(t.names()).toEqual([['kept']]);
  });

  it('enabled: false ignores everything; setEnabled(true) re-enables', async () => {
    const t = fakeTransport();
    const logger = make({ enabled: false }, t.transport);
    logger.fatal('ignored');
    await vi.advanceTimersByTimeAsync(0);
    await logger.flush();
    expect(t.calls).toHaveLength(0);

    logger.setEnabled(true);
    logger.info('kept');
    await logger.flush();
    expect(t.names()).toEqual([['kept']]);
  });
});

describe('flush triggers', () => {
  it('sends queued events when the timer fires, with the right envelope', async () => {
    const t = fakeTransport();
    const logger = make({}, t.transport);
    logger.info('a');
    logger.info('b', { message: 'hello' });
    logger.warn('c');
    await vi.advanceTimersByTimeAsync(9_999);
    expect(t.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(t.calls).toHaveLength(1);
    const { batch, keepalive } = t.calls[0]!;
    expect(keepalive).toBe(false);
    expect(batch.appVersion).toBe('1.0.0');
    expect(batch.platform).toBe('web');
    expect(batch.sessionId).toMatch(/^[0-9a-f]{32}$/);
    expect(batch.sessionId).toBe(logger.sessionId);
    expect(batch.events).toEqual([
      { level: 'info', event: 'a', clientTs: new Date(NOW).toISOString() },
      { level: 'info', event: 'b', message: 'hello', clientTs: new Date(NOW).toISOString() },
      { level: 'warn', event: 'c', clientTs: new Date(NOW).toISOString() },
    ]);
  });

  it('flushes when the queue reaches batchSize, without waiting for the timer', async () => {
    const t = fakeTransport();
    const logger = make({ batchSize: 3 }, t.transport);
    logger.info('a');
    logger.info('b');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls).toHaveLength(0);
    logger.info('c');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.names()).toEqual([['a', 'b', 'c']]);
  });

  it('flushes immediately on error and fatal', async () => {
    const t = fakeTransport();
    const logger = make({}, t.transport);
    logger.info('a');
    logger.error('b');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.names()).toEqual([['a', 'b']]);
    logger.fatal('c');
    await vi.advanceTimersByTimeAsync(0);
    expect(t.names()).toEqual([['a', 'b'], ['c']]);
  });

  it('splits 45 events into batches of 20, 20, 5', async () => {
    const t = fakeTransport();
    const logger = make({ batchSize: 20 }, t.transport);
    for (let i = 0; i < 45; i++) logger.info(`e${i}`);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls.map((c) => c.batch.events.length)).toEqual([20, 20, 5]);
    expect(t.names().flat()).toEqual(Array.from({ length: 45 }, (_, i) => `e${i}`));
  });
});

describe('queue limits', () => {
  it('keeps only the newest maxQueueSize events', async () => {
    const t = fakeTransport(() => ({ outcome: 'retry' }));
    const logger = make({ maxQueueSize: 10, batchSize: 5, debug: true }, t.transport);
    for (let i = 0; i < 15; i++) logger.info(`e${i}`);
    await vi.advanceTimersByTimeAsync(0);
    expect(warnSpy).toHaveBeenCalledWith('[pixie-logger]', 'queue full, dropped 1 oldest events');

    t.setScript(() => ({ outcome: 'sent', rejected: 0 }));
    t.calls.length = 0;
    await logger.flush();
    expect(t.names().flat()).toEqual(['e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12', 'e13', 'e14']);
  });
});

describe('send outcomes', () => {
  it('sent and dropped remove the batch', async () => {
    const t = fakeTransport((_b, i) => (i === 0 ? { outcome: 'sent', rejected: 1 } : { outcome: 'dropped', status: 400 }));
    const logger = make({ batchSize: 2 }, t.transport);
    for (const n of ['a', 'b', 'c', 'd']) logger.info(n);
    await logger.flush();
    expect(t.names()).toEqual([['a', 'b'], ['c', 'd']]);

    await logger.flush();
    expect(t.calls).toHaveLength(2);
  });

  it('retry keeps the batch and stops the loop', async () => {
    const t = fakeTransport(() => ({ outcome: 'retry' }));
    const logger = make({ batchSize: 2 }, t.transport);
    for (const n of ['a', 'b', 'c', 'd']) logger.info(n);
    await logger.flush();
    expect(t.names()).toEqual([['a', 'b']]);

    t.setScript(() => ({ outcome: 'sent', rejected: 0 }));
    await logger.flush();
    expect(t.names()).toEqual([['a', 'b'], ['a', 'b'], ['c', 'd']]);
  });

  it('unauthorized keeps the batch, stops all later sends and warns once without debug', async () => {
    const t = fakeTransport(() => ({ outcome: 'unauthorized' }));
    const logger = make({ batchSize: 2 }, t.transport);
    for (const n of ['a', 'b', 'c']) logger.info(n);
    await logger.flush();
    expect(t.names()).toEqual([['a', 'b']]);

    logger.error('later');
    await vi.advanceTimersByTimeAsync(30_000);
    await logger.flush();
    expect(t.calls).toHaveLength(1);

    const authWarnings = warnSpy.mock.calls.filter((c) => String(c[1]).includes('API key rejected'));
    expect(authWarnings).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('concurrency', () => {
  it('only one flush runs at a time', async () => {
    const d = deferred<SendResult>();
    const t = fakeTransport(() => d.promise);
    const logger = make({}, t.transport);
    logger.info('a');
    const p1 = logger.flush();
    const p2 = logger.flush();
    expect(t.calls).toHaveLength(1);
    d.resolve({ outcome: 'sent', rejected: 0 });
    await Promise.all([p1, p2]);
    expect(t.calls).toHaveLength(1);
  });

  it('events logged while a send is in flight go in the next batch', async () => {
    const d = deferred<SendResult>();
    const t = fakeTransport((_b, i) => (i === 0 ? d.promise : { outcome: 'sent', rejected: 0 }));
    const logger = make({}, t.transport);
    logger.info('a');
    logger.info('b');
    const p = logger.flush();
    logger.info('c');
    logger.info('d');
    d.resolve({ outcome: 'sent', rejected: 0 });
    await p;
    expect(t.names()).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('never throws', () => {
  it('treats a throwing transport as retry', async () => {
    let n = 0;
    const t = fakeTransport(() => {
      n++;
      if (n === 1) throw new Error('network down');
      return { outcome: 'sent', rejected: 0 };
    });
    const logger = make({ batchSize: 1 }, t.transport);
    logger.info('a');
    logger.info('b');
    await expect(logger.flush()).resolves.toBeUndefined();
    expect(t.calls).toHaveLength(1);
    await logger.flush();
    expect(t.names()).toEqual([['a'], ['a'], ['b']]);
  });

  it('log and flush never throw on bad input', async () => {
    const t = fakeTransport(() => {
      throw new Error('x');
    });
    const logger = make({ debug: true }, t.transport);
    const exploding = {} as Record<string, unknown>;
    Object.defineProperty(exploding, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter');
      },
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => {
      logger.log('nope' as never, 'x');
      logger.info(null as unknown as string);
      logger.info('x', null as never);
      logger.info('x', 'string' as never);
      logger.info('x', { params: exploding });
      logger.info('x', { context: circular });
    }).not.toThrow();
    await expect(logger.flush()).resolves.toBeUndefined();
    await expect(logger.shutdown()).resolves.toBeUndefined();
  });
});

describe('persistence', () => {
  it('saves after the debounce and restores before new events, in separate batches', async () => {
    const { storage, data } = memoryStorage();
    const t1 = fakeTransport(() => ({ outcome: 'retry' }));
    const first = make({ storage }, t1.transport);
    first.info('old_a');
    first.info('old_b');
    await vi.advanceTimersByTimeAsync(999);
    expect(data.has(STORAGE_KEY)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const saved = JSON.parse(data.get(STORAGE_KEY)!);
    expect(saved.v).toBe(1);
    expect(saved.items.map((i: { event: { event: string } }) => i.event.event)).toEqual(['old_a', 'old_b']);

    // Simulate an app restart: a new logger reading the same storage.
    const t2 = fakeTransport();
    const second = make({ storage }, t2.transport);
    second.info('new_a'); // logged before the async restore completes
    expect(second.sessionId).not.toBe(first.sessionId);
    await vi.advanceTimersByTimeAsync(0);

    expect(t2.names()).toEqual([['old_a', 'old_b'], ['new_a']]);
    expect(t2.calls[0]!.batch.sessionId).toBe(first.sessionId);
    expect(t2.calls[1]!.batch.sessionId).toBe(second.sessionId);

    await vi.advanceTimersByTimeAsync(1000);
    expect(JSON.parse(data.get(STORAGE_KEY)!)).toEqual({ v: 1, items: [] });
  });

  it('removes corrupt stored data', async () => {
    const { storage, data } = memoryStorage({ [STORAGE_KEY]: '{not json' });
    const t = fakeTransport();
    make({ storage }, t.transport);
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(data.has(STORAGE_KEY)).toBe(false);
  });

  it('removes stored data with the wrong shape and skips invalid items', async () => {
    const { storage } = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ v: 2, items: [] }) });
    make({ storage }, fakeTransport().transport);
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);

    const good = { event: { level: 'info', event: 'ok', clientTs: 'x' }, sessionId: 's', appVersion: '0.9' };
    const { storage: s2 } = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({ v: 1, items: [good, { event: {} }, null, { ...good, sessionId: 1 }] }),
    });
    const t = fakeTransport();
    make({ storage: s2 }, t.transport);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.names()).toEqual([['ok']]);
    expect(t.calls[0]!.batch.appVersion).toBe('0.9');
  });
});

describe('lifecycle', () => {
  function fakeLifecycle() {
    let handlers: LifecycleHandlers | null = null;
    const unsubscribe = vi.fn();
    const lifecycle: LifecycleAdapter = {
      subscribe: vi.fn((h: LifecycleHandlers) => {
        handlers = h;
        return unsubscribe;
      }),
    };
    return { lifecycle, unsubscribe, handlers: () => handlers! };
  }

  it('onBackground saves immediately and flushes with keepalive', async () => {
    const { storage } = memoryStorage();
    const lc = fakeLifecycle();
    const t = fakeTransport();
    const logger = make({ storage, lifecycle: lc.lifecycle }, t.transport);
    logger.info('a');
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.setItem).not.toHaveBeenCalled();

    lc.handlers().onBackground();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.setItem).toHaveBeenCalled();
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.keepalive).toBe(true);
  });

  it('onForeground flushes', async () => {
    const lc = fakeLifecycle();
    const t = fakeTransport();
    const logger = make({ lifecycle: lc.lifecycle }, t.transport);
    logger.info('a');
    lc.handlers().onForeground();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.keepalive).toBe(false);
  });

  it('shutdown unsubscribes, flushes, stops the timer and ignores later logs', async () => {
    const { storage, data } = memoryStorage();
    const lc = fakeLifecycle();
    const t = fakeTransport();
    const logger = make({ storage, lifecycle: lc.lifecycle }, t.transport);
    logger.info('a');
    await logger.shutdown();

    expect(lc.unsubscribe).toHaveBeenCalledTimes(1);
    expect(t.names()).toEqual([['a']]);
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.parse(data.get(STORAGE_KEY)!)).toEqual({ v: 1, items: [] });

    logger.error('after');
    await vi.advanceTimersByTimeAsync(60_000);
    await logger.flush();
    expect(t.calls).toHaveLength(1);
  });
});

describe('review fixes (task 1b)', () => {
  type SavedItem = { event: { event: string } };
  const savedNames = (raw: string): string[] => JSON.parse(raw).items.map((i: SavedItem) => i.event.event);

  it('#1: onBackground during a running flush makes the remaining batches keepalive', async () => {
    const d = deferred<SendResult>();
    const t = fakeTransport((_b, i) => (i === 0 ? d.promise : { outcome: 'sent', rejected: 0 }));
    let handlers: LifecycleHandlers | null = null;
    const lifecycle: LifecycleAdapter = {
      subscribe: (h) => {
        handlers = h;
        return () => {};
      },
    };
    const logger = make({ batchSize: 20, lifecycle }, t.transport);
    for (let i = 0; i < 25; i++) logger.info(`e${i}`);

    const p = logger.flush();
    expect(t.calls).toHaveLength(1);
    handlers!.onBackground();
    d.resolve({ outcome: 'sent', rejected: 0 });
    await p;

    expect(t.calls.map((c) => [c.batch.events.length, c.keepalive])).toEqual([
      [20, false],
      [5, true],
    ]);

    logger.info('later');
    await logger.flush();
    expect(t.calls[2]!.keepalive).toBe(false);
  });

  it('#2: a huge flushIntervalMs is capped instead of firing immediately', async () => {
    const t = fakeTransport();
    const logger = make({ flushIntervalMs: 3_000_000_000 }, t.transport);
    logger.info('a');
    await vi.advanceTimersByTimeAsync(100);
    expect(t.calls).toHaveLength(0);
  });

  it('#5: saves only the newest events up to 512 KB but still sends all of them', async () => {
    const { storage, data } = memoryStorage();
    const t = fakeTransport(() => ({ outcome: 'retry' }));
    const logger = make({ storage, maxQueueSize: 500 }, t.transport);
    const params = { data: 'x'.repeat(7000) };
    for (let i = 0; i < 100; i++) logger.info(`e${i}`, { params });
    await vi.advanceTimersByTimeAsync(1000);

    const raw = data.get(STORAGE_KEY)!;
    expect(utf8ByteLength(raw)).toBeLessThanOrEqual(512 * 1024);
    const saved = JSON.parse(raw);
    expect(saved.v).toBe(1);
    const n = saved.items.length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(100);
    expect(savedNames(raw)).toEqual(Array.from({ length: n }, (_, i) => `e${100 - n + i}`));

    t.setScript(() => ({ outcome: 'sent', rejected: 0 }));
    t.calls.length = 0;
    await logger.flush();
    expect(t.names().flat()).toHaveLength(100);
  });

  it('#5: a failing save warns once without debug', async () => {
    const storage: StorageAdapter = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('quota exceeded');
      },
      removeItem: async () => {},
    };
    const t = fakeTransport(() => ({ outcome: 'retry' }));
    const logger = make({ storage }, t.transport);
    logger.info('a');
    await vi.advanceTimersByTimeAsync(1000);
    logger.info('b');
    await vi.advanceTimersByTimeAsync(1000);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![1]).toBe('failed to save queue');
  });

  it('#7: after unauthorized, new events are ignored and no flush is scheduled', async () => {
    const { storage, data } = memoryStorage();
    const t = fakeTransport(() => ({ outcome: 'unauthorized' }));
    const logger = make({ storage }, t.transport);
    logger.info('a');
    logger.info('b');
    await logger.flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(savedNames(data.get(STORAGE_KEY)!)).toEqual(['a', 'b']);

    logger.info('c');
    logger.error('d');
    expect(vi.getTimerCount()).toBe(1); // only the flush interval

    await logger.shutdown();
    expect(savedNames(data.get(STORAGE_KEY)!)).toEqual(['a', 'b']);
    expect(t.calls).toHaveLength(1);
  });

  it('#10: restore skips items with a bad level, event name, sessionId or appVersion', async () => {
    const good = { event: { level: 'info', event: 'ok', clientTs: 'x' }, sessionId: 's', appVersion: '0.9' };
    const { storage } = memoryStorage({
      [STORAGE_KEY]: JSON.stringify({
        v: 1,
        items: [
          good,
          { ...good, event: { ...good.event, level: 'trace' } },
          { ...good, event: { ...good.event, event: 'Bad Name' } },
          { ...good, sessionId: '' },
          { ...good, appVersion: 'v'.repeat(51) },
        ],
      }),
    });
    const t = fakeTransport();
    make({ storage }, t.transport);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.names()).toEqual([['ok']]);
  });
});

describe('storage errors (task 3b)', () => {
  it('a failed startup read turns saving off for the session but still sends events', async () => {
    const storage: StorageAdapter = {
      getItem: vi.fn(async () => {
        throw new Error('read failed');
      }),
      setItem: vi.fn(async () => {}),
      removeItem: vi.fn(async () => {}),
    };
    const t = fakeTransport();
    const logger = make({ storage }, t.transport);
    await vi.advanceTimersByTimeAsync(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    logger.info('a');
    await vi.advanceTimersByTimeAsync(1000);
    logger.info('b');
    await logger.flush();
    await vi.advanceTimersByTimeAsync(2000);

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(t.names().flat()).toEqual(['a', 'b']);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('a failed save deletes the old saved queue so it is not restored again', async () => {
    const old = { event: { level: 'info', event: 'old_a', clientTs: 'x' }, sessionId: 's', appVersion: '0.9' };
    const { storage, data } = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ v: 1, items: [old] }) });
    const t1 = fakeTransport();
    make({ storage }, t1.transport);
    await vi.advanceTimersByTimeAsync(0);
    expect(t1.names()).toEqual([['old_a']]);

    vi.mocked(storage.setItem).mockImplementation(async () => {
      throw new Error('quota exceeded');
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.setItem).toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(data.has(STORAGE_KEY)).toBe(false);

    const t2 = fakeTransport();
    const second = make({ storage }, t2.transport);
    await vi.advanceTimersByTimeAsync(0);
    await second.flush();
    expect(t2.calls).toHaveLength(0);
  });

  it('a failed save whose cleanup also fails does not throw and warns once', async () => {
    const storage: StorageAdapter = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('quota exceeded');
      },
      removeItem: vi.fn(async () => {
        throw new Error('remove failed');
      }),
    };
    const t = fakeTransport(() => ({ outcome: 'retry' }));
    const logger = make({ storage }, t.transport);
    logger.info('a');
    await vi.advanceTimersByTimeAsync(1000);
    logger.info('b');
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]![1]).toBe('failed to save queue');
  });
});

describe('retry with backoff (task 2)', () => {
  // Clock that follows the fake timers, so `retryAt` expires as time advances.
  function makeTimed(options: Partial<LoggerOptions>, transport: Transport): Logger {
    const logger = createLogger(
      { ...BASE, ...options },
      { transport, now: () => Date.now(), random: () => 0.5 },
    );
    loggers.push(logger);
    return logger;
  }

  it('interval and error-level flushes do not send during backoff; the retry timer does', async () => {
    const t = fakeTransport((_b, i) => (i === 0 ? { outcome: 'retry' } : { outcome: 'sent', rejected: 0 }));
    const logger = makeTimed({ flushIntervalMs: 1000, debug: true }, t.transport);
    logger.info('a');
    await logger.flush();
    expect(t.calls).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith('[pixie-logger]', 'send failed, retrying in 5s');

    logger.error('b'); // size/level trigger: skipped while backing off
    await vi.advanceTimersByTimeAsync(4999); // four interval ticks
    expect(t.calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(t.names()).toEqual([['a'], ['a', 'b']]);
  });

  it('the retry timer sends even when the interval is long', async () => {
    const t = fakeTransport((_b, i) => (i === 0 ? { outcome: 'retry' } : { outcome: 'sent', rejected: 0 }));
    const logger = makeTimed({ flushIntervalMs: 600_000 }, t.transport);
    logger.info('a');
    await logger.flush();
    await vi.advanceTimersByTimeAsync(4999);
    expect(t.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.calls).toHaveLength(2);
  });

  it('uses retryAfterMs instead of the backoff delay', async () => {
    const t = fakeTransport((_b, i) =>
      i === 0 ? { outcome: 'retry', retryAfterMs: 30_000 } : { outcome: 'sent', rejected: 0 },
    );
    const logger = makeTimed({ flushIntervalMs: 1000 }, t.transport);
    logger.info('a');
    await logger.flush();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(t.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.calls).toHaveLength(2);
  });

  it('a success after retries resets the delay to 5 s', async () => {
    const t = fakeTransport((_b, i) => (i === 2 ? { outcome: 'sent', rejected: 0 } : { outcome: 'retry' }));
    const logger = makeTimed({ flushIntervalMs: 600_000 }, t.transport);
    logger.info('a');
    await logger.flush(); // fail #1 → 5 s
    await vi.advanceTimersByTimeAsync(5000); // fail #2 → 10 s
    expect(t.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(9999);
    expect(t.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); // success
    expect(t.calls).toHaveLength(3);

    logger.info('b');
    await logger.flush(); // fail → back to 5 s
    expect(t.calls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(4999);
    expect(t.calls).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.calls).toHaveLength(5);
  });

  it('flush() and a background flush send immediately during backoff', async () => {
    let handlers: LifecycleHandlers | null = null;
    const lifecycle: LifecycleAdapter = {
      subscribe: (h) => {
        handlers = h;
        return () => {};
      },
    };
    const t = fakeTransport(() => ({ outcome: 'retry' }));
    const logger = makeTimed({ flushIntervalMs: 600_000, lifecycle }, t.transport);
    logger.info('a');
    await logger.flush();
    expect(t.calls).toHaveLength(1);

    await logger.flush();
    expect(t.calls).toHaveLength(2);

    handlers!.onBackground();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.calls).toHaveLength(3);
    expect(t.calls[2]!.keepalive).toBe(true);
  });

  it('shutdown clears the retry timer', async () => {
    const t = fakeTransport(() => ({ outcome: 'retry' }));
    const logger = makeTimed({}, t.transport);
    logger.info('a');
    await logger.flush();
    await logger.shutdown();
    expect(vi.getTimerCount()).toBe(0);
  });
});
