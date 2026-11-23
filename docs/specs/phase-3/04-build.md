# Phase 3 — Task 4: Build and Packaging

Part of [Phase 3](README.md). Turns the TypeScript package into something any app can install, inside or outside this repo.

## Why a build is needed

Inside the monorepo, packages share TypeScript source directly. An app in another repo installs the logger into `node_modules`, and Angular CLI, Vite and Metro don't compile TypeScript from there. So the logger ships compiled JavaScript plus type definitions.

## Output

Built with `tsup` into `packages/logger/dist/`:

- **ESM and CommonJS** for each entry point (core, `web`, `capacitor`, `react-native`), so it works with Angular, Vite, Metro and older tooling.
- **Type definitions** (`.d.ts`) for each entry point, including for projects whose TypeScript settings don't understand package subpaths (common in older Angular projects).
- **The shared contract is bundled in,** so apps install one package. **zod is not included**; the build fails if it sneaks in.
- **Size budget:** the core entry under 12 KB minified (raised from 10 KB in Task 4b). The build check fails above that.

## Installing in an app

**Now (development, local):** pack the logger into a `.tgz` file and install that file in the app. It behaves exactly like a real published package, unlike symlinks, which often confuse Angular and Metro.

```
# in pixie-logger
pnpm --filter @pixie-logger/logger pack:local     # builds and writes packages/logger/pixie-logger-logger-<version>.tgz

# in the app (npm or pnpm, whichever the app uses)
npm install /Users/<you>/Documents/GitHub/pixie-logger/packages/logger/pixie-logger-logger-0.1.0.tgz
```

After changing the logger: run `pack:local` again and re-run the same install command.

**Later (GitHub):** attach the `.tgz` to a GitHub Release on the PixieCutGames repo and install it by URL. Works with npm, pnpm and yarn. If the repo is private, installs need a GitHub token. This is documented, not set up, in this task.

## Versioning

- Starts at `0.1.0`. Bump the version in `packages/logger/package.json` when packing a changed build, so apps can tell builds apart.
- The package stays `"private": true`, which blocks accidental `npm publish` but still allows packing.

## Done when

- `pnpm --filter @pixie-logger/logger build` produces the outputs above, and the size and no-zod checks pass.
- `pack:local` produces a `.tgz` that installs and imports correctly in a throwaway test project.
