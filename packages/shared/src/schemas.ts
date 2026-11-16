import { z } from 'zod';
import { EVENT_NAME_PATTERN, LIMITS, LOG_LEVELS, PLATFORMS } from './constants';
import { utf8ByteLength } from './utf8';

export const logLevelSchema = z.enum(LOG_LEVELS);
export const platformSchema = z.enum(PLATFORMS);

export const logEventSchema = z
  .object({
    level: logLevelSchema,
    event: z.string().min(1).max(LIMITS.eventNameMax).regex(EVENT_NAME_PATTERN),
    message: z.string().max(LIMITS.messageMax).optional(),
    route: z.string().max(LIMITS.routeMax).optional(),
    params: z.record(z.string(), z.json()).optional(),
    context: z.record(z.string(), z.json()).optional(),
    clientTs: z.iso.datetime({ offset: true }),
  })
  .superRefine((value, ctx) => {
    if (utf8ByteLength(JSON.stringify(value)) > LIMITS.maxEventBytes) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message: `event exceeds ${LIMITS.maxEventBytes} bytes`,
      });
    }
  });

export const logBatchEnvelopeSchema = z.object({
  appVersion: z.string().min(1).max(LIMITS.appVersionMax),
  platform: platformSchema,
  sessionId: z.string().min(1).max(LIMITS.sessionIdMax),
  events: z.array(z.unknown()).min(1).max(LIMITS.maxEventsPerBatch),
});

export type LogLevel = z.infer<typeof logLevelSchema>;
export type Platform = z.infer<typeof platformSchema>;
export type LogEvent = z.infer<typeof logEventSchema>;
export type LogBatchEnvelope = z.infer<typeof logBatchEnvelopeSchema>;
/** What clients send. */
export type LogBatch = Omit<LogBatchEnvelope, 'events'> & { events: LogEvent[] };
