# Task 2: API Endpoints

Part of [Phase 1](README.md). Defines the two endpoints, how requests are validated, and what they return. Uses the event and batch shapes from [Task 1](01-event-contract.md).

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

## `GET /v1/logs` — read logs (admin only)

Headers: `X-Admin-Key: <admin key>` (later also behind Cloudflare Access)

| Query param | Type              | Notes                                 |
|-------------|-------------------|---------------------------------------|
| `app`       | string            | app name                              |
| `level`     | level, repeatable | e.g. `?level=error&level=fatal`       |
| `event`     | string            | exact match                           |
| `from`      | ISO datetime      | inclusive, by server receive time     |
| `to`        | ISO datetime      | exclusive                             |
| `limit`     | number            | default 100, max 500                  |
| `cursor`    | string            | from the previous page's `nextCursor` |

Results are newest first. Invalid query params → `400` with code `invalid_query`; missing or wrong admin key → `401`.

### Response

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

`nextCursor` is `null` when there are no more results. `receivedAt` is set by the server.

## Tasks

- [ ] Review the validation flow, status codes and error codes and confirm or adjust them.
- [ ] Confirm the read filters cover how you'll want to search logs in the viewer.

## Done when

- Both endpoints' requests, responses, status codes and error codes are final.
- Phase 2 can implement the Worker routes from this file without open questions.
