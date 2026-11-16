# Phase 3 — Task 2: Transport and Retry

Part of [Phase 3](README.md). Sends batches to the Worker and decides what happens to them based on the response.

## Request

- `POST <endpoint>` with headers `Content-Type: application/json` and `X-Api-Key`, body = one batch (`appVersion`, `platform`, `sessionId`, `events`).
- Timeout: 10 seconds, after which the request is treated as a network failure.
- During a background flush the request uses `fetch(..., { keepalive: true })`, so the browser can finish it after the page is hidden (only when the body is under 60 KB, the browser's limit for keepalive requests).

## Response handling

| Response | Outcome | What the logger does |
|---|---|---|
| `202` | sent | Remove the batch from the queue. Warn (debug mode) if some events were `rejected`. |
| `400`, `413`, other `4xx` except below | dropped | Remove the batch; retrying would fail again. Warn (debug mode). |
| `401` | unauthorized | Stop sending for the rest of the session and warn once. New events are still queued (and persisted), so nothing is lost if the key is fixed in the next release. |
| `429` | retry | Keep the batch; wait for `Retry-After` seconds if given, else back off. |
| `5xx`, timeout, network error | retry | Keep the batch at the front of the queue and back off. |

## Backoff

- First retry after 5 s, then doubling each time (10 s, 20 s …) up to 5 minutes, with ±20 % random jitter so many devices don't retry at the same moment.
- Reset to normal after any successful send.
- While backing off, the regular flush timer doesn't send; new events just queue up.
- A background flush still tries once, even during backoff.

## Out of scope

- Splitting a batch the server rejects as too large: batches are capped at 20 × 8 KB, well under the 512 KB limit.
- Compression.

## Done when

- Every row of the table above is covered by a unit test with a mocked `fetch`, including timeout and `Retry-After`.
