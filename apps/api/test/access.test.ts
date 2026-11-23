import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import {
	isDevBypass,
	normalizeTeamDomain,
	requireAccess,
	verifyAccessToken,
} from '../src/lib/access';

const TEAM = 'https://team.cloudflareaccess.com';
const AUD = 'test-aud';
const KID = 'test-key';
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };

let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let localJwks: JWTVerifyGetKey;

interface TokenOptions {
	claims?: Record<string, unknown>;
	issuer?: string;
	audience?: string;
	expiresAt?: string | number;
	key?: CryptoKey;
}

function signToken({
	claims = { email: 'me@example.com' },
	issuer = TEAM,
	audience = AUD,
	expiresAt = '5m',
	key = privateKey,
}: TokenOptions = {}): Promise<string> {
	return new SignJWT(claims)
		.setProtectedHeader({ alg: 'RS256', kid: KID })
		.setIssuer(issuer)
		.setAudience(audience)
		.setIssuedAt()
		.setExpirationTime(expiresAt)
		.sign(key);
}

const verify = (token: string | undefined, settings: typeof env = env) =>
	verifyAccessToken(token, settings, () => localJwks);

beforeAll(async () => {
	const pair = await generateKeyPair('RS256', { extractable: true });
	const other = await generateKeyPair('RS256', { extractable: true });
	privateKey = pair.privateKey;
	otherPrivateKey = other.privateKey;
	const jwk = await exportJWK(pair.publicKey);
	jwk.kid = KID;
	jwk.alg = 'RS256';
	localJwks = createLocalJWKSet({ keys: [jwk] });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('normalizeTeamDomain', () => {
	it('removes a trailing slash and surrounding whitespace', () => {
		expect(normalizeTeamDomain('https://team.cloudflareaccess.com/')).toBe(TEAM);
		expect(normalizeTeamDomain('  https://team.cloudflareaccess.com  ')).toBe(TEAM);
	});

	it.each([
		undefined,
		'',
		'team.cloudflareaccess.com',
		'http://team.cloudflareaccess.com',
		'https://team.cloudflareaccess.com/x',
		'https://team.cloudflareaccess.com?x=1',
		'https://team.cloudflareaccess.com#x',
	])('rejects %s', (value) => {
		expect(normalizeTeamDomain(value)).toBeNull();
	});
});

describe('verifyAccessToken', () => {
	it('accepts a valid token', async () => {
		await expect(verify(await signToken())).resolves.toEqual({ email: 'me@example.com' });
	});

	it('returns a null email when the claim is missing', async () => {
		await expect(verify(await signToken({ claims: {} }))).resolves.toEqual({ email: null });
	});

	it('rejects the wrong audience', async () => {
		await expect(verify(await signToken({ audience: 'other-aud' }))).resolves.toBeNull();
	});

	it('rejects the wrong issuer', async () => {
		await expect(
			verify(await signToken({ issuer: 'https://other.cloudflareaccess.com' })),
		).resolves.toBeNull();
	});

	it('rejects a token expired beyond the clock tolerance', async () => {
		const expiresAt = Math.floor(Date.now() / 1000) - 60;
		await expect(verify(await signToken({ expiresAt }))).resolves.toBeNull();
	});

	it('rejects a token signed by a different key pair', async () => {
		await expect(verify(await signToken({ key: otherPrivateKey }))).resolves.toBeNull();
	});

	it.each([undefined, '', 'not-a-jwt'])('rejects token %s', async (token) => {
		await expect(verify(token)).resolves.toBeNull();
	});

	it.each([
		['ACCESS_AUD', { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: '' }],
		['ACCESS_TEAM_DOMAIN', { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: AUD }],
	])('fails closed when %s is empty', async (_name, settings) => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(verify(await signToken(), settings)).resolves.toBeNull();
		expect(errorSpy).toHaveBeenCalled();
	});

	it('rejects an HS256 token', async () => {
		const token = await new SignJWT({ email: 'me@example.com' })
			.setProtectedHeader({ alg: 'HS256', kid: KID })
			.setIssuer(TEAM)
			.setAudience(AUD)
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(new Uint8Array(32).fill(7));
		await expect(verify(token)).resolves.toBeNull();
	});
});

describe('isDevBypass', () => {
	it('allows localhost and 127.0.0.1 with the setting', () => {
		const settings = { ACCESS_DEV_BYPASS: 'true' };
		expect(isDevBypass('http://localhost:8787/v1/admin/logs', settings)).toBe(true);
		expect(isDevBypass('http://127.0.0.1:8787/v1/admin/logs', settings)).toBe(true);
	});

	it('refuses other hosts even with the setting', () => {
		expect(
			isDevBypass('https://pixie-logger.x.workers.dev/v1/admin/logs', {
				ACCESS_DEV_BYPASS: 'true',
			}),
		).toBe(false);
	});

	it.each([undefined, '', '1', 'TRUE '])('refuses localhost with setting %s', (value) => {
		expect(isDevBypass('http://localhost:8787/v1/admin/logs', { ACCESS_DEV_BYPASS: value })).toBe(
			false,
		);
	});

	it('accepts the exact value after trimming', () => {
		expect(isDevBypass('http://localhost:8787/x', { ACCESS_DEV_BYPASS: ' true ' })).toBe(true);
	});

	it('returns false for an unparseable URL', () => {
		expect(isDevBypass('not a url', { ACCESS_DEV_BYPASS: 'true' })).toBe(false);
	});
});

describe('requireAccess', () => {
	function buildApp() {
		const app = new Hono<{ Bindings: CloudflareBindings }>();
		app.use('/v1/admin/*', requireAccess({ getJwks: () => localJwks }));
		app.get('/v1/admin/ping', (c) => c.json({ ok: true }));
		app.get('/v1/health', (c) => c.json({ ok: true }));
		return app;
	}

	const PING = 'https://example.workers.dev/v1/admin/ping';

	it('returns 401 without a token', async () => {
		const res = await buildApp().request(PING, {}, env);
		expect(res.status).toBe(401);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('unauthorized');
	});

	it('passes a valid token', async () => {
		const res = await buildApp().request(
			PING,
			{ headers: { 'Cf-Access-Jwt-Assertion': await signToken() } },
			env,
		);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true });
	});

	it('returns 401 for an invalid token', async () => {
		const res = await buildApp().request(
			PING,
			{ headers: { 'Cf-Access-Jwt-Assertion': 'not-a-jwt' } },
			env,
		);
		expect(res.status).toBe(401);
	});

	it('honours the bypass on localhost without a token', async () => {
		const res = await buildApp().request(
			'http://localhost/v1/admin/ping',
			{},
			{ ...env, ACCESS_DEV_BYPASS: 'true' },
		);
		expect(res.status).toBe(200);
	});

	it('ignores the bypass on a non-local host', async () => {
		const res = await buildApp().request(PING, {}, { ...env, ACCESS_DEV_BYPASS: 'true' });
		expect(res.status).toBe(401);
	});

	it('does not guard routes outside /v1/admin/*', async () => {
		const res = await buildApp().request('https://example.workers.dev/v1/health', {}, env);
		expect(res.status).toBe(200);
	});
});
