import { Hono } from 'hono';
import {
	LIMITS,
	errorResponse,
	formatZodIssues,
	logBatchEnvelopeSchema,
	utf8ByteLength,
	validateEvents,
} from '@pixie-logger/shared';
import type { ErrorResponse, IngestResponse } from '@pixie-logger/shared';
import { findAppIdForKey } from '../lib/auth';
import { INSERT_LOG_SQL, LOG_COLUMNS, toLogRow } from '../lib/log-rows';

export const ingest = new Hono<{ Bindings: CloudflareBindings }>();

const tooLarge = (): ErrorResponse =>
	errorResponse('payload_too_large', `Body exceeds ${LIMITS.maxBodyBytes} bytes`);

ingest.post('/', async (c) => {
	// 1. Auth
	const appId = await findAppIdForKey(c.env.DB, c.req.header('x-api-key'));
	if (appId === null) {
		return c.json<ErrorResponse>(errorResponse('unauthorized', 'Invalid or missing API key'), 401);
	}

	// 2. Size, from header (before reading the body)
	const contentLength = c.req.header('content-length');
	if (contentLength !== undefined && /^\d+$/.test(contentLength.trim())) {
		if (Number(contentLength.trim()) > LIMITS.maxBodyBytes) {
			return c.json<ErrorResponse>(tooLarge(), 413);
		}
	}

	// 3. Read body and measure it
	const text = await c.req.text();
	if (utf8ByteLength(text) > LIMITS.maxBodyBytes) {
		return c.json<ErrorResponse>(tooLarge(), 413);
	}

	// 4. Parse
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return c.json<ErrorResponse>(errorResponse('invalid_json', 'Body is not valid JSON'), 400);
	}

	// 5. Envelope
	const result = logBatchEnvelopeSchema.safeParse(json);
	if (!result.success) {
		return c.json<ErrorResponse>(
			errorResponse('invalid_envelope', formatZodIssues(result.error).join('; ')),
			400,
		);
	}
	const envelope = result.data;

	// 6. Events
	const { valid, rejected } = validateEvents(envelope.events);
	if (valid.length === 0) {
		return c.json<ErrorResponse>(
			errorResponse(
				'no_valid_events',
				`All ${rejected.length} events are invalid. First error: ${rejected[0]?.errors[0] ?? 'unknown'}`,
			),
			400,
		);
	}

	// 7. Insert: one batch (single transaction). Errors go to the app-level onError → 500.
	const receivedAt = Date.now();
	const stmt = c.env.DB.prepare(INSERT_LOG_SQL);
	await c.env.DB.batch(
		valid.map((e) => {
			const row = toLogRow(appId, envelope, e, receivedAt);
			return stmt.bind(...LOG_COLUMNS.map((k) => row[k]));
		}),
	);

	// 8. Respond
	return c.json<IngestResponse>({ accepted: valid.length, rejected }, 202);
});
