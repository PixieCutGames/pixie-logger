import type { ErrorCode } from './constants';
import { formatZodIssues } from './format';
import { logEventSchema } from './schemas';
import type { LogEvent, LogLevel, Platform } from './types';

export interface RejectedEvent {
  index: number;      // position in the request's `events` array
  errors: string[];   // from formatZodIssues
}

export interface IngestResponse {         // POST /v1/logs → 202
  accepted: number;
  rejected: RejectedEvent[];
}

export interface ErrorResponse {          // any 4xx
  error: { code: ErrorCode; message: string };
}

export interface LogRecord {              // one item from GET /v1/logs
  id: string;
  app: string;
  level: LogLevel;
  event: string;
  message: string | null;
  route: string | null;
  params: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  appVersion: string;
  platform: Platform;
  sessionId: string;
  clientTs: string;    // ISO datetime
  receivedAt: string;  // ISO datetime, set by the server
}

export interface LogsPage {               // GET /v1/logs → 200
  items: LogRecord[];
  nextCursor: string | null;
}

/** Validates each event independently so one bad event doesn't reject the batch. Never throws. */
export function validateEvents(events: readonly unknown[]): {
  valid: LogEvent[];
  rejected: RejectedEvent[];
} {
  const valid: LogEvent[] = [];
  const rejected: RejectedEvent[] = [];
  events.forEach((item, index) => {
    const result = logEventSchema.safeParse(item);
    if (result.success) {
      valid.push(result.data);
    } else {
      rejected.push({ index, errors: formatZodIssues(result.error) });
    }
  });
  return { valid, rejected };
}

export function errorResponse(code: ErrorCode, message: string): ErrorResponse {
  return { error: { code, message } };
}
