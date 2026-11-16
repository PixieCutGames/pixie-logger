# Technical Spec — Task 3: Shared Package Scaffold

> **Implement this file first.** Tasks 1 and 2 add code into the package this task creates.
> Execution order for Phase 1: **03 → 01 → 02**.

Design reference: [03-shared-package.md](03-shared-package.md)

## Rules for the agent

1. Only create or modify the files listed in "Files" below. Do not touch anything else.
2. Do not change the contract (names, limits, shapes). If something in this spec seems wrong or conflicts with the repo, **stop and report it** instead of improvising.
3. Use **pnpm** only (never npm or yarn). Run all commands from the **repo root** unless a step says otherwise.
4. Do not commit. The user commits.
5. Finish by running every command in "Verification" and reporting the output.

## Repo context (current state)

```
pixie-logger/                 # pnpm monorepo root
├─ package.json               # "private": true, "type": "module", packageManager pnpm@12.21.0
├─ pnpm-workspace.yaml        # packages: apps/*, packages/*
├─ apps/
│  └─ api/                    # Cloudflare Worker, Hono, package name @pixie-logger/api
│     ├─ src/index.ts         # Hono app, one route: GET /message
│     ├─ tsconfig.json        # moduleResolution: Bundler, strict, lib ESNext
│     └─ wrangler.jsonc       # Worker "pixie-logger", D1 binding DB
├─ packages/                  # empty
└─ docs/specs/phase-1/          # specs (this folder)
```

## Goal

Create the `@pixie-logger/shared` package with tooling (TypeScript, zod, vitest), make `apps/api` depend on it, and prove the Worker can import and bundle it.

## Files

### Create `packages/shared/package.json`

```json
{
  "name": "@pixie-logger/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Then add dependencies with pnpm (do not hand-write versions):

```
pnpm --filter @pixie-logger/shared add zod@^4
pnpm --filter @pixie-logger/shared add -D typescript vitest
```

The package intentionally ships **TypeScript source with no build step**. Consumers (the Worker via wrangler/esbuild, later the client logger) bundle it themselves.

### Create `packages/shared/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

`lib` is `ES2022` only — **no DOM, no Node types**. This package must run in the Worker, browsers, Capacitor WebViews and React Native (Hermes). Do not use `TextEncoder`, `Buffer`, `crypto`, `window`, or any Node/DOM API in `src/`.

### Create `packages/shared/src/index.ts`

```ts
export const CONTRACT_VERSION = 'v1' as const;
```

Tasks 1 and 2 will append re-exports to this file.

### Create `packages/shared/test/index.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { CONTRACT_VERSION } from '../src/index';

describe('shared package', () => {
  it('exposes the contract version', () => {
    expect(CONTRACT_VERSION).toBe('v1');
  });
});
```

### Modify root `package.json`

Replace `"scripts": {}` with:

```json
"scripts": {
  "test": "pnpm -r --if-present test",
  "typecheck": "pnpm -r --if-present typecheck"
}
```

Change nothing else in that file.

### Wire into `apps/api`

1. Add the dependency:

   ```
   pnpm --filter @pixie-logger/api add @pixie-logger/shared@workspace:*
   ```

   Result in `apps/api/package.json`: `"@pixie-logger/shared": "workspace:*"` under `dependencies`.

2. In `apps/api/src/index.ts`, add a health route that uses the package. Keep the existing `/message` route. Final file:

   ```ts
   import { Hono } from "hono";
   import { CONTRACT_VERSION } from "@pixie-logger/shared";

   const app = new Hono<{ Bindings: CloudflareBindings }>();

   app.get("/message", (c) => {
     return c.text("Hello Hono!");
   });

   app.get("/v1/health", (c) => {
     return c.json({ ok: true, contract: CONTRACT_VERSION });
   });

   export default app;
   ```

## Verification

Run from the repo root and report the results:

1. `pnpm install` — completes with no errors.
2. `pnpm test` — the shared test passes.
3. `pnpm typecheck` — no errors.
4. `pnpm --filter @pixie-logger/api exec wrangler deploy --dry-run --outdir .wrangler/dry-run` — bundles successfully (this proves the Worker can import the shared package; nothing is deployed).
5. Optional, if a long-running process is allowed: `pnpm --filter @pixie-logger/api dev`, then `curl http://localhost:8787/v1/health` returns `{"ok":true,"contract":"v1"}`.

## Done when

- All verification steps pass.
- `packages/shared` contains exactly: `package.json`, `tsconfig.json`, `src/index.ts`, `test/index.test.ts` (plus `node_modules`).
