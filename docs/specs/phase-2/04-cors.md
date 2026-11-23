# Phase 2 — Task 4: CORS (simple allowlist)

Part of [Phase 2](README.md). Lets browsers and Ionic/Capacitor WebViews send logs to `POST /v1/logs`, so the client package (Phase 3) can be tested from real apps.

> **Prerequisite:** [Task 2](02-ingest.md) (ingest endpoint) is done.

## Why it's needed

Browsers block a page from calling an API on another origin unless the API says that origin is allowed. Capacitor apps run in a WebView with their own origin (`capacitor://localhost` on iOS, `https://localhost` on Android), so they're blocked too. curl, scripts and React Native don't enforce CORS, which is why they already work.

Because requests carry a custom header (`X-Api-Key`), the browser first sends a **preflight** (`OPTIONS`) asking permission. If the Worker doesn't approve the origin, the browser never sends the real request.

## Design

- **One allowlist for all apps,** stored in the Worker config as the variable `ALLOWED_ORIGINS` (comma-separated). Adding a domain is a config change and a deploy, not a code change.
- **Applies to `/v1/logs` only.** Other routes are untouched.
- **Exact match.** No wildcards; an origin is allowed only if it appears in the list exactly (e.g. `https://maslary.app`, no trailing slash).
- **Preflight answer** for an allowed origin:
  - methods: `POST`
  - headers: `Content-Type`, `X-Api-Key`
  - cached by the browser for 24 hours, so it isn't repeated before every batch
- **Disallowed origins** get no CORS headers, so the browser blocks the request. The server doesn't need its own rejection.
- **Requests without an `Origin` header** (curl, React Native, native code) are unaffected.

### Default origins

| Origin | For |
|---|---|
| `capacitor://localhost` | Capacitor on iOS |
| `https://localhost` | Capacitor on Android |
| `http://localhost` | Older Capacitor Android setups |
| `http://localhost:8100` | `ionic serve` |
| `http://localhost:4200` | Angular dev server |
| `http://localhost:5173` | Vite dev server (React) |

Add each web app's real domain when it goes live.

> `https://localhost` and `capacitor://localhost` are shared by every Capacitor app, so any Capacitor app with a leaked key could use it. That's accepted for now: the key is write-only and size-limited. Per-app origins come with the admin phase (see the [roadmap](../ROADMAP.md)).

## What CORS does and doesn't protect

It stops **websites** from using a key. It doesn't stop scripts or apps, which can send any `Origin` they like. The write-only key, size limits and (later) rate limiting remain the real protection.

## Out of scope

- Per-app origins and editing them from an admin page (Phase 7).
- Rate limiting (Phase 5).

## Tasks

- [ ] Review the default origins; add any real web domains you already have.
- [ ] Agent implements [04-cors.tech.md](04-cors.tech.md).
- [ ] You deploy and run the preflight curl from the Phase 2 testing notes.
- [ ] Commit: "Phase 2: CORS allowlist".

## Done when

- A preflight from an allowed origin gets the CORS headers; from any other origin it doesn't.
- curl without an `Origin` still works exactly as before.
