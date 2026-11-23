# Technical Spec — Phase 4, Task 3: Viewer Page

> **Prerequisites:** [01-access-check.tech.md](01-access-check.tech.md) and [02-read-api.tech.md](02-read-api.tech.md) done (`GET /v1/admin/logs`, `GET /v1/admin/apps`, `ACCESS_DEV_BYPASS` for local dev).

Design reference: [03-viewer.md](03-viewer.md). API: [../phase-1/02-api-endpoints.md](../phase-1/02-api-endpoints.md) ("Reading logs").

## Rules for the agent

1. Only create, modify or delete the files listed in "Files" below.
2. **Plain HTML, CSS and JavaScript only.** No framework, no npm dependency, no build step, no TypeScript for these files, nothing loaded from another origin (no CDN fonts, scripts or styles).
3. **Never insert data as HTML.** Build the DOM with `document.createElement`, `textContent`, `append`, `setAttribute` / `dataset` (attribute values only from your own code or `encodeURIComponent`'d values, never `href`/`src` built from log data). `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function` and inline event-handler attributes must not appear in any file.
4. Do not change the API. If something conflicts or fails, **stop and report it**.
5. **Never use `--remote`, never deploy.** Local only.
6. pnpm only. Do not commit. Finish by running "Verification" and reporting the output of each step.

## Files

### Delete `apps/api/public/index.html`

### Modify `apps/api/src/index.ts`

Remove the `GET /message` route. Change nothing else.

### Create `apps/api/public/_headers`

```
/admin/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Cache-Control: no-store
```

Workers static assets apply this file to matching asset responses and don't serve the file itself. If verification shows the headers are **not** applied (or `/_headers` is downloadable), stop and report it instead of working around it.

### Create `apps/api/public/admin/index.html`

- `<!doctype html>`, `lang="en"`, `<meta charset="utf-8">`, viewport meta, `<meta name="color-scheme" content="light dark">`, `<title>pixie-logger</title>`.
- `<link rel="stylesheet" href="viewer.css">` and `<script type="module" src="viewer.js"></script>` (relative paths; the page is served at `/admin/`).
- No inline `<script>` or `style` attributes/elements.
- Structure (ids are used by `viewer.js`):
  - `<header>` with the title.
  - `<form id="filters">` containing: `<select id="f-app">` (first option `value=""` "All apps"), a fieldset `#f-levels` with five checkboxes `name="level"` values `debug info warn error fatal`, `<input id="f-event">`, `<input id="f-session">`, `<input type="datetime-local" id="f-from" step="1">`, `<input type="datetime-local" id="f-to" step="1">`, `<select id="f-limit">` with 50/100/200/500 (100 selected), `<button type="submit">Search</button>`, `<button type="button" id="f-reset">Reset</button>`. Every input has a `<label>`.
  - `<p id="status" role="status" aria-live="polite">`.
  - `<table id="results">` with `<thead>` (Received, App, Level, Event, Message, Platform) and an empty `<tbody>`.
  - `<button type="button" id="load-more" hidden>Load more</button>`.

### Create `apps/api/public/admin/viewer.css`

Simple, readable styles: system font stack; compact form laid out in wrapping rows; table with sticky header, zebra rows, row hover, `cursor: pointer` on log rows; message cell truncated with ellipsis (max ~50ch); level badges (`.lvl-debug` grey, `.lvl-info` blue, `.lvl-warn` amber, `.lvl-error` red, `.lvl-fatal` white-on-dark-red); details row with `<pre>` blocks (`white-space: pre-wrap; word-break: break-word`); table container `overflow-x: auto` for narrow screens; `prefers-color-scheme: dark` variant. No external resources.

### Create `apps/api/public/admin/viewer.js`

An ES module, no globals beyond the module scope. Required behaviour:

**State and URL**

- `readFiltersFromUrl()`: on load, read `app`, `level` (repeatable), `event`, `session`, `from`, `to`, `limit` from `location.search` and fill the form. `from`/`to` in the URL are ISO strings; show them in the `datetime-local` inputs converted to **local** time (`YYYY-MM-DDTHH:mm:ss`).
- `filtersFromForm()`: returns a `URLSearchParams` with only non-empty values: `app`, one `level` per ticked box, trimmed `event` and `session`, `from`/`to` converted from the local `datetime-local` value with `new Date(value).toISOString()`, and `limit`. If a date input value is invalid, show an error in `#status` and don't search.
- On search, `history.replaceState(null, '', '?' + params)` (or the bare path when empty), so reloads keep the filters. `cursor` is never written to the URL.

**Requests**

- `apiGet(pathAndQuery)`: `fetch(pathAndQuery, { credentials: 'same-origin', redirect: 'manual', headers: { Accept: 'application/json' } })`.
  - `response.type === 'opaqueredirect'`, status `401`, or status `403` → throw an error with message `Your Cloudflare Access sign-in has expired or is missing. Reload the page to sign in again.`
  - Non-OK with a JSON body of shape `{ error: { code, message } }` → throw with `` `${code}: ${message}` ``.
  - Other non-OK, or a body that isn't JSON → throw with `` `Request failed (HTTP ${status})` ``.
  - A `fetch` rejection (network) → throw with `Network error. Check your connection and try again.`
- On load: `GET /v1/admin/apps` → fill `#f-app` with one `<option>` per app (`value = id`, text = `displayName (id)`, plus ` (disabled)` when disabled). Keep the selected value from the URL if it's in the list; if the URL names an app not in the list, add it as an option anyway so the filter isn't silently lost. If this request fails, show the error in `#status` but still allow searching.
- Then search once with the current filters.

**Search and paging**

- Submit → clear `<tbody>`, set `#status` to `Loading…`, `GET /v1/admin/logs?<params>`.
- Render each item as one row (columns as in the header). `Received` = `receivedAt` in local time with seconds (`toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })`); `Level` = badge `<span class="lvl lvl-<level>">` (class chosen from a fixed map of the five levels, falling back to `lvl`), text uppercase; `Message` = message or `—`.
- After rendering: `#status` = `` `${shown} logs` `` (plus ` — more available` when `nextCursor` isn't null), or `No logs match these filters` when the first page is empty.
- `#load-more` visible only when `nextCursor` isn't null. Clicking it requests the same params plus `cursor=<nextCursor>`, appends rows, updates the status. Disable both buttons while a request is running; ignore responses from a search that was superseded (keep a request counter).
- Errors: rows already shown stay; `#status` shows the error message (as text).

**Details row**

- Clicking a log row (or pressing Enter/Space on it; rows get `tabindex="0"`) toggles a details row directly below it, spanning all columns. Only one details row per log row.
- Details content: a definition list with Message (full), Route, Event, Level, App, App version, Platform, Session id, Client time (local + ISO), Received (local + ISO), Log id; then `Params` and `Context` each as `<pre>` containing `JSON.stringify(value, null, 2)` or `—` when null.
- A **Show this session** button: resets the form, sets `#f-session` to the row's `sessionId`, and runs a new search.

**Reset**

- `#f-reset` clears every filter (limit back to 100) and runs a search.

### Modify `CLAUDE.md`

In the `apps/api` architecture section, replace the `ASSETS` part of the "Bindings" bullet's description with: static assets `ASSETS` from `public/`: the Phase 4 viewer (`public/admin/`, plain HTML/CSS/JS, no build) and `public/_headers` (CSP for `/admin/*`). Add the rule: *viewer code must never insert log data as HTML.*

## Verification

Run from the repo root. **Local only.** Report the output of each step.

### A. Static checks

1. `pnpm test` and `pnpm typecheck` — still pass.
2. `grep -nE "innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function" apps/api/public/admin/*` and `grep -nE "<[^>]*\son[a-z]+=" apps/api/public/admin/index.html` — no matches.
3. `grep -nE "https?://" apps/api/public/admin/*` — no matches (nothing loaded from other origins).
4. `node --check apps/api/public/admin/viewer.js` — no syntax errors.

### B. Served files and headers

5. Create `apps/api/.dev.vars` with `ACCESS_DEV_BYPASS=true`, start `pnpm --filter @pixie-logger/api exec wrangler dev --port 8787`.
6. `curl -sI http://localhost:8787/admin/` → `200`, `content-type: text/html`, and the `Content-Security-Policy`, `X-Content-Type-Options`, `Referrer-Policy` and `Cache-Control: no-store` headers from `_headers`.
7. `curl -sI http://localhost:8787/admin/viewer.js` → `200`, JavaScript content type, same security headers.
8. `curl -si http://localhost:8787/_headers` → **not** `200` with the file contents.
9. `curl -si http://localhost:8787/` → `404`; `curl -si http://localhost:8787/message` → `404`; `curl -s http://localhost:8787/v1/health` → `200`.

### C. Seed data for the manual checks

10. Create app `smoke-a` with `pnpm keys create-app smoke-a "Smoke A"` and send through `POST /v1/logs`:
    - 120 `info` events `page_view` in session `s1` (in batches of 50), so paging can be tried with page size 100;
    - one `error` event `api_failed` in session `s2` with `"message": "<img src=x onerror=alert(1)>"` and `"context": {"html": "<b>bold?</b>", "n": 1}`.
11. Leave the dev server running and report that it's ready for the manual checks below. Do **not** delete the seed data; the user cleans up.

## Manual checks (you, in a browser at `http://localhost:8787/admin/`)

1. The page loads with no errors in the browser console (including no CSP violations).
2. App dropdown lists `smoke-a`; search shows 100 rows, newest first; **Load more** adds 21 and then disappears.
3. Level filter `error` → only the `api_failed` row. Its message shows literally as `<img src=x onerror=alert(1)>`; no alert, no broken image.
4. Open its details: context shows formatted JSON with `"<b>bold?</b>"` as text.
5. **Show this session** → only the session `s2` row; the address bar shows `?session=s2`. Reload → same result.
6. From/to: set "to" before the seeded events → "No logs match these filters".
7. Stop the server, delete `apps/api/.dev.vars`, start it again, reload → the page shows the sign-in message instead of data.
8. Clean up: stop the server; `pnpm --filter @pixie-logger/api exec wrangler d1 execute pixie-logs --local --command "DELETE FROM apps WHERE id = 'smoke-a'"`.

## Done when

- `public/index.html` and `GET /message` are gone; `public/_headers` and `public/admin/{index.html,viewer.css,viewer.js}` exist as specified.
- Verification steps A–C pass and the manual checks pass.
- `git status` shows changes only in the files listed above (plus `CLAUDE.md`).
