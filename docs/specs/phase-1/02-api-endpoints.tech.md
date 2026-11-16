# Technical Spec — Task 2: API Contract Code

> **Prerequisites:** [03-shared-package.tech.md](03-shared-package.tech.md) and [01-event-contract.tech.md](01-event-contract.tech.md) are done.
> Execution order for Phase 1: **03 → 01 → 02**.

Design reference: [02-api-endpoints.md](02-api-endpoints.md) — the source of truth for every name, status and code below.

## Scope — read carefully

This task adds the **contract code** for the two endpoints to `@pixie-logger/shared`: error codes, the partial-accept validation helper, the read-query schema and the response types.

It does **not** implement the Worker routes, database tables or auth. That is Phase 2. Do **not** modify `apps/api` in this task.

## Rules for the agent

1. Only create or modify the files listed in "Files" below. Nothing in `apps/`.
2. Do not change any name, status code, error code or shape from the design reference. If something conflicts, **stop and report it**.
3. Platform-neutral code only in `packages/shared/src/` (no Node/DOM APIs).
4. zod **v4** APIs only. `import type` for type-only imports.
5. pnpm only. Do not commit. Finish by running "Verification" and reporting the output.

## Files

### Modify `packages/shared/src/constants.ts`

Add these keys to the existing `LIMITS` object (keep it one flat object):

```ts
  readDefaultLimit: 100,
  readMaxLimit: 500,
  appNameMax: 50,
  cursorMax: 500,
```

Add:

```ts
export const ERROR_CODES = [
  'invalid_json',
  'invalid_envelope',
  'no_valid_events',
  'invalid_query',
  'unauthorized',
  'payload_too_large',
  'rate_limited',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
```

### Create `packages/shared/src/api.ts`

#### Response types

```ts
export interface RejectedEvent {
  index: number;      // position in the request's `events` array
  errors: string[];   // from formatZodIssues
}

export interface IngestResponse {         // POST /v1/logs → 202
  accepted: number;
  rejected: RejectedEvent[];
}

export interface ErrorResponse {          // any 4xx
  error: { code: ErrorCode; message: string };
}

export interface LogRecord {              // one item from GET /v1/logs
  id: string;
  app: string;
  level: LogLevel;
  event: string;
  message: string | null;
  route: string | null;
  params: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  appVersion: string;
  platform: Platform;
  sessionId: string;
  clientTs: string;    // ISO datetime
  receivedAt: string;  // ISO datetime, set by the server
}

export interface LogsPage {               // GET /v1/logs → 200
  items: LogRecord[];
  nextCursor: string | null;
}
```

Optional fields are `null` (not missing) in `LogRecord` because they come from database columns.

#### `validateEvents`

```ts
export function validateEvents(events: readonly unknown[]): {
  valid: LogEvent[];
  rejected: RejectedEvent[];
}
```

- Runs `logEventSchema.safeParse` on each item **independently**.
- Successful items go to `valid` (the parsed `data`, so unknown keys are stripped), in their original order.
- Failed items go to `rejected` as `{ index, errors: formatZodIssues(result.error) }`, where `index` is the item's position in the input array.
- Never throws. Does not check batch size (the envelope schema does that).

Phase 2 will use it like this (for context only — do not implement):

```
envelope = logBatchEnvelopeSchema.safeParse(body)  → 400 invalid_envelope if it fails
{ valid, rejected } = validateEvents(envelope.events)
valid.length === 0                                  → 400 no_valid_events
otherwise store `valid`                             → 202 { accepted: valid.length, rejected }
```

#### `errorResponse`

```ts
export function errorResponse(code: ErrorCode, message: string): ErrorResponse
```

Returns `{ error: { code, message } }`.

### Create `packages/shared/src/query.ts`

The Worker will call this with an object built from the URL, where each key is a string, or an array of strings when the param repeats: `Record<string, string | string[] | undefined>`.

```ts
export const logsQuerySchema = z.object({ ... })
export type LogsQuery = z.output<typeof logsQuerySchema>;
```

| Key | Input | Output | Rule |
|---|---|---|---|
| `app` | string, optional | string \| undefined | 1–`LIMITS.appNameMax` chars |
| `level` | string or string[], optional | `LogLevel[]` \| undefined | each item must be a valid level; a single string becomes a one-item array; duplicates removed |
| `event` | string, optional | string \| undefined | 1–`LIMITS.eventNameMax` chars |
| `from` | string, optional | string \| undefined | `z.iso.datetime({ offset: true })` |
| `to` | string, optional | string \| undefined | `z.iso.datetime({ offset: true })` |
| `limit` | string, optional | number | `z.coerce.number().int().min(1).max(LIMITS.readMaxLimit)`, default `LIMITS.readDefaultLimit` |
| `cursor` | string, optional | string \| undefined | 1–`LIMITS.cursorMax` chars |

Cross-field rule (`.superRefine` on the object): when both `from` and `to` are present, `Date.parse(from)` must be **less than** `Date.parse(to)`; otherwise add an issue on path `['to']` with message `'to must be after from'`.

Unknown query params are stripped (default `z.object` behaviour).

### Modify `packages/shared/src/index.ts`

Append:

```ts
export * from './api';
export * from './query';
```

### Create tests

`packages/shared/test/validate-events.test.ts`:
1. All valid → `valid.length === n`, `rejected` empty.
2. Mixed `[valid, {}, valid, { level: 'nope', event: 'x', clientTs: '…' }]` → `valid.length === 2` in original order; `rejected` indexes are `[1, 3]`; each `errors` array is non-empty strings.
3. All invalid → `valid` empty, `rejected.length === n`.
4. Non-object items (`null`, `42`, `'str'`) are rejected, not thrown.
5. Unknown keys are stripped from items in `valid`.

`packages/shared/test/query-schema.test.ts`:
1. `{}` → `{ limit: 100 }` (all others undefined).
2. `{ level: 'error' }` → `level: ['error']`.
3. `{ level: ['error', 'fatal', 'error'] }` → `level: ['error', 'fatal']`.
4. `{ level: 'critical' }` fails.
5. `{ limit: '250' }` → `limit: 250`; `'0'`, `'501'`, `'abc'`, `'1.5'` fail.
6. `from` before `to` passes; equal or reversed fails with an issue on path `to`.
7. `from: '2026-11-15'` fails.
8. Unknown param `{ foo: 'bar' }` passes and is stripped.

`packages/shared/test/api.test.ts`:
1. `errorResponse('unauthorized', 'Missing API key')` deep-equals `{ error: { code: 'unauthorized', message: 'Missing API key' } }`.
2. `ERROR_CODES` contains exactly the 7 codes listed above.

> Note: Phase 2, Task 2 later adds an 8th code, `internal_error`, and updates this test.

## Verification

From the repo root:

1. `pnpm test` — all tests pass (including Task 1 and Task 3 tests).
2. `pnpm typecheck` — no errors.
3. `pnpm --filter @pixie-logger/api exec wrangler deploy --dry-run --outdir .wrangler/dry-run` — still bundles.
4. `git status` shows changes only under `packages/shared/`.

## Done when

- `@pixie-logger/shared` exports everything listed in [03-shared-package.md](03-shared-package.md), plus `validateEvents`, `errorResponse`, `formatZodIssues`, `utf8ByteLength`, `RejectedEvent` and `ErrorCode`.
- All verification steps pass.
- Phase 1 is complete.
