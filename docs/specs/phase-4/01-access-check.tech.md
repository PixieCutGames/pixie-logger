# Technical Spec — Phase 4, Task 1: Access Check in the Worker

> **Prerequisites:** Phases 1–3 done. `apps/api` has Hono 4.13, vitest, TypeScript 7, `src/index.ts` with `GET /v1/health`, `POST /v1/logs` and a global `onError`.

Design reference: [01-access-check.md](01-access-check.md). Contract: [../phase-1/02-api-endpoints.md](../phase-1/02-api-endpoints.md) ("Reading logs").

## Rules for the agent

1. Only create or modify the files listed in "Files" below.
2. Do not change the API contract or any existing behaviour of `POST /v1/logs`, `GET /v1/health` or CORS. If something conflicts or fails, **stop and report it**.
3. **Never use `--remote`, never deploy.** Local only. Do not put real team domain or AUD values anywhere.
4. Fail closed: any missing setting, missing token or verification error means "not authorised". Never log the token.
5. pnpm only. Do not commit. Finish by running "Verification" and reporting the output of each step.

## Background (why not `ctx.access`)

Cloudflare offers `ctx.access.getIdentity()`, but it isn't passed to Workers that have static assets (this Worker serves `public/`). So the Worker verifies the `Cf-Access-Jwt-Assertion` JWT itself, following Cloudflare's documented approach with `jose`: `createRemoteJWKSet(new URL(`${TEAM_DOMAIN}/cdn-cgi/access/certs`))` + `jwtVerify(token, JWKS, { issuer: TEAM_DOMAIN, audience: AUD })`.

## Files

### Modify `apps/api/package.json`

```
pnpm --filter @pixie-logger/api add jose
```

(`jose` 6.x, as a regular dependency.) Change nothing else in the file.

### Modify `apps/api/wrangler.jsonc`

Add two keys to the existing `vars` object (keep `ALLOWED_ORIGINS` unchanged):

```jsonc
"ACCESS_TEAM_DOMAIN": "",
"ACCESS_AUD": ""
```

Add a comment above them: `// Cloudflare Access (Phase 4). Filled in by the owner; empty = every /v1/admin/* request is refused.`

Then run `pnpm --filter @pixie-logger/api cf-typegen` to regenerate `worker-configuration.d.ts`. Do **not** add `ACCESS_DEV_BYPASS` to `wrangler.jsonc`.

### Create `apps/api/.dev.vars.example`

```
# Copy to .dev.vars (never committed, never deployed) for local development.
# Lets /v1/admin/* work under `wrangler dev` without Cloudflare Access.
# Only honoured for requests to localhost / 127.0.0.1.
ACCESS_DEV_BYPASS=true
```

(`.gitignore` already ignores `.dev.vars*` and un-ignores `.dev.vars.example`.)

### Create `apps/api/src/lib/access.ts`

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { MiddlewareHandler } from 'hono';
import { errorResponse } from '@pixie-logger/shared';
import type { ErrorResponse } from '@pixie-logger/shared';

/** The settings this module reads. CloudflareBindings is assignable to it. */
export interface AccessEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_DEV_BYPASS?: string;
}

export interface AccessIdentity {
  email: string | null;   // null for non-email identities (e.g. service tokens)
}

export type JwksProvider = (teamDomain: string) => JWTVerifyGetKey;
```

#### `normalizeTeamDomain(value: string | undefined): string | null`

- Trim; remove trailing `/` characters.
- Return `null` if empty, or if it doesn't start with `https://`, or if `new URL(value)` throws, or if the URL has a path other than `/`, a query or a hash.
- Otherwise return the normalised value (e.g. `https://team.cloudflareaccess.com`).

#### `remoteJwks: JwksProvider`

Returns `createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`))`, **cached in a module-level `Map` keyed by `teamDomain`**, so the keys are fetched once per Worker instance, not per request.

#### `verifyAccessToken`

```ts
export async function verifyAccessToken(
  token: string | undefined,
  env: AccessEnv,
  getJwks: JwksProvider = remoteJwks,
): Promise<AccessIdentity | null>
```

1. `teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN)`; `aud = env.ACCESS_AUD?.trim()`. If either is missing/empty → `console.error('Access check: ACCESS_TEAM_DOMAIN or ACCESS_AUD is not set')` and return `null`.
2. `token = token?.trim()`. Empty or missing → return `null`.
3. `await jwtVerify(token, getJwks(teamDomain), { issuer: teamDomain, audience: aud, algorithms: ['RS256'], clockTolerance: 30 })` inside `try/catch`. Any error → return `null` (do not log the token or the error message, which can contain claims).
4. Return `{ email: typeof payload.email === 'string' ? payload.email : null }`.

#### `isDevBypass`

```ts
export function isDevBypass(requestUrl: string, env: AccessEnv): boolean
```

`true` only if `env.ACCESS_DEV_BYPASS?.trim() === 'true'` **and** `new URL(requestUrl).hostname` is exactly `localhost` or `127.0.0.1`. Any parse error → `false`.

#### `requireAccess` (Hono middleware)

```ts
export function requireAccess(options?: { getJwks?: JwksProvider }): MiddlewareHandler<{ Bindings: CloudflareBindings }>
```

1. If `isDevBypass(c.req.url, c.env)` → `await next()` and return.
2. `identity = await verifyAccessToken(c.req.header('cf-access-jwt-assertion'), c.env, options?.getJwks)`.
3. `null` → `return c.json<ErrorResponse>(errorResponse('unauthorized', 'Cloudflare Access sign-in required'), 401)` with header `Cache-Control: no-store`.
4. Otherwise `await next()`.

Do not read the `CF_Authorization` cookie; only the header.

### Modify `apps/api/src/index.ts`

- Import `requireAccess`.
- Add, **after** the `/v1/logs` route and before `onError`:

  ```ts
  // Every /v1/admin/* route requires Cloudflare Access (Phase 4). Routes are added in Task 2.
  app.use('/v1/admin/*', requireAccess());
  ```

- Change nothing else (the `/message` route is removed in Task 3, not here).

### Create `apps/api/test/access.test.ts`

Use `jose` to create test keys in `beforeAll`: `generateKeyPair('RS256', { extractable: true })`, export the public key with `exportJWK`, set `kid` and `alg: 'RS256'`, and build a local key set with `createLocalJWKSet({ keys: [jwk] })`. Pass `() => localJwks` as `getJwks`. Sign tokens with `new SignJWT({ email: 'me@example.com' }).setProtectedHeader({ alg: 'RS256', kid }).setIssuer(TEAM).setAudience(AUD).setIssuedAt().setExpirationTime('5m').sign(privateKey)`.

Constants: `TEAM = 'https://team.cloudflareaccess.com'`, `AUD = 'test-aud'`, `env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }`.

`normalizeTeamDomain`:
1. `'https://team.cloudflareaccess.com/'` → `'https://team.cloudflareaccess.com'`; `'  https://team.cloudflareaccess.com  '` → same.
2. `undefined`, `''`, `'team.cloudflareaccess.com'`, `'http://team.cloudflareaccess.com'`, `'https://team.cloudflareaccess.com/x'` → `null`.

`verifyAccessToken`:
3. Valid token → `{ email: 'me@example.com' }`.
4. Valid token without `email` claim → `{ email: null }`.
5. Wrong audience, wrong issuer, expired (`setExpirationTime` in the past beyond 30 s), signed by a different key pair → `null`.
6. Missing token, empty string, `'not-a-jwt'` → `null`.
7. Valid token but `ACCESS_AUD` empty, or `ACCESS_TEAM_DOMAIN` empty → `null` (spy on `console.error` and silence it; assert it was called).
8. Token with `alg: 'HS256'` (signed with a symmetric secret) → `null`.

`isDevBypass`:
9. `('http://localhost:8787/v1/admin/logs', { ACCESS_DEV_BYPASS: 'true' })` → `true`; same with `127.0.0.1` → `true`.
10. `'https://pixie-logger.x.workers.dev/v1/admin/logs'` with bypass `'true'` → `false`.
11. localhost with bypass `undefined`, `''`, `'1'`, `'TRUE '`… — only exactly `'true'` after trim counts: `'1'` → `false`, `undefined` → `false`.

`requireAccess` (build a tiny Hono app in the test: `app.use('/v1/admin/*', requireAccess({ getJwks: () => localJwks }))`, `app.get('/v1/admin/ping', (c) => c.json({ ok: true }))`, `app.get('/v1/health', …)`; call with `app.request(url, init, env)`):
12. No header → `401`, body `{ error: { code: 'unauthorized', … } }`, `Cache-Control: no-store`.
13. Valid token in `Cf-Access-Jwt-Assertion` → `200 { ok: true }`.
14. Invalid token → `401`.
15. `http://localhost/v1/admin/ping` with `{ ...env, ACCESS_DEV_BYPASS: 'true' }` and no token → `200`.
16. `https://example.workers.dev/v1/admin/ping` with bypass `'true'` and no token → `401`.
17. `/v1/health` without a token → `200` (middleware not applied outside `/v1/admin/*`).

### Modify `CLAUDE.md`

In the `apps/api` architecture list, add after the `cors.ts` bullet:

```
  - `src/lib/access.ts`: Cloudflare Access check for `/v1/admin/*` (verifies the `Cf-Access-Jwt-Assertion` JWT with `jose` against `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD`; fails closed). Local dev bypass only with `ACCESS_DEV_BYPASS=true` in `.dev.vars` **and** a localhost request. `ctx.access` is not used (not available to Workers with static assets).
```

and in the "Bindings" bullet, add the vars `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`.

## Verification

Run from the repo root. **Local only.** Report the output of each step.

1. `pnpm test` — all tests pass, including `apps/api/test/access.test.ts`.
2. `pnpm typecheck` — no errors.
3. `pnpm --filter @pixie-logger/api exec wrangler deploy --dry-run --outdir .wrangler/dry-run` — bundles; report the bundle size line.
4. Start `pnpm --filter @pixie-logger/api exec wrangler dev --port 8787` **without** a `.dev.vars` file (if one exists, rename it temporarily and restore it afterwards). Then:
   - `curl -i http://localhost:8787/v1/admin/anything` → `401`, code `unauthorized`.
   - `curl -i -H "Cf-Access-Jwt-Assertion: abc" http://localhost:8787/v1/admin/anything` → `401`.
   - `curl -i http://localhost:8787/v1/health` → `200`.
   - Repeat one valid ingest request from Phase 2 (`pnpm keys create-app smoke-test "Smoke Test"`, then a one-event batch to `POST /v1/logs`) → `202`.
5. Stop the server. Create `apps/api/.dev.vars` with `ACCESS_DEV_BYPASS=true`, start it again:
   - `curl -i http://localhost:8787/v1/admin/anything` → `404` (bypass passes the check; no route exists yet).
   - Stop the server and **delete** `apps/api/.dev.vars` (and restore any file you renamed in step 4).
6. Clean up: `pnpm --filter @pixie-logger/api exec wrangler d1 execute pixie-logs --local --command "DELETE FROM apps WHERE id = 'smoke-test'"`.
7. `git status` — changes only in: `apps/api/package.json`, `pnpm-lock.yaml`, `apps/api/wrangler.jsonc`, `apps/api/worker-configuration.d.ts`, `apps/api/.dev.vars.example`, `apps/api/src/lib/access.ts`, `apps/api/src/index.ts`, `apps/api/test/access.test.ts`, `CLAUDE.md`.

## Done when

- `access.ts` exports `normalizeTeamDomain`, `remoteJwks`, `verifyAccessToken`, `isDevBypass`, `requireAccess` and the types above.
- `/v1/admin/*` is guarded in `index.ts`; nothing else changed behaviour.
- All verification steps pass; nothing was deployed and no real Access values were added.
