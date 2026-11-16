# Phase 2 — Task 3: App & Key Management Script

Part of [Phase 2](README.md). A small command-line tool, run on your machine, that creates apps and manages their write keys in D1.

> **Prerequisite:** [Task 1](01-d1-schema.md) is done (the `apps` and `api_keys` tables exist).

## Goal

One command to register a new app and get its key, plus the few commands needed to rotate and revoke keys later. No dashboard, no admin API: this is a tool only you run.

## Commands

Run from the repo root:

```
pnpm keys <command> [arguments] [--remote]
```

| Command | What it does |
|---|---|
| `create-app <id> "<display name>" [--label "<text>"]` | Creates the app and its first key, and prints the key |
| `add-key <app-id> [--label "<text>"]` | Adds another key to an existing app (for rotation), and prints it |
| `revoke-key <key-id>` | Turns a key off; requests using it get `401` |
| `disable-app <app-id>` | Stops accepting logs from the app (all its keys stop working); keeps its data |
| `enable-app <app-id>` | Undoes `disable-app` |
| `list` | Shows all apps and their keys: id, prefix, label, created, revoked |

### Local vs live

- **By default every command uses the local database** (the one `pnpm dev` uses), so you can experiment safely.
- Add `--remote` to act on the live database. Commands that change data then ask for confirmation first (`--yes` skips the question).

### Examples

```
pnpm keys create-app maslary "Maslary (مصاري)" --label "v1" --remote
pnpm keys list --remote
pnpm keys add-key maslary --label "v2 release" --remote
pnpm keys revoke-key 1 --remote
```

## Keys

- Format: `pxl_` followed by 64 random hex characters, e.g. `pxl_3f9a…`. The `pxl_` prefix makes keys easy to spot in code or if leaked.
- **The full key is shown once,** when it's created. Only its SHA-256 hash is stored, so a lost key can't be recovered: add a new one instead.
- The first 12 characters (e.g. `pxl_3f9a1c2e`) are stored as the key's prefix, so `list` can show which key is which.
- Where the key goes in each app: its normal environment config (e.g. `environment.ts` in Ionic, an `.env` value in React Native). Remember it's a public, write-only key, so this is fine.

### Rotating a key

1. `add-key <app>` and put the new key in the next app release.
2. Once most users have updated, `revoke-key <old key id>`.

## Shared key code

The key format and the hashing function live in one module in `apps/api` that both this script and the Worker import. That guarantees the Worker (Task 2) hashes incoming keys exactly the way the script hashed them when they were created.

## Known limitations

- **macOS and Linux only.** The script runs wrangler's `.cmd` file directly on Windows, which recent Node versions refuse to do without a shell. Fix it if the script ever needs to run on Windows.
- Key ids are never reused (the table uses auto-increment), so ids can start above 1 or have gaps after test data is deleted. That's expected.

## Out of scope

- An admin API or UI for keys.
- Deleting apps (rarely needed; can be done with a single SQL command).
- Rate limiting or usage tracking per key.

## Tasks

- [ ] Review the commands above.
- [ ] Agent implements [03-app-keys.tech.md](03-app-keys.tech.md) (local database only).
- [ ] You create your first real app on the live database: `pnpm keys create-app <id> "<name>" --remote`, and store the key somewhere safe.
- [ ] Commit: "Phase 2: app & key script".

## Done when

- All commands work against the local database.
- Your first real app and key exist in the live database.
