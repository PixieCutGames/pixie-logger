# Technical Spec — Phase 3, Task 2: Transport and Retry

> **Prerequisite:** [01-core.tech.md](01-core.tech.md) and [01b-review-fixes.tech.md](01b-review-fixes.tech.md) are done (placeholder `createFetchTransport` exists).
>
> **Keep from Task 1b:** `keepalive` comes from the `keepaliveRequested` state (set by `flush({ keepalive: true })` even when it joins a running flush), not from a `runFlush` argument. The internal `flush({ keepalive, force })` below must keep that behaviour, and `log()` keeps returning early when `blocked`.

Design reference: [02-transport.md](02-transport.md).

## Rules for the agent

1. Only create or modify the files listed below.
2. Same platform rules as Task 1: no `window`, `document`, `navigator`, Node APIs, or zod in `packages/logger/src`.
3. Don't change the public API from Task 1.
4. pnpm only. Do not commit. Finish by running "Verification" and reporting the output.

## Files

### Replace `packages/logger/src/transport.ts`

```ts
export const REQUEST_TIMEOUT_MS = 10_000;
export const KEEPALIVE_MAX_BYTES = 60 * 1024;
export const MAX_RETRY_AFTER_MS = 5 * 60_000;

export function createFetchTransport(opts: {
  endpoint: string;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Transport

export function parseRetryAfter(header: string | null): number | undefined
```

**`fetch` resolution:** `opts.fetch` if given, else `globalThis.fetch.bind(globalThis)` (unbound `fetch` throws "Illegal invocation" in browsers). If neither exists, `send` always returns `{ outcome: 'retry' }`.

**`send(batch, { keepalive })`:**
1. `body = JSON.stringify(batch)`.
2. `useKeepalive = keepalive && utf8ByteLength(body) <= KEEPALIVE_MAX_BYTES`.
3. Timeout: if `AbortController` exists, create one and `setTimeout(() => controller.abort(), timeoutMs)`; clear the timeout in `finally`. Without `AbortController`, no timeout.
4. `fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey }, body, keepalive: useKeepalive || undefined, signal })`. Only set `keepalive` when true.
5. Map the result:

| Result | Return |
|---|---|
| Throws (network error, abort/timeout) | `{ outcome: 'retry' }` |
| `202` (or any `2xx`) | `{ outcome: 'sent', rejected }`, where `rejected` is `body.rejected.length` from the JSON response; `0` if the body can't be parsed |
| `401` | `{ outcome: 'unauthorized' }` |
| `429` | `{ outcome: 'retry', retryAfterMs: parseRetryAfter(res.headers.get('Retry-After')) }` |
| `5xx` | `{ outcome: 'retry' }` |
| any other status | `{ outcome: 'dropped', status }` |

Never throws. For non-`2xx` responses, don't read the body (avoid extra work).

**`parseRetryAfter`:** a whole number of seconds (`/^\d+$/`) → that many ms, capped at `MAX_RETRY_AFTER_MS`. Anything else (including HTTP dates) → `undefined`.

### Create `packages/logger/src/backoff.ts`

```ts
export interface Backoff { next(): number; reset(): void; readonly attempts: number; }

export function createBackoff(opts?: {
  baseMs?: number;    // default 5_000
  maxMs?: number;     // default 300_000
  jitter?: number;    // default 0.2
  random?: () => number;
}): Backoff
```

`next()`: `raw = min(maxMs, baseMs * 2 ** attempts)`, then `delay = raw * (1 + (random() * 2 - 1) * jitter)`, rounded, then `attempts++`. `reset()` sets `attempts = 0`.

### Modify `packages/logger/src/logger.ts`

Add retry scheduling:

- State: `backoff = createBackoff({ random })`, `retryAt = 0`, `retryTimer`.
- In the flush loop, on `retry`: `delay = result.retryAfterMs ?? backoff.next()`; `retryAt = now() + delay`; clear any existing `retryTimer` and set `retryTimer = setTimeout(() => void flush(), delay)`; `warn('send failed, retrying in Ns')`; stop the loop.
- On `sent` or `dropped`: `backoff.reset()`, `retryAt = 0`.
- **Timer-triggered and size-triggered flushes** (interval, batch-size, error-level) skip sending while `now() < retryAt`.
- **Forced flushes ignore `retryAt`:** public `flush()`, background flush, foreground flush, the `retryTimer` itself, and the startup flush after restoring.
- `shutdown()` also clears `retryTimer`.

Implement this as an internal `flush({ keepalive, force })`; the interval and log-triggered flushes pass `force: false`, everything else `force: true`.

## Tests

### `packages/logger/test/transport.test.ts` (mocked `fetch` via `vi.fn()`)

1. Request: method `POST`, URL = endpoint, headers include `Content-Type: application/json` and `X-Api-Key`, body equals the batch.
2. `202` with `{ accepted: 2, rejected: [{index:1, errors:[]}] }` → `{ outcome: 'sent', rejected: 1 }`; `202` with a non-JSON body → `rejected: 0`.
3. `400`, `403`, `404`, `413` → `dropped` with that status.
4. `401` → `unauthorized`.
5. `429` with `Retry-After: 30` → `retryAfterMs: 30000`; with `Retry-After: 99999` → capped at 300000; with an HTTP date → `retryAfterMs` undefined.
6. `500`, `503` → `retry`.
7. `fetch` rejects → `retry`.
8. Timeout: `fetch` that never resolves until aborted, `timeoutMs: 50` with fake timers → `retry` after advancing 50 ms; the signal was aborted.
9. `keepalive: true` with a small body → `fetch` called with `keepalive: true`; with a 70 KB body → `keepalive` not set.
10. Default fetch: when `opts.fetch` is omitted, `globalThis.fetch` is called with `this === globalThis` (stub `globalThis.fetch` in the test and restore it after).

### `packages/logger/test/backoff.test.ts`

1. With `random = () => 0.5` (no jitter effect): 5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000.
2. With `random = () => 0` → 20 % less; `() => 1` → 20 % more (first value 4000 and 6000).
3. `reset()` returns to 5000.

### Add to `packages/logger/test/logger.test.ts`

1. Transport returns `retry` → no further sends on interval ticks until the backoff delay passes; then the retry timer sends.
2. `retryAfterMs: 30000` is used instead of backoff.
3. A success after retries resets the delay to 5 s for the next failure.
4. `flush()` during backoff sends immediately; background flush during backoff sends with `keepalive: true`.

## Verification

1. `pnpm test` — all pass.
2. `pnpm typecheck` — no errors.
3. The same `grep` checks as Task 1 (no browser/Node globals, no zod in `packages/logger/src`).

## Done when

- `transport.ts` and `backoff.ts` are implemented, the logger uses them, and all tests pass.
