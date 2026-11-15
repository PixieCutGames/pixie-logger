import { describe, expect, it } from 'vitest';
import {
	API_KEY_PATTERN,
	apiKeyPrefix,
	generateApiKey,
	hashApiKey,
	isWellFormedApiKey,
} from '../src/lib/api-key';

describe('generateApiKey', () => {
	it('matches API_KEY_PATTERN', () => {
		expect(generateApiKey()).toMatch(API_KEY_PATTERN);
	});

	it('generates 100 distinct keys', () => {
		const keys = new Set(Array.from({ length: 100 }, () => generateApiKey()));
		expect(keys.size).toBe(100);
	});
});

describe('hashApiKey', () => {
	it('matches the known SHA-256 of "abc"', async () => {
		expect(await hashApiKey('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
	});

	it('returns 64 lowercase hex chars and is deterministic', async () => {
		const key = generateApiKey();
		const first = await hashApiKey(key);
		expect(first).toMatch(/^[0-9a-f]{64}$/);
		expect(await hashApiKey(key)).toBe(first);
	});
});

describe('apiKeyPrefix', () => {
	it('returns the first 12 chars', () => {
		expect(apiKeyPrefix('pxl_0123456789abcdef' + '0'.repeat(48))).toBe('pxl_01234567');
	});
});

describe('isWellFormedApiKey', () => {
	it('accepts a generated key', () => {
		expect(isWellFormedApiKey(generateApiKey())).toBe(true);
	});

	it('rejects malformed keys', () => {
		const hex = generateApiKey().slice(4);
		expect(isWellFormedApiKey('')).toBe(false);
		expect(isWellFormedApiKey('pxl_')).toBe(false);
		expect(isWellFormedApiKey('pxl_' + 'A'.repeat(64))).toBe(false);
		expect(isWellFormedApiKey('pxl_' + hex.slice(1))).toBe(false); // 63 hex chars
		expect(isWellFormedApiKey('abc_' + hex)).toBe(false);
	});
});
