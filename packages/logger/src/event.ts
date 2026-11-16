import { EVENT_NAME_PATTERN, LIMITS, utf8ByteLength } from '@pixie-logger/shared';
import type { LogEvent, LogLevel } from '@pixie-logger/shared';
import { sanitizeRecord } from './sanitize';
import type { LogOptions } from './types';
import { isRecord, truncate } from './util';

export type BuildResult = { ok: true; event: LogEvent } | { ok: false; reason: string };

function tooBig(event: LogEvent): boolean {
  return utf8ByteLength(JSON.stringify(event)) > LIMITS.maxEventBytes;
}

export function buildEvent(
  level: LogLevel,
  name: string,
  options: LogOptions | undefined,
  nowMs: number,
  shouldRedact: (key: string) => boolean,
): BuildResult {
  if (
    typeof name !== 'string' ||
    name.length < 1 ||
    name.length > LIMITS.eventNameMax ||
    !EVENT_NAME_PATTERN.test(name)
  ) {
    return { ok: false, reason: `invalid event name "${String(name)}"` };
  }

  const opts: LogOptions = isRecord(options) ? options : {};
  const fields: Record<string, unknown> = { level, event: name };
  if (typeof opts.message === 'string') fields.message = truncate(opts.message, LIMITS.messageMax);
  if (typeof opts.route === 'string') fields.route = truncate(opts.route, LIMITS.routeMax);
  if (isRecord(opts.params)) fields.params = sanitizeRecord(opts.params, shouldRedact);
  if (isRecord(opts.context)) fields.context = sanitizeRecord(opts.context, shouldRedact);
  fields.clientTs = new Date(nowMs).toISOString();
  const event = fields as LogEvent;

  if (tooBig(event) && !shrink(event)) return { ok: false, reason: 'event too large' };
  return { ok: true, event };
}

/**
 * Makes an oversized event fit by dropping context and/or params, keeping context when
 * dropping params alone is enough. Returns false if it is still too big without both.
 */
function shrink(event: LogEvent): boolean {
  const context = event.context;
  delete event.context;
  if (!tooBig(event)) return true;

  delete event.params;
  if (context !== undefined) {
    event.context = context;
    if (!tooBig(event)) return true;
    delete event.context;
  }
  return !tooBig(event);
}
