# Phase 2 — Task 1: Database Schema (D1 Migrations)

Part of Phase 2 (backend ingest). Creates the tables the Worker will read and write. Later Phase 2 tasks build on it:

1. **Database schema** (this task)
2. `POST /v1/logs`: key check, validation, batch insert
3. Script to create an app and generate its key

Contract reference: [Phase 1](../phase-1/README.md).

## Goal

Create the database structure for apps, their write keys and their logs, as versioned SQL migrations in Git, applied to the local database first and then to the live one.

## Tables

### `apps` — one row per app

| Column | Type | Notes |
|---|---|---|
| `id` | text, primary key | Short slug, e.g. `maslary`. Lowercase letters, digits and `-`, 1–50 chars. This is the `app` value returned by `GET /v1/admin/logs` and used as its filter. Never changes. |
| `display_name` | text | Human name, e.g. `Maslary (مصاري)` |
| `created_at` | integer | Unix time in milliseconds |
| `disabled_at` | integer, nullable | Set to stop accepting logs from the app without deleting anything |

### `api_keys` — write keys, many per app

| Column | Type | Notes |
|---|---|---|
| `id` | integer, primary key | |
| `app_id` | text → `apps.id` | |
| `key_hash` | text, unique | SHA-256 of the key. The key itself is **never stored**. |
| `key_prefix` | text | First characters of the key (e.g. `pxl_a1b2c3d4`), so you can recognise which key is which |
| `label` | text, nullable | e.g. `v1.0 release` |
| `created_at` | integer | ms |
| `revoked_at` | integer, nullable | Set to turn a key off |

**Why a separate keys table:** apps already installed on phones keep using the old key until users update. A separate table lets an app have an old and a new key at the same time: ship a release with the new key, then revoke the old one once most users have updated. With one key column on `apps`, rotating a key would cut off every older install at once.

### `logs` — one row per accepted event

| Column | Type | Notes |
|---|---|---|
| `id` | integer, primary key, auto-increment | Always increasing, so "newest first" = highest id first, and it doubles as the paging cursor |
| `app_id` | text → `apps.id` | From the API key, not the request body |
| `level` | text | One of `debug`, `info`, `warn`, `error`, `fatal` |
| `event` | text | |
| `message` | text, nullable | |
| `route` | text, nullable | |
| `params` | text (JSON), nullable | |
| `context` | text (JSON), nullable | |
| `app_version` | text | From the batch envelope |
| `platform` | text | One of `web`, `android`, `ios` |
| `session_id` | text | |
| `client_ts` | integer | ms; device time, converted from the ISO string |
| `received_at` | integer | ms; server time |

Times are stored as millisecond numbers because they compare and range-filter cleanly; the API converts them back to ISO strings.

The database itself rejects bad values (unknown level or platform, invalid JSON, bad app slug), as a second safety net behind the zod validation.

### Deleting

Deleting an app deletes its keys and logs automatically. Normally you'd disable an app instead.

## Indexes

Kept to what the read endpoint and the cleanup job need. Every index makes each insert slightly more expensive, so there's no index per filter.

| Index | Used by |
|---|---|
| `logs (app_id, id)` | Logs for one app, newest first |
| `logs (app_id, level, id)` | One app filtered by level (e.g. errors only) |
| `logs (received_at)` | Date-range filters and the 30-day cleanup (Phase 5) |
| `api_keys (key_hash)` unique | Key check on every `POST /v1/logs` |

Filtering by `event` scans within one app's logs, which is fine at personal-app volume. An index can be added later if it gets slow.

## Migrations workflow

- Migrations are plain `.sql` files in `apps/api/migrations/`, numbered in order and committed to Git.
- A migration is never edited after it's been applied to the live database; changes go in a new migration.
- Apply locally first, test, then apply to the live database.
- Two package scripts make this a single command each: `db:migrate:local` and `db:migrate:remote`.

## Out of scope

- Inserting logs (Task 2).
- Creating apps and keys (Task 3).
- Retention cleanup job (Phase 5).

## Tasks

- [ ] Review the tables and columns above.
- [ ] Agent implements [01-d1-schema.tech.md](01-d1-schema.tech.md) (local database only).
- [ ] You review the migration file.
- [ ] You apply it to the live database: `pnpm --filter @pixie-logger/api db:migrate:remote`.
- [ ] Commit: "Phase 2: D1 schema".

## Done when

- The migration applies cleanly to both the local and the live database.
- The constraint checks in the tech spec behave as expected locally.
