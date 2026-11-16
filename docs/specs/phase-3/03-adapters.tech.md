# Technical Spec — Phase 3, Task 3: Platform Adapters

> **Prerequisite:** [02-transport.tech.md](02-transport.tech.md) is done.

Design reference: [03-adapters.md](03-adapters.md).

## Rules for the agent

1. Only create or modify the files listed below.
2. **Do not install** Capacitor, React Native or AsyncStorage packages, not even as devDependencies. Adapters take the platform module as an argument and describe it with small structural interfaces defined here.
3. `web.ts` may use `window`, `document` and `localStorage`, but **only inside functions** (never at module top level), always guarded with `typeof … !== 'undefined'` and try/catch, so importing it in React Native or tests can't crash.
4. `capacitor.ts` and `react-native.ts` follow Task 1's platform-neutral rules.
5. Adapters never throw and never return rejected promises.
6. pnpm only. Do not commit. Finish by running "Verification" and reporting the output.

## Files

### `packages/logger/src/web.ts`

```ts
export function webStorage(storage?: Storage): StorageAdapter
export function webLifecycle(target?: { document: Document; window: Window }): LifecycleAdapter
export type { StorageAdapter, LifecycleAdapter } from './types';
```

**`webStorage`**
- Resolve the storage lazily on first use: the argument, else `globalThis.localStorage` read inside try/catch (accessing it can throw `SecurityError`). If unavailable, use an in-memory `Map`.
- Each method wraps the call in try/catch; on error fall back to the in-memory map for that call (`getItem` → map value or `null`).
- All methods return promises.

**`webLifecycle`**
- `subscribe(handlers)`: if `document` / `window` aren't available, return a no-op unsubscribe.
- `visibilitychange` on `document`: `document.visibilityState === 'hidden'` → `onBackground()`, `'visible'` → `onForeground()`.
- `pagehide` on `window` → `onBackground()`.
- Ignore a background signal if the previous signal was also background (prevents double flush on hide + pagehide); same for foreground.
- Each handler call in try/catch.
- Unsubscribe removes both listeners.

### `packages/logger/src/capacitor.ts`

Structural types (exported):

```ts
export interface PreferencesLike {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}
export interface ListenerHandleLike { remove(): Promise<void> | void; }
export interface AppLike {
  addListener(event: 'pause' | 'resume', cb: () => void): Promise<ListenerHandleLike> | ListenerHandleLike;
}
export interface CapacitorLike { getPlatform(): string; }
```

```ts
export function capacitorStorage(preferences: PreferencesLike): StorageAdapter
export function capacitorLifecycle(app: AppLike): LifecycleAdapter
export function capacitorPlatform(capacitor: CapacitorLike): Platform   // 'ios' | 'android', anything else → 'web'
export type { StorageAdapter, LifecycleAdapter } from './types';
```

- `capacitorStorage`: maps to `get` / `set` / `remove`; errors → `null` / ignored.
- `capacitorLifecycle.subscribe`: add `pause` → `onBackground`, `resume` → `onForeground`. `addListener` may return a handle or a promise of one: normalise with `Promise.resolve(...)`. Unsubscribe calls `remove()` on both handles once they resolve (also if unsubscribe is called before they resolve). Ignore errors.
- `capacitorPlatform`: wrap in try/catch; on error → `'web'`.

### `packages/logger/src/react-native.ts`

```ts
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
export interface AppStateLike {
  currentState?: string | null;
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
}
export interface PlatformLike { OS: string; }

export function rnStorage(asyncStorage: AsyncStorageLike): StorageAdapter
export function rnLifecycle(appState: AppStateLike): LifecycleAdapter
export function rnPlatform(platform: PlatformLike): Platform     // 'ios' | 'android', anything else → 'web'
export type { StorageAdapter, LifecycleAdapter } from './types';
```

- `rnStorage`: passthrough with try/catch.
- `rnLifecycle.subscribe`: start with `previous = appState.currentState ?? 'active'`. On `change`: if `state` is `background` or `inactive` and `previous === 'active'` → `onBackground()`; if `state === 'active'` and `previous !== 'active'` → `onForeground()`; then `previous = state`. Unsubscribe calls `subscription.remove()`.

### Modify `packages/logger/package.json` `exports`

Add source entries so tests and the monorepo can import subpaths (Task 4 replaces these with built files):

```json
"exports": {
  ".": "./src/index.ts",
  "./web": "./src/web.ts",
  "./capacitor": "./src/capacitor.ts",
  "./react-native": "./src/react-native.ts"
}
```

## Tests — `packages/logger/test/`

`web.test.ts` (vitest `jsdom` environment for this file only: add `// @vitest-environment jsdom` at the top, and `pnpm --filter @pixie-logger/logger add -D jsdom`):
1. `webStorage()` round-trips via `localStorage`.
2. A storage object whose methods throw → falls back to memory; `getItem` returns what was set.
3. `webLifecycle()`: setting `document.visibilityState` (via `Object.defineProperty`) to `hidden` and dispatching `visibilitychange` calls `onBackground` once; a following `pagehide` doesn't call it again; `visible` calls `onForeground`.
4. Unsubscribe removes listeners (no more calls).
5. Importing `../src/web` in a **node** environment test file (no jsdom) doesn't throw, and `webLifecycle().subscribe(...)` returns a no-op.

`capacitor.test.ts` (fake objects, node environment):
1. Storage maps to `get/set/remove` with `{ key }` / `{ key, value }`; a rejecting `get` → `null`.
2. Lifecycle with `addListener` returning a **promise** of a handle, and with it returning a handle directly: `pause` → `onBackground`, `resume` → `onForeground`; unsubscribe calls `remove()` on both handles, including when called before the promise resolves.
3. `capacitorPlatform` for `'ios'`, `'android'`, `'web'`, `'electron'` (→ `'web'`), and a throwing `getPlatform` (→ `'web'`).

`react-native.test.ts`:
1. Storage passthrough; rejecting `getItem` → `null`.
2. Lifecycle transitions: `active → background` (bg), `background → inactive` (none), `inactive → active` (fg), `active → inactive` (bg), `active → active` (none); unsubscribe calls `remove()`.
3. `rnPlatform` for `'ios'`, `'android'`, `'windows'` (→ `'web'`).

`integration.test.ts` (node, fake timers, fake transport): a logger created with `rnStorage` + `rnLifecycle` fakes persists on background and flushes with `keepalive: true`.

## Verification

1. `pnpm test` — all pass.
2. `pnpm typecheck` — no errors.
3. `grep -rnE "from '(@capacitor|react-native|@react-native-async-storage)" packages/logger/src` — no matches.
4. `grep -rnE "\b(window|document|localStorage|navigator)\b" packages/logger/src --exclude=web.ts` — no matches.

## Done when

- The three adapter files exist with the exports above, tests pass, and the logger has no Capacitor or React Native imports.
