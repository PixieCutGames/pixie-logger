import { describe, it, expect } from 'vitest';
import { logBatchEnvelopeSchema } from '../src/schemas';

const event = { level: 'info', event: 'order_viewed', clientTs: '2026-11-15T12:30:00.000Z' };
const envelope = (events: unknown[], extra: Record<string, unknown> = {}) => ({
  appVersion: '1.4.2',
  platform: 'android',
  sessionId: 'b3f1c2e0-6a7d-4c1e-9f2a-1d2e3f4a5b6c',
  events,
  ...extra,
});
const ok = (v: unknown) => logBatchEnvelopeSchema.safeParse(v).success;

describe('logBatchEnvelopeSchema', () => {
  it('accepts 1 and 50 events', () => {
    expect(ok(envelope([event]))).toBe(true);
    expect(ok(envelope(Array(50).fill(event)))).toBe(true);
  });

  it('rejects 0 and 51 events', () => {
    expect(ok(envelope([]))).toBe(false);
    expect(ok(envelope(Array(51).fill(event)))).toBe(false);
  });

  it('rejects an unknown platform', () => {
    expect(ok(envelope([event], { platform: 'windows' }))).toBe(false);
  });

  it('validates sessionId', () => {
    const { sessionId: _s, ...noSession } = envelope([event]);
    expect(ok(noSession)).toBe(false);
    expect(ok(envelope([event], { sessionId: 'a'.repeat(65) }))).toBe(false);
  });

  it('does not validate individual events', () => {
    expect(ok(envelope([{}]))).toBe(true);
  });
});
