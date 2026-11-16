export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export const PLATFORMS = ['web', 'android', 'ios'] as const;

export const LIMITS = {
  maxEventsPerBatch: 50,
  maxEventBytes: 8 * 1024,      // 8 KB, JSON-serialized event
  maxBodyBytes: 512 * 1024,     // 512 KB, whole request body
  eventNameMax: 100,
  messageMax: 1000,
  routeMax: 200,
  appVersionMax: 50,
  sessionIdMax: 64,
  readDefaultLimit: 100,
  readMaxLimit: 500,
  appNameMax: 50,
  cursorMax: 500,
} as const;

export const ERROR_CODES = [
  'invalid_json',
  'invalid_envelope',
  'no_valid_events',
  'invalid_query',
  'unauthorized',
  'payload_too_large',
  'rate_limited',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
