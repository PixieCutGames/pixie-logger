# Phase 3: Client Package

The small library every app installs: `@pixie-logger/logger`. Apps call `logger.info('order_viewed', { … })`; the logger queues, batches and sends events to `POST /v1/logs` in the background, survives offline use and app restarts, and never slows down or crashes the app.

Contract reference: [Phase 1](../phase-1/README.md). Backend: [Phase 2](../phase-2/README.md).

## Tasks

| # | Task | Design | Tech spec |
|---|------|--------|-----------|
| 1 | Core logger: API, sanitising, redaction, queue, timers | [01-core.md](01-core.md) | [01-core.tech.md](01-core.tech.md) |
| 1b | Review fixes for the core logger (9 findings) | [01b-review-fixes.md](01b-review-fixes.md) | [01b-review-fixes.tech.md](01b-review-fixes.tech.md) |
| 2 | Transport: sending, response handling, retry with backoff | [02-transport.md](02-transport.md) | [02-transport.tech.md](02-transport.tech.md) |
| 3 | Platform adapters: web, Capacitor, React Native | [03-adapters.md](03-adapters.md) | [03-adapters.tech.md](03-adapters.tech.md) |
| 3b | Storage and lifecycle fixes (review of Task 3) | [03b-storage-and-lifecycle-fixes.md](03b-storage-and-lifecycle-fixes.md) | [03b-storage-and-lifecycle-fixes.tech.md](03b-storage-and-lifecycle-fixes.tech.md) |
| 4 | Build & packaging: compiled JS + types, local install | [04-build.md](04-build.md) | [04-build.tech.md](04-build.tech.md) |
| 5 | Integration test in the Taqa app (local only) | [05-integration.md](05-integration.md) | [05-integration.tech.md](05-integration.tech.md) |

**Implement in this order:** 1 → 1b → 2 → 3 → 3b → 4 → 5.

To hand a spec to an agent: *"Implement `docs/specs/phase-3/<file>.tech.md` exactly as written. Follow its 'Rules for the agent' section."*

## Decisions made

- **No npm publishing for now.** Apps install a packed `.tgz` from a local path during development; GitHub Releases later, until a decision on npm.
- **One package, optional platform entry points:** `@pixie-logger/logger` (core), `/web`, `/capacitor`, `/react-native`. An app imports only its platform's adapter.
- **Adapters receive the platform module as an argument** (e.g. `capacitorStorage(Preferences)`) instead of importing it. The logger has no peer dependencies, so it never breaks an app's bundler over a package that app doesn't use.
- **Compiled output** (ESM + CommonJS + type definitions) built with `tsup`, because apps outside the monorepo can't compile TypeScript from `node_modules`. The shared contract is bundled in; **zod is not** (the client sanitises by hand to stay small).
- **No `sendBeacon`.** It can't send the `X-Api-Key` header. Instead the queue is persisted to storage, and a background flush uses `fetch` with `keepalive`; anything that doesn't make it is sent on the next launch.
- **Integration test app: Taqa, local only.** Nothing from this task is committed to the Taqa repo.
- **Saving uses a fixed 1-second timer** (Task 1). The first change starts it; later changes don't restart it. A timer that restarted on every change would never save while the app logs more than once a second.
- **No saving before the startup restore finishes** (Task 1). Otherwise an early save (e.g. the app going to the background right after launch) could overwrite the previous session's unsent events.
- **`[Truncated]` replaces any value deeper than 5 levels** (Task 1), including strings and numbers, not only objects and arrays.
- **Bad option values fall back to defaults** (Task 1): non-numeric `batchSize` / `flushIntervalMs` / `maxQueueSize` use the default before clamping; an unknown `minLevel` becomes `'debug'`. The no-op logger (invalid options) has `sessionId: ''`.

- **Saved queue capped at 512 KB** (Task 1b): only the newest events that fit are saved; the in-memory queue is unaffected. A failed save always warns once per session.
- **After a 401, new events are ignored** for the rest of the session (Task 1b); already-queued events stay saved for the next launch.
- **One "flush soon" timer for startup, batch-size and error flushes** (Task 2). Each request records whether it must ignore the backoff; if any does, the flush does. So an error logged right after launch can't hold back the restored events.
- **Nothing keeps running after `shutdown()`** (Task 2): no new retry timer is started. A `retryAfterMs` that isn't a valid number falls back to the backoff delay; very large values are capped so the timer can't fire immediately.
- **Storage adapters pass errors to the logger** (Task 3b) instead of hiding them. Web uses memory only when no storage exists at all.
- **If the saved queue can't be read at startup, saving is off for that session** (Task 3b), so it is never overwritten. After a failed save, the saved queue is deleted so already-sent events can't come back.

## Known limitations

- **Multiple tabs of the same web app share one saved queue** (`pixie-logger:queue`). A new tab restores and sends events another tab is also sending (duplicates), and each tab's save overwrites the other's (lost events). Capacitor and React Native apps aren't affected. To be designed in Phase 5.

## Goals

- **Never hurts the app:** no thrown errors, no blocking work, no unbounded memory or storage.
- **Small:** core bundle under 10 KB minified.
- **Same behaviour on every platform;** only storage and lifecycle differ.
- **Nothing sensitive leaves the device by accident:** common secret and personal fields are redacted automatically.

## Out of scope

- Publishing to npm or GitHub Releases (later decision).
- Automatic logging of route changes, clicks or crashes; the app decides what to log.
- Reading logs (Phase 4).

## Phase 3 is done when

- All five tasks are done.
- Events logged from Taqa in the browser (`ionic serve`) and on an Android or iOS device/emulator arrive in the live database, including events logged while offline.
