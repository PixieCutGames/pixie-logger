# Phase 3, Task 1b: Review Fixes for the Core Logger

A code review of Task 1 found ten issues. Nine are fixed here; one (multiple browser tabs) is recorded as a known limitation for Phase 5. These fixes land **before Task 2**, because Task 2 changes the same flush and log code.

Tech spec: [01b-review-fixes.tech.md](01b-review-fixes.tech.md).

## What changes

| # | Problem | Fix |
|---|---|---|
| 1 | Going to the background while a send is already running ignores `keepalive`, so the remaining batches can be cancelled when a web page closes. | "Keepalive requested" is remembered; every batch sent after that point in the same flush uses `keepalive`. (The request already in flight can't be changed.) |
| 2 | A huge `flushIntervalMs` (over ~24.8 days) makes `setInterval` fire every 1 ms. | Capped at 2,147,483,647 ms. |
| 3 | A `__proto__` key in `params`/`context` is silently lost. | Keys are written as real properties. |
| 5 | The whole queue (up to ~4 MB) is saved every second, and a full storage fails silently. | Only the newest events up to **512 KB** are saved; a failed save always warns once per session. |
| 6 | Truncating `message`, `route` or `appVersion` can cut an emoji in half. | A trailing half-emoji is dropped. |
| 7 | After the API key is rejected (401), events keep being built, queued and saved. | New events are ignored once logging is paused. Already-queued events stay saved for the next launch. |
| 8 | Two copies of the same helper. | One shared helper in `util.ts`. |
| 9 | An oversized event always loses `context` first, even when `params` is the big field. | If dropping `params` makes room, `context` is put back. |
| 10 | Restored events aren't fully checked. | Level, event name, session id and app version are validated on restore; bad items are skipped. |

## Not fixed here

- **#4, multiple tabs of the same web app** share one saved queue: events can be sent twice or lost when tabs overwrite each other's save. Capacitor and React Native apps aren't affected. Recorded as a known limitation; to be designed in Phase 5.

## Effect on the app

None visible. The public API doesn't change.
