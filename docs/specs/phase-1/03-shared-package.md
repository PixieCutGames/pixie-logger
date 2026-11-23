# Task 3: Shared Package

Part of [Phase 1](README.md). Turns [Task 1](01-event-contract.md) and [Task 2](02-api-endpoints.md) into code that both the Worker and the client logger import.

## Package

- Name: `@pixie-logger/shared`
- Location: `packages/shared`
- Dependency: `zod`
- Exports TypeScript source directly (no build step for now); the Worker and the logger bundle it themselves.

## Exports

| Export | What it is |
|---|---|
| `LOG_LEVELS` | `['debug','info','warn','error','fatal'] as const` |
| `PLATFORMS` | `['web','android','ios'] as const` |
| `LIMITS` | all numeric limits in one object (max events, max event bytes, max body bytes, string lengths, read page sizes) |
| `ERROR_CODES` | the error codes from Task 2 |
| `logEventSchema` | zod schema for one event, including the 8 KB size check |
| `logBatchEnvelopeSchema` | zod schema for the envelope, with `events` as an array of unknown items (so events can be validated one by one) |
| `logsQuerySchema` | zod schema for the `GET /v1/logs` query params |
| Types | `LogLevel`, `Platform`, `LogEvent`, `LogBatch`, `IngestResponse`, `ErrorResponse`, `LogsQuery`, `LogRecord`, `LogsPage` — plain TypeScript in `types.ts`, checked against the schemas at compile time (Phase 3 Task 4b) |
| `levelAtLeast(level, min)` | helper for client-side level filtering |

## Structure

```
packages/shared/
├─ package.json
├─ tsconfig.json
└─ src/
   ├─ index.ts        # re-exports everything
   ├─ constants.ts    # LOG_LEVELS, PLATFORMS, LIMITS, ERROR_CODES
   ├─ schemas.ts      # zod schemas
   ├─ types.ts        # inferred + response types
   └─ levels.ts       # levelAtLeast helper
```

## Tasks

- [ ] Create `packages/shared` (`package.json`, `tsconfig.json`, `src/`).
- [ ] Add `zod` as a dependency of `@pixie-logger/shared`.
- [ ] Write `constants.ts` with levels, platforms, limits and error codes.
- [ ] Write `schemas.ts`: event, envelope, logs query.
- [ ] Write `types.ts`: inferred types plus API response types.
- [ ] Write `levels.ts` with `levelAtLeast`.
- [ ] Re-export everything from `index.ts`.
- [ ] Add `@pixie-logger/shared` as a `workspace:*` dependency of `apps/api`.
- [ ] Import the package in `apps/api/src/index.ts` and run `pnpm dev` to check it resolves and bundles.
- [ ] Add unit tests (vitest) for the schemas: valid event, missing required field, oversized event, 51-event batch, unknown level.
- [ ] Commit: "Phase 1: shared contract".

## Done when

- `@pixie-logger/shared` exists and exports everything listed above.
- `apps/api` imports it and `pnpm dev` still starts without errors.
- The schema tests pass.
