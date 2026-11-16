import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogBatch } from '@pixie-logger/shared';
import { createFetchTransport, MAX_RETRY_AFTER_MS, parseRetryAfter } from '../src/transport';

const ENDPOINT = 'https://example.test/v1/logs';
const API_KEY = 'pxl_test';

const BATCH: LogBatch = {
  appVersion: '1.0.0',
  platform: 'web',
  sessionId: 'sess',
  events: [
    { level: 'info', event: 'a', clientTs: '2026-01-01T00:00:00.000Z' },
    { level: 'warn', event: 'b', clientTs: '2026-01-01T00:00:01.000Z' },
  ],
};

function response(status: number, body: string | null = null, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : body, { status, headers });
}

function make(fetchImpl: (...args: Parameters<typeof fetch>) => Promise<Response>, timeoutMs?: number) {
  const fetchMock = vi.fn(fetchImpl);
  const transport = createFetchTransport({
    endpoint: ENDPOINT,
    apiKey: API_KEY,
    fetch: fetchMock as unknown as typeof fetch,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });
  return { transport, fetchMock };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createFetchTransport', () => {
  it('sends a POST with JSON headers, the API key and the batch as body', async () => {
    const { transport, fetchMock } = make(async () => response(202, '{"accepted":2,"rejected":[]}'));
    await transport.send(BATCH, { keepalive: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json', 'X-Api-Key': API_KEY });
    expect(JSON.parse(init?.body as string)).toEqual(BATCH);
  });

  it('202 → sent with the number of rejected events; unparseable body → rejected 0', async () => {
    const ok = make(async () =>
      response(202, JSON.stringify({ accepted: 2, rejected: [{ index: 1, errors: [] }] })),
    );
    expect(await ok.transport.send(BATCH, { keepalive: false })).toEqual({ outcome: 'sent', rejected: 1 });

    const bad = make(async () => response(202, 'not json'));
    expect(await bad.transport.send(BATCH, { keepalive: false })).toEqual({ outcome: 'sent', rejected: 0 });
  });

  it.each([400, 403, 404, 413])('%i → dropped with that status', async (status) => {
    const { transport } = make(async () => response(status, '{}'));
    expect(await transport.send(BATCH, { keepalive: false })).toEqual({ outcome: 'dropped', status });
  });

  it('401 → unauthorized', async () => {
    const { transport } = make(async () => response(401, '{}'));
    expect(await transport.send(BATCH, { keepalive: false })).toEqual({ outcome: 'unauthorized' });
  });

  it('429 → retry with Retry-After seconds, capped; an HTTP date is ignored', async () => {
    const r30 = make(async () => response(429, null, { 'Retry-After': '30' }));
    expect(await r30.transport.send(BATCH, { keepalive: false })).toEqual({ outcome: 'retry', retryAfterMs: 30_000 });

    const rBig = make(async () => response(429, null, { 'Retry-After': '99999' }));
    expect(await rBig.transport.send(BATCH, { keepalive: false })).toEqual({
      outcome: 'retry',
      retryAfterMs: 300_000,
    });

    const rDate = make(async () => response(429, null, { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }));
    const result = await rDate.transport.send(BATCH, { keepalive: false });
    expect(result.outcome).toBe('retry');
    expect((result as { retryAfterMs?: number }).retryAfterMs).toBeUndefined();
  });

  it.each([500, 503])('%i → retry', async (status) => {
    const { transport } = make(async () => response(status, '{}'));
    expect(await transport.send(BATCH, { keepalive: false })).toEqual({ outcome: 'retry' });
  });

  it('fetch rejecting → retry', async () => {
    const { transport } = make(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await transport.send(BATCH, { keepalive: false })).toEqual({ outcome: 'retry' });
  });

  it('times out: aborts the request and returns retry', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const { transport } = make(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
      50,
    );

    let result: unknown;
    const pending = transport.send(BATCH, { keepalive: false }).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(49);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(result).toEqual({ outcome: 'retry' });
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keepalive only for bodies up to 60 KB', async () => {
    const { transport, fetchMock } = make(async () => response(202, '{"accepted":1,"rejected":[]}'));
    await transport.send(BATCH, { keepalive: true });
    expect(fetchMock.mock.calls[0]![1]?.keepalive).toBe(true);

    const big: LogBatch = {
      ...BATCH,
      events: [{ level: 'info', event: 'big', clientTs: 'x', params: { data: 'x'.repeat(70 * 1024) } }],
    };
    await transport.send(big, { keepalive: true });
    expect(fetchMock.mock.calls[1]![1]).not.toHaveProperty('keepalive');

    await transport.send(BATCH, { keepalive: false });
    expect(fetchMock.mock.calls[2]![1]).not.toHaveProperty('keepalive');
  });

  it('uses globalThis.fetch bound to globalThis when no fetch is given', async () => {
    let self: unknown;
    const globalFetch = vi.fn(function (this: unknown) {
      self = this;
      return Promise.resolve(response(202, '{"accepted":2,"rejected":[]}'));
    });
    vi.stubGlobal('fetch', globalFetch);

    const transport = createFetchTransport({ endpoint: ENDPOINT, apiKey: API_KEY });
    expect(await transport.send(BATCH, { keepalive: false })).toEqual({ outcome: 'sent', rejected: 0 });
    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(self).toBe(globalThis);
  });

  it('without any fetch, always returns retry', async () => {
    vi.stubGlobal('fetch', undefined);
    const transport = createFetchTransport({ endpoint: ENDPOINT, apiKey: API_KEY });
    expect(await transport.send(BATCH, { keepalive: false })).toEqual({ outcome: 'retry' });
  });
});

describe('parseRetryAfter', () => {
  it.each([
    ['30', 30_000],
    ['0', 0],
    ['99999', MAX_RETRY_AFTER_MS],
    [null, undefined],
    ['', undefined],
    ['1.5', undefined],
    ['-5', undefined],
    ['Wed, 21 Oct 2026 07:28:00 GMT', undefined],
  ])('%s → %s', (header, expected) => {
    expect(parseRetryAfter(header)).toBe(expected);
  });
});
