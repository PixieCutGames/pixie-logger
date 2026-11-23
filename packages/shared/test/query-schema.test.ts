import { describe, it, expect } from 'vitest';
import { logsQuerySchema } from '../src/query';

const parse = (v: unknown) => logsQuerySchema.safeParse(v);

describe('logsQuerySchema', () => {
  it('defaults limit to 100', () => {
    const r = parse({});
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ limit: 100 });
  });

  it('turns a single level into an array', () => {
    expect(parse({ level: 'error' }).data?.level).toEqual(['error']);
  });

  it('removes duplicate levels', () => {
    expect(parse({ level: ['error', 'fatal', 'error'] }).data?.level).toEqual(['error', 'fatal']);
  });

  it('rejects an unknown level', () => {
    expect(parse({ level: 'critical' }).success).toBe(false);
  });

  it('coerces and bounds limit', () => {
    expect(parse({ limit: '250' }).data?.limit).toBe(250);
    for (const bad of ['0', '501', 'abc', '1.5']) {
      expect(parse({ limit: bad }).success).toBe(false);
    }
  });

  it('requires from to be before to', () => {
    const a = '2026-11-15T12:00:00.000Z';
    const b = '2026-11-15T13:00:00.000Z';
    expect(parse({ from: a, to: b }).success).toBe(true);
    for (const [from, to] of [[a, a], [b, a]]) {
      const r = parse({ from, to });
      expect(r.success).toBe(false);
      expect(r.error?.issues.some((i) => i.path.join('.') === 'to')).toBe(true);
    }
  });

  it('rejects a date-only from', () => {
    expect(parse({ from: '2026-11-15' }).success).toBe(false);
  });

  it('accepts a session', () => {
    expect(parse({ session: 'abc' }).data?.session).toBe('abc');
  });

  it('bounds session length', () => {
    expect(parse({ session: '' }).success).toBe(false);
    expect(parse({ session: 'x'.repeat(65) }).success).toBe(false);
    expect(parse({ session: 'x'.repeat(64) }).success).toBe(true);
  });

  it('strips unknown params', () => {
    const r = parse({ foo: 'bar' });
    expect(r.success).toBe(true);
    expect(r.data && 'foo' in r.data).toBe(false);
  });
});
