# Phase 3, Task 4b: Build Fixes

The Task 4 agent stopped with three blockers it couldn't fix within its spec. This task finishes Task 4 with these decisions:

| Blocker | Decision |
|---|---|
| TypeScript 7 (the new native compiler) has no JavaScript compiler API, so `tsup` can't generate type declarations. | **Pin `packages/logger` to TypeScript 6.** `packages/shared` and `apps/api` stay on 7. Revisit if TypeScript 6 becomes a nuisance (e.g. switch to a declaration tool that doesn't need the compiler API). |
| The published `.d.ts` files import `@pixie-logger/shared`, which isn't in the package, because `LogLevel`, `Platform` and `LogEvent` are only defined through zod's `z.infer`. | **Write these types as plain TypeScript** in a new `packages/shared/src/types.ts` with no zod and no imports. The zod schemas stay the runtime rules, and a compile-time check makes sure the plain types and the schemas can't drift apart. The contract doesn't change. |
| The core bundle is 10,400 bytes minified, over the 10 KB budget. | **Budget raised to 12 KB** (12,288 bytes). The growth came from features added on purpose (save cap, backoff, keepalive, storage error handling); 12 KB leaves room for the Phase 5 multi-tab fix. Gzipped it's about 4 KB. |

Tech spec: [04b-build-fixes.tech.md](04b-build-fixes.tech.md).

## Effect on apps

None visible. Apps get correct TypeScript types with no dependency on the shared package or zod.
