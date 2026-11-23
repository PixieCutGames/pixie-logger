# Technical Spec — Task 1: Event Contract

> **Prerequisite:** [03-shared-package.tech.md](03-shared-package.tech.md) is done (the `@pixie-logger/shared` package exists with zod and vitest installed).
> Execution order for Phase 1: **03 → 01 → 02**.

Design reference: [01-event-contract.md](01-event-contract.md) — the source of truth for every name and limit below.

## Rules for the agent

1. Only create or modify the files listed in "Files" below.
2. Do not change any name, limit or shape from the design reference. If something conflicts, **stop and report it**.
3. Code in `packages/shared/src/` must be platform-neutral: **no** `TextEncoder`, `Buffer`, `crypto`, `window`, Node or DOM APIs. It runs in the Worker, browsers and React Native.
4. Use zod **v4** APIs (`z.iso.datetime`, `z.json`, `z.record(key, value)`). Do not use zod v3 patterns.
5. Use `.js`-less relative imports (e.g. `./constants`); the package uses `moduleResolution: Bundler`. Use `import type` for type-only imports (`verbatimModuleSyntax` is on).
6. pnpm only. Do not commit. Finish by running "Verification" and reporting the output.

## Goal

Implement the constants, the event and batch-envelope schemas, their types, and the helpers that the Worker and client logger will use.

## Files

### Create `packages/shared/src/constants.ts`

```ts
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export const PLATFORMS = ['web', 'android', 'ios'] as const;

export const LIMITS = {
  maxEventsPerBatch: 50,
  maxEventBytes: 8 * 1024,      // 8 KB, JSON-serialized event
  maxBodyBytes: 512 * 1024,     // 512 KB, whole request body
  eventNameMax: 100,
  messageMax: 1000,
  routeMax: 200,
  appVersionMax: 50,
  sessionIdMax: 64,
} as const;
```

Task 2 will add more keys to `LIMITS` and add `ERROR_CODES` to this file. Keep the object flat.

### Create `packages/shared/src/utf8.ts`

```ts
/** UTF-8 byte length of a string, without TextEncoder (Hermes-safe). */
export function utf8ByteLength(str: string): number
```

Implementation requirements:
- Iterate over `charCodeAt`. Code units `< 0x80` → 1 byte, `< 0x800` → 2 bytes, surrogate pair (high `0xD800–0xDBFF` followed by low `0xDC00–0xDFFF`) → 4 bytes and skip the low surrogate, any other unit → 3 bytes.
- A lone surrogate counts as 3 bytes.

### Create `packages/shared/src/levels.ts`

```ts
import type { LogLevel } from './schemas';

/** True if `level` is the same as or more severe than `min`. */
export function levelAtLeast(level: LogLevel, min: LogLevel): boolean
```

Severity order is the order of `LOG_LEVELS` (index 0 = least severe). Example: `levelAtLeast('error', 'warn') === true`, `levelAtLeast('info', 'warn') === false`, `levelAtLeast('warn', 'warn') === true`.

### Create `packages/shared/src/schemas.ts`

Exports:

| Export | Kind |
|---|---|
| `EVENT_NAME_PATTERN` | `/^[a-z0-9][a-z0-9_.:-]*$/` |
| `logLevelSchema` | `z.enum(LOG_LEVELS)` |
| `platformSchema` | `z.enum(PLATFORMS)` |
| `logEventSchema` | zod object, see below |
| `logBatchEnvelopeSchema` | zod object, see below |
| `type LogLevel` | plain union in `types.ts`, checked against `z.infer<typeof logLevelSchema>` |
| `type Platform` | plain union in `types.ts`, checked against `z.infer<typeof platformSchema>` |
| `type LogEvent` | plain type alias in `types.ts`, checked against `z.infer<typeof logEventSchema>` |
| `type LogBatchEnvelope` | plain type alias in `types.ts`, checked against `z.infer<typeof logBatchEnvelopeSchema>` |
| `type LogBatch` | plain type alias in `types.ts` — what clients send |

*Since Phase 3 Task 4b these types are plain TypeScript (no zod), so the client package's published types don't depend on zod. A compile-time check in `schemas.ts` fails `typecheck` if they drift from the schemas.*

**`logEventSchema`** — a `z.object` (default behaviour: unknown keys are **stripped**, not rejected):

| Key | Rule |
|---|---|
| `level` | `logLevelSchema` |
| `event` | `z.string().min(1).max(LIMITS.eventNameMax).regex(EVENT_NAME_PATTERN)` |
| `message` | `z.string().max(LIMITS.messageMax).optional()` |
| `route` | `z.string().max(LIMITS.routeMax).optional()` |
| `params` | `z.record(z.string(), z.json()).optional()` |
| `context` | `z.record(z.string(), z.json()).optional()` |
| `clientTs` | `z.iso.datetime({ offset: true })` |

Optional fields use `.optional()` only, **not** `.nullish()`: `null` is rejected (see the design doc's validation rules).

Then add a size check on the parsed object with `.superRefine`: if `utf8ByteLength(JSON.stringify(value)) > LIMITS.maxEventBytes`, add a custom issue with `path: []` and message `` `event exceeds ${LIMITS.maxEventBytes} bytes` ``.

**`logBatchEnvelopeSchema`** — a `z.object`:

| Key | Rule |
|---|---|
| `appVersion` | `z.string().min(1).max(LIMITS.appVersionMax)` |
| `platform` | `platformSchema` |
| `sessionId` | `z.string().min(1).max(LIMITS.sessionIdMax)` |
| `events` | `z.array(z.unknown()).min(1).max(LIMITS.maxEventsPerBatch)` |

`events` is deliberately `unknown[]`: the envelope is validated first, then each event is validated on its own (Task 2's `validateEvents`) so one bad event doesn't reject the batch.

### Create `packages/shared/src/format.ts`

```ts
import type { z } from 'zod';

/** Turns zod issues into short strings like "event: Too small…" or "(root): event exceeds 8192 bytes". */
export function formatZodIssues(error: z.ZodError): string[]
```

Each string is `` `${path}: ${issue.message}` `` where `path` is `issue.path.join('.')`, or `(root)` when the path is empty. One string per issue, in zod's order.

### Modify `packages/shared/src/index.ts`

Append (keep `CONTRACT_VERSION`):

```ts
export * from './constants';
export * from './schemas';
export * from './levels';
export * from './utf8';
export * from './format';
```

### Create tests

`packages/shared/test/utf8.test.ts`:
- `''` → 0, `'abc'` → 3, `'é'` → 2, `'€'` → 3, `'😀'` → 4, `'مصاري'` → 10 (Arabic: 2 bytes each).

`packages/shared/test/levels.test.ts`:
- The three examples above, plus `levelAtLeast('fatal', 'debug') === true` and `levelAtLeast('debug', 'fatal') === false`.

`packages/shared/test/event-schema.test.ts` (use `safeParse`):
1. Minimal valid event (`level`, `event`, `clientTs`) passes.
2. Full valid event (all fields, nested `params`/`context`) passes.
3. Missing `event` fails; missing `clientTs` fails.
4. `level: 'critical'` fails; `level: 'fatal'` passes.
5. `event` of 101 chars fails; `message` of 1001 chars fails; `route` of 201 chars fails.
6. `clientTs: '2026-11-15'` (date only) fails; `'2026-11-15T12:30:00.000Z'` and `'2026-11-15T14:30:00+02:00'` pass.
7. `context` with a function value or `undefined` value fails (not JSON).
8. An event whose `context` makes it larger than 8 KB fails, and `formatZodIssues` on the error contains `'(root): event exceeds 8192 bytes'`.
9. Unknown key `foo` is stripped: parse succeeds and `'foo' in result.data` is false.
10. Event name pattern: `'api.failed:v2-x_y'` and `'9lives'` pass; `'Order_Viewed'`, `'_x'` and `'has space'` fail.
11. `null` for `message`, `route`, `params` or `context` fails.

`packages/shared/test/envelope-schema.test.ts`:
1. Valid envelope with 1 event passes; with 50 passes.
2. 0 events fails; 51 events fails.
3. `platform: 'windows'` fails.
4. Missing `sessionId` fails; `sessionId` of 65 chars fails.
5. An envelope whose `events` contains invalid events (e.g. `[{}]`) **passes** — events aren't checked at this level.

## Verification

From the repo root:

1. `pnpm test` — all tests pass.
2. `pnpm typecheck` — no errors.
3. `pnpm --filter @pixie-logger/api exec wrangler deploy --dry-run --outdir .wrangler/dry-run` — still bundles.

## Done when

- All files above exist and export exactly what is listed.
- All verification steps pass.
