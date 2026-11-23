# Technical Spec — Phase 4, Task 2: Read API

> **Prerequisites:** [01-access-check.tech.md](01-access-check.tech.md) done (`requireAccess` guards `/v1/admin/*` in `apps/api/src/index.ts`).

Design reference: [02-read-api.md](02-read-api.md). Contract: [../phase-1/02-api-endpoints.md](../phase-1/02-api-endpoints.md) ("Reading logs").

## Rules for the agent

1. Only create or modify the files listed in "Files" below.
2. Do not change the contract beyond what this spec lists (`session` param, `AppSummary`, `AppsResponse`). If something conflicts or fails, **stop and report it**.
3. **Never use `--remote`, never deploy.** Local database and `wrangler dev` only.
4. All SQL uses prepared statements with `.bind()`. Never put a query value into the SQL string. Column names and `?` placeholders are the only dynamic SQL parts.
5. No new migration. No CORS on these routes.
6. pnpm only. Do not commit. Finish by running "Verification" and reporting the output of each step.

## Repo context

```
packages/shared/src/query.ts   # logsQuerySchema, LogsQuery
packages/shared/src/api.ts     # LogRecord, LogsPage, errorResponse, …
apps/api/src/index.ts          # Hono app; app.use('/v1/admin/*', requireAccess()) from Task 1
apps/api/src/lib/access.ts     # requireAccess
apps/api/migrations/0001_init.sql  # logs(id INTEGER PK AUTOINCREMENT, app_id, level, event, message, route,
                                   #      params TEXT json, context TEXT json, app_version, platform,
                                   #      session_id, client_ts ms, received_at ms); apps(id, display_name, created_at, disabled_at)
```

## Files

### Modify `packages/shared/src/query.ts`

Add to the object schema, after `event`:

```ts
session: z.string().min(1).max(LIMITS.sessionIdMax).optional(),
```

Change nothing else.

### Modify `packages/shared/src/api.ts`

- Update the comments `// one item from GET /v1/logs` → `// one item from GET /v1/admin/logs` and `// GET /v1/logs → 200` → `// GET /v1/admin/logs → 200`.
- Add after `LogsPage`:

```ts
export interface AppSummary {             // one item from GET /v1/admin/apps
  id: string;
  displayName: string;
  disabled: boolean;
}

export interface AppsResponse {           // GET /v1/admin/apps → 200
  items: AppSummary[];
}
```

### Modify `packages/shared/test/query-schema.test.ts`

Add:
- `{ session: 'abc' }` → `session: 'abc'`.
- `{ session: '' }` fails; `{ session: 'x'.repeat(65) }` fails; `'x'.repeat(64)` passes.

### Create `apps/api/src/lib/log-query.ts`

Pure functions, no database access.

```ts
import type { LogLevel, LogRecord, LogsQuery, Platform } from '@pixie-logger/shared';

/** URLSearchParams → the input shape logsQuerySchema expects: a string, or string[] when a key repeats. */
export function searchParamsToObject(params: URLSearchParams): Record<string, string | string[]>
```

- One value → the string. Two or more → the array, in order. (So `?level=error` → `'error'`, `?level=error&level=fatal` → `['error','fatal']`.)

```ts
/** Cursor = decimal log id. Returns null if not a positive safe integer written in canonical form. */
export function parseCursor(cursor: string): number | null
```

- Accept only `/^[1-9][0-9]*$/` and `Number.isSafeInteger(n)`. Everything else → `null`.

```ts
export interface LogDbRow {
  id: number; app_id: string; level: string; event: string;
  message: string | null; route: string | null;
  params: string | null; context: string | null;
  app_version: string; platform: string; session_id: string;
  client_ts: number; received_at: number;
}

export const SELECT_LOG_COLUMNS: string  // the 13 columns above, in this order, comma-separated

export function buildLogsQuery(q: LogsQuery, cursorId: number | null): { sql: string; params: (string | number)[] }
```

Builds:

```sql
SELECT <SELECT_LOG_COLUMNS> FROM logs
WHERE <conditions joined by ' AND '>      -- whole WHERE clause omitted when there are none
ORDER BY id DESC
LIMIT ?
```

Conditions, in this order, each only when the filter is present, with values pushed to `params` in the same order:

| Filter | Condition | Value(s) |
|---|---|---|
| `app` | `app_id = ?` | `q.app` |
| `level` (non-empty) | `level IN (?, ?, …)` (one `?` per level) | each level |
| `event` | `event = ?` | `q.event` |
| `session` | `session_id = ?` | `q.session` |
| `from` | `received_at >= ?` | `Date.parse(q.from)` |
| `to` | `received_at < ?` | `Date.parse(q.to)` |
| `cursorId !== null` | `id < ?` | `cursorId` |

Last param: `q.limit + 1` (one extra row tells whether there's a next page). Use anonymous `?` placeholders only.

```ts
export function toLogRecord(row: LogDbRow): LogRecord
```

- `id: String(row.id)`, `app: row.app_id`, `level: row.level as LogLevel`, `platform: row.platform as Platform`.
- `params` / `context`: `JSON.parse` when not null, else `null`. (The database guarantees valid JSON; a parse error is a real fault and goes to `onError` → 500.)
- `appVersion`, `sessionId`, `message`, `route`, `event` copied.
- `clientTs: new Date(row.client_ts).toISOString()`, `receivedAt: new Date(row.received_at).toISOString()`.

```ts
export function toLogsPage(rows: LogDbRow[], limit: number): LogsPage
```

- If `rows.length > limit`: `items` = first `limit` rows mapped; `nextCursor = String(rows[limit - 1].id)`.
- Otherwise: all rows mapped; `nextCursor: null`.

### Create `apps/api/src/routes/admin.ts`

```ts
export const admin = new Hono<{ Bindings: CloudflareBindings }>();
```

Set `Cache-Control: no-store` on every response of this sub-app (a small `admin.use('*', …)` that sets the header after `await next()`; it must also apply to 400 responses).

#### `GET /logs`

1. `const parsed = logsQuerySchema.safeParse(searchParamsToObject(new URL(c.req.url).searchParams))`. Failure → `400`, `errorResponse('invalid_query', formatZodIssues(parsed.error).join('; '))`.
2. If `parsed.data.cursor` is set: `cursorId = parseCursor(...)`; `null` → `400`, `errorResponse('invalid_query', 'cursor: invalid')`.
3. `const { sql, params } = buildLogsQuery(parsed.data, cursorId)`; `const { results } = await c.env.DB.prepare(sql).bind(...params).all<LogDbRow>()`.
4. `200` with `toLogsPage(results, parsed.data.limit)`, typed `LogsPage`.

Do not catch database errors (global `onError` → `500 internal_error`).

#### `GET /apps`

```sql
SELECT id, display_name, disabled_at FROM apps ORDER BY id
```

→ `200` `AppsResponse`: `{ items: results.map(r => ({ id: r.id, displayName: r.display_name, disabled: r.disabled_at !== null })) }`.

### Modify `apps/api/src/index.ts`

After the `app.use('/v1/admin/*', requireAccess())` line from Task 1, mount:

```ts
app.route('/v1/admin', admin);
```

The `use` line must stay **before** the `route` line. Change nothing else.

### Create `apps/api/test/log-query.test.ts`

`searchParamsToObject`:
1. `?app=a&level=error&level=fatal&limit=5` → `{ app: 'a', level: ['error','fatal'], limit: '5' }`.
2. Empty params → `{}`.

`parseCursor`:
3. `'1'`, `'42'`, `'9007199254740991'` → numbers.
4. `''`, `'0'`, `'-1'`, `'01'`, `'1.5'`, `'1e3'`, `' 1'`, `'abc'`, `'9007199254740992'` → `null`.

`buildLogsQuery` (build `LogsQuery` values with `logsQuerySchema.parse(...)`):
5. `{}` → SQL has no `WHERE`, ends with `ORDER BY id DESC LIMIT ?`; params `[101]`.
6. All filters + cursor 500 → conditions in the table order; params exactly `['maslary', 'error', 'fatal', 'api_failed', 's1', <ms from>, <ms to>, 500, 51]` for `limit: '50'`.
7. One level → `level IN (?)` with one param.
8. The number of `?` in the SQL equals `params.length` (check for cases 5–7).
9. Values never appear in the SQL string (e.g. `app: "x' OR 1=1 --"` is only in `params`).

`toLogRecord` / `toLogsPage`:
10. Row with null optionals → nulls; `params` / `context` JSON strings → objects; times → ISO strings (`1794744000000` → `'2026-11-15T12:00:00.000Z'`); `id` is a string.
11. `toLogsPage` with `limit + 1` rows → `limit` items, `nextCursor` = id of the last returned item as a string; with `limit` or fewer rows → `nextCursor: null`; with 0 rows → `{ items: [], nextCursor: null }`.

## Verification

Run from the repo root. **Local only.** Report the output of each step.

### A. Static checks

1. `pnpm test` — all pass.
2. `pnpm typecheck` — no errors.

### B. Setup

3. `pnpm --filter @pixie-logger/api db:migrate:local`.
4. `pnpm keys create-app smoke-a "Smoke A"` and `pnpm keys create-app smoke-b "Smoke B"`; save the keys as `KEY_A`, `KEY_B`.
5. Create `apps/api/.dev.vars` with `ACCESS_DEV_BYPASS=true` and start `pnpm --filter @pixie-logger/api exec wrangler dev --port 8787`.
6. Seed through the real ingest route (`POST /v1/logs`):
   - `KEY_A`, session `s1`, platform `web`: 3 events — `info`/`page_view`, `error`/`api_failed` with `"context":{"status":504}`, `warn`/`slow`.
   - `KEY_A`, session `s2`: 1 event `error`/`api_failed`.
   - `KEY_B`, session `s3`: 1 event `fatal`/`crash` with `"params":{"id":"1"}`.

### C. Requests (`curl -s http://localhost:8787/v1/admin/...`, report status + body)

| # | Request | Expected |
|---|---|---|
| 7 | `/logs` | `200`, 5 items, newest first (highest id first), `nextCursor: null`, header `Cache-Control: no-store` |
| 8 | `/logs?app=smoke-a` | 4 items, all `app: "smoke-a"` |
| 9 | `/logs?level=error&level=fatal` | 3 items |
| 10 | `/logs?event=api_failed&app=smoke-a` | 2 items |
| 11 | `/logs?session=s1` | 3 items, all `sessionId: "s1"` |
| 12 | `/logs?limit=2` → then `?limit=2&cursor=<nextCursor>` → then again | pages of 2, 2, 1; no duplicates across pages; last `nextCursor: null` |
| 13 | `/logs?from=<ISO 1 minute in the future>` | `items: []`, `nextCursor: null` |
| 14 | `/logs?to=2000-01-01T00:00:00Z` | `items: []` |
| 15 | `/logs?level=critical` | `400`, `invalid_query` |
| 16 | `/logs?limit=501` | `400`, `invalid_query` |
| 17 | `/logs?from=2026-11-20T00:00:00Z&to=2026-11-19T00:00:00Z` | `400`, `invalid_query`, message mentions `to` |
| 18 | `/logs?cursor=abc` | `400`, `invalid_query`, `cursor: invalid`; header `Cache-Control: no-store` |
| 19 | the `crash` item from #7 | `params` is the object `{"id":"1"}`, `clientTs` / `receivedAt` are ISO strings |
| 20 | `/apps` | `200`, `{ items: [{ id: "smoke-a", displayName: "Smoke A", disabled: false }, { id: "smoke-b", … }, …] }` sorted by id (other local apps may also appear) |
| 21 | `pnpm keys disable-app smoke-b`, then `/apps` | `smoke-b` has `disabled: true`; `/logs?app=smoke-b` still returns its log |

### D. Without the bypass

22. Stop the server, **delete** `apps/api/.dev.vars`, start it again: `/v1/admin/logs` and `/v1/admin/apps` → `401 unauthorized`. A `POST /v1/logs` with `KEY_A` → `202`.

### E. Clean up

23. Stop the server. Delete `apps/api/.dev.vars` if it still exists.
24. `wrangler d1 execute pixie-logs --local --command "DELETE FROM apps WHERE id IN ('smoke-a','smoke-b')"` (via `pnpm --filter @pixie-logger/api exec`).
25. `git status` — changes only in `packages/shared/src/query.ts`, `packages/shared/src/api.ts`, `packages/shared/test/query-schema.test.ts`, `apps/api/src/lib/log-query.ts`, `apps/api/src/routes/admin.ts`, `apps/api/src/index.ts`, `apps/api/test/log-query.test.ts`.

## Done when

- Both routes exist under `/v1/admin`, guarded by `requireAccess`, and match the contract.
- `logsQuerySchema` accepts `session`; `AppSummary` and `AppsResponse` are exported.
- All verification steps pass; nothing was deployed and the live database was not touched.
