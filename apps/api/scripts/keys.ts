// App & key management CLI. Run from the repo root: pnpm keys <command> [arguments] [--remote]
// Talks to D1 through `wrangler d1 execute`. Local database by default; --remote for the live one.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { apiKeyPrefix, generateApiKey, hashApiKey } from '../src/lib/api-key';

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = join(API_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler');
const DATABASE = 'pixie-logs';

const USAGE = `Usage: pnpm keys <command> [arguments] [--remote] [--yes]

  create-app <id> "<display name>" [--label "<text>"]   Create an app and its first key
  add-key <app-id> [--label "<text>"]                   Add another key to an app
  revoke-key <key-id>                                   Turn a key off
  disable-app <app-id>                                  Stop accepting logs from an app
  enable-app <app-id>                                   Undo disable-app
  list                                                  Show all apps and their keys

Flags:
  --remote   Use the live database (default: local)
  --yes      Skip the confirmation prompt for --remote changes
`;

/** Thrown to end the program with an exit code (lets stdout/stderr flush before exiting). */
class Exit extends Error {
	constructor(readonly code: number) {
		super(`exit ${code}`);
	}
}

function fail(message: string): never {
	console.error(message);
	throw new Exit(1);
}

function usageError(message?: string): never {
	if (message) console.error(message + '\n');
	process.stderr.write(USAGE);
	throw new Exit(1);
}

// ---------- arguments ----------

type Command = 'create-app' | 'add-key' | 'revoke-key' | 'disable-app' | 'enable-app' | 'list';

const ARG_COUNTS: Record<Command, number> = {
	'create-app': 2,
	'add-key': 1,
	'revoke-key': 1,
	'disable-app': 1,
	'enable-app': 1,
	list: 0,
};
const TAKES_LABEL: ReadonlySet<Command> = new Set(['create-app', 'add-key']);
const CHANGES_DATA: ReadonlySet<Command> = new Set(['create-app', 'add-key', 'revoke-key', 'disable-app', 'enable-app']);

interface ParsedArgs {
	command: Command;
	args: string[];
	remote: boolean;
	yes: boolean;
	label?: string;
}

function parseArgs(argv: string[]): ParsedArgs | 'help' {
	const positionals: string[] = [];
	let remote = false;
	let yes = false;
	let label: string | undefined;
	let help = false;

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--') continue; // separator some runners insert before forwarded args
		if (arg === '--remote') remote = true;
		else if (arg === '--yes') yes = true;
		else if (arg === '--help') help = true;
		else if (arg === '--label') {
			const value = argv[++i];
			if (value === undefined) usageError('--label needs a value.');
			label = value;
		} else if (arg.startsWith('--')) usageError(`Unknown flag: ${arg}`);
		else positionals.push(arg);
	}

	const [command, ...args] = positionals;
	if (help || command === undefined || command === 'help') return 'help';
	if (!(command in ARG_COUNTS)) usageError(`Unknown command: ${command}`);
	const cmd = command as Command;
	if (args.length !== ARG_COUNTS[cmd]) usageError(`Wrong number of arguments for ${cmd}.`);
	if (label !== undefined && !TAKES_LABEL.has(cmd)) usageError(`--label is not used by ${cmd}.`);
	return { command: cmd, args, remote, yes, label };
}

// ---------- validation ----------

const APP_ID_PATTERN = /^[a-z0-9-]{1,50}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function validateAppId(id: string): string {
	if (!APP_ID_PATTERN.test(id)) {
		fail(`Invalid app id "${id}": use 1–50 lowercase letters, digits or "-".`);
	}
	return id;
}

function validateText(value: string, what: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 1 || trimmed.length > 100) fail(`Invalid ${what}: must be 1–100 characters.`);
	if (CONTROL_CHARS.test(trimmed)) fail(`Invalid ${what}: must not contain control characters.`);
	return trimmed;
}

function validateKeyId(value: string): number {
	if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
		fail(`Invalid key id "${value}": must be a positive integer.`);
	}
	return Number(value);
}

// ---------- SQL ----------

/** Single-quoted SQL string literal; doubles any single quote inside. */
function sqlString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

/** Runs SQL with wrangler and returns the result rows of the last statement. */
function runSql(sql: string, opts: { remote: boolean }): unknown[] {
	const result = spawnSync(
		WRANGLER,
		['d1', 'execute', DATABASE, opts.remote ? '--remote' : '--local', '--json', '--command', sql],
		{ cwd: API_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
	);

	if (result.error) fail(`Could not run wrangler: ${result.error.message}`);
	if (result.status !== 0) {
		const stderr = result.stderr.trim();
		console.error('wrangler failed:');
		console.error(stderr !== '' ? stderr : result.stdout.trim());
		throw new Exit(1);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(result.stdout);
	} catch {
		fail(`Could not parse wrangler output:\n${result.stdout}`);
	}
	if (!Array.isArray(parsed) || parsed.length === 0) fail(`Unexpected wrangler output:\n${result.stdout}`);
	const last = parsed[parsed.length - 1] as { results?: unknown };
	return Array.isArray(last.results) ? last.results : [];
}

// ---------- output helpers ----------

function formatDate(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

function printKeyBlock(appId: string, keyId: number, key: string): void {
	console.log('');
	console.log(`  App:    ${appId}`);
	console.log(`  Key id: ${keyId}`);
	console.log(`  Key:    ${key}`);
	console.log('');
	console.log("  Copy this key now. It is stored only as a hash and can't be shown again.");
	console.log('');
}

async function confirmLive(): Promise<boolean> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = await rl.question('About to change the LIVE database. Continue? (y/N) ');
		return ['y', 'yes'].includes(answer.trim().toLowerCase());
	} finally {
		rl.close();
	}
}

// ---------- commands ----------

interface NewKey {
	key: string;
	hash: string;
	prefix: string;
}

async function newKey(): Promise<NewKey> {
	const key = generateApiKey();
	return { key, hash: await hashApiKey(key), prefix: apiKeyPrefix(key) };
}

function insertKeySql(appId: string, k: NewKey, label: string | undefined, now: number): string {
	return (
		'INSERT INTO api_keys (app_id, key_hash, key_prefix, label, created_at) VALUES (' +
		`${sqlString(appId)}, ${sqlString(k.hash)}, ${sqlString(k.prefix)}, ` +
		`${label === undefined ? 'NULL' : sqlString(label)}, ${now})`
	);
}

function keyIdForHash(hash: string, remote: boolean): number {
	const rows = runSql(`SELECT id FROM api_keys WHERE key_hash = ${sqlString(hash)}`, { remote }) as { id: number }[];
	if (rows.length !== 1) fail('Key was inserted but could not be read back.');
	return rows[0].id;
}

async function createApp(id: string, displayName: string, label: string | undefined, remote: boolean): Promise<void> {
	const existing = runSql(`SELECT id FROM apps WHERE id = ${sqlString(id)}`, { remote });
	if (existing.length > 0) fail(`App "${id}" already exists.`);

	const k = await newKey();
	const now = Date.now();
	runSql(
		`INSERT INTO apps (id, display_name, created_at) VALUES (${sqlString(id)}, ${sqlString(displayName)}, ${now}); ` +
			insertKeySql(id, k, label, now),
		{ remote },
	);
	printKeyBlock(id, keyIdForHash(k.hash, remote), k.key);
}

async function addKey(appId: string, label: string | undefined, remote: boolean): Promise<void> {
	const rows = runSql(`SELECT id, disabled_at FROM apps WHERE id = ${sqlString(appId)}`, { remote }) as {
		id: string;
		disabled_at: number | null;
	}[];
	if (rows.length === 0) fail(`App "${appId}" not found.`);
	if (rows[0].disabled_at !== null) {
		console.log("Note: this app is disabled; the key won't work until you run enable-app.");
	}

	const k = await newKey();
	runSql(insertKeySql(appId, k, label, Date.now()), { remote });
	printKeyBlock(appId, keyIdForHash(k.hash, remote), k.key);
}

function revokeKey(keyId: number, remote: boolean): void {
	const rows = runSql(`SELECT id, app_id, key_prefix, revoked_at FROM api_keys WHERE id = ${keyId}`, { remote }) as {
		id: number;
		app_id: string;
		key_prefix: string;
		revoked_at: number | null;
	}[];
	if (rows.length === 0) fail(`Key ${keyId} not found.`);
	const key = rows[0];
	if (key.revoked_at !== null) {
		console.log(`Key ${keyId} is already revoked.`);
		return;
	}

	runSql(`UPDATE api_keys SET revoked_at = ${Date.now()} WHERE id = ${keyId}`, { remote });
	console.log(`Revoked key ${keyId} (${key.key_prefix}…) for app "${key.app_id}".`);

	const active = runSql(
		`SELECT COUNT(*) AS n FROM api_keys WHERE app_id = ${sqlString(key.app_id)} AND revoked_at IS NULL`,
		{ remote },
	) as { n: number }[];
	if (active[0]?.n === 0) console.log(`Warning: "${key.app_id}" has no active keys left.`);
}

function setAppDisabled(appId: string, disable: boolean, remote: boolean): void {
	const rows = runSql(`SELECT id, disabled_at FROM apps WHERE id = ${sqlString(appId)}`, { remote }) as {
		id: string;
		disabled_at: number | null;
	}[];
	if (rows.length === 0) fail(`App "${appId}" not found.`);
	const isDisabled = rows[0].disabled_at !== null;
	if (isDisabled === disable) {
		console.log(`App "${appId}" is already ${disable ? 'disabled' : 'enabled'}.`);
		return;
	}

	runSql(`UPDATE apps SET disabled_at = ${disable ? Date.now() : 'NULL'} WHERE id = ${sqlString(appId)}`, { remote });
	console.log(disable ? `Disabled "${appId}".` : `Enabled "${appId}".`);
}

interface ListRow {
	app_id: string;
	display_name: string;
	disabled_at: number | null;
	key_id: number | null;
	key_prefix: string | null;
	label: string | null;
	created_at: number | null;
	revoked_at: number | null;
}

function list(remote: boolean): void {
	console.log(`Database: ${remote ? 'LIVE' : 'local'}`);
	const rows = runSql(
		`SELECT a.id AS app_id, a.display_name, a.disabled_at,
       k.id AS key_id, k.key_prefix, k.label, k.created_at, k.revoked_at
FROM apps a LEFT JOIN api_keys k ON k.app_id = a.id
ORDER BY a.id, k.id;`,
		{ remote },
	) as ListRow[];

	if (rows.length === 0) {
		console.log('No apps yet.');
		return;
	}

	let currentApp: string | undefined;
	for (const row of rows) {
		if (row.app_id !== currentApp) {
			currentApp = row.app_id;
			console.log('');
			console.log(`${row.app_id} — ${row.display_name}${row.disabled_at !== null ? ' [disabled]' : ''}`);
		}
		if (row.key_id === null) {
			console.log('  (no keys)');
			continue;
		}
		let line = `  #${row.key_id}  ${row.key_prefix}…  ${row.label ?? '-'}  created ${formatDate(row.created_at!)}`;
		if (row.revoked_at !== null) line += `  REVOKED ${formatDate(row.revoked_at)}`;
		console.log(line);
	}
}

// ---------- main ----------

async function main(argv: string[]): Promise<void> {
	const parsed = parseArgs(argv);
	if (parsed === 'help') {
		process.stdout.write(USAGE);
		return;
	}
	const { command, args, remote, yes } = parsed;

	// Validate every input before touching the database.
	let run: () => void | Promise<void>;
	switch (command) {
		case 'create-app': {
			const id = validateAppId(args[0]);
			const displayName = validateText(args[1], 'display name');
			const label = parsed.label === undefined ? undefined : validateText(parsed.label, 'label');
			run = () => createApp(id, displayName, label, remote);
			break;
		}
		case 'add-key': {
			const appId = validateAppId(args[0]);
			const label = parsed.label === undefined ? undefined : validateText(parsed.label, 'label');
			run = () => addKey(appId, label, remote);
			break;
		}
		case 'revoke-key': {
			const keyId = validateKeyId(args[0]);
			run = () => revokeKey(keyId, remote);
			break;
		}
		case 'disable-app':
		case 'enable-app': {
			const appId = validateAppId(args[0]);
			run = () => setAppDisabled(appId, command === 'disable-app', remote);
			break;
		}
		case 'list':
			run = () => list(remote);
			break;
	}

	// Live database changes need confirmation before any runSql call.
	if (remote && CHANGES_DATA.has(command) && !yes) {
		if (!(await confirmLive())) {
			console.log('Cancelled.');
			return;
		}
	}

	await run();
}

main(process.argv.slice(2)).catch((err: unknown) => {
	if (err instanceof Exit) {
		process.exitCode = err.code;
		return;
	}
	console.error(err);
	process.exitCode = 1;
});
