import { describe, it, expect } from 'vitest';
import { logEventSchema } from '../src/schemas';
import { formatZodIssues } from '../src/format';

const minimal = { level: 'info', event: 'order_viewed', clientTs: '2026-11-15T12:30:00.000Z' };
const ok = (v: unknown) => logEventSchema.safeParse(v).success;

describe('logEventSchema', () => {
  it('accepts a minimal event', () => {
    expect(ok(minimal)).toBe(true);
  });

  it('accepts a full event with nested params/context', () => {
    expect(
      ok({
        ...minimal,
        level: 'error',
        message: 'Timeout loading orders',
        route: '/orders/:id',
        params: { id: '123', filters: { tags: ['a', 'b'] } },
        context: { status: 504, url: '/api/orders', retry: { count: 2, ok: false, last: null } },
      }),
    ).toBe(true);
  });

  it('rejects missing required fields', () => {
    const { event: _e, ...noEvent } = minimal;
    const { clientTs: _c, ...noTs } = minimal;
    expect(ok(noEvent)).toBe(false);
    expect(ok(noTs)).toBe(false);
  });

  it('validates level', () => {
    expect(ok({ ...minimal, level: 'critical' })).toBe(false);
    expect(ok({ ...minimal, level: 'fatal' })).toBe(true);
  });

  it('enforces char limits', () => {
    expect(ok({ ...minimal, event: 'a'.repeat(101) })).toBe(false);
    expect(ok({ ...minimal, message: 'a'.repeat(1001) })).toBe(false);
    expect(ok({ ...minimal, route: 'a'.repeat(201) })).toBe(false);
  });

  it('enforces the event name pattern', () => {
    expect(ok({ ...minimal, event: 'api.failed:v2-x_y' })).toBe(true);
    expect(ok({ ...minimal, event: '9lives' })).toBe(true);
    expect(ok({ ...minimal, event: 'Order_Viewed' })).toBe(false);
    expect(ok({ ...minimal, event: '_x' })).toBe(false);
    expect(ok({ ...minimal, event: 'has space' })).toBe(false);
  });

  it('requires an ISO datetime with time zone for clientTs', () => {
    expect(ok({ ...minimal, clientTs: '2026-11-15' })).toBe(false);
    expect(ok({ ...minimal, clientTs: '2026-11-15T12:30:00.000Z' })).toBe(true);
    expect(ok({ ...minimal, clientTs: '2026-11-15T14:30:00+02:00' })).toBe(true);
  });

  it('rejects non-JSON context values', () => {
    expect(ok({ ...minimal, context: { fn: () => 1 } })).toBe(false);
    expect(ok({ ...minimal, context: { u: undefined } })).toBe(false);
  });

  it('rejects null for optional fields', () => {
    expect(ok({ ...minimal, message: null })).toBe(false);
    expect(ok({ ...minimal, route: null })).toBe(false);
    expect(ok({ ...minimal, params: null })).toBe(false);
    expect(ok({ ...minimal, context: null })).toBe(false);
  });

  it('rejects events larger than 8 KB', () => {
    const result = logEventSchema.safeParse({ ...minimal, context: { blob: 'x'.repeat(8200) } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatZodIssues(result.error)).toContain('(root): event exceeds 8192 bytes');
    }
  });

  it('strips unknown keys', () => {
    const result = logEventSchema.safeParse({ ...minimal, foo: 'bar' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('foo' in result.data).toBe(false);
    }
  });
});
