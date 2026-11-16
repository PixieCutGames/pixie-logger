import type { LogLevel, Platform, LogEvent, LogBatch } from '@pixie-logger/shared';

export interface LogOptions {
  message?: string;
  route?: string;
  params?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

/**
 * Methods may reject when the underlying storage fails; the logger catches every call.
 * Implementations must not throw synchronously.
 */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface LifecycleHandlers { onBackground(): void; onForeground(): void; }
export interface LifecycleAdapter {
  /** Starts listening; returns a function that stops listening. */
  subscribe(handlers: LifecycleHandlers): () => void;
}

export type SendResult =
  | { outcome: 'sent'; rejected: number }
  | { outcome: 'dropped'; status: number }
  | { outcome: 'unauthorized' }
  | { outcome: 'retry'; retryAfterMs?: number };

export interface Transport {
  send(batch: LogBatch, opts: { keepalive: boolean }): Promise<SendResult>;
}

export interface LoggerOptions {
  endpoint: string;
  apiKey: string;
  appVersion: string;
  platform: Platform;
  minLevel?: LogLevel;
  enabled?: boolean;
  flushIntervalMs?: number;
  batchSize?: number;
  maxQueueSize?: number;
  redactKeys?: string[];
  storage?: StorageAdapter;
  lifecycle?: LifecycleAdapter;
  debug?: boolean;
  fetch?: typeof fetch;
}

export interface Logger {
  debug(event: string, options?: LogOptions): void;
  info(event: string, options?: LogOptions): void;
  warn(event: string, options?: LogOptions): void;
  error(event: string, options?: LogOptions): void;
  fatal(event: string, options?: LogOptions): void;
  log(level: LogLevel, event: string, options?: LogOptions): void;
  flush(): Promise<void>;
  setEnabled(enabled: boolean): void;
  shutdown(): Promise<void>;
  readonly sessionId: string;
}

/** Internal: test seams. Not part of the documented API. */
export interface LoggerDeps {
  transport?: Transport;
  now?: () => number;
  random?: () => number;
}

export interface QueueItem { event: LogEvent; sessionId: string; appVersion: string; }
