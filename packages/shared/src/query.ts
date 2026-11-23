import { z } from 'zod';
import { LIMITS } from './constants';
import { logLevelSchema } from './schemas';

export const logsQuerySchema = z
  .object({
    app: z.string().min(1).max(LIMITS.appNameMax).optional(),
    level: z
      .union([logLevelSchema, z.array(logLevelSchema)])
      .transform((v) => [...new Set(Array.isArray(v) ? v : [v])])
      .optional(),
    event: z.string().min(1).max(LIMITS.eventNameMax).optional(),
    session: z.string().min(1).max(LIMITS.sessionIdMax).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(LIMITS.readMaxLimit)
      .default(LIMITS.readDefaultLimit),
    cursor: z.string().min(1).max(LIMITS.cursorMax).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.from !== undefined && q.to !== undefined && !(Date.parse(q.from) < Date.parse(q.to))) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be after from' });
    }
  });

export type LogsQuery = z.output<typeof logsQuerySchema>;
