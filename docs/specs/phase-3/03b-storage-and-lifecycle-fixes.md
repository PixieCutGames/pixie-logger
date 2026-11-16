# Phase 3, Task 3b: Storage and Lifecycle Fixes

A code review of Task 3 found that the storage adapters hide errors, which can lose or duplicate events, plus two lifecycle edge cases. These fixes land in the same PR as Task 3, before Task 4.

Tech spec: [03b-storage-and-lifecycle-fixes.tech.md](03b-storage-and-lifecycle-fixes.tech.md).

## What changes

| Problem | Fix |
|---|---|
| On web, a failed `localStorage` write (e.g. storage full) goes to memory and reports success. The old saved queue stays, so already-sent events are **sent again** after a reload, and the logger never warns. | `webStorage` uses memory **only** when no storage is available at all (e.g. blocked in private mode). If `localStorage` exists and a call fails, the error goes to the logger. |
| After one failed write, a key is split between memory and `localStorage`; reads return the stale copy. | Gone with the fix above: one storage per adapter, never mixed. |
| Capacitor and React Native adapters also hide errors. If reading the saved queue fails at startup, the next save **overwrites** it and the previous session's events are lost. | Both adapters pass errors through. The logger: if the startup read fails, **saving is turned off for that session** (with a warning), so unreadable saved events are never overwritten. |
| After a failed save, the old saved queue could come back on the next launch. | The logger deletes the saved queue after a failed save. Unsent events are still in memory and sent normally. |
| React Native: if `AppState` starts as `'unknown'` (iOS), the first move to the background is missed. | Any state other than `background` / `inactive` counts as active. |
| Web: a page restored from the back/forward cache could ignore the next background signal. | `pageshow` counts as foreground. |

## Rule change

Task 3's rule "adapters never throw and never return rejected promises" becomes: **storage adapters may reject when the underlying storage fails; the logger catches every storage call.** Lifecycle adapters and the `*Platform` helpers still never throw. No adapter throws synchronously.

## Not changed

- Capacitor `pause` / `resume` already fire on the web (since `@capacitor/app` 4.1.0), so `capacitorLifecycle` needs no web fallback.
- Multiple browser tabs sharing one saved queue stays a known limitation for Phase 5.

## Effect on the app

None visible. The public API doesn't change. Data loss and duplicate sends from storage failures are prevented, and failures show a warning.
