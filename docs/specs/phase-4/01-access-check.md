# Phase 4 — Task 1: Access Check in the Worker

Part of [Phase 4](README.md). Before any read route exists, the Worker learns to refuse `/v1/admin/*` requests that didn't come through your Cloudflare Access sign-in.

## Why the Worker checks too

Cloudflare Access (set up in [Task 4](04-access-setup.md)) sits in front of the Worker on the `/admin` and `/v1/admin` paths and asks you to sign in. When you're signed in, Access adds a signed token to every request it lets through, in the `Cf-Access-Jwt-Assertion` header.

The path rule only covers the paths and hostname you list. A request could still reach the Worker another way, for example through a preview URL. So the Worker checks the token itself on every `/v1/admin/*` request:

- the token is present,
- it was signed by your Access team (checked against Access's public keys),
- it was issued for this Access application (its audience/AUD tag),
- it hasn't expired.

If any check fails → `401 unauthorized`. Cloudflare recommends this check whenever Access is in front of a Worker.

## Settings

Two plain (non-secret) values in `apps/api/wrangler.jsonc`, filled in during [Task 4](04-access-setup.md):

| Setting | Example | Where to find it |
|---|---|---|
| `ACCESS_TEAM_DOMAIN` | `https://pixiecut.cloudflareaccess.com` | Zero Trust → Settings → your team domain |
| `ACCESS_AUD` | a 64-character tag | Zero Trust → Access → Applications → your app → Overview → Application Audience (AUD) Tag |

Until both are set, **every** `/v1/admin/*` request is refused (fails closed). That's safe: nothing breaks, the viewer just can't load data.

## Local development

There's no Access on your laptop. To use the viewer with `wrangler dev`, create `apps/api/.dev.vars` (already ignored by git, never deployed) with:

```
ACCESS_DEV_BYPASS=true
```

The bypass works only if **both** are true: that setting is `true`, **and** the request is to `localhost` or `127.0.0.1`. On the live Worker neither can happen, so the bypass can't open production by mistake. A `.dev.vars.example` file documents it.

## What changes

- New `apps/api/src/lib/access.ts`: the token check and a small middleware.
- `apps/api/src/index.ts`: the middleware is applied to `/v1/admin/*` (no routes there yet; Task 2 adds them).
- New dependency `jose` in `apps/api` (the library Cloudflare's own example uses; works in Workers).
- `wrangler.jsonc`: the two settings, empty for now.
- Unit tests with locally generated test keys (no network, no real Access).
- `CLAUDE.md`: short note on the Access check.

## Out of scope

- Using the signed-in email for anything (e.g. audit logs): Phase 7.
- Service tokens or an admin key for scripts: Phase 7 if needed.

## Tasks

- [ ] Review the design above.
- [ ] Agent implements [01-access-check.tech.md](01-access-check.tech.md) (local only).
- [ ] Commit: "Phase 4: Access check for admin routes".

## Done when

- The verification in the tech spec passes locally.
- Every `/v1/admin/*` request without a valid token gets `401`, and `POST /v1/logs` behaves exactly as before.
