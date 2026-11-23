# Technical Spec — Phase 3, Task 4b: Build Fixes (finishes Task 4)

> **Prerequisite:** the uncommitted Task 4 work is in place (`tsup.config.ts`, `vitest.config.ts`, `scripts/check-build.mjs`, stub folders, `package.json`, `.gitignore`). This task fixes the three blockers and then runs Task 4's full Verification.
> Execution order for Phase 3: **1 → 1b → 2 → 3 → 3b → 4 + 4b → 5**.

Design reference: [04b-build-fixes.md](04b-build-fixes.md). Task 4 spec: [04-build.tech.md](04-build.tech.md) (already updated for the 12 KB budget and the TypeScript 6 checks).

## Rules for the agent

1. Only create or modify:
   - `packages/shared/src/types.ts` (new), `packages/shared/src/schemas.ts`, `packages/shared/src/index.ts`, and any file in `packages/shared/src` or `apps/api/src` that imports `LogLevel`, `Platform`, `LogEvent`, `LogBatchEnvelope` or `LogBatch` from `./schemas` (currently `levels.ts` and `api.ts`): change only those import lines
   - `packages/logger/package.json`, `packages/logger/tsup.config.ts`, `packages/logger/scripts/check-build.mjs`, and if needed (step 3) a new `packages/logger/tsconfig.build.json`
   - `pnpm-lock.yaml` (via pnpm)
   - plus every file Task 4 already lists.
2. **Don't change the contract:** no schema, limit, name or runtime behaviour changes in `packages/shared`. Only where the five types are declared moves. `apps/api` must still pass its tests and typecheck.
3. Don't change `packages/logger/src`. If the build needs a source change, **stop and report**.
4. If, after step 3 below, the declarations still contain any import that doesn't resolve inside the package, **stop and report** with the offending lines.
5. pnpm only in the repo. Don't commit. Never deploy or use `--remote`. Finish by running Task 4's full Verification and reporting the output.

## Changes

### 1. TypeScript 6 for the logger only

```
pnpm --filter @pixie-logger/logger add -D typescript@^6
```

Remove any `@typescript/typescript6` package added during Task 4. `packages/shared` and `apps/api` keep `typescript@^7`. The logger's `test` and `typecheck` scripts must still pass with TypeScript 6.

### 2. Plain contract types in `packages/shared`

Create `packages/shared/src/types.ts`. It must have **no imports at all** (not even `import type`), so declaration bundling inlines it as one self-contained block. Use **type aliases, not interfaces**: like the old `z.infer` types, aliases are compatible with `Record<string, unknown>` (an interface isn't), so existing code such as the cast in `logger/src/event.ts` keeps compiling:

```ts
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type Platform = 'web' | 'android' | 'ios';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type LogEvent = {
  level: LogLevel;
  event: string;
  message?: string;
  route?: string;
  params?: Record<string, JsonValue>;
  context?: Record<string, JsonValue>;
  clientTs: string;
};

export type LogBatchEnvelope = {
  appVersion: string;
  platform: Platform;
  sessionId: string;
  events: unknown[];
};

/** What clients send. */
export type LogBatch = {
  appVersion: string;
  platform: Platform;
  sessionId: string;
  events: LogEvent[];
};
```

In `schemas.ts`:
- Delete the five `export type … = z.infer<…>` / `LogBatch` declarations.
- `import type { LogLevel, Platform, LogEvent, LogBatchEnvelope } from './types';`
- Add a **compile-time check** (type-only, erased at runtime) that each plain type and its zod-inferred type are **assignable in both directions**. Mutual assignability, not exact equality: zod 4 infers optional fields as `?: T | undefined`, which an exact-equality check would reject for no real reason.
  The check must be **types only**: no runtime export or value (that would change `shared`'s runtime output). For example:
  ```ts
  type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
  type Assert<T extends true> = T;
  /** Fails to compile if the plain types in ./types drift from the zod schemas. Type-only. */
  export type ContractTypeChecks = [
    Assert<Mutual<LogLevel, z.infer<typeof logLevelSchema>>>,
    Assert<Mutual<LogLevel, (typeof LOG_LEVELS)[number]>>,
    Assert<Mutual<Platform, z.infer<typeof platformSchema>>>,
    Assert<Mutual<Platform, (typeof PLATFORMS)[number]>>,
    Assert<Mutual<LogEvent, z.infer<typeof logEventSchema>>>,
    Assert<Mutual<LogBatchEnvelope, z.infer<typeof logBatchEnvelopeSchema>>>,
  ];
  ```
  Equivalent type-only forms are fine, as long as `pnpm typecheck` fails when a plain type stops matching. **Prove it once:** temporarily change `Platform` in `types.ts` to add `'windows'`, confirm `pnpm --filter @pixie-logger/shared typecheck` fails, revert, and report this in the output.
  If `JsonValue` vs zod's `z.json()` inferred type isn't mutually assignable for `LogEvent`, report the exact error and the smallest adjustment to `JsonValue` that fixes it (adjust `JsonValue` only, never the schema).
- In `index.ts`, add `export * from './types';`.
- Change the type imports in `levels.ts` and `api.ts` (and any other file) from `./schemas` to `./types`.

`pnpm test` and `pnpm typecheck` must pass for `shared`, `api` and `logger`.

### 3. Bundle the shared types into the logger's declarations

In `tsup.config.ts` change `dts: true` to:
```ts
dts: { resolve: ['@pixie-logger/shared'] },
```

Build and inspect `dist/*.d.ts` / `*.d.cts`. If any declaration still imports `@pixie-logger/shared`, `zod`, or a relative path that isn't another file in `dist/` (e.g. `./constants`), then:
- create `packages/logger/tsconfig.build.json` that extends `./tsconfig.json` and adds `"compilerOptions": { "paths": { "@pixie-logger/shared": ["../shared/src/index.ts"] } }`;
- set `tsconfig: 'tsconfig.build.json'` in `tsup.config.ts`;
- rebuild and re-inspect.

The normal `tsconfig.json` is not changed. If it still fails, stop (rule 4).

*In practice the fallback was needed: `packages/logger/tsconfig.build.json` exists and `tsup.config.ts` uses it.*

### 4. `check-build.mjs`

- Size budget: **≤ 12 288 bytes** for minified `dist/index.js` (was 10 240).
- New check: no `.d.ts` / `.d.cts` file in `dist/` contains `@pixie-logger/shared` or `from 'zod'` / `from "zod"`, and every relative `from './x'` in a declaration file points at a file that exists in `dist/` (try `x`, `x.d.ts`, `x.d.cts`). Report the file and line on failure.

A build warning that the internal `LoggerDeps` type isn't exported is expected and harmless (it's a test seam, not public API).

## Verification

Run Task 4's full Verification ([04-build.tech.md](04-build.tech.md#verification), as updated), plus:

6. `pnpm --filter @pixie-logger/shared typecheck` fails with the temporary `'windows'` change and passes after reverting it (report both).
7. `grep -rn "@pixie-logger/shared\|zod" packages/logger/dist --include="*.d.ts" --include="*.d.cts"`: no matches.
8. `pnpm --filter @pixie-logger/api test` and `pnpm --filter @pixie-logger/api typecheck` pass.

## Done when

- `pack:local` produces a `.tgz` that passes every check in Task 4 and above.
- The five contract types are plain TypeScript in `shared/src/types.ts`, checked against the zod schemas at compile time.
- The logger builds with TypeScript 6; shared and api still use TypeScript 7.
