# Phase 2 — Task 2: Ingest Endpoint (`POST /v1/logs`)

Part of [Phase 2](README.md). The endpoint your apps send logs to: it checks the key, validates the batch and stores the valid events.

> **Prerequisites:** [Task 1](01-d1-schema.md) (tables) and [Task 3](03-app-keys.md) (key module and `pnpm keys`) are done.
> Contract: [Phase 1 — API endpoints](../phase-1/02-api-endpoints.md). This task implements that contract; it doesn't change it (except adding `internal_error`, below).

## Request flow

```
POST /v1/logs
  │
  1. Key check ─────────── no key / malformed / unknown / revoked / app disabled → 401 unauthorized
  │
  2. Size check ────────── body over 512 KB → 413 payload_too_large
  │
  3. Parse JSON ────────── not JSON → 400 invalid_json
  │
  4. Envelope ──────────── bad appVersion / platform / sessionId / events count → 400 invalid_envelope
  │
  5. Each event ────────── validated on its own; invalid ones are dropped and reported
  │                         none valid → 400 no_valid_events
  │
  6. Insert ────────────── all valid events in one database batch (all or nothing)
  │                         database error → 500 internal_error
  │
  └─ 202 { accepted, rejected }
```

### 1. Key check

- The key comes from the `X-Api-Key` header.
- A key that doesn't look like a key (`pxl_` + 64 hex) is rejected straight away, without touching the database.
- Otherwise it's hashed and looked up. It's accepted only if the key exists, isn't revoked, and its app isn't disabled.
- Every failure returns the same `401` with the same message, so nobody can probe whether a key exists, was revoked, or belongs to a disabled app.
- The app is taken from the key. The request body can't choose it.

### 2. Size check

- If the `Content-Length` header says the body is over 512 KB, reject before reading it.
- The body is also measured after reading, because the header can be missing or wrong.

### 3–5. Validation

Uses the shared package from Phase 1 (`logBatchEnvelopeSchema`, `validateEvents`), so the Worker and the client logger apply exactly the same rules.

### 6. Insert

- Each valid event becomes one row in `logs`, with `app_id` from the key, the envelope fields copied onto every row, and one shared server timestamp (`received_at`).
- All rows go in a single database batch, which runs as one transaction: either every valid event is stored or none is.
- Events are inserted one statement per event (D1 limits how many values one statement can take, so a single big `INSERT` with 50 rows wouldn't fit).

## Responses

Exactly as in the [Phase 1 contract](../phase-1/02-api-endpoints.md):

| Status | Body |
|---|---|
| `202` | `{ "accepted": 2, "rejected": [{ "index": 1, "errors": ["…"] }] }` |
| `400` / `401` / `413` | `{ "error": { "code": "…", "message": "…" } }` |
| `500` | `{ "error": { "code": "internal_error", "message": "Internal error" } }` |

### New error code: `internal_error`

The Phase 1 contract had no code for a server-side failure, e.g. the database being unavailable. This task adds `internal_error` (500). The client logger (Phase 3) will treat it as temporary and keep the batch to retry later, unlike `400` errors, which won't succeed on retry. The Phase 1 doc has been updated.

The real error is written to the Worker log (visible with `wrangler tail`) but never sent back in the response.

## Testing it yourself

After deploying, with a key from `pnpm keys create-app … --remote`:

```
curl -i -X POST https://pixie-logger.<your-subdomain>.workers.dev/v1/logs \
  -H "X-Api-Key: pxl_…" \
  -H "Content-Type: application/json" \
  -d '{"appVersion":"1.0.0","platform":"web","sessionId":"test-1","events":[{"level":"info","event":"hello","clientTs":"2026-11-15T12:00:00Z"}]}'
```

Expect `202` and `{"accepted":1,"rejected":[]}`. Then check the row:

```
pnpm --filter @pixie-logger/api exec wrangler d1 execute pixie-logs --remote \
  --command "SELECT id, app_id, level, event, received_at FROM logs ORDER BY id DESC LIMIT 5"
```

## Out of scope

- **CORS** (Phase 5). Until then, calls from browsers and Ionic/Capacitor WebViews are blocked by the browser; curl, scripts and React Native work.
- Rate limiting (Phase 5).
- Reading logs, `GET /v1/logs` (Phase 4).
- Caching key lookups. One small indexed lookup per batch is cheap at this scale.

## Tasks

- [ ] Review the flow above.
- [ ] Agent implements [02-ingest.tech.md](02-ingest.tech.md) (local database and local dev server only).
- [ ] You deploy: `pnpm --filter @pixie-logger/api run deploy`.
- [ ] You test against the live Worker with the curl command above, including once with a wrong key (expect `401`).
- [ ] Commit: "Phase 2: ingest endpoint".

## Done when

- The verification in the tech spec passes locally.
- The live Worker accepts a batch with your real key and rejects a wrong key with `401`.
