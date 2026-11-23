import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { MiddlewareHandler } from 'hono';
import { errorResponse } from '@pixie-logger/shared';
import type { ErrorResponse } from '@pixie-logger/shared';

/** The settings this module reads. CloudflareBindings is assignable to it. */
export interface AccessEnv {
	ACCESS_TEAM_DOMAIN?: string;
	ACCESS_AUD?: string;
	ACCESS_DEV_BYPASS?: string;
}

export interface AccessIdentity {
	email: string | null; // null for non-email identities (e.g. service tokens)
}

export type JwksProvider = (teamDomain: string) => JWTVerifyGetKey;

/** Returns the team domain as a bare https origin, or null if it isn't one. */
export function normalizeTeamDomain(value: string | undefined): string | null {
	if (value === undefined) return null;
	const normalized = value.trim().replace(/\/+$/, '');
	if (normalized === '' || !normalized.startsWith('https://')) return null;
	// Checked on the string because URL reports a bare trailing '?' or '#' as empty.
	if (/[?#]/.test(normalized)) return null;
	try {
		return new URL(normalized).pathname === '/' ? normalized : null;
	} catch {
		return null;
	}
}

const jwksByTeamDomain = new Map<string, JWTVerifyGetKey>();

/** One key set per team domain, so keys are fetched once per Worker instance, not per request. */
export const remoteJwks: JwksProvider = (teamDomain) => {
	let jwks = jwksByTeamDomain.get(teamDomain);
	if (!jwks) {
		jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
		jwksByTeamDomain.set(teamDomain, jwks);
	}
	return jwks;
};

/** Fails closed: any missing setting, missing token or verification error returns null. */
export async function verifyAccessToken(
	token: string | undefined,
	env: AccessEnv,
	getJwks: JwksProvider = remoteJwks,
): Promise<AccessIdentity | null> {
	const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
	const aud = env.ACCESS_AUD?.trim();
	if (!teamDomain || !aud) {
		console.error('Access check: ACCESS_TEAM_DOMAIN or ACCESS_AUD is not set');
		return null;
	}

	const trimmedToken = token?.trim();
	if (!trimmedToken) return null;

	try {
		const { payload } = await jwtVerify(trimmedToken, getJwks(teamDomain), {
			issuer: teamDomain,
			audience: aud,
			algorithms: ['RS256'],
			clockTolerance: 30,
		});
		return { email: typeof payload.email === 'string' ? payload.email : null };
	} catch {
		// Deliberately not logged: the error message can contain token claims.
		return null;
	}
}

/** Local development only: needs the explicit setting and a localhost request. */
export function isDevBypass(requestUrl: string, env: AccessEnv): boolean {
	if (env.ACCESS_DEV_BYPASS?.trim() !== 'true') return false;
	try {
		const { hostname } = new URL(requestUrl);
		return hostname === 'localhost' || hostname === '127.0.0.1';
	} catch {
		return false;
	}
}

/** Hono middleware for /v1/admin/*. Reads only the header, never the CF_Authorization cookie. */
export function requireAccess(options?: {
	getJwks?: JwksProvider;
}): MiddlewareHandler<{ Bindings: CloudflareBindings }> {
	return async (c, next) => {
		if (isDevBypass(c.req.url, c.env)) {
			await next();
			return;
		}

		const identity = await verifyAccessToken(
			c.req.header('cf-access-jwt-assertion'),
			c.env,
			options?.getJwks,
		);
		if (identity === null) {
			return c.json<ErrorResponse>(
				errorResponse('unauthorized', 'Cloudflare Access sign-in required'),
				401,
				{ 'Cache-Control': 'no-store' },
			);
		}

		await next();
	};
}
