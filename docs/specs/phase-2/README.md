# Phase 2: Backend Ingest

Make the Worker accept and store logs. By the end of this phase, an app can send a batch to `POST /v1/logs` with its key and the events land in D1.

Contract reference: [Phase 1](../phase-1/README.md).

## Tasks

| # | Task | Design | Tech spec |
|---|------|--------|-----------|
| 1 | Database schema (D1 migrations for `apps`, `api_keys`, `logs`) | [01-d1-schema.md](01-d1-schema.md) | [01-d1-schema.tech.md](01-d1-schema.tech.md) |
| 2 | `POST /v1/logs`: key check, validation, batch insert | [02-ingest.md](02-ingest.md) | [02-ingest.tech.md](02-ingest.tech.md) |
| 3 | Script to create apps and manage their keys | [03-app-keys.md](03-app-keys.md) | [03-app-keys.tech.md](03-app-keys.tech.md) |
| 4 | CORS: one allowlist for all apps | [04-cors.md](04-cors.md) | [04-cors.tech.md](04-cors.tech.md) |

**Implement in this order:** 1 → 3 → 2 → 4. Task 1 must come first; doing Task 3 before Task 2 means a real app and key exist when you test the ingest endpoint. Task 4 (CORS) was moved here from Phase 5 so the client package can be tested from Ionic apps.

To hand a spec to an agent: *"Implement `docs/specs/phase-2/<file>.tech.md` exactly as written. Follow its 'Rules for the agent' section."*

## Decisions made

- **Separate `api_keys` table**, so an app can have an old and a new key at once and keys can rotate without cutting off older installs.
- **App ID is a short slug** (e.g. `maslary`), stored directly on each log row; no join needed to filter by app.
- **Log IDs are auto-increment integers**: "newest first" is highest id first, and the id doubles as the paging cursor.
- **Times are stored as Unix milliseconds**; the API converts them to ISO strings.
- **Keys are stored only as SHA-256 hashes**, never in plain text.
- **The live database is only changed by you**, never by an agent.
- **Keys look like `pxl_` + 64 hex chars** and are shown once at creation. The key format and hashing live in one module (`apps/api/src/lib/api-key.ts`) used by both the script and the Worker.
- **New error code `internal_error` (500)** for server-side failures; clients treat it as temporary and retry. Added to the Phase 1 contract.
- **One database batch per request**: all valid events are stored together or not at all, one insert statement per event (D1 limits values per statement).
- **CORS is one shared allowlist** in the Worker config (`ALLOWED_ORIGINS`), scoped to `/v1/logs`. Per-app origins wait for the admin phase.
- **Every auth failure is the same `401`**, so a caller can't tell whether a key is unknown, revoked or its app disabled.
- **Key management is a local CLI** (`pnpm keys …`), not an API: local database by default, `--remote` for the live one with a confirmation prompt.

## Goals

- Every accepted event is stored with the app it came from, taken from the API key, never the request body.
- Invalid data is rejected twice: by zod in the Worker and by constraints in the database.
- Inserts stay cheap: indexes only where reads or cleanup need them.

## Out of scope (later phases)

- Client logger package (Phase 3).
- `GET /v1/admin/logs`, the viewer page and Cloudflare Access (Phase 4).
- Rate limiting and the 30-day cleanup job (Phase 5).
- Per-app origins and an admin page (Phase 7, see the [roadmap](../ROADMAP.md)).

## Phase 2 is done when

- All four tasks are done.
- A curl request with a real app key to the deployed Worker stores events in the live database, and a request with a bad key gets `401`.
