# Technical Spec — Phase 3, Task 1b: Review Fixes

> **Prerequisite:** [01-core.tech.md](01-core.tech.md) is done. `pnpm test` and `pnpm typecheck` pass.
> Execution order for Phase 3: **1 → 1b → 2 → 3 → 4 → 5**.

Design reference: [01b-review-fixes.md](01b-review-fixes.md). Finding numbers below match it.

## Rules for the agent

1. Only create or modify these files:
   - `packages/logger/src/util.ts` (new)
   - `packages/logger/src/logger.ts`
   - `packages/logger/src/event.ts`
   - `packages/logger/src/sanitize.ts`
   - `packages/logger/test/util.test.ts` (new), `sanitize.test.ts`, `event.test.ts`, `logger.test.ts`
2. Do **not** touch `transport.ts`, `packages/shared` or `apps/api`. If something conflicts, **stop and report it**.
3. Same platform rules as Task 1: no `window`, `document`, `localStorage`, `navigator`, `Buffer`, `process`, Node modules or zod in `packages/logger/src`.
4. Don't change the public API (`index.ts` exports and the `Logger` / `LoggerOptions` types).
5. Nothing exported may throw at runtime. Existing tests must keep passing (update a test only where this spec changes the behaviour it checks, and say which).
6. pnpm only. Do not commit. Finish by running "Verification" and reporting the output.

## Changes

### New `src/util.ts` (#6, #8)

```ts
/** Plain object check: not null, not an array. */
export function isRecord(v: unknown): v is Record<string, unknown>

/** s.slice(0, max), but if the result ends with a high surrogate (0xD800–0xDBFF), drop that last code unit. */
export function truncate(s: string, max: number): string
```

- `logger.ts`: delete its local `isRecord`, import from `./util`.
- `event.ts`: delete `isPlainRecord`, import `isRecord` from `./util`.

### #1 — keepalive while a flush is running (`logger.ts`)

- New state: `let keepaliveRequested = false;`
- `flush(opts)`: if `opts?.keepalive === true`, set `keepaliveRequested = true` **before** the "already flushing" check, so a call that joins an existing flush still records it.
- `runFlush()` takes no `keepalive` argument; for **each** batch it calls `transport.send(body, { keepalive: keepaliveRequested })`.
- In the `finally` that clears `flushing`, also set `keepaliveRequested = false`.
- The request already in flight is not changed (it can't be).

### #2 — interval cap (`logger.ts`)

```ts
const MAX_TIMER_MS = 2_147_483_647; // setInterval/setTimeout overflow above this and fire immediately
```
`flushIntervalMs = intOption(options.flushIntervalMs, DEFAULT_FLUSH_INTERVAL_MS, MIN_FLUSH_INTERVAL_MS, MAX_TIMER_MS)`.

### #3 — `__proto__` keys (`sanitize.ts`)

In `sanitizeObject`, write every key (including `[REDACTED]` ones) with:
```ts
Object.defineProperty(out, key, { value: v, enumerable: true, writable: true, configurable: true });
```
instead of `out[key] = v`. `out` stays a normal `{}`.

### #5 — cap the saved queue (`logger.ts`)

```ts
const MAX_PERSIST_BYTES = 512 * 1024;
```

In `persistNow()`, instead of `JSON.stringify({ v: 1, items: queue })`:
1. Walk the queue **from newest to oldest**. `JSON.stringify` each item and add its `utf8ByteLength` (+1 for the comma). Stop **before** the item that would take the total above `MAX_PERSIST_BYTES - 64` (room for the wrapper). Never stringify more items than needed.
2. Save `'{"v":1,"items":[' + parts.reverse().join(',') + ']}'` (oldest-first order, same format as before, so restore is unchanged).
3. If items were left out, `warn('saved queue capped at 512 KB; N oldest events not saved')` (debug only). The in-memory queue is **not** trimmed; it is still sent normally.
4. If `storage.setItem` throws: `alwaysWarn('failed to save queue', err)` **once per logger instance** (a `saveErrorReported` flag), then debug-only `warn` for later failures.

### #6 — safe truncation (`event.ts`, `logger.ts`)

Use `truncate()` for `message` (`LIMITS.messageMax`), `route` (`LIMITS.routeMax`) and `appVersion` (`LIMITS.appVersionMax`).

### #7 — stop logging after 401 (`logger.ts`)

In `log()`, return immediately if `blocked` (add it to the existing `stopped || !enabled || …` check). Items already queued stay in the queue and keep being saved, so they are sent on the next launch.

### #9 — keep `context` when possible (`event.ts`)

Replace the size fallback with:
1. Too big → remove `context`.
2. Still too big → remove `params`; then, if there was a `context`, put it back and re-check; if that's too big, remove it again.
3. Still too big → `{ ok: false, reason: 'event too large' }`.

The size check only runs for events that are already too big, so the extra `JSON.stringify` calls don't affect normal events.

### #10 — validate restored items (`logger.ts`)

`isQueueItem` additionally requires:
- `event.level` in `LOG_LEVELS`;
- `event.event` a string of 1–`LIMITS.eventNameMax` chars matching `EVENT_NAME_PATTERN`;
- `sessionId` a non-empty string, ≤ `LIMITS.sessionIdMax` chars;
- `appVersion` a non-empty string, ≤ `LIMITS.appVersionMax` chars.

Invalid items are skipped; valid ones are restored as before.

## Tests

`util.test.ts`
1. `isRecord`: `{}` true; `null`, `[]`, `'x'`, `1` false.
2. `truncate('ab', 5)` → `'ab'`; `truncate('a😀b', 2)` → `'a'` (no lone surrogate); `truncate('a😀b', 3)` → `'a😀'`.

`sanitize.test.ts`
3. `sanitizeRecord(JSON.parse('{"__proto__":{"a":1},"b":2}'), …)` → `JSON.stringify` of the result contains both `__proto__` and `b`; the result's prototype is still `Object.prototype`.

`event.test.ts`
4. A `message` of 999 `'a'` + `'😀'` → message length 999, no lone surrogate.
5. Small `context` + ~9 KB `params` → `params` dropped, `context` **kept**. (The existing "both oversized → both dropped" test still passes.)

`logger.test.ts`
6. **#1:** a fake transport whose first `send` waits on a promise the test controls. 25 events with `batchSize: 20`; call `flush()`; while the first send is pending, fire `onBackground`; resolve the first send as `sent`. The second batch is sent with `keepalive: true`. A later flush (after this one ends) uses `keepalive: false`.
7. **#2:** `flushIntervalMs: 3_000_000_000` with fake timers: log 1 event, advance 100 ms → transport not called.
8. **#5:** fake storage; `maxQueueSize: 500`, transport always `retry`; log 100 events each with ~7 KB `params` (under the 8 KB event limit); after the debounce the saved string is ≤ 512 KB, parses as `{ v: 1, items }`, and holds the **newest** events in order. The in-memory queue still sends all 100 (switch transport to `sent`, `flush()`, count events).
9. **#5:** storage whose `setItem` always throws: two save cycles → exactly one `console.warn` without `debug`.
10. **#7:** after an `unauthorized` result, `log` calls don't grow the queue (check via the saved storage contents or the number of items after the next save) and schedule no flush.
11. **#10:** stored queue with one valid item and items with `level: 'trace'`, `event: 'Bad Name'`, `sessionId: ''`, `appVersion` of 51 chars → only the valid item is restored and sent.

## Verification

From the repo root:

1. `pnpm test` — all packages pass.
2. `pnpm typecheck` — no errors.
3. `grep -rnE "\b(window|document|localStorage|navigator|Buffer|process)\b" packages/logger/src` — no matches.
4. `grep -rn "zod" packages/logger/src` — no matches.
5. `grep -rn "isPlainRecord" packages/logger/src` — no matches.

## Done when

- All nine fixes are in, the new tests pass, and every existing test still passes (or the report names any test changed and why).
