# Technical Spec — Phase 3, Task 3b: Storage and Lifecycle Fixes

> **Prerequisite:** [03-adapters.tech.md](03-adapters.tech.md) is done. `pnpm test` and `pnpm typecheck` pass.
> Execution order for Phase 3: **1 → 1b → 2 → 3 → 3b → 4 → 5**.

Design reference: [03b-storage-and-lifecycle-fixes.md](03b-storage-and-lifecycle-fixes.md). [03-adapters.tech.md](03-adapters.tech.md) has already been updated to describe the end state; this spec lists the changes.

## Rules for the agent

1. Only modify these files:
   - `packages/logger/src/web.ts`, `capacitor.ts`, `react-native.ts`, `logger.ts`, `types.ts`
   - `packages/logger/test/web.test.ts`, `capacitor.test.ts`, `react-native.test.ts`, `logger.test.ts`, `integration.test.ts` (only if a test there breaks)
2. Do not touch `transport.ts`, `backoff.ts`, `packages/shared`, `apps/api` or `docs/`. If something conflicts, **stop and report it**.
3. Same platform rules as Tasks 1 and 3 (`web.ts` is the only file that may use browser globals, only inside functions, behind `typeof` checks).
4. Don't change the public API (exports and option/handler types). The `StorageAdapter` interface shape stays the same; only its documented error behaviour changes.
5. **New adapter rule:** storage adapter methods **may reject** when the underlying storage fails. They must never throw synchronously (an `async` function satisfies this). Lifecycle adapters and `*Platform` helpers still never throw.
6. Existing tests must keep passing, except those whose expected behaviour this spec changes; name each test you change in the report.
7. pnpm only. Do not commit. Finish by running "Verification" and reporting the output.

## Changes

### `types.ts`

Add a doc comment to `StorageAdapter`:
```ts
/**
 * Methods may reject when the underlying storage fails; the logger catches every call.
 * Implementations must not throw synchronously.
 */
```

### `web.ts` — `webStorage`

- Resolve the backing storage once, lazily, on first use: the argument, else `globalThis.localStorage` read inside try/catch (`SecurityError`). Unavailable → an in-memory `Map` **for the lifetime of the adapter**.
- If a real storage was resolved, every method calls it directly. **Errors are not caught**: they surface as a rejected promise. Never fall back to memory after a failed call.
- If no storage was resolved, every method uses the map. A global `localStorage` without `getItem` / `setItem` / `removeItem` functions counts as not resolved (Node 25 exposes an empty object); storage passed as the argument isn't checked.
- The `resolved` flag can be replaced by `let backing: Storage | null | undefined` (`undefined` = not resolved yet). Optional.

### `web.ts` — `webLifecycle`

- Also listen for `pageshow` on `window` → `foreground()` (same duplicate rule: ignored if the last signal was foreground).
- Unsubscribe removes all three listeners.

### `capacitor.ts` — `capacitorStorage`

Remove the try/catch blocks. `getItem` returns `result.value` if it's a string, else `null`; errors reject. `setItem` / `removeItem` just `await` the call.

### `react-native.ts` — `rnStorage`

Remove the try/catch blocks. `getItem` returns the value if it's a string, else `null`; errors reject.

### `react-native.ts` — `rnLifecycle`

Replace the transition rule:
```ts
const isAway = (s: string | null | undefined) => s === 'background' || s === 'inactive';
// on change:
if (isAway(state) && !isAway(previous)) onBackground();
else if (state === 'active' && isAway(previous)) onForeground();
previous = state;
```
Start with `previous = appState.currentState ?? 'active'`. So `'unknown'` (or any other value) counts as active.

### `logger.ts`

1. **Startup read fails → no saving this session.** New state `let persistenceOff = false;`. In `restore()`, if `storage.getItem` rejects: set `persistenceOff = true` and `alwaysWarn('could not read the saved queue; saving is off for this session so it is not overwritten', err)`. `persistNow()` and `schedulePersist()` return immediately when `persistenceOff` is true. `persistNow()` checks it **again after awaiting the startup read**, so a save that started before the read finished (e.g. backgrounding right after launch) can't overwrite the unreadable queue. Events are still queued and sent normally.
2. **Failed save → delete the old saved queue.** In `persistNow()`, when `storage.setItem` rejects: keep the existing once-per-session warning, then `await storage.removeItem(STORAGE_KEY)` inside its own try/catch (ignore its errors). The in-memory queue is unchanged.
3. `removeItem` in `restore()` (invalid saved queue) is already wrapped; leave it.

## Tests

`web.test.ts` (jsdom)
1. **Replace test #2:** a storage object whose methods throw → `getItem`, `setItem`, `removeItem` all **reject**; a later successful-looking call doesn't read from memory (no fallback).
2. New: when reading `localStorage` throws (`Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError') }, configurable: true })`, restored after the test), `webStorage()` round-trips through memory.
3. New: `hidden` → `onBackground`; `pageshow` → `onForeground`; then `pagehide` → `onBackground` again (two background calls total). Unsubscribe also removes `pageshow`.

`capacitor.test.ts`
4. **Change test #1:** a rejecting `get` → `getItem` rejects (was `null`). Rejecting `set` / `remove` → reject.

`react-native.test.ts`
5. **Change test #1:** a rejecting `getItem` → rejects (was `null`).
6. New: `currentState: 'unknown'` then `background` → `onBackground` once; `currentState: 'unknown'` then `active` → no call. The existing transition list still passes.

`logger.test.ts`
7. Storage whose `getItem` rejects: exactly one `console.warn` without `debug`; after logging and advancing past the save delay, `setItem` was **never** called; the events are still sent.
8. Fake storage that already holds a saved queue with event A. Logger restores and sends A. Then make `setItem` reject: after the next save attempt, `removeItem('pixie-logger:queue')` was called and the storage no longer holds A. A second logger on the same storage restores nothing and sends nothing.
9. `setItem` rejects and `removeItem` also rejects → no throw, still one warning.

## Verification

1. `pnpm test` — all pass.
2. `pnpm typecheck` — no errors.
3. `grep -rnE "from '(@capacitor|react-native|@react-native-async-storage)" packages/logger/src` — no matches.
4. `grep -rnE "\b(window|document|localStorage|navigator)\b" packages/logger/src --exclude=web.ts` — no matches.
5. `grep -n "catch" packages/logger/src/capacitor.ts packages/logger/src/react-native.ts` — only the lifecycle and `*Platform` functions catch; no catch in the storage functions.

## Done when

- Storage errors reach the logger on all three platforms, the logger protects saved data as above, the two lifecycle fixes are in, and all tests pass.
