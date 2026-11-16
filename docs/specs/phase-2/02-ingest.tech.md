# Technical Spec — Phase 2, Task 2: Ingest Endpoint

> **Prerequisites:**
> - Phase 1 complete (`@pixie-logger/shared` with `logBatchEnvelopeSchema`, `validateEvents`, `formatZodIssues`, `errorResponse`, `LIMITS`, `utf8ByteLength`, `ERROR_CODES`).
> - [01-d1-schema.tech.md](01-d1-schema.tech.md) done and applied locally.
> - [03-app-keys.tech.md](03-app-keys.tech.md) done (`apps/api/src/lib/api-key.ts`, `pnpm keys`, vitest in `apps/api`).

Design reference: [02-ingest.md](02-ingest.md). Contract: [../phase-1/02-api-endpoints.md](../phase-1/02-api-endpoints.md).

## Rules for the agent

1. Only create or modify the files listed in "Files" below.
2. Do not change the API contract (paths, headers, status codes, error codes, response shapes) beyond adding `internal_error` as specified. If something conflicts or fails, **stop and report it**.
3. **Never use `--remote`, never deploy.** Local database and `wrangler dev` only.
4. Reuse the shared package and `src/lib/api-key.ts`. Do not re-implement validation, hashing or byte counting.
5. pnpm only. Do not commit. Finish by running "Verification" and reporting the output of each step.

## Repo context

```
packages/shared/src/        # constants.ts (LIMITS, ERROR_CODES), schemas.ts, api.ts (validateEvents, errorResponse, types), format.ts, utf8.ts
apps/api/
├─ wrangler.jsonc           # binding DB (D1 "pixie-logs")
├─ migrations/0001_init.sql # apps, api_keys, logs
├─ scripts/keys.ts          # pnpm keys …
├─ src/index.ts             # Hono app: GET /message, GET /v1/health
├─ src/lib/api-key.ts       # isWellFormedApiKey, hashApiKey, …
└─ test/api-key.test.ts
```

The Worker's env type is `CloudflareBindings` (from `worker-configuration.d.ts`); `c.env.DB` is a `D1Database`.

## Files

### Modify `apps/api/package.json` (do this first)

`apps/api` has no TypeScript compiler installed yet, so it can't be type-checked on its own. Add it:

```
pnpm --filter @pixie-logger/api add -D typescript
```

Add to `scripts` (keep the existing ones):

```json
"typecheck": "tsc --noEmit"
```

Root `pnpm typecheck` runs every package's `typecheck` script, so it now covers `apps/api` as well as `packages/shared`.

Then run `pnpm typecheck` once **before** making any other change. If it reports errors in existing code, stop and report them rather than fixing them as part of this task.

### Modify `packages/shared/src/constants.ts`

Append `'internal_error'` as the **last** item of `ERROR_CODES`. Change nothing else.

### Modify `packages/shared/test/api.test.ts`

Update the `ERROR_CODES` test to expect 8 codes, with `'internal_error'` last.

### Create `apps/api/src/lib/auth.ts`

```ts
/**
 * Returns the app id for a valid, active key, or null.
 * Null for: missing/malformed key, unknown hash, revoked key, disabled app.
 */
export async function findAppIdForKey(db: D1Database, key: string | undefined): Promise<string | null>
```

- `key` is trimmed first. If missing or `!isWellFormedApiKey(key)` → return `null` **without** a database call.
- Otherwise `hashApiKey(key)` and run one prepared statement with `.bind()` (never string interpolation):

  ```sql
  SELECT k.app_id AS app_id
  FROM api_keys k
  JOIN apps a ON a.id = k.app_id
  WHERE k.key_hash = ?1
    AND k.revoked_at IS NULL
    AND a.disabled_at IS NULL
  LIMIT 1
  ```

- Return `app_id` from `.first<{ app_id: string }>()`, or `null`.

### Create `apps/api/src/lib/log-rows.ts`

Pure functions, no database access, so they can be unit-tested in Node.

```ts
import type { LogEvent, LogBatchEnvelope } from '@pixie-logger/shared';

export interface LogRow {
  app_id: string;
  level: string;
  event: string;
  message: string | null;
  route: string | null;
  params: string | null;      // JSON string
  context: string | null;     // JSON string
  app_version: string;
  platform: string;
  session_id: string;
  client_ts: number;          // ms
  received_at: number;        // ms
}

export const LOG_COLUMNS: readonly (keyof LogRow)[]   // the 12 keys above, in this order

export function toLogRow(
  appId: string,
  envelope: Pick<LogBatchEnvelope, 'appVersion' | 'platform' | 'sessionId'>,
  event: LogEvent,
  receivedAt: number,
): LogRow
```

Mapping:
- `message`, `route`: the value, or `null` when undefined.
- `params`, `context`: `JSON.stringify(value)` when defined, else `null`.
- `client_ts`: `Date.parse(event.clientTs)` (the schema already guarantees a valid ISO datetime with offset).
- Envelope fields copied as-is.

```ts
export const INSERT_LOG_SQL: string
```

`INSERT INTO logs (<LOG_COLUMNS joined by ", ">) VALUES (?1, ?2, …, ?12)`, built from `LOG_COLUMNS` so the order can't drift.

### Create `apps/api/src/routes/ingest.ts`

Export a Hono sub-app:

```ts
export const ingest = new Hono<{ Bindings: CloudflareBindings }>();
ingest.post('/', async (c) => { … });
```

Handler steps, in this exact order:

1. **Auth.** `const appId = await findAppIdForKey(c.env.DB, c.req.header('x-api-key'))`. If `null` → `401`, `errorResponse('unauthorized', 'Invalid or missing API key')`.
2. **Size, from header.** If `Content-Length` is present, is a valid integer, and is `> LIMITS.maxBodyBytes` → `413`, `errorResponse('payload_too_large', \`Body exceeds ${LIMITS.maxBodyBytes} bytes\`)`. Do not read the body in this case.
3. **Read body.** `const text = await c.req.text()`. If `utf8ByteLength(text) > LIMITS.maxBodyBytes` → same `413`.
4. **Parse.** `JSON.parse(text)` in try/catch. Failure → `400`, `errorResponse('invalid_json', 'Body is not valid JSON')`.
5. **Envelope.** `logBatchEnvelopeSchema.safeParse(json)`. Failure → `400`, `errorResponse('invalid_envelope', formatZodIssues(result.error).join('; '))`.
6. **Events.** `const { valid, rejected } = validateEvents(envelope.events)`. If `valid.length === 0` → `400`, `errorResponse('no_valid_events', \`All ${rejected.length} events are invalid. First error: ${rejected[0]?.errors[0] ?? 'unknown'}\`)`.
7. **Insert.**
   ```ts
   const receivedAt = Date.now();
   const stmt = c.env.DB.prepare(INSERT_LOG_SQL);
   await c.env.DB.batch(
     valid.map((e) => {
       const row = toLogRow(appId, envelope, e, receivedAt);
       return stmt.bind(...LOG_COLUMNS.map((k) => row[k]));
     }),
   );
   ```
   Do **not** catch errors here; the app-level error handler turns them into `500`.
8. **Respond.** `202` with an `IngestResponse`: `{ accepted: valid.length, rejected }`.

All responses use `c.json(body, status)`. Type the bodies with `IngestResponse` / `ErrorResponse` from the shared package.

### Modify `apps/api/src/index.ts`

- Keep `GET /message` and `GET /v1/health`.
- Mount the sub-app: `app.route('/v1/logs', ingest)`.
- Add a global error handler:

  ```ts
  app.onError((err, c) => {
    console.error('Unhandled error', err);
    return c.json(errorResponse('internal_error', 'Internal error'), 500);
  });
  ```

  The response must never include `err.message` or a stack trace.

### Create `apps/api/test/log-rows.test.ts`

1. Minimal event → `message`, `route`, `params`, `context` are `null`; `client_ts === Date.parse(clientTs)`; envelope fields and `received_at` copied.
2. Full event → `params` / `context` are JSON strings that `JSON.parse` back to the originals.
3. `clientTs` with an offset (`'2026-11-15T14:30:00+02:00'`) → `client_ts === Date.parse('2026-11-15T12:30:00Z')`.
4. `LOG_COLUMNS` has 12 entries; `INSERT_LOG_SQL` contains every column name and placeholders `?1` … `?12`, and no `?13`.

## Verification

Run from the repo root. **Local only.** Report the output of each step.

### A. Static checks

1. `pnpm test` — all tests pass (shared, including the updated `ERROR_CODES` test, and api).
2. `pnpm typecheck` — no errors in either package (the output should show both `@pixie-logger/shared` and `@pixie-logger/api` running `tsc --noEmit`).

### B. Setup

3. `pnpm --filter @pixie-logger/api db:migrate:local` — no pending migrations (or applies cleanly).
4. `pnpm keys create-app smoke-test "Smoke Test"` — save the printed key as `KEY` and the key id as `KEY_ID`.
5. Start the dev server in the background: `pnpm --filter @pixie-logger/api exec wrangler dev --port 8787`. Wait until it responds on `http://localhost:8787/v1/health`.

### C. Requests

Use `curl -s -o /dev/stderr -w "%{http_code}\n" -X POST http://localhost:8787/v1/logs -H "Content-Type: application/json" …` (or equivalent) and report status and body for each.

A valid event for the bodies below: `{"level":"info","event":"smoke","clientTs":"2026-11-15T12:00:00Z"}`. A valid envelope: `{"appVersion":"1.0.0","platform":"web","sessionId":"s1","events":[ … ]}`.

| # | Request | Expected |
|---|---|---|
| 6 | No `X-Api-Key` | `401`, code `unauthorized` |
| 7 | `X-Api-Key: wrong` | `401`, `unauthorized` |
| 8 | Well-formed but unknown key (`pxl_` + 64 zeros) | `401`, `unauthorized` |
| 9 | `KEY`, body `not json` | `400`, `invalid_json` |
| 10 | `KEY`, envelope with `"platform":"windows"` | `400`, `invalid_envelope` |
| 11 | `KEY`, envelope with `"events":[]` | `400`, `invalid_envelope` |
| 12 | `KEY`, envelope with `"events":[{}]` | `400`, `no_valid_events` |
| 13 | `KEY`, envelope with 2 valid events | `202`, `{"accepted":2,"rejected":[]}` |
| 14 | `KEY`, envelope with `[valid, {"level":"nope"}, valid]` | `202`, `accepted: 2`, one rejected with `index: 1` |
| 15 | `KEY`, body of ~600 KB (e.g. generate a JSON string with a long padding field) | `413`, `payload_too_large` |
| 16 | `KEY`, valid event with `"params":{"id":"123"}` and `"context":{"n":1}` | `202` |

### D. Database checks

Run with `pnpm --filter @pixie-logger/api exec wrangler d1 execute pixie-logs --local --command "<SQL>"`:

17. `SELECT count(*) AS n FROM logs WHERE app_id = 'smoke-test';` → `5` (2 + 2 + 1 from steps 13, 14, 16).
18. `SELECT params, context, client_ts, received_at FROM logs WHERE params IS NOT NULL;` → `{"id":"123"}`, `{"n":1}`, `client_ts = 1794744000000`, `received_at` a recent ms timestamp.
19. All rows from step 13 share the same `received_at`.

### E. Revoked key and disabled app

20. `pnpm keys disable-app smoke-test` → request #13 again → `401`. Then `pnpm keys enable-app smoke-test` → `202` again.
21. `pnpm keys revoke-key <KEY_ID>` → request #13 again → `401`.

### F. Error handling

22. Confirm by reading the code that `onError` returns `internal_error` with the fixed message `Internal error` and never includes the original error. (Do not try to break the local database to test this.)

### G. Clean up

23. Stop the dev server.
24. `pnpm --filter @pixie-logger/api exec wrangler d1 execute pixie-logs --local --command "DELETE FROM apps WHERE id = 'smoke-test'"` → then `SELECT count(*) FROM logs;` returns `0`.

## Done when

- `src/lib/auth.ts`, `src/lib/log-rows.ts`, `src/routes/ingest.ts` and `test/log-rows.test.ts` exist as specified, and `src/index.ts` mounts the route and the error handler.
- `ERROR_CODES` ends with `internal_error`.
- `apps/api` has `typescript` as a dev dependency and a `typecheck` script.
- All verification steps pass locally; nothing was deployed and the live database was not touched.
