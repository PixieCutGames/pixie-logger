# Technical Spec — Phase 2, Task 3: App & Key Management Script

> **Prerequisite:** [01-d1-schema.tech.md](01-d1-schema.tech.md) is done and applied locally (`pnpm --filter @pixie-logger/api db:migrate:local`).

Design reference: [03-app-keys.md](03-app-keys.md) — the source of truth for command names, arguments and key format.

## Rules for the agent

1. Only create or modify the files listed in "Files" below.
2. Do not change command names, arguments, the key format or the hashing method. If something conflicts or fails, **stop and report it**.
3. **Never use `--remote`.** Test against the local database only.
4. Do not edit `wrangler.jsonc` or the migration files.
5. pnpm only. Do not commit. Finish by running "Verification" and reporting the output of each step.

## Repo context

```
pixie-logger/
├─ package.json                 # root scripts: test, typecheck
└─ apps/api/
   ├─ package.json              # @pixie-logger/api; scripts incl. db:migrate:local
   ├─ wrangler.jsonc            # D1 binding DB → database "pixie-logs"
   ├─ migrations/0001_init.sql  # apps, api_keys, logs
   └─ src/index.ts              # Hono app
```

Relevant tables (see `migrations/0001_init.sql`):
- `apps(id TEXT PK, display_name, created_at INTEGER ms, disabled_at INTEGER ms NULL)`
- `api_keys(id INTEGER PK, app_id → apps.id, key_hash TEXT UNIQUE (64 hex), key_prefix, label NULL, created_at, revoked_at NULL)`

## Files

### Create `apps/api/src/lib/api-key.ts`

Shared by the script and (in Task 2) the Worker. Must use **Web Crypto only** (`globalThis.crypto`), which exists in both Workers and Node 20+. No `node:crypto`, no `Buffer`.

```ts
export const API_KEY_PREFIX = 'pxl_';
export const API_KEY_RANDOM_BYTES = 32;          // → 64 hex chars
export const API_KEY_DISPLAY_LENGTH = 12;        // 'pxl_' + 8 hex chars
export const API_KEY_PATTERN = /^pxl_[0-9a-f]{64}$/;

/** New random key: 'pxl_' + 64 lowercase hex chars. */
export function generateApiKey(): string

/** Lowercase hex SHA-256 of the key's UTF-8 bytes (64 chars). */
export async function hashApiKey(key: string): Promise<string>

/** First API_KEY_DISPLAY_LENGTH chars, stored as api_keys.key_prefix. */
export function apiKeyPrefix(key: string): string

/** True if the string matches API_KEY_PATTERN. */
export function isWellFormedApiKey(key: string): boolean
```

Implementation notes:
- `generateApiKey`: `crypto.getRandomValues(new Uint8Array(API_KEY_RANDOM_BYTES))`, then hex-encode (each byte → 2 lowercase hex chars, zero-padded).
- `hashApiKey`: `crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))`, then hex-encode. (`TextEncoder` is fine here: this file runs only in the Worker and Node, never in React Native.)

### Create `apps/api/scripts/keys.ts`

A Node CLI run with `tsx`. It talks to D1 by running wrangler's `d1 execute` command as a child process.

#### Arguments

Parse `process.argv.slice(2)` by hand (no CLI library):

- First positional = command. Remaining positionals = command arguments.
- Flags: `--remote` (boolean), `--yes` (boolean), `--label <text>` (string).
- Unknown command, unknown flag, or wrong number of arguments → print usage (all commands, one line each, as in the design doc) to stderr and exit with code `1`.
- `help`, `--help` or no command → print usage to stdout, exit `0`.

#### Input validation (before any database call)

| Input | Rule |
|---|---|
| app id | `/^[a-z0-9-]{1,50}$/` |
| display name | 1–100 chars after trimming |
| label | 1–100 chars after trimming, optional |
| key id | positive integer |

Display name and label must not contain control characters (`/[\u0000-\u001f\u007f]/`). On failure print a clear message and exit `1`.

#### Running SQL

Write one helper, used for every query:

```ts
function runSql(sql: string, opts: { remote: boolean }): unknown[]  // returns the result rows
```

- Spawn wrangler with `spawnSync`, **no shell**: command is the wrangler binary from `apps/api/node_modules/.bin/` (`wrangler.cmd` on Windows), args `['d1', 'execute', 'pixie-logs', opts.remote ? '--remote' : '--local', '--json', '--command', sql]`, `cwd` = the `apps/api` directory (resolve it from the script's own location, not `process.cwd()`).
- On non-zero exit: print wrangler's stderr (and stdout if stderr is empty) and exit `1`.
- On success: parse stdout as JSON. Wrangler returns an array with one entry per statement, each with a `results` array. Return the `results` of the **last** entry.

Values are inserted into SQL strings, so write one escaping helper and use it for **every** string value:

```ts
function sqlString(value: string): string   // wraps in single quotes, doubles any single quote inside
```

Numbers (timestamps, key ids) are validated integers and inserted directly. Never interpolate an unvalidated value.

#### Confirmation for the live database

If `--remote` is set and the command changes data (`create-app`, `add-key`, `revoke-key`, `disable-app`, `enable-app`) and `--yes` is not set: print `About to change the LIVE database. Continue? (y/N) ` and read one line from stdin (`node:readline/promises`). Anything other than `y` / `yes` (case-insensitive) → print `Cancelled.` and exit `0`.

#### Commands

All timestamps are `Date.now()`.

**`create-app <id> <displayName> [--label]`**
1. `SELECT id FROM apps WHERE id = …` → if a row exists: `App "<id>" already exists.`, exit `1`.
2. Generate key, hash, prefix.
3. Run in **one** `runSql` call (two statements separated by `;`): insert into `apps (id, display_name, created_at)`, then into `api_keys (app_id, key_hash, key_prefix, label, created_at)`. Use `NULL` when there's no label.
4. Print the key block (below).

**`add-key <appId> [--label]`**
1. `SELECT id, disabled_at FROM apps WHERE id = …` → no row: `App "<id>" not found.`, exit `1`. If disabled, still allow it but print a warning line: `Note: this app is disabled; the key won't work until you run enable-app.`
2. Generate, hash, insert into `api_keys`. Print the key block.

**`revoke-key <keyId>`**
1. `SELECT id, app_id, key_prefix, revoked_at FROM api_keys WHERE id = …` → no row: `Key <id> not found.`, exit `1`. Already revoked: `Key <id> is already revoked.`, exit `0`.
2. `UPDATE api_keys SET revoked_at = <now> WHERE id = …`. Print `Revoked key <id> (<prefix>…) for app "<app_id>".`
3. If that app now has no active keys, also print: `Warning: "<app_id>" has no active keys left.`

**`disable-app <appId>` / `enable-app <appId>`**
- Not found → exit `1`. Already in the requested state → say so, exit `0`.
- Otherwise set `disabled_at` to `<now>` / `NULL` and print `Disabled "<id>".` / `Enabled "<id>".`

**`list`**
- One query joining apps and keys, ordered by app id then key id:
  ```sql
  SELECT a.id AS app_id, a.display_name, a.disabled_at,
         k.id AS key_id, k.key_prefix, k.label, k.created_at, k.revoked_at
  FROM apps a LEFT JOIN api_keys k ON k.app_id = a.id
  ORDER BY a.id, k.id;
  ```
- Print each app as a header line `<id> — <display name>` plus ` [disabled]` if disabled, then one indented line per key: `#<key id>  <prefix>…  <label or "-">  created <YYYY-MM-DD>` plus `  REVOKED <YYYY-MM-DD>` if revoked. An app with no keys shows `  (no keys)`.
- No apps: print `No apps yet.`
- Print `Database: local` or `Database: LIVE` as the first line.

#### Key block (printed by `create-app` and `add-key`)

```

  App:    <app id>
  Key id: <key id>
  Key:    pxl_<64 hex>

  Copy this key now. It is stored only as a hash and can't be shown again.

```

Get `<key id>` with a follow-up `SELECT id FROM api_keys WHERE key_hash = …`.

### Modify `apps/api/package.json`

Add dev dependencies with pnpm (don't hand-write versions):

```
pnpm --filter @pixie-logger/api add -D tsx vitest
```

Add to `scripts` (keep existing ones):

```json
"keys": "tsx scripts/keys.ts",
"test": "vitest run"
```

### Modify root `package.json`

Add to `scripts` (keep existing ones):

```json
"keys": "pnpm --filter @pixie-logger/api keys"
```

### Create `apps/api/test/api-key.test.ts`

1. `generateApiKey()` matches `API_KEY_PATTERN`; 100 generated keys are all different.
2. `hashApiKey('abc')` equals `'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'`.
3. `hashApiKey` of a generated key is 64 lowercase hex chars, and hashing the same key twice gives the same result.
4. `apiKeyPrefix('pxl_0123456789abcdef…')` returns `'pxl_01234567'`.
5. `isWellFormedApiKey`: true for a generated key; false for `''`, `'pxl_'`, an uppercase-hex key, a 63-char key, and a key with a different prefix.

If vitest can't resolve `crypto` globals in this package, stop and report rather than switching to `node:crypto`.

## Verification

Run from the repo root, local database only. Report the output of each step.

1. `pnpm test` — all tests pass (shared + api).
2. `pnpm typecheck` — no errors. If `apps/api` has no `typecheck` script, also run `pnpm --filter @pixie-logger/api exec tsc --noEmit` and report it.
3. `pnpm keys` → prints usage, exit 0. `pnpm keys nonsense` → usage on stderr, exit 1.
4. `pnpm keys create-app test-app "Test App" --label first` → prints a key block. Save the key and key id.
5. `pnpm keys create-app test-app "Again"` → `already exists`, exit 1.
6. `pnpm keys create-app "Bad App" "x"` → validation error, exit 1, no database call.
7. `pnpm keys create-app quote-test "Dina's App"` → succeeds (single quote handled); `list` shows the name correctly.
8. `pnpm keys add-key test-app --label second` → second key block with a different key.
9. Check the stored hash matches the printed key: run `pnpm --filter @pixie-logger/api exec wrangler d1 execute pixie-logs --local --command "SELECT key_hash FROM api_keys WHERE id = <first key id>"` and compare with `hashApiKey(<first key>)` (e.g. via a one-off `pnpm --filter @pixie-logger/api exec tsx -e "…"`). They must match.
10. `pnpm keys revoke-key <first key id>` → revoked. Run it again → `already revoked`, exit 0.
11. `pnpm keys revoke-key <second key id>` → revoked plus the `no active keys left` warning.
12. `pnpm keys disable-app test-app`, then again (→ already disabled), then `enable-app test-app`.
13. `pnpm keys list` → shows `Database: local`, both apps, their keys, revoked dates.
14. **Clean up:** `pnpm --filter @pixie-logger/api exec wrangler d1 execute pixie-logs --local --command "DELETE FROM apps WHERE id IN ('test-app','quote-test')"`, then `pnpm keys list` → `No apps yet.`
15. Do **not** test `--remote` or the confirmation prompt against the live database. Instead, confirm by reading the code that every data-changing command checks for `--remote` without `--yes` before calling `runSql`.

## Done when

- `apps/api/src/lib/api-key.ts`, `apps/api/scripts/keys.ts` and `apps/api/test/api-key.test.ts` exist as specified.
- The scripts are added to both `package.json` files.
- All verification steps pass on the local database, and the live database was not touched.
