import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';

function normalizeOrigin(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

/** Splits the comma-separated list, trims each entry, drops empty entries and trailing slashes. */
export function parseAllowedOrigins(value: string | undefined): string[] {
	if (!value) return [];
	return value
		.split(',')
		.map(normalizeOrigin)
		.filter((o) => o.length > 0);
}

/** Exact match after the same normalisation. 'null' and empty strings are never allowed. */
export function isOriginAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
	if (origin === undefined) return false;
	const normalized = normalizeOrigin(origin);
	if (normalized === '' || normalized === 'null') return false;
	return allowed.includes(normalized);
}

/** Hono middleware for /v1/logs. */
export function logsCors(): MiddlewareHandler<{ Bindings: CloudflareBindings }> {
	return cors({
		origin: (origin, c) =>
			isOriginAllowed(origin, parseAllowedOrigins(c.env.ALLOWED_ORIGINS)) ? origin : null,
		allowMethods: ['POST'],
		allowHeaders: ['Content-Type', 'X-Api-Key'],
		maxAge: 86400,
	});
}
