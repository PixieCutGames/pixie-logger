export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type Platform = 'web' | 'android' | 'ios';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type LogEvent = {
  level: LogLevel;
  event: string;
  message?: string;
  route?: string;
  params?: Record<string, JsonValue>;
  context?: Record<string, JsonValue>;
  clientTs: string;
};

export type LogBatchEnvelope = {
  appVersion: string;
  platform: Platform;
  sessionId: string;
  events: unknown[];
};

/** What clients send. */
export type LogBatch = {
  appVersion: string;
  platform: Platform;
  sessionId: string;
  events: LogEvent[];
};
