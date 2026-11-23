# Phase 4 — Task 4: Cloudflare Access Setup, Deploy and Check

Part of [Phase 4](README.md). **You do this task**; there's no agent spec. It puts Cloudflare Access in front of the viewer and read routes, connects the Worker's own check to it, deploys, and checks everything end to end.

> **Prerequisites:** Tasks 1–3 merged. Don't deploy them before step 4 below. (The Worker fails closed without the settings, so an early deploy wouldn't leak logs, but the viewer wouldn't work.)

Dashboard labels change from time to time; if a name below doesn't match exactly, look for the closest one.

## 1. Zero Trust team (first time only)

1. Cloudflare dashboard → **Zero Trust**.
2. If asked, choose a **team name** (it becomes `https://<team>.cloudflareaccess.com`) and the **Free** plan.
3. Sign-in method: the default **One-time PIN** (a code sent to your email) is enough. No other identity provider is needed.

## 2. Create the Access application (paths only)

> ⚠️ **Don't** use "Enable Cloudflare Access" on the Worker's *Domains & Routes* page, or the Worker's *Access* tab. Those protect the whole Worker, including `POST /v1/logs`, and your apps would stop sending logs.

1. Zero Trust → **Access → Applications → Add an application → Self-hosted**.
2. Name: `pixie-logger admin`. Session duration: e.g. 24 hours.
3. Add **two** public destinations (hostnames/paths):
   - `pixie-logger.pixie-cut-games.workers.dev` path `admin`
   - `pixie-logger.pixie-cut-games.workers.dev` path `v1/admin`

   A path covers everything under it (`/admin/…`, `/v1/admin/logs`, …). Don't add `v1/logs` or the bare hostname.
4. Policy: **Allow**, include **Emails** → your email address only.
5. Save. On the application's **Overview**, copy the **Application Audience (AUD) Tag**.
6. Note your team domain: `https://<team>.cloudflareaccess.com` (Zero Trust → Settings).

## 3. Preview URLs

Worker → **Settings → Domains & Routes** → **Preview URLs**. If you don't use them, turn them off. (If they stay on, the Worker's own check still refuses reads through them; only the empty viewer page would load.)

## 4. Fill in the Worker settings

In `apps/api/wrangler.jsonc`:

```jsonc
"ACCESS_TEAM_DOMAIN": "https://<team>.cloudflareaccess.com",
"ACCESS_AUD": "<AUD tag>"
```

Neither value is a secret (the AUD tag is sent to your browser in every Access token), so they can be committed.

## 5. Deploy

Run the [deploy checklist](#deploy-checklist) below, then:

```
pnpm --filter @pixie-logger/api run deploy
```

No migration is needed in this phase.

## 6. End-to-end check

| # | Check | Expected |
|---|---|---|
| 1 | Private/incognito window → `https://pixie-logger.pixie-cut-games.workers.dev/admin/` | Access sign-in page; after the email code, the viewer loads |
| 2 | Viewer, app `taqa-local` | The Phase 3 test logs appear; filters, Load more and Show this session work |
| 3 | `curl -si https://pixie-logger.pixie-cut-games.workers.dev/v1/admin/logs` | Redirect (`302`) to `…cloudflareaccess.com` or a `403` from Access; no log data |
| 4 | `curl -si …/admin/` | Same redirect |
| 5 | Same request as #3 to a preview URL (only if preview URLs are still on) | `401 unauthorized` from the Worker |
| 6 | A valid `POST /v1/logs` with an app key (curl from [Phase 2, Task 2](../phase-2/02-ingest.md#testing-it-yourself) or log from Taqa) | `202`; the event shows up in the viewer |
| 7 | `curl -si …/` and `…/message` | `404` |
| 8 | Browser dev tools on the viewer: response headers for `/admin/` | `Content-Security-Policy` present; no console errors |

If #6 fails with a redirect, an Access destination is too broad (step 2.3): fix it in Zero Trust, no deploy needed.

## Deploy checklist

- [ ] Tasks 1–3 merged; `pnpm test` and `pnpm typecheck` pass on `main`.
- [ ] Access application exists with exactly the two paths, and a policy allowing only your email.
- [ ] `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` set in `wrangler.jsonc` (and `pnpm --filter @pixie-logger/api cf-typegen` run if the agent's version didn't have them).
- [ ] No `.dev.vars` content was copied into `wrangler.jsonc` (`ACCESS_DEV_BYPASS` must not be there).
- [ ] Dry run bundles: `pnpm --filter @pixie-logger/api exec wrangler deploy --dry-run --outdir .wrangler/dry-run`.
- [ ] Rollback plan: `wrangler rollback` (or Workers → Deployments → previous version) restores the Phase 3 Worker; ingest is unaffected either way.

## Tasks

- [ ] Steps 1–4.
- [ ] Deploy checklist, then deploy (step 5).
- [ ] End-to-end checks 1–8 (step 6).
- [ ] Commit the `wrangler.jsonc` values: "Phase 4: Access settings".
- [ ] Set Phase 4 to Done in `ROADMAP.md`.

## Done when

- Every check in step 6 passes.
