import { describe, expect, it } from 'vitest';
import { logsQuerySchema } from '@pixie-logger/shared';
import {
	buildLogsQuery,
	parseCursor,
	searchParamsToObject,
	toLogRecord,
	toLogsPage,
} from '../src/lib/log-query';
import type { LogDbRow } from '../src/lib/log-query';

const countPlaceholders = (sql: string) => (sql.match(/\?/g) ?? []).length;

const row = (over: Partial<LogDbRow> = {}): LogDbRow => ({
	id: 1,
	app_id: 'maslary',
	level: 'error',
	event: 'api_failed',
	message: null,
	route: null,
	params: null,
	context: null,
	app_version: '1.0.0',
	platform: 'web',
	session_id: 's1',
	client_ts: 1794744000000,
	received_at: 1794744000000,
	...over,
});

describe('searchParamsToObject', () => {
	it('keeps single values as strings and repeated keys as arrays', () => {
		expect(
			searchParamsToObject(new URLSearchParams('?app=a&level=error&level=fatal&limit=5')),
		).toEqual({ app: 'a', level: ['error', 'fatal'], limit: '5' });
	});

	it('returns an empty object for empty params', () => {
		expect(searchParamsToObject(new URLSearchParams())).toEqual({});
	});
});

describe('parseCursor', () => {
	it.each([
		['1', 1],
		['42', 42],
		['9007199254740991', 9007199254740991],
	])('accepts %s', (input, expected) => {
		expect(parseCursor(input)).toBe(expected);
	});

	it.each(['', '0', '-1', '01', '1.5', '1e3', ' 1', 'abc', '9007199254740992'])(
		'rejects %j',
		(input) => {
			expect(parseCursor(input)).toBeNull();
		},
	);
});

describe('buildLogsQuery', () => {
	it('omits WHERE when there are no filters', () => {
		const { sql, params } = buildLogsQuery(logsQuerySchema.parse({}), null);
		expect(sql).not.toContain('WHERE');
		expect(sql.endsWith('ORDER BY id DESC LIMIT ?')).toBe(true);
		expect(params).toEqual([101]);
		expect(countPlaceholders(sql)).toBe(params.length);
	});

	it('orders all conditions and params as specified', () => {
		const from = '2026-11-15T12:00:00.000Z';
		const to = '2026-11-16T12:00:00.000Z';
		const q = logsQuerySchema.parse({
			app: 'maslary',
			level: ['error', 'fatal'],
			event: 'api_failed',
			session: 's1',
			from,
			to,
			limit: '50',
		});
		const { sql, params } = buildLogsQuery(q, 500);
		expect(sql).toContain(
			'WHERE app_id = ? AND level IN (?, ?) AND event = ? AND session_id = ? AND received_at >= ? AND received_at < ? AND id < ? ORDER BY',
		);
		expect(params).toEqual([
			'maslary',
			'error',
			'fatal',
			'api_failed',
			's1',
			Date.parse(from),
			Date.parse(to),
			500,
			51,
		]);
		expect(countPlaceholders(sql)).toBe(params.length);
	});

	it('uses one placeholder for one level', () => {
		const { sql, params } = buildLogsQuery(logsQuerySchema.parse({ level: 'error' }), null);
		expect(sql).toContain('level IN (?)');
		expect(params).toEqual(['error', 101]);
		expect(countPlaceholders(sql)).toBe(params.length);
	});

	it('never puts values in the SQL string', () => {
		const app = "x' OR 1=1 --";
		const { sql, params } = buildLogsQuery(logsQuerySchema.parse({ app }), null);
		expect(sql).not.toContain(app);
		expect(params).toContain(app);
	});
});

describe('toLogRecord', () => {
	it('keeps null optionals as null', () => {
		const r = toLogRecord(row());
		expect(r.message).toBeNull();
		expect(r.route).toBeNull();
		expect(r.params).toBeNull();
		expect(r.context).toBeNull();
	});

	it('parses JSON, formats times and stringifies the id', () => {
		const r = toLogRecord(row({ id: 7, params: '{"id":"1"}', context: '{"status":504}' }));
		expect(r.id).toBe('7');
		expect(r.params).toEqual({ id: '1' });
		expect(r.context).toEqual({ status: 504 });
		expect(r.clientTs).toBe('2026-11-15T12:00:00.000Z');
		expect(r.receivedAt).toBe('2026-11-15T12:00:00.000Z');
	});
});

describe('toLogsPage', () => {
	it('returns limit items and a cursor when there is an extra row', () => {
		const page = toLogsPage([row({ id: 3 }), row({ id: 2 }), row({ id: 1 })], 2);
		expect(page.items.map((i) => i.id)).toEqual(['3', '2']);
		expect(page.nextCursor).toBe('2');
	});

	it('returns a null cursor with limit or fewer rows', () => {
		expect(toLogsPage([row({ id: 2 }), row({ id: 1 })], 2).nextCursor).toBeNull();
		expect(toLogsPage([row({ id: 1 })], 2).nextCursor).toBeNull();
	});

	it('handles zero rows', () => {
		expect(toLogsPage([], 2)).toEqual({ items: [], nextCursor: null });
	});
});
