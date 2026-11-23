import { Hono } from 'hono';
import { errorResponse, formatZodIssues, logsQuerySchema } from '@pixie-logger/shared';
import type { AppsResponse, ErrorResponse, LogsPage } from '@pixie-logger/shared';
import {
	buildLogsQuery,
	parseCursor,
	searchParamsToObject,
	toLogsPage,
} from '../lib/log-query';
import type { LogDbRow } from '../lib/log-query';

export const admin = new Hono<{ Bindings: CloudflareBindings }>();

admin.use('*', async (c, next) => {
	await next();
	c.header('Cache-Control', 'no-store');
});

admin.get('/logs', async (c) => {
	const parsed = logsQuerySchema.safeParse(searchParamsToObject(new URL(c.req.url).searchParams));
	if (!parsed.success) {
		return c.json<ErrorResponse>(
			errorResponse('invalid_query', formatZodIssues(parsed.error).join('; ')),
			400,
		);
	}

	let cursorId: number | null = null;
	if (parsed.data.cursor !== undefined) {
		cursorId = parseCursor(parsed.data.cursor);
		if (cursorId === null) {
			return c.json<ErrorResponse>(errorResponse('invalid_query', 'cursor: invalid'), 400);
		}
	}

	const { sql, params } = buildLogsQuery(parsed.data, cursorId);
	const { results } = await c.env.DB.prepare(sql)
		.bind(...params)
		.all<LogDbRow>();

	return c.json<LogsPage>(toLogsPage(results, parsed.data.limit), 200);
});

admin.get('/apps', async (c) => {
	const { results } = await c.env.DB.prepare(
		'SELECT id, display_name, disabled_at FROM apps ORDER BY id',
	).all<{ id: string; display_name: string; disabled_at: number | null }>();

	return c.json<AppsResponse>(
		{
			items: results.map((r) => ({
				id: r.id,
				displayName: r.display_name,
				disabled: r.disabled_at !== null,
			})),
		},
		200,
	);
});
