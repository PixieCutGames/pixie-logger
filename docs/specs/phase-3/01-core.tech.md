# Technical Spec — Phase 3, Task 1: Core Logger

> **Prerequisite:** Phases 1 and 2 complete. `pnpm test` and `pnpm typecheck` pass at the repo root.
> Execution order for Phase 3: **1 → 2 → 3 → 4 → 5**.

Design reference: [01-core.md](01-core.md) — the source of truth for option names, defaults, the redaction list and behaviour.

## Rules for the agent

1. Only create or modify the files listed in "Files" below.
2. Do not change the contract in `packages/shared` beyond what "Modify packages/shared" says. If something conflicts, **stop and report it**.
3. **Platform-neutral code only.** In `packages/logger/src/` (except `web.ts`, which is Task 3), do not reference `window`, `document`, `localStorage`, `navigator`, `Buffer`, `process` or any Node module. Allowed globals: `setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `fetch`, `AbortController`, `console`, `Date`, `Math`, `JSON`, and `globalThis.crypto` **only behind an existence check**.
4. **Never import zod** in `packages/logger`, directly or through a value import from a zod-using module. Import from `@pixie-logger/shared` only: constants (`LIMITS`, `LOG_LEVELS`, `PLATFORMS`, `EVENT_NAME_PATTERN`), `utf8ByteLength`, `levelAtLeast`, and **types** (with `import type`).
5. Nothing exported by the logger may throw at runtime. Wrap entry points in try/catch.
6. pnpm only. Do not commit. Finish by running "Verification" and reporting the output.

## Modify `packages/shared`

The client must be able to use the event-name rule without pulling in zod.

1. In `src/constants.ts`, add (moved from `schemas.ts`, same value):
   ```ts
   export const EVENT_NAME_PATTERN = /^[a-z0-9][a-z0-9_.:-]*$/;
   ```
2. In `src/schemas.ts`, delete its own `EVENT_NAME_PATTERN` declaration and **import** it from `./constants` instead. Do **not** re-export it from `schemas.ts` (it's already exported from the package root via `constants`).
3. Update any file in `packages/shared` that imports `EVENT_NAME_PATTERN` from `./schemas` / `../src/schemas` to import from `constants` (or the package root).
4. In `packages/shared/package.json`, add `"sideEffects": false`.

`pnpm test` must still pass for `packages/shared` with no other changes.

## Create `packages/logger`

### `package.json`

```json
{
  "name": "@pixie-logger/logger",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

(Task 4 replaces the entry fields with built output.) Then:

```
pnpm --filter @pixie-logger/logger add -D @pixie-logger/shared@workspace:* typescript vitest
```

`@pixie-logger/shared` **must be a devDependency**, not a dependency: Task 4 bundles it, and apps installing the packed logger must not try to download it.

### `tsconfig.json`

Same as `packages/shared/tsconfig.json`, except `"lib": ["ES2022", "DOM"]` (needed for `fetch` / `AbortController` types and, in Task 3, the web adapter). Rule 3 above still applies: DOM *types* are available, DOM *usage* is not allowed outside `web.ts`.

### `src/types.ts`

```ts
import type { LogLevel, Platform, LogEvent, LogBatch } from '@pixie-logger/shared';

export interface LogOptions {
  message?: string;
  route?: string;
  params?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface LifecycleHandlers { onBackground(): void; onForeground(): void; }
export interface LifecycleAdapter {
  /** Starts listening; returns a function that stops listening. */
  subscribe(handlers: LifecycleHandlers): () => void;
}

export type SendResult =
  | { outcome: 'sent'; rejected: number }
  | { outcome: 'dropped'; status: number }
  | { outcome: 'unauthorized' }
  | { outcome: 'retry'; retryAfterMs?: number };

export interface Transport {
  send(batch: LogBatch, opts: { keepalive: boolean }): Promise<SendResult>;
}

export interface LoggerOptions {
  endpoint: string;
  apiKey: string;
  appVersion: string;
  platform: Platform;
  minLevel?: LogLevel;
  enabled?: boolean;
  flushIntervalMs?: number;
  batchSize?: number;
  maxQueueSize?: number;
  redactKeys?: string[];
  storage?: StorageAdapter;
  lifecycle?: LifecycleAdapter;
  debug?: boolean;
  fetch?: typeof fetch;
}

export interface Logger {
  debug(event: string, options?: LogOptions): void;
  info(event: string, options?: LogOptions): void;
  warn(event: string, options?: LogOptions): void;
  error(event: string, options?: LogOptions): void;
  fatal(event: string, options?: LogOptions): void;
  log(level: LogLevel, event: string, options?: LogOptions): void;
  flush(): Promise<void>;
  setEnabled(enabled: boolean): void;
  shutdown(): Promise<void>;
  readonly sessionId: string;
}

/** Internal: test seams. Not part of the documented API. */
export interface LoggerDeps {
  transport?: Transport;
  now?: () => number;
  random?: () => number;
}

export interface QueueItem { event: LogEvent; sessionId: string; appVersion: string; }
```

### `src/sanitize.ts`

```ts
export const DEFAULT_REDACT_SUBSTRINGS: readonly string[]  // password, passwd, token, secret, apikey, authorization, cookie, sessionid, email, phone, creditcard, cardnumber, nationalid
export const DEFAULT_REDACT_SUFFIXES: readonly string[]    // otp, cvv, iban, pin
export const REDACTED = '[REDACTED]';

export function normalizeKey(key: string): string           // lowercase, remove '-' and '_'
export function makeKeyRedactor(extraKeys: readonly string[]): (key: string) => boolean
export function sanitizeRecord(
  value: Record<string, unknown>,
  shouldRedact: (key: string) => boolean,
): Record<string, unknown>
```

`makeKeyRedactor`: a key is redacted if its normalised form **contains** any substring entry, **equals or ends with** any suffix entry, or **equals** the normalised form of any `extraKeys` entry.

`sanitizeRecord` walks the value recursively with these rules (depth starts at 1 for the record's own keys):

| Input | Output |
|---|---|
| key matched by `shouldRedact` (any depth) | `'[REDACTED]'` (value not inspected) |
| `null`, boolean, string | unchanged |
| finite number | unchanged; `NaN` / `±Infinity` → `null` |
| `bigint` | `value.toString()` |
| `undefined`, function, symbol | **key omitted** in objects; `null` inside arrays |
| `Date` | `toISOString()`, or `null` if invalid |
| `Error` (`instanceof Error`) | `{ name, message }` (no stack, no other props) |
| array | each element sanitised |
| other object | own enumerable string keys, sanitised |
| an ancestor already being visited | `'[Circular]'` |
| depth greater than 5 | `'[Truncated]'` (any value, including primitives) |

Track ancestors (not every object seen), so the same object referenced twice in sibling positions is serialised twice, not marked circular.

### `src/event.ts`

```ts
export type BuildResult = { ok: true; event: LogEvent } | { ok: false; reason: string };

export function buildEvent(
  level: LogLevel,
  name: string,
  options: LogOptions | undefined,
  nowMs: number,
  shouldRedact: (key: string) => boolean,
): BuildResult
```

Steps:
1. `name` must be a string, 1–`LIMITS.eventNameMax` chars, matching `EVENT_NAME_PATTERN` → else `{ ok: false, reason: 'invalid event name "<name>"' }`.
2. `message` / `route`: if strings, truncate to `LIMITS.messageMax` / `LIMITS.routeMax`; non-strings are ignored.
3. `params` / `context`: if plain objects (not arrays, not null), `sanitizeRecord`; otherwise ignored.
4. `clientTs = new Date(nowMs).toISOString()`.
5. Omit absent optional fields (no `undefined` values in the result).
6. Size: if `utf8ByteLength(JSON.stringify(event)) > LIMITS.maxEventBytes`, remove `context` and re-check, then remove `params` and re-check; still too big → `{ ok: false, reason: 'event too large' }`.

### `src/session.ts`

```ts
export function randomId(random: () => number): string   // 32 lowercase hex chars
```

Use `globalThis.crypto.getRandomValues` (16 bytes) if it exists and is a function; otherwise build from `random()`. Never throw.

### `src/backoff.ts` and `src/transport.ts` — placeholders

Task 2 implements these. For now create:

```ts
// transport.ts
export function createFetchTransport(_opts: { endpoint: string; apiKey: string; fetch?: typeof fetch }): Transport {
  return { send: async () => ({ outcome: 'retry' }) };   // replaced in Task 2
}
```

Do not create `backoff.ts` yet.

### `src/logger.ts`

```ts
export function createLogger(options: LoggerOptions, deps?: LoggerDeps): Logger
```

**Setup**
- `now = deps?.now ?? Date.now`, `random = deps?.random ?? Math.random`.
- Defaults from the design doc. Clamp `batchSize` to 1–`LIMITS.maxEventsPerBatch`; `maxQueueSize` to at least `batchSize`; `flushIntervalMs` to at least 1000.
- Truncate `appVersion` to `LIMITS.appVersionMax`.
- If `endpoint`, `apiKey` or `appVersion` is missing/empty, or `platform` isn't in `PLATFORMS`: return a logger that ignores everything (all methods no-ops, `flush` resolves), and `console.warn` once **regardless of `debug`** (a misconfigured logger must be noticed).
- `sessionId = randomId(random)`.
- `transport = deps?.transport ?? createFetchTransport({ endpoint, apiKey, fetch: options.fetch })`.
- `warn(...)` helper: `console.warn('[pixie-logger]', ...)` only when `debug` is true.

**State**: `queue: QueueItem[]`, `flushing: Promise<void> | null`, `blocked = false` (after 401), `enabled`, timers, `unsubscribeLifecycle`.

**`log(level, name, options)`** (all inside try/catch; `debug/info/...` call it):
1. Return if `!enabled`, or `!levelAtLeast(level, minLevel)`.
2. `buildEvent(...)`; on failure `warn(reason)` and return.
3. Push `{ event, sessionId, appVersion }`. If `queue.length > maxQueueSize`, remove from the front until it fits, and `warn('queue full, dropped N oldest events')`.
4. `schedulePersist()`.
5. If `queue.length >= batchSize` or `levelAtLeast(level, 'error')`: schedule a flush with `setTimeout(…, 0)` (one pending at a time).

**Batching** — `takeBatch()` returns the items for the next request **without removing them**: starting from `queue[0]`, take consecutive items with the same `sessionId` and `appVersion` as `queue[0]`, up to `batchSize`. Batch body: `{ appVersion, platform: options.platform, sessionId, events }` from those items.

**`flush(opts?: { keepalive?: boolean })`** (internal version takes `keepalive`; the public `flush()` passes `false`):
- If `flushing` is set, return it. Otherwise set it and clear it in `finally`.
- If `blocked` or queue empty → done.
- Loop while the queue is non-empty:
  1. `batch = takeBatch()`; `result = await transport.send(body, { keepalive })` (a thrown error counts as `{ outcome: 'retry' }`).
  2. `sent` / `dropped`: remove exactly those item **objects** from the queue (by identity, since the queue may have changed while waiting); `schedulePersist()`; warn on `rejected > 0` or `dropped`; continue.
  3. `unauthorized`: `blocked = true`; `console.warn` once **regardless of `debug`** ("API key rejected; logging paused for this session"); stop.
  4. `retry`: stop (Task 2 adds backoff here).
- Never rejects.

**Timer**: `setInterval(() => void flush(), flushIntervalMs)`.

**Persistence** (only if `storage` given), key `pixie-logger:queue`:
- Format: `JSON.stringify({ v: 1, items: queue })`.
- `schedulePersist()`: if no save is pending, start a 1000 ms timer, then `storage.setItem`. Later calls while a save is pending do **not** restart the timer (a restarting debounce would never save under steady logging). Errors ignored.
- **No save before the startup restore has finished** (successfully or not). Saves requested earlier, including `persistNow()`, wait for the restore; otherwise they could overwrite the previous session's queue.
- `persistNow()`: cancel the debounce and save immediately.
- **On startup:** `storage.getItem` asynchronously. If valid (`v === 1`, `items` array), keep items whose `event` has string `level`, `event` and `clientTs`, and string `sessionId` / `appVersion`; **prepend** them before anything logged since startup; trim from the front to `maxQueueSize`; `schedulePersist()`; schedule a flush. Invalid JSON or shape → `storage.removeItem` and continue.

**Lifecycle** (only if `lifecycle` given): `unsubscribeLifecycle = lifecycle.subscribe({ onBackground: () => { void persistNow(); void flush({ keepalive: true }); }, onForeground: () => void flush() })`.

**`setEnabled(v)`**: sets the flag; queued events are kept.

**`shutdown()`**: clear interval and pending timeouts, unsubscribe lifecycle, `await flush()`, `await persistNow()`. Later `log` calls are ignored.

### `src/index.ts`

```ts
export { createLogger } from './logger';
export type { Logger, LoggerOptions, LogOptions, StorageAdapter, LifecycleAdapter, LifecycleHandlers } from './types';
export type { LogLevel, Platform } from '@pixie-logger/shared';
```

(`LoggerDeps`, `Transport`, `SendResult`, `QueueItem` stay internal.)

## Tests — `packages/logger/test/`

Use vitest with `vi.useFakeTimers()` where timing matters, and a **fake transport** that records batches and returns scripted results. Use a fixed `now` and `random` in deps.

`sanitize.test.ts`
1. Every row of the sanitise table, including nested arrays, `Error`, invalid `Date`, `NaN`, `bigint`, a function inside an object (omitted) and inside an array (`null`).
2. Circular reference → `'[Circular]'`; the same object in two sibling keys is serialised twice.
3. Depth: a 7-level nested object has `'[Truncated]'` at level 6.
4. Redaction: `password`, `userEmail`, `X-Auth-Token`, `refresh_token`, `userOtp`, `PIN` redacted at any depth; `notPaid`, `spinner`, `author`, `sessionCount` **not** redacted; extra key `'nationalNumber'` redacts `national_number`.

`event.test.ts`
1. Valid minimal call → event with only `level`, `event`, `clientTs` (ISO from `nowMs`).
2. Names `''`, `'OrderViewed'`, `'_x'`, `'has space'`, 101 chars → rejected; `'order_viewed'`, `'checkout.step:2'` → accepted.
3. `message` of 1500 chars → truncated to 1000; non-string `message` ignored.
4. Size: an oversized `context` is dropped and `params` kept; when `params` is oversized too, both are dropped and the event is still accepted. An event just under 8 KB is untouched. The check counts UTF-8 bytes: a `context` with 4,500 Arabic characters (≈ 9 KB) is dropped even though it's under 8,192 characters.

(After truncation, `message` + `route` + name can't exceed 8 KB on their own, so the final "event too large" branch is defensive and needs no test.)

`logger.test.ts`
1. Invalid options (missing apiKey; platform `'windows'`) → no-op logger, one `console.warn` even without `debug`.
2. `minLevel: 'warn'` ignores `info`; `enabled: false` ignores everything; `setEnabled(true)` re-enables.
3. Timer: 3 events, advance `flushIntervalMs` → one batch with 3 events and correct envelope (`sessionId` 32 hex chars).
4. Reaching `batchSize` triggers a flush without waiting for the timer; `error` triggers an immediate flush.
5. 45 events with `batchSize: 20` → batches of 20, 20, 5.
6. `maxQueueSize: 10`, `batchSize: 5` (`maxQueueSize` is clamped to at least `batchSize`, default 20), transport always `retry`: log 15 → queue holds the newest 10.
7. Outcomes: `sent` and `dropped` remove the batch; `retry` keeps it and stops the loop; `unauthorized` keeps it, stops all later sends, and warns once without `debug`.
8. Only one flush in flight: calling `flush()` twice concurrently sends once.
9. Events logged while a send is in flight are not lost and go in the next batch.
10. Transport that throws is treated as `retry`; `log` and `flush` never throw.
11. Persistence with an in-memory fake storage: queue saved after the debounce; a new logger with the same storage restores items **before** new ones, keeps their original `sessionId`, and sends them in a separate batch from new-session events; corrupt stored JSON is removed.
12. Lifecycle fake: `onBackground` saves immediately and flushes with `keepalive: true`; `onForeground` flushes; `shutdown()` unsubscribes, flushes and stops the timer.

## Verification

From the repo root:

1. `pnpm install` — completes.
2. `pnpm test` — all packages pass (shared unchanged except the `EVENT_NAME_PATTERN` move).
3. `pnpm typecheck` — no errors in any package.
4. `grep -rnE "\b(window|document|localStorage|navigator|Buffer|process)\b" packages/logger/src` — no matches (comments excepted; report any).
5. `grep -rn "zod" packages/logger/src` — no matches.

## Done when

- `packages/logger` exists with the files above and all tests pass.
- `EVENT_NAME_PATTERN` lives in `constants.ts`; shared has `"sideEffects": false`.
