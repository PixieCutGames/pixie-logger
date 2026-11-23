import type { LogLevel, LogRecord, LogsPage, LogsQuery, Platform } from '@pixie-logger/shared';

/** URLSearchParams → the input shape logsQuerySchema expects: a string, or string[] when a key repeats. */
export function searchParamsToObject(params: URLSearchParams): Record<string, string | string[]> {
	const out: Record<string, string | string[]> = Object.create(null);
	for (const key of new Set(params.keys())) {
		const values = params.getAll(key);
		out[key] = values.length === 1 ? values[0] : values;
	}
	return { ...out };
}

/** Cursor = decimal log id. Returns null if not a positive safe integer written in canonical form. */
export function parseCursor(cursor: string): number | null {
	if (!/^[1-9][0-9]*$/.test(cursor)) return null;
	const n = Number(cursor);
	return Number.isSafeInteger(n) ? n : null;
}

export interface LogDbRow {
	id: number;
	app_id: string;
	level: string;
	event: string;
	message: string | null;
	route: string | null;
	params: string | null;
	context: string | null;
	app_version: string;
	platform: string;
	session_id: string;
	client_ts: number;
	received_at: number;
}

export const SELECT_LOG_COLUMNS: string =
	'id, app_id, level, event, message, route, params, context, app_version, platform, session_id, client_ts, received_at';

export function buildLogsQuery(
	q: LogsQuery,
	cursorId: number | null,
): { sql: string; params: (string | number)[] } {
	const conditions: string[] = [];
	const params: (string | number)[] = [];

	if (q.app !== undefined) {
		conditions.push('app_id = ?');
		params.push(q.app);
	}
	if (q.level !== undefined && q.level.length > 0) {
		conditions.push(`level IN (${q.level.map(() => '?').join(', ')})`);
		params.push(...q.level);
	}
	if (q.event !== undefined) {
		conditions.push('event = ?');
		params.push(q.event);
	}
	if (q.session !== undefined) {
		conditions.push('session_id = ?');
		params.push(q.session);
	}
	if (q.from !== undefined) {
		conditions.push('received_at >= ?');
		params.push(Date.parse(q.from));
	}
	if (q.to !== undefined) {
		conditions.push('received_at < ?');
		params.push(Date.parse(q.to));
	}
	if (cursorId !== null) {
		conditions.push('id < ?');
		params.push(cursorId);
	}

	params.push(q.limit + 1);

	const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
	return {
		sql: `SELECT ${SELECT_LOG_COLUMNS} FROM logs${where} ORDER BY id DESC LIMIT ?`,
		params,
	};
}

export function toLogRecord(row: LogDbRow): LogRecord {
	return {
		id: String(row.id),
		app: row.app_id,
		level: row.level as LogLevel,
		event: row.event,
		message: row.message,
		route: row.route,
		params: row.params === null ? null : (JSON.parse(row.params) as Record<string, unknown>),
		context: row.context === null ? null : (JSON.parse(row.context) as Record<string, unknown>),
		appVersion: row.app_version,
		platform: row.platform as Platform,
		sessionId: row.session_id,
		clientTs: new Date(row.client_ts).toISOString(),
		receivedAt: new Date(row.received_at).toISOString(),
	};
}

export function toLogsPage(rows: LogDbRow[], limit: number): LogsPage {
	if (rows.length > limit) {
		return {
			items: rows.slice(0, limit).map(toLogRecord),
			nextCursor: String(rows[limit - 1].id),
		};
	}
	return { items: rows.map(toLogRecord), nextCursor: null };
}
