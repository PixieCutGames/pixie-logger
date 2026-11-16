import { describe, expect, it } from 'vitest';
import { isOriginAllowed, parseAllowedOrigins } from '../src/lib/cors';

describe('parseAllowedOrigins', () => {
	it('returns [] for undefined and empty string', () => {
		expect(parseAllowedOrigins(undefined)).toEqual([]);
		expect(parseAllowedOrigins('')).toEqual([]);
	});

	it('trims entries, drops empties and trailing slashes', () => {
		expect(parseAllowedOrigins(' https://a.com , capacitor://localhost ,, https://b.com/ ')).toEqual([
			'https://a.com',
			'capacitor://localhost',
			'https://b.com',
		]);
	});
});

describe('isOriginAllowed', () => {
	const allowed = ['https://a.com', 'capacitor://localhost'];

	it('allows exact matches (trailing slash normalised)', () => {
		expect(isOriginAllowed('https://a.com', allowed)).toBe(true);
		expect(isOriginAllowed('https://a.com/', allowed)).toBe(true);
		expect(isOriginAllowed('capacitor://localhost', allowed)).toBe(true);
	});

	it('rejects other origins, schemes, ports and subdomains', () => {
		expect(isOriginAllowed('https://evil.com', allowed)).toBe(false);
		expect(isOriginAllowed('http://a.com', allowed)).toBe(false);
		expect(isOriginAllowed('https://a.com:8443', allowed)).toBe(false);
		expect(isOriginAllowed('https://sub.a.com', allowed)).toBe(false);
	});

	it('rejects undefined, empty and "null"', () => {
		expect(isOriginAllowed(undefined, allowed)).toBe(false);
		expect(isOriginAllowed('', allowed)).toBe(false);
		expect(isOriginAllowed('null', allowed)).toBe(false);
	});
});
