# pixie-logger Roadmap

A lightweight logging service for personal apps: a Cloudflare Worker (Hono + D1) that apps send small batches of events to, plus a client package and a simple viewer.

**Approach:** get the simple version working end to end first, then add a proper admin page on top of something that already works.

## Tracking

- **Task status lives on the [Logger project board](https://github.com/users/PixieCutGames/projects/5/views/1)**, not in these docs. This file only keeps the phase-level status below.
- The `- [ ]` checklists in each task's design doc (`NN-name.md`) are a template: the design doc is copied into the task's GitHub issue and ticked off there. They are not updated in the repo.

## Phases

| Phase | Content | Status |
|---|---|---|
| 0 | Setup: monorepo, Hono Worker, D1 database | Done |
| 1 | [Contract](phase-1/README.md): event shape, API, shared package | Done |
| 2 | [Backend ingest](phase-2/README.md): schema, key CLI, `POST /v1/logs`, simple CORS allowlist | Done |
| 3 | [Client package](phase-3/README.md): core, transport and retry, platform adapters, build, Taqa integration test | Done |
| 4 | [Read side](phase-4/README.md): Access check in the Worker, `GET /v1/admin/logs` + `GET /v1/admin/apps`, simple HTML viewer at `/admin/`, Cloudflare Access setup | Not started |
| 5 | Hardening: rate limiting, 30-day cleanup cron, CI deploy from GitHub, multi-tab queue sharing on web, endpoint path check | Not started |
| 6 | Reuse: publish/tag the logger package with a README (install, init, log); add the logger to a second app to check the API is truly generic | Not started |
| 7 | [Admin page](#phase-7-admin-page): everything below | Not started |

## Notes for Phase 3 (client package)

Resolved in the [Phase 3 specs](phase-3/README.md):
- `sendBeacon` is not used (it can't send `X-Api-Key`). The queue is persisted, and the background flush uses `fetch` with `keepalive`; anything missed is sent on the next launch.
- `500 internal_error`, `429` and network failures are retried with backoff; `400`-type errors and `rejected` events are not.

## Notes for Phase 4 (read side)

Decided before specing (details in the [Phase 4 README](phase-4/README.md)):
- **Cloudflare Access only** for reading; the planned `X-Admin-Key` is dropped for now (an admin key for scripts may come in Phase 7).
- **Read routes live under `/v1/admin/*`** (`GET /v1/admin/logs`, `GET /v1/admin/apps`) so Access can protect them by path while `POST /v1/logs` stays public.
- **Viewer is one plain HTML + JS page** at `/admin/`, no build step. The UI stack is decided in Phase 7.

## Notes for Phase 5 (hardening)

- **Endpoint path check (client).** Found in the Taqa test: an `endpoint` without `/v1/logs` (just the Worker's base URL) is accepted silently; requests go to `/`, which has no CORS headers, so the browser shows a confusing CORS error. Options: warn (always, like invalid options) when the endpoint doesn't end in `/v1/logs`, or accept a base URL and append the path. Decide which; changing the option's meaning affects every app's config.
- **Multi-tab queue sharing (web).** All tabs of a web app save to the same `pixie-logger:queue` key, causing duplicate sends and lost events. Options to weigh: per-tab keys with a claim/hand-over on restore, or the Web Locks API so only one tab sends. See [Phase 3 known limitations](phase-3/README.md#known-limitations).

## Notes for Phase 6 (reuse)

- **Publishing:** still undecided between npm and GitHub Releases (Phase 3 decided no npm for now; apps install a packed `.tgz`).
- **Second app:** add the logger to another app to check the API is truly generic.

## Phase 7: Admin page

Replace the CLI and config-file workflows with an admin UI, served by the same Worker.

### Features

- Create, disable and enable apps.
- Create, label and revoke keys (key shown once on creation).
- **Per-app allowed origins**, e.g. a web app allows only its own domain, a Capacitor app only the Capacitor origins.
- Anything else found useful while using the simple version.

### Design notes already worked out

- **Cloudflare Access first.** No admin feature is deployed before Access protects it. An exposed admin could create keys and open CORS.
- **CSRF protection.** Access signs you in with a cookie, so a malicious page could try to trigger admin actions in your session. Require a custom header on every admin request; browsers won't send it cross-site without CORS approval.
- **Per-app CORS works in two steps,** because the browser's preflight (`OPTIONS`) doesn't include `X-Api-Key`:
  1. Preflight: allow the origin if *any* app lists it.
  2. Actual `POST`: the key identifies the app; check `Origin` against *that app's* list and reject with `403` if it isn't there.
  3. No `Origin` header (curl, React Native, native code) → allowed; origin checks only restrict websites.
- **New migration** for per-app origins (e.g. an `app_origins` table). The shared `ALLOWED_ORIGINS` config from Phase 2 can then be removed.
- **Optional admin key for scripts.** Phase 4 reads use Cloudflare Access only. If reading logs from scripts or the CLI becomes useful, add an admin key (or use an Access service token) for `/v1/admin/*`.
- **Admin APIs go under `/v1/admin/*`**, next to the Phase 4 read routes, so the same Access application and Worker check cover them.
- **Keep the `pnpm keys` CLI** as a backup in case Access ever locks you out. The CLI and the admin API should share the same underlying code.
- **UI stack:** to decide. A small React + Vite app served through the Worker's static assets is the leading option.
