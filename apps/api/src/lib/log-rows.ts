// Maps validated events to `logs` rows. Pure functions, no database access.
import type { LogBatchEnvelope, LogEvent } from '@pixie-logger/shared';

export interface LogRow {
	app_id: string;
	level: string;
	event: string;
	message: string | null;
	route: string | null;
	params: string | null; // JSON string
	context: string | null; // JSON string
	app_version: string;
	platform: string;
	session_id: string;
	client_ts: number; // ms
	received_at: number; // ms
}

export const LOG_COLUMNS: readonly (keyof LogRow)[] = [
	'app_id',
	'level',
	'event',
	'message',
	'route',
	'params',
	'context',
	'app_version',
	'platform',
	'session_id',
	'client_ts',
	'received_at',
];

export function toLogRow(
	appId: string,
	envelope: Pick<LogBatchEnvelope, 'appVersion' | 'platform' | 'sessionId'>,
	event: LogEvent,
	receivedAt: number,
): LogRow {
	return {
		app_id: appId,
		level: event.level,
		event: event.event,
		message: event.message ?? null,
		route: event.route ?? null,
		params: event.params !== undefined ? JSON.stringify(event.params) : null,
		context: event.context !== undefined ? JSON.stringify(event.context) : null,
		app_version: envelope.appVersion,
		platform: envelope.platform,
		session_id: envelope.sessionId,
		client_ts: Date.parse(event.clientTs),
		received_at: receivedAt,
	};
}

export const INSERT_LOG_SQL = `INSERT INTO logs (${LOG_COLUMNS.join(', ')}) VALUES (${LOG_COLUMNS.map(
	(_, i) => `?${i + 1}`,
).join(', ')})`;
