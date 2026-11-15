// API key format and hashing, shared by the key management script and the Worker.
// Web Crypto only (globalThis.crypto): works in Workers and Node 20+.

export const API_KEY_PREFIX = 'pxl_';
export const API_KEY_RANDOM_BYTES = 32; // → 64 hex chars
export const API_KEY_DISPLAY_LENGTH = 12; // 'pxl_' + 8 hex chars
export const API_KEY_PATTERN = /^pxl_[0-9a-f]{64}$/;

function toHex(bytes: Uint8Array): string {
	let hex = '';
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, '0');
	}
	return hex;
}

/** New random key: 'pxl_' + 64 lowercase hex chars. */
export function generateApiKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(API_KEY_RANDOM_BYTES));
	return API_KEY_PREFIX + toHex(bytes);
}

/** Lowercase hex SHA-256 of the key's UTF-8 bytes (64 chars). */
export async function hashApiKey(key: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
	return toHex(new Uint8Array(digest));
}

/** First API_KEY_DISPLAY_LENGTH chars, stored as api_keys.key_prefix. */
export function apiKeyPrefix(key: string): string {
	return key.slice(0, API_KEY_DISPLAY_LENGTH);
}

/** True if the string matches API_KEY_PATTERN. */
export function isWellFormedApiKey(key: string): boolean {
	return API_KEY_PATTERN.test(key);
}
