# Technical Spec — Phase 3, Task 4: Build and Packaging

> **Prerequisite:** [03-adapters.tech.md](03-adapters.tech.md) is done.

Design reference: [04-build.md](04-build.md).

## Rules for the agent

1. Only create or modify the files listed below.
2. Don't change any source behaviour in `packages/logger/src`. If the build needs a source change, **stop and report it**.
3. The test project in Verification goes in a **temporary directory outside the repo** (e.g. `mktemp -d`) and is deleted afterwards.
4. pnpm only inside the repo (npm is fine inside the temporary test project). Do not commit. Finish by running "Verification" and reporting the output.

## Files

### Dev dependencies

```
pnpm --filter @pixie-logger/logger add -D tsup esbuild
```

### Create `packages/logger/tsup.config.ts`

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    web: 'src/web.ts',
    capacitor: 'src/capacitor.ts',
    'react-native': 'src/react-native.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  treeshake: true,
  splitting: false,
  target: 'es2019',
  platform: 'neutral',
  noExternal: ['@pixie-logger/shared'],
});
```

- `target: 'es2019'` so optional chaining etc. are compiled down for older Android WebViews and Hermes.
- `noExternal` bundles the shared contract. zod must be tree-shaken out because the logger only imports constants, `utf8ByteLength`, `levelAtLeast` and types (and shared has `"sideEffects": false`).
- If tsup's `dts` build fails resolving `@pixie-logger/shared` types, stop and report rather than changing `tsconfig` paths broadly.

Expected output in `dist/`: for each entry `X`: `X.js` (ESM), `X.cjs` (CommonJS), `X.d.ts`, `X.d.cts`, plus source maps.

### Create subpath stub folders

For tools that don't read the `exports` map (older Metro, TypeScript with `moduleResolution: "node"`), create `packages/logger/web/package.json`:

```json
{
  "main": "../dist/web.cjs",
  "module": "../dist/web.js",
  "types": "../dist/web.d.ts",
  "sideEffects": false
}
```

Same for `capacitor/` and `react-native/` (pointing at their own files).

### Modify `packages/logger/package.json`

Final shape (keep existing `devDependencies`; version stays `0.1.0`; keep `"private": true`):

```json
{
  "name": "@pixie-logger/logger",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import":  { "types": "./dist/index.d.ts",  "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    },
    "./web": {
      "import":  { "types": "./dist/web.d.ts",  "default": "./dist/web.js" },
      "require": { "types": "./dist/web.d.cts", "default": "./dist/web.cjs" }
    },
    "./capacitor": {
      "import":  { "types": "./dist/capacitor.d.ts",  "default": "./dist/capacitor.js" },
      "require": { "types": "./dist/capacitor.d.cts", "default": "./dist/capacitor.cjs" }
    },
    "./react-native": {
      "import":  { "types": "./dist/react-native.d.ts",  "default": "./dist/react-native.js" },
      "require": { "types": "./dist/react-native.d.cts", "default": "./dist/react-native.cjs" }
    },
    "./package.json": "./package.json"
  },
  "files": ["dist", "web", "capacitor", "react-native"],
  "scripts": {
    "build": "tsup",
    "check:build": "node scripts/check-build.mjs",
    "pack:local": "pnpm build && pnpm check:build && pnpm pack",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Each condition carries its own `types`, so CommonJS consumers get the `.d.cts` declarations.

**Tests and typecheck inside the monorepo must keep working** now that `exports` points at `dist/`. Add to `packages/logger/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@pixie-logger/logger': new URL('./src/index.ts', import.meta.url).pathname } },
});
```

(Tests import from `../src/...` already; this only guards against self-imports.) Tests must not require a prior build.

### Create `packages/logger/scripts/check-build.mjs`

Plain Node ESM script, no dependencies except `esbuild` and Node built-ins. Exit `1` with a clear message on any failure; print a summary table on success.

1. Every expected file exists: for `index`, `web`, `capacitor`, `react-native`: `.js`, `.cjs`, `.d.ts`, `.d.cts`.
2. **No zod:** no file in `dist/` (excluding `.map`) contains the string `zod` (case-sensitive). Report which file if found.
3. **No platform imports:** no `dist/*.js` / `*.cjs` file contains `@capacitor/`, `react-native'`, `react-native"` or `@react-native-async-storage`.
4. **Size budget:** minify `dist/index.js` with `esbuild.transform(code, { minify: true })` and require the result ≤ **10 240 bytes**. Print sizes for all four ESM entries (minified bytes, and gzip size via `node:zlib`).
5. **Stubs:** each stub `package.json` points at files that exist.

### Modify root `.gitignore`

Add:

```
# packed packages
*.tgz
packages/logger/dist/
```

## Verification

1. `pnpm test` and `pnpm typecheck` at the repo root — pass **without** a prior build (run `rm -rf packages/logger/dist` first).
2. `pnpm --filter @pixie-logger/logger pack:local` — succeeds; report the check-build summary and the `.tgz` file name and size.
3. `tar -tzf packages/logger/*.tgz` — contains `package/dist/...`, `package/web/package.json`, `package/capacitor/package.json`, `package/react-native/package.json`, `package/package.json`; **no** `src/`, `test/` or `node_modules/`.
4. Inspect the packed `package.json` (`tar -xOzf … package/package.json`): `devDependencies` may list `@pixie-logger/shared` with a version (not `workspace:*`); `dependencies` must be absent or empty.
5. **Throwaway consumer test** in a temp dir outside the repo:
   ```
   T=$(mktemp -d) && cd "$T" && npm init -y >/dev/null
   npm install <absolute path to the .tgz>
   ```
   a. ESM: `node --input-type=module -e "import { createLogger } from '@pixie-logger/logger'; import * as w from '@pixie-logger/logger/web'; import * as c from '@pixie-logger/logger/capacitor'; import * as r from '@pixie-logger/logger/react-native'; console.log(typeof createLogger, Object.keys(w), Object.keys(c), Object.keys(r))"`
   b. CJS: `node -e "const { createLogger } = require('@pixie-logger/logger'); const w = require('@pixie-logger/logger/web'); console.log(typeof createLogger, Object.keys(w))"`
   c. Types, modern resolution: a `test.ts` importing `createLogger` and all three subpaths, type-checked with the repo's TypeScript (`<repo>/node_modules/.bin/tsc` or the logger package's) using `--moduleResolution bundler --module esnext --noEmit --strict`.
   d. Types, legacy resolution: the same file with `--moduleResolution node --module commonjs` (this exercises the stub folders).
   e. Runtime smoke: in ESM, create a logger with a fake `fetch` that records calls, log one `info` event, `await logger.flush()`, and print the recorded request body. The body must be a valid batch.
   Then delete the temp dir.

## Done when

- `pack:local` produces a `.tgz` that passes all checks above.
- Tests and typecheck in the monorepo don't depend on a build.
