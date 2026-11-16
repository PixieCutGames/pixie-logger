# Technical Spec — Phase 2, Task 4: CORS Allowlist

> **Prerequisite:** [02-ingest.tech.md](02-ingest.tech.md) is done (`src/routes/ingest.ts` exists and is mounted at `/v1/logs`; `pnpm typecheck` covers `apps/api`).

Design reference: [04-cors.md](04-cors.md).

## Rules for the agent

1. Only create or modify the files listed in "Files" below.
2. Do not change the ingest logic, response shapes or error codes. If something conflicts or fails, **stop and report it**.
3. **Never use `--remote`, never deploy.**
4. Use Hono's built-in `cors` middleware from `hono/cors`. Don't hand-write CORS headers and don't add a CORS library.
5. pnpm only. Do not commit. Finish by running "Verification" and reporting the output of each step.

## Repo context

```
apps/api/
├─ wrangler.jsonc        # has a commented-out "vars" example; no vars yet
├─ worker-configuration.d.ts   # generated; defines CloudflareBindings
└─ src/
   ├─ index.ts           # mounts ingest at /v1/logs, onError handler
   ├─ routes/ingest.ts   # export const ingest = new Hono<…>(); ingest.post('/', …)
   └─ lib/               # api-key.ts, auth.ts, log-rows.ts
```

## Files

### Modify `apps/api/wrangler.jsonc`

Add a top-level `vars` entry (replace the commented-out `"vars"` example line; leave all other comments and settings alone):

```jsonc
"vars": {
  "ALLOWED_ORIGINS": "capacitor://localhost,https://localhost,http://localhost,http://localhost:8100,http://localhost:4200,http://localhost:5173"
}
```

Then regenerate the binding types so `ALLOWED_ORIGINS` appears on `CloudflareBindings`:

```
pnpm --filter @pixie-logger/api cf-typegen
```

### Create `apps/api/src/lib/cors.ts`

Pure functions plus the middleware factory.

```ts
/** Splits the comma-separated list, trims each entry, drops empty entries and trailing slashes. */
export function parseAllowedOrigins(value: string | undefined): string[]

/** Exact match after the same normalisation. 'null' and empty strings are never allowed. */
export function isOriginAllowed(origin: string | undefined, allowed: readonly string[]): boolean

/** Hono middleware for /v1/logs. */
export function logsCors(): MiddlewareHandler<{ Bindings: CloudflareBindings }>
```

`logsCors()` returns `cors({ … })` from `hono/cors` configured as:

| Option | Value |
|---|---|
| `origin` | a function `(origin, c) => isOriginAllowed(origin, parseAllowedOrigins(c.env.ALLOWED_ORIGINS)) ? origin : null` |
| `allowMethods` | `['POST']` |
| `allowHeaders` | `['Content-Type', 'X-Api-Key']` |
| `maxAge` | `86400` |
| `credentials` | `false` (omit; it's the default) |

If the installed Hono version's `origin` callback has a different signature, adapt to it and report what changed.

### Modify `apps/api/src/routes/ingest.ts`

Register the middleware on the sub-app **before** the POST handler:

```ts
ingest.use('*', logsCors());
```

Change nothing else in the file.

### Create `apps/api/test/cors.test.ts`

`parseAllowedOrigins`:
1. `undefined` and `''` → `[]`.
2. `' https://a.com , capacitor://localhost ,, https://b.com/ '` → `['https://a.com', 'capacitor://localhost', 'https://b.com']`.

`isOriginAllowed` with list `['https://a.com', 'capacitor://localhost']`:
3. `'https://a.com'` → true; `'https://a.com/'` → true; `'capacitor://localhost'` → true.
4. `'https://evil.com'`, `'http://a.com'`, `'https://a.com:8443'`, `'https://sub.a.com'` → false.
5. `undefined`, `''`, `'null'` → false.

## Verification

Run from the repo root. **Local only.** Report the output of each step.

1. `pnpm test` — all tests pass.
2. `pnpm typecheck` — no errors; `c.env.ALLOWED_ORIGINS` is typed as a string.
3. `pnpm --filter @pixie-logger/api db:migrate:local`, then `pnpm keys create-app cors-test "CORS Test"`; save the key as `KEY`.
4. Start `pnpm --filter @pixie-logger/api exec wrangler dev --port 8787` in the background.

Use `curl -s -i` and report the relevant response headers for each:

| # | Request | Expected |
|---|---|---|
| 5 | `OPTIONS /v1/logs` with `Origin: http://localhost:8100`, `Access-Control-Request-Method: POST`, `Access-Control-Request-Headers: content-type,x-api-key` | `204`; `Access-Control-Allow-Origin: http://localhost:8100`; `Access-Control-Allow-Methods` includes `POST`; `Access-Control-Allow-Headers` includes `X-Api-Key` and `Content-Type` (any case); `Access-Control-Max-Age: 86400` |
| 6 | Same with `Origin: capacitor://localhost` | Same, with that origin echoed |
| 7 | Same with `Origin: https://evil.example` | **No** `Access-Control-Allow-Origin` header |
| 8 | `POST /v1/logs` with `KEY`, a valid one-event batch, `Origin: http://localhost:8100` | `202`; `Access-Control-Allow-Origin: http://localhost:8100` |
| 9 | Same POST with **no** `Origin` header | `202`; body unchanged from before this task |
| 10 | `POST /v1/logs` with a wrong key and `Origin: http://localhost:8100` | `401` with `Access-Control-Allow-Origin` present (so the browser can read the error) |
| 11 | `GET /v1/health` with `Origin: http://localhost:8100` | `200`; no CORS headers (middleware is scoped to `/v1/logs`) |

12. Stop the dev server. Clean up: `pnpm --filter @pixie-logger/api exec wrangler d1 execute pixie-logs --local --command "DELETE FROM apps WHERE id = 'cors-test'"`.

## Done when

- `ALLOWED_ORIGINS` is in `wrangler.jsonc` and in the generated types.
- `src/lib/cors.ts` and `test/cors.test.ts` exist; `ingest.ts` uses the middleware.
- All verification steps pass locally; nothing was deployed.
