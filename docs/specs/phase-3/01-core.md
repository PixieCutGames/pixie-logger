# Phase 3 — Task 1: Core Logger

Part of [Phase 3](README.md). The platform-independent heart of the client: the public API, turning a call into a valid event, and the queue.

## Usage

```ts
import { createLogger } from '@pixie-logger/logger';

export const logger = createLogger({
  endpoint: 'https://pixie-logger.<subdomain>.workers.dev/v1/logs',
  apiKey: 'pxl_…',
  appVersion: '1.4.2',
  platform: 'android',
});

logger.info('order_viewed', { route: '/orders/:id', params: { id: '123' } });
logger.error('api_failed', { message: 'Timeout', context: { status: 504, error } });
```

Each app creates one logger at startup and exports it.

## Options

| Option | Default | Notes |
|---|---|---|
| `endpoint` | required | Full URL of `POST /v1/logs` |
| `apiKey` | required | The app's write key |
| `appVersion` | required | |
| `platform` | required | `web`, `android` or `ios` |
| `minLevel` | `'debug'` | Lower levels are ignored, e.g. `'warn'` in production |
| `enabled` | `true` | `false` ignores all calls (e.g. logging off in dev) |
| `flushIntervalMs` | `10000` | How often queued events are sent |
| `batchSize` | `20` | Events per request (max 50) |
| `maxQueueSize` | `500` | When full, the oldest events are dropped |
| `redactKeys` | `[]` | Extra field names to redact, on top of the defaults |
| `storage` | none | Adapter to persist the queue (Task 3) |
| `lifecycle` | none | Adapter for background/foreground events (Task 3) |
| `debug` | `false` | Print warnings to the console about dropped or invalid events |
| `fetch` | global `fetch` | Custom fetch function (tests, or e.g. a native HTTP plugin) |

## Methods

| Method | What it does |
|---|---|
| `debug / info / warn / error / fatal(event, options?)` | Log at that level |
| `log(level, event, options?)` | Same, with the level as an argument |
| `flush()` | Send everything queued now; resolves when done (never rejects) |
| `setEnabled(on)` | Turn logging on or off at runtime |
| `shutdown()` | Stop timers, detach lifecycle listeners, flush once |

`options` is `{ message?, route?, params?, context? }`, matching the event contract.

## What happens on each call

1. **Filter:** ignored if disabled or below `minLevel`.
2. **Check the event name:** must match the contract's pattern (lowercase letters, digits, `_ . : -`). An invalid name drops the event, with a warning in `debug` mode, so you notice during development.
3. **Clean the data** in `params` and `context` so it's always valid JSON:
   - `Error` objects become `{ name, message }` (no stack: too big, and may contain file paths).
   - `Date` becomes an ISO string; `BigInt` a string; functions, symbols and `undefined` are removed.
   - Circular references become `"[Circular]"`; nesting deeper than 5 levels becomes `"[Truncated]"`.
4. **Redact** sensitive fields anywhere in `params` and `context`: values become `"[REDACTED]"`. Default list (matched case-insensitively, ignoring `-` and `_`, as part of the key name): `password`, `passwd`, `token`, `secret`, `apikey`, `authorization`, `cookie`, `sessionid`, `email`, `phone`, `creditcard`, `cardnumber`, `nationalid` (matched anywhere in the key), plus `otp`, `cvv`, `iban`, `pin` (matched only as the whole key or its end, so `userOtp` is caught but `notPaid` and `spinner` aren't). So `userEmail`, `X-Auth-Token` and `refresh_token` are all caught.
5. **Shorten** `message` and `route` that exceed the contract limits.
6. **Size check:** if the event is over 8 KB, drop `context`, then `params`; if still too big, drop the event.
7. **Queue** it with the current time, session id and app version.

None of this can throw: any unexpected error inside the logger is caught and ignored (warned in `debug` mode).

## Queue and timers

- Events wait in an in-memory queue, oldest first, capped at `maxQueueSize`.
- A flush is triggered when the timer fires, when the queue reaches `batchSize`, immediately for `error` and `fatal`, and when the app goes to the background.
- Only one flush runs at a time.
- A **session id** (random, per `createLogger` call) is attached to every event. Queued events keep the session id and app version they were logged with, so events restored after a restart are reported under their original session.
- With a `storage` adapter, the queue is saved shortly after it changes and restored on startup.

Sending and retrying are [Task 2](02-transport.md); this task calls a `send` function and acts on its result.

## Out of scope

- HTTP details and retry (Task 2), platform adapters (Task 3), build (Task 4).

## Done when

- The API above exists and is covered by unit tests, using a fake `send` function and fake timers.
