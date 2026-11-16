import { describe, expect, it } from 'vitest';
import type { LogEvent } from '@pixie-logger/shared';
import { INSERT_LOG_SQL, LOG_COLUMNS, toLogRow } from '../src/lib/log-rows';

const envelope = { appVersion: '1.2.3', platform: 'android', sessionId: 'sess-1' } as const;
const receivedAt = 1_794_744_123_456;

describe('toLogRow', () => {
	it('maps a minimal event, with optional fields as null', () => {
		const event: LogEvent = { level: 'info', event: 'app.start', clientTs: '2026-11-15T12:00:00Z' };
		const row = toLogRow('maslary', envelope, event, receivedAt);
		expect(row).toEqual({
			app_id: 'maslary',
			level: 'info',
			event: 'app.start',
			message: null,
			route: null,
			params: null,
			context: null,
			app_version: '1.2.3',
			platform: 'android',
			session_id: 'sess-1',
			client_ts: Date.parse('2026-11-15T12:00:00Z'),
			received_at: receivedAt,
		});
	});

	it('serializes params and context as JSON strings', () => {
		const params = { id: '123', page: 2 };
		const context = { n: 1, nested: { ok: true, list: [1, 'a', null] } };
		const event: LogEvent = {
			level: 'error',
			event: 'api.fail',
			message: 'Request failed',
			route: '/orders/:id',
			params,
			context,
			clientTs: '2026-11-15T12:00:00Z',
		};
		const row = toLogRow('maslary', envelope, event, receivedAt);
		expect(row.message).toBe('Request failed');
		expect(row.route).toBe('/orders/:id');
		expect(typeof row.params).toBe('string');
		expect(typeof row.context).toBe('string');
		expect(JSON.parse(row.params!)).toEqual(params);
		expect(JSON.parse(row.context!)).toEqual(context);
	});

	it('converts clientTs with an offset to UTC ms', () => {
		const event: LogEvent = { level: 'info', event: 'x', clientTs: '2026-11-15T14:30:00+02:00' };
		const row = toLogRow('maslary', envelope, event, receivedAt);
		expect(row.client_ts).toBe(Date.parse('2026-11-15T12:30:00Z'));
	});
});

describe('INSERT_LOG_SQL', () => {
	it('lists all 12 columns with placeholders ?1 … ?12', () => {
		expect(LOG_COLUMNS).toHaveLength(12);
		for (const col of LOG_COLUMNS) {
			expect(INSERT_LOG_SQL).toContain(col);
		}
		for (let i = 1; i <= 12; i++) {
			expect(INSERT_LOG_SQL).toMatch(new RegExp(`\\?${i}(?!\\d)`));
		}
		expect(INSERT_LOG_SQL).not.toContain('?13');
	});
});
