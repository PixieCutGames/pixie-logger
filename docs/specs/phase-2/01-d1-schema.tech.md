# Technical Spec — Phase 2, Task 1: D1 Schema

> **Prerequisite:** Phase 1 is complete (`@pixie-logger/shared` exists; `pnpm test` passes).

Design reference: [01-d1-schema.md](01-d1-schema.md) — the source of truth for every table, column and index below.

## Rules for the agent

1. Only create or modify the files listed in "Files" below.
2. Do not change table names, column names, types, constraints or indexes from this spec. If something conflicts or fails, **stop and report it**.
3. **Never run anything with `--remote`.** Work on the local database only. The user applies the migration to the live database.
4. Do not edit `wrangler.jsonc`. The D1 binding is already configured (`binding: "DB"`, `database_name: "pixie-logs"`), and wrangler's default migrations folder (`migrations/`, next to `wrangler.jsonc`) is the one to use.
5. pnpm only. Do not commit. Finish by running "Verification" and reporting the output of each step.

## Repo context

```
apps/api/
├─ package.json        # @pixie-logger/api; scripts: dev, deploy, cf-typegen
├─ wrangler.jsonc      # Worker "pixie-logger"; d1_databases: [{ binding: "DB", database_name: "pixie-logs", ... }]
└─ src/index.ts
```

Run wrangler as `pnpm --filter @pixie-logger/api exec wrangler …` from the repo root.

## Files

### Create `apps/api/migrations/0001_init.sql`

Create it with:

```
pnpm --filter @pixie-logger/api exec wrangler d1 migrations create pixie-logs init
```

If wrangler names the file differently (e.g. a different number format), keep wrangler's name and report it. Then replace the file's contents with exactly:

```sql
-- Migration 0001: apps, api_keys, logs

CREATE TABLE apps (
  id            TEXT    PRIMARY KEY
                        CHECK (length(id) BETWEEN 1 AND 50 AND id NOT GLOB '*[^a-z0-9-]*'),
  display_name  TEXT    NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  created_at    INTEGER NOT NULL,
  disabled_at   INTEGER
);

CREATE TABLE api_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id        TEXT    NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  key_hash      TEXT    NOT NULL UNIQUE CHECK (length(key_hash) = 64),
  key_prefix    TEXT    NOT NULL,
  label         TEXT,
  created_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);

CREATE INDEX idx_api_keys_app ON api_keys (app_id);

CREATE TABLE logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id        TEXT    NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  level         TEXT    NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error', 'fatal')),
  event         TEXT    NOT NULL CHECK (length(event) BETWEEN 1 AND 100),
  message       TEXT,
  route         TEXT,
  params        TEXT    CHECK (params IS NULL OR json_valid(params)),
  context       TEXT    CHECK (context IS NULL OR json_valid(context)),
  app_version   TEXT    NOT NULL,
  platform      TEXT    NOT NULL CHECK (platform IN ('web', 'android', 'ios')),
  session_id    TEXT    NOT NULL,
  client_ts     INTEGER NOT NULL,
  received_at   INTEGER NOT NULL
);

CREATE INDEX idx_logs_app_id       ON logs (app_id, id);
CREATE INDEX idx_logs_app_level_id ON logs (app_id, level, id);
CREATE INDEX idx_logs_received_at  ON logs (received_at);
```

Notes for the agent (do not add these to the SQL):
- `key_hash` is a lowercase hex SHA-256 (64 chars). `api_keys.key_hash` is `UNIQUE`, which creates the lookup index automatically.
- `idx_api_keys_app` supports cascading deletes and listing an app's keys.
- Level and platform values must match `LOG_LEVELS` and `PLATFORMS` in `packages/shared/src/constants.ts`. Check they do; if not, stop and report.
- All `*_at` / `*_ts` columns are Unix milliseconds.

### Modify `apps/api/package.json`

Add to `scripts` (keep the existing ones):

```json
"db:migrate:local": "wrangler d1 migrations apply pixie-logs --local",
"db:migrate:remote": "wrangler d1 migrations apply pixie-logs --remote",
"db:list:local": "wrangler d1 migrations list pixie-logs --local"
```

Do **not** run `db:migrate:remote`.

## Verification

Run from the repo root. For the SQL checks, use:

```
pnpm --filter @pixie-logger/api exec wrangler d1 execute pixie-logs --local --command "<SQL>"
```

1. **Apply:** `pnpm --filter @pixie-logger/api db:migrate:local` succeeds.
2. **Listed as applied:** `pnpm --filter @pixie-logger/api db:list:local` shows no pending migrations.
3. **Tables exist:** `SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY name;` lists `apps`, `api_keys`, `logs` and the four `idx_…` indexes.
4. **Valid inserts succeed** (run as one command):
   ```sql
   INSERT INTO apps (id, display_name, created_at) VALUES ('test-app', 'Test App', 1763200000000);
   INSERT INTO api_keys (app_id, key_hash, key_prefix, created_at) VALUES ('test-app', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'pxl_test', 1763200000000);
   INSERT INTO logs (app_id, level, event, params, app_version, platform, session_id, client_ts, received_at)
     VALUES ('test-app', 'info', 'order_viewed', '{"id":"123"}', '1.0.0', 'android', 's1', 1763200000000, 1763200001000);
   ```
5. **Each of these fails** with a constraint error (run each separately; report the error for each):
   - Bad app slug: `INSERT INTO apps (id, display_name, created_at) VALUES ('Bad App', 'x', 1);`
   - Unknown level: `INSERT INTO logs (app_id, level, event, app_version, platform, session_id, client_ts, received_at) VALUES ('test-app', 'critical', 'e', '1', 'web', 's', 1, 1);`
   - Unknown platform: same as above with `level = 'info'`, `platform = 'windows'`.
   - Invalid JSON: same as the valid log insert with `params = 'not json'`.
   - Unknown app (foreign key): same as the valid log insert with `app_id = 'nope'`.
   - Duplicate key hash: repeat the `api_keys` insert from step 4.
6. **Cascade:** `DELETE FROM apps WHERE id = 'test-app';` then `SELECT (SELECT count(*) FROM api_keys) AS keys, (SELECT count(*) FROM logs) AS logs;` returns `0, 0`.
7. **Index is used:** `EXPLAIN QUERY PLAN SELECT * FROM logs WHERE app_id = 'x' AND level = 'error' ORDER BY id DESC LIMIT 100;` mentions `idx_logs_app_level_id`.
8. **Clean up:** the test rows are already gone after step 6. Confirm `SELECT count(*) FROM apps;` returns 0.
9. **Nothing else broke:** `pnpm test` and `pnpm typecheck` still pass.

If step 5's foreign-key insert **succeeds**, foreign keys aren't being enforced locally. Stop and report it rather than changing the schema.

## Done when

- `apps/api/migrations/0001_init.sql` exists with the SQL above.
- The three scripts are in `apps/api/package.json`.
- All verification steps pass on the local database, and the remote database was not touched.
