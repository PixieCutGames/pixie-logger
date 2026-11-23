# Task 1: Event Contract

Part of [Phase 1](README.md). Defines what a log event is and how apps send events.

## 1. Log levels

`debug` · `info` · `warn` · `error` · `fatal`

Ordered from least to most severe. The order matters for client-side level filtering (e.g. "only send `warn` and above in production"). The server accepts every level; filtering is the client's job.

## 2. Event shape

One log event.

| Field      | Type                                              | Required | Limits / notes                                  |
|------------|---------------------------------------------------|----------|-------------------------------------------------|
| `level`    | `debug` \| `info` \| `warn` \| `error` \| `fatal` | yes      |                                                 |
| `event`    | string                                            | yes      | 1–100 chars, pattern `^[a-z0-9][a-z0-9_.:-]*$`, e.g. `order_viewed`, `api_failed` |
| `message`  | string                                            | no       | max 1000 chars                                  |
| `route`    | string                                            | no       | max 200 chars; the route pattern, e.g. `/orders/:id` |
| `params`   | object (string keys, JSON values)                 | no       | route / query params                            |
| `context`  | object (string keys, JSON values)                 | no       | any variables the app wants to log              |
| `clientTs` | string (ISO 8601 datetime)                        | yes      | when the event happened on the device           |

**Size limit:** the whole event, serialized as JSON, must be **8 KB or less**.

## 3. Batch envelope

Apps send events in batches. Fields that are the same for every event in a batch live on the batch, not on each event.

| Field        | Type                             | Required | Limits / notes                    |
|--------------|----------------------------------|----------|-----------------------------------|
| `appVersion` | string                           | yes      | 1–50 chars, e.g. `1.4.2`          |
| `platform`   | `web` \| `android` \| `ios`      | yes      |                                   |
| `sessionId`  | string                           | yes      | 1–64 chars; random per app launch (a UUID v4 is recommended, not enforced), never a device or user ID |
| `events`     | array of events                  | yes      | 1–50 events                       |

**Request body limit:** 512 KB (50 events × 8 KB, plus envelope overhead).

### Example

```json
{
  "appVersion": "1.4.2",
  "platform": "android",
  "sessionId": "b3f1c2e0-6a7d-4c1e-9f2a-1d2e3f4a5b6c",
  "events": [
    {
      "level": "info",
      "event": "order_viewed",
      "route": "/orders/:id",
      "params": { "id": "123" },
      "clientTs": "2026-11-15T12:30:00.000Z"
    },
    {
      "level": "error",
      "event": "api_failed",
      "message": "Timeout loading orders",
      "context": { "status": 504, "url": "/api/orders" },
      "clientTs": "2026-11-15T12:30:05.000Z"
    }
  ]
}
```

## 4. Validation rules

These apply to both the event and the envelope.

- **Character limits** ("chars") count JavaScript string length (UTF-16 code units).
- **Byte limits** (8 KB, 512 KB) count UTF-8 bytes. 1 KB = 1024 bytes, so 8 KB = 8,192 bytes and 512 KB = 524,288 bytes.
- **Event size** is measured on `JSON.stringify(event)` of the event as received. Whitespace in the request body does not count against it.
- **Unknown fields** are ignored (stripped) and never stored. A newer app release can add a field without an older server rejecting its logs.
- **Optional fields** may be omitted, but not sent as `null` (a `null` value makes the event invalid). Omitted fields are stored as `null`. Optional strings may be empty.
- **`event`** is lowercase. It allows letters, digits and `_ . : -`, and must start with a letter or digit. This keeps names consistent for exact-match filtering in `GET /v1/admin/logs`.
- **`params` / `context`** must be JSON objects (not arrays or primitives). Their values can be any JSON. Nesting is only limited by the 8 KB event size.
- **`clientTs`** is an ISO 8601 datetime with a time zone: either `Z` or an offset such as `+02:00`. It is never rejected for being in the past or future, because device clocks drift. The server records its own `receivedAt` separately.

## 5. Limits summary

These become the `LIMITS` constant in Task 3.

| Constant                  | Value     |
|---------------------------|-----------|
| `EVENT_NAME_MAX_LENGTH`   | 100       |
| `MESSAGE_MAX_LENGTH`      | 1000      |
| `ROUTE_MAX_LENGTH`        | 200       |
| `APP_VERSION_MAX_LENGTH`  | 50        |
| `SESSION_ID_MAX_LENGTH`   | 64        |
| `MAX_EVENT_BYTES`         | 8,192     |
| `MIN_EVENTS_PER_BATCH`    | 1         |
| `MAX_EVENTS_PER_BATCH`    | 50        |
| `MAX_BODY_BYTES`          | 524,288   |

Read page sizes (`limit` default 100, max 500) are defined in [Task 2](02-api-endpoints.md).

## 6. App identification

- The app is identified by its API key, sent in the `X-Api-Key` header, **never** by a field in the body. One app can't pretend to be another.
- Each app has its own **write-only** key. It can send logs, nothing else.
- Reading logs needs a Cloudflare Access sign-in (`/v1/admin/*` routes, Phase 4). No app key can read logs.

## Tasks

- [ ] Review the levels, fields and limits above and confirm or adjust them.
- [ ] Confirm the example request is a realistic event from one of your apps.

## Done when

- Levels, event fields, envelope fields and all limits are final.
- Task 3 can implement the schemas from this file without open questions.
