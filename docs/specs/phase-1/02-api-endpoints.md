# Task 2: API Endpoints

Part of [Phase 1](README.md). Defines the endpoints, how requests are validated, and what they return. Uses the event and batch shapes from [Task 1](01-event-contract.md).

## `POST /v1/logs` — send a batch

Headers: `X-Api-Key: <app write key>`, `Content-Type: application/json`

### Validation flow (partial accept)

1. Check the key. Invalid or missing → `401`.
2. Check body size. Over 512 KB → `413`.
3. Validate the envelope (`appVersion`, `platform`, `sessionId`, `events` array 1–50). Invalid → `400`, nothing stored.
4. Validate each event on its own. Valid events are kept; invalid ones are dropped and reported.
5. If **no** event is valid → `400`, nothing stored.
6. Otherwise → `202 Accepted`.

| Status | When                                              |
|--------|---------------------------------------------------|
| `202`  | At least one event accepted                       |
| `400`  | Bad JSON, invalid envelope, or all events invalid |
| `401`  | Missing or invalid API key                        |
| `413`  | Body over 512 KB                                  |
| `429`  | Rate limited (Phase 5)                            |
| `500`  | Unexpected server error (e.g. database unavailable) |

### `202` response

```json
{
  "accepted": 1,
  "rejected": [
    { "index": 1, "errors": ["event: required"] }
  ]
}
```

`index` is the event's position in the sent `events` array. The client logger should **not** retry rejected events — they will fail again.

### Error response (`400` / `401` / `413` / `429` / `500`)

```json
{ "error": { "code": "invalid_envelope", "message": "events: must contain 1-50 items" } }
```

Error codes: `invalid_json`, `invalid_envelope`, `no_valid_events`, `invalid_query`, `unauthorized`, `payload_too_large`, `rate_limited`, `internal_error`.

> `internal_error` (500) was added in Phase 2, Task 2. A client should treat it as temporary and retry the batch later.

## Reading logs (admin only, behind Cloudflare Access)

> **Changed in Phase 4** (see [Phase 4](../phase-4/README.md)): the read route moved from `GET /v1/logs` to `GET /v1/admin/logs`, the planned `X-Admin-Key` header was dropped in favour of Cloudflare Access, a `session` filter was added, and `GET /v1/admin/apps` was added for the viewer. An admin key for scripts may be added in Phase 7.

All `/v1/admin/*` routes are protected twice:

1. **Cloudflare Access** in front of the Worker on the `/admin` and `/v1/admin` paths: you sign in through Access in the browser; requests without a valid Access session never reach the Worker.
2. **The Worker checks the Access token** (`Cf-Access-Jwt-Assertion` header) on every `/v1/admin/*` request, in case a request reaches it some other way (e.g. a preview URL). Missing or invalid token → `401 unauthorized`.

Read routes are same-origin only (used by the viewer page on the same Worker), so they have no CORS headers. `POST /v1/logs` stays outside Access and keeps using `X-Api-Key`.

### `GET /v1/admin/logs` — search logs

| Query param | Type              | Notes                                 |
|-------------|-------------------|---------------------------------------|
| `app`       | string            | app id, exact match                   |
| `level`     | level, repeatable | e.g. `?level=error&level=fatal`       |
| `event`     | string            | exact match                           |
| `session`   | string            | session id, exact match (1–64 chars)  |
| `from`      | ISO datetime      | inclusive, by server receive time     |
| `to`        | ISO datetime      | exclusive                             |
| `limit`     | number            | default 100, max 500                  |
| `cursor`    | string            | from the previous page's `nextCursor` |

Results are newest first. Invalid query params (including a cursor that wasn't returned by the server) → `400` with code `invalid_query`; failed Access check → `401`.

#### Response

```json
{
  "items": [
    {
      "id": "…",
      "app": "maslary",
      "level": "error",
      "event": "api_failed",
      "message": "Timeout loading orders",
      "route": null,
      "params": null,
      "context": { "status": 504, "url": "/api/orders" },
      "appVersion": "1.4.2",
      "platform": "android",
      "sessionId": "b3f1c2e0-…",
      "clientTs": "2026-11-15T12:30:05.000Z",
      "receivedAt": "2026-11-15T12:30:07.120Z"
    }
  ],
  "nextCursor": "…"
}
```

`nextCursor` is `null` when there are no more results. `receivedAt` is set by the server. Treat `id` and `nextCursor` as opaque strings.

### `GET /v1/admin/apps` — list apps

No query params. Returns every app, including disabled ones (they can still have logs), sorted by id.

```json
{
  "items": [
    { "id": "maslary", "displayName": "Maslary", "disabled": false },
    { "id": "taqa-local", "displayName": "Taqa (local test)", "disabled": false }
  ]
}
```

Failed Access check → `401`.

## Tasks

- [ ] Review the validation flow, status codes and error codes and confirm or adjust them.
- [ ] Confirm the read filters cover how you'll want to search logs in the viewer.

## Done when

- Both endpoints' requests, responses, status codes and error codes are final.
- Phase 2 can implement the Worker routes from this file without open questions.
