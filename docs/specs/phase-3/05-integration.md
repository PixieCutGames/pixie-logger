# Phase 3 — Task 5: Integration Test in Taqa (local only)

Part of [Phase 3](README.md). Proves the logger works in a real Ionic app on the web and on a device, against the live Worker.

> **Local only.** These changes are made in your local Taqa checkout to test the logger, and are **never committed or pushed**. Remove them when done (`git stash` or discard).

## Before you start

1. Create a dedicated test app and key on the live database:
   ```
   pnpm keys create-app taqa-local "Taqa (local test)" --label "phase 3" --remote
   ```
2. Build and pack the logger (Task 4): `pnpm --filter @pixie-logger/logger pack:local`.

## What gets added to Taqa (locally)

- The `.tgz` installed with Taqa's own package manager.
- One file that creates the logger with the Capacitor adapters (see [Task 3](03-adapters.md)), and is imported once at startup.
- A handful of test events: app started, a route change, a button tap, a deliberate error, each using **only non-personal data**. Don't log names, roles, emails, IDs of real users or anything from API responses.
- `debug: true` so you can see what the logger does in the console.

## Test checklist

| # | Scenario | Expected |
|---|---|---|
| 1 | `ionic serve` (browser, origin `http://localhost:8100`) | Events arrive; no CORS errors in the console |
| 2 | Android emulator or device | Events arrive with `platform: android` |
| 3 | iOS simulator or device (if available) | Events arrive with `platform: ios` |
| 4 | Turn on airplane mode, log a few events, turn it off | Events arrive after reconnecting |
| 5 | Log events while offline, then kill the app; reopen it online | Events from before the kill arrive, under the previous session id |
| 6 | Send the app to the background right after logging | Events arrive (background flush) or on next launch |
| 7 | Log an event with `context: { password: 'x', userEmail: 'y' }` | Stored as `[REDACTED]` |
| 8 | Revoke the key (`pnpm keys revoke-key <id> --remote`), log events | One console warning (debug mode); app unaffected |

Check what arrived with:

```
pnpm --filter @pixie-logger/api exec wrangler d1 execute pixie-logs --remote \
  --command "SELECT id, level, event, platform, session_id, context, datetime(received_at/1000,'unixepoch') AS received FROM logs WHERE app_id = 'taqa-local' ORDER BY id DESC LIMIT 20"
```

## After testing

- Discard the Taqa changes; check `git status` in Taqa is clean.
- Disable the test app: `pnpm keys disable-app taqa-local --remote`.
- Note anything awkward in the logger's API; it feeds into later changes.

## Done when

- Scenarios 1, 2, 4, 5 and 7 pass (3 if iOS is available; 6 and 8 are best-effort checks).
- Taqa's working tree is clean again.
