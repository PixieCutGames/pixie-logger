# Phase 4: Read Side

See your logs. By the end of this phase you open `https://pixie-logger.pixie-cut-games.workers.dev/admin/`, sign in through Cloudflare Access, and search the logs your apps sent. Nobody else can read them.

Contract reference: [Phase 1 — API endpoints](../phase-1/02-api-endpoints.md) (updated for this phase). Backend: [Phase 2](../phase-2/README.md).

## Tasks

| # | Task | Design | Tech spec |
|---|------|--------|-----------|
| 1 | Access check in the Worker for `/v1/admin/*` | [01-access-check.md](01-access-check.md) | [01-access-check.tech.md](01-access-check.tech.md) |
| 2 | Read API: `GET /v1/admin/logs` and `GET /v1/admin/apps` | [02-read-api.md](02-read-api.md) | [02-read-api.tech.md](02-read-api.tech.md) |
| 3 | Viewer page at `/admin/` (plain HTML + JS) and removing the hello-world page | [03-viewer.md](03-viewer.md) | [03-viewer.tech.md](03-viewer.tech.md) |
| 4 | Cloudflare Access setup, deploy and end-to-end check (you) | [04-access-setup.md](04-access-setup.md) | — (no agent work) |

**Implement in this order:** 1 → 2 → 3 → 4. Task 1 comes first so the read routes never exist without the Worker's own check. Task 4 creates the Access application **before** the first deploy that contains the read routes.

To hand a spec to an agent: *"Implement `docs/specs/phase-4/<file>.tech.md` exactly as written. Follow its 'Rules for the agent' section."*

## How it fits together

```
Browser ── /admin/…  ──────────┐
                               ├─► Cloudflare Access (sign-in, your email only)
Browser ── /v1/admin/… ────────┘          │
                                          ▼
                                    pixie-logger Worker
                                      ├─ /admin/*        static viewer files (no data in them)
                                      ├─ /v1/admin/*     Access token check ─► D1 (read)
                                      └─ /v1/logs        X-Api-Key ─► D1 (write)   ← not behind Access
```

## Decisions made

- **Cloudflare Access only, no admin key** (for now). The viewer runs in the browser, so an admin key would have to be stored there. Access signs you in with your email instead. An admin key (or an Access service token) for scripts can be added in Phase 7.
- **Read routes moved to `/v1/admin/*`.** Access protects paths, not HTTP methods, so `GET /v1/logs` couldn't be protected while `POST /v1/logs` stays open for apps. The Phase 7 admin APIs will live under `/v1/admin/*` too.
- **Access is set up per path, not for the whole Worker.** Turning Access on for the whole Worker (the one-click option in the dashboard) would also block apps sending logs.
- **The Worker checks the Access token too**, on every `/v1/admin/*` request, using the `jose` library and your Access team domain + application ID (AUD). This covers any way of reaching the Worker that the path rule doesn't, such as preview URLs. Without the settings, it refuses every read (fails closed).
- **The Worker can't use Cloudflare's built-in `ctx.access` helper**, because Workers with static files don't receive it. That's why it checks the token itself.
- **Local development uses a bypass** that only works when the request is to `localhost` **and** `ACCESS_DEV_BYPASS=true` is set in `apps/api/.dev.vars` (a file that is never deployed or committed).
- **New `session` filter** on `GET /v1/admin/logs`, to see everything one session did.
- **New `GET /v1/admin/apps`** so the viewer can offer an app dropdown. Disabled apps are included (they can still have logs).
- **Viewer is one plain HTML + JS + CSS page**, no framework and no build step. The UI stack for the admin page is decided in Phase 7.
- **Log data is shown as text only, never as HTML**, plus a strict Content-Security-Policy on `/admin/*`. Log messages come from apps and must never run as code in your browser.
- **Paging uses the log id as the cursor**, newest first. No new migration is needed: the existing indexes cover the filters.
- **Hello-world page and `/message` route removed.**
- **No CSRF protection yet.** Phase 4 has only read (`GET`) routes; Phase 7 adds it with the first route that changes data.

## Goals

- Only you can read logs, even if the Worker URL is known.
- Sending logs from apps keeps working exactly as before.
- Finding "what happened in this session" takes one click.

## Out of scope

- Changing data from the browser (apps, keys, origins): Phase 7.
- Admin key or service-token access for scripts: Phase 7 if needed.
- Charts, counts, live tail, export.
- Rate limiting and the 30-day cleanup: Phase 5.

## Phase 4 is done when

- All four tasks are done.
- Signed in, the live viewer shows the `taqa-local` test logs and every filter works.
- Without signing in, `/admin/` and `/v1/admin/*` can't be read.
- `POST /v1/logs` with an app key still returns `202`.
