import { utf8ByteLength } from '@pixie-logger/shared';
import type { LogBatch } from '@pixie-logger/shared';
import type { SendResult, Transport } from './types';
import { isRecord } from './util';

export const REQUEST_TIMEOUT_MS = 10_000;
export const KEEPALIVE_MAX_BYTES = 60 * 1024;
export const MAX_RETRY_AFTER_MS = 5 * 60_000;

/** `Retry-After` as a whole number of seconds → ms (capped). HTTP dates and anything else → undefined. */
export function parseRetryAfter(header: string | null): number | undefined {
  if (typeof header !== 'string') return undefined;
  const value = header.trim();
  if (!/^\d+$/.test(value)) return undefined;
  const ms = Number(value) * 1000;
  return Number.isFinite(ms) ? Math.min(ms, MAX_RETRY_AFTER_MS) : MAX_RETRY_AFTER_MS;
}

function resolveFetch(custom: typeof fetch | undefined): typeof fetch | undefined {
  if (typeof custom === 'function') return custom;
  const g = globalThis as { fetch?: typeof fetch };
  // Unbound `fetch` throws "Illegal invocation" in browsers.
  return typeof g.fetch === 'function' ? g.fetch.bind(globalThis) : undefined;
}

async function countRejected(res: Response): Promise<number> {
  try {
    const body: unknown = await res.json();
    return isRecord(body) && Array.isArray(body.rejected) ? body.rejected.length : 0;
  } catch {
    return 0;
  }
}

export function createFetchTransport(opts: {
  endpoint: string;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Transport {
  const doFetch = resolveFetch(opts.fetch);
  const timeoutMs =
    typeof opts.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? opts.timeoutMs
      : REQUEST_TIMEOUT_MS;

  async function send(batch: LogBatch, sendOpts: { keepalive: boolean }): Promise<SendResult> {
    if (!doFetch) return { outcome: 'retry' };

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const body = JSON.stringify(batch);
      const useKeepalive = sendOpts?.keepalive === true && utf8ByteLength(body) <= KEEPALIVE_MAX_BYTES;

      let signal: AbortSignal | undefined;
      if (typeof AbortController === 'function') {
        const controller = new AbortController();
        signal = controller.signal;
        timer = setTimeout(() => controller.abort(), timeoutMs);
      }

      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': opts.apiKey },
        body,
      };
      if (useKeepalive) init.keepalive = true;
      if (signal) init.signal = signal;

      const res = await doFetch(opts.endpoint, init);
      const status = res.status;

      if (status >= 200 && status < 300) return { outcome: 'sent', rejected: await countRejected(res) };
      if (status === 401) return { outcome: 'unauthorized' };
      if (status === 429) {
        const retryAfterMs = parseRetryAfter(res.headers?.get('Retry-After') ?? null);
        return retryAfterMs === undefined ? { outcome: 'retry' } : { outcome: 'retry', retryAfterMs };
      }
      if (status >= 500) return { outcome: 'retry' };
      return { outcome: 'dropped', status };
    } catch {
      // Network error, abort/timeout, or anything unexpected.
      return { outcome: 'retry' };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return { send };
}
