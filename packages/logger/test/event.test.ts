import { describe, it, expect } from 'vitest';
import { utf8ByteLength } from '@pixie-logger/shared';
import { buildEvent } from '../src/event';
import { makeKeyRedactor } from '../src/sanitize';

const NOW = 1_700_000_000_000;
const TS = new Date(NOW).toISOString();
const redact = makeKeyRedactor([]);

describe('buildEvent', () => {
  it('builds a minimal event with only level, event and clientTs', () => {
    const r = buildEvent('info', 'order_viewed', undefined, NOW, redact);
    expect(r).toEqual({ ok: true, event: { level: 'info', event: 'order_viewed', clientTs: TS } });
    if (r.ok) expect(Object.keys(r.event)).toEqual(['level', 'event', 'clientTs']);
  });

  it.each(['', 'OrderViewed', '_x', 'has space', 'a'.repeat(101)])('rejects name %j', (name) => {
    const r = buildEvent('info', name, undefined, NOW, redact);
    expect(r).toEqual({ ok: false, reason: `invalid event name "${name}"` });
  });

  it.each(['order_viewed', 'checkout.step:2', 'a'.repeat(100)])('accepts name %j', (name) => {
    expect(buildEvent('info', name, undefined, NOW, redact).ok).toBe(true);
  });

  it('truncates message and route, ignores non-strings', () => {
    const r = buildEvent('info', 'e', { message: 'm'.repeat(1500), route: 'r'.repeat(300) }, NOW, redact);
    expect(r.ok && r.event.message?.length).toBe(1000);
    expect(r.ok && r.event.route?.length).toBe(200);

    const r2 = buildEvent('info', 'e', { message: 42 as unknown as string, route: null as unknown as string }, NOW, redact);
    expect(r2.ok && Object.keys(r2.event)).toEqual(['level', 'event', 'clientTs']);
  });

  it('sanitises params and context, ignores non-objects', () => {
    const r = buildEvent('info', 'e', { params: { password: 'x', n: NaN }, context: { e: new Error('x') } }, NOW, redact);
    expect(r).toEqual({
      ok: true,
      event: {
        level: 'info',
        event: 'e',
        params: { password: '[REDACTED]', n: null },
        context: { e: { name: 'Error', message: 'x' } },
        clientTs: TS,
      },
    });
    const r2 = buildEvent('info', 'e', { params: [1] as unknown as Record<string, unknown>, context: null as unknown as Record<string, unknown> }, NOW, redact);
    expect(r2.ok && Object.keys(r2.event)).toEqual(['level', 'event', 'clientTs']);
  });

  it('does not split an emoji when truncating message', () => {
    const r = buildEvent('info', 'e', { message: 'a'.repeat(999) + '😀' }, NOW, redact);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.event.message).toHaveLength(999);
      expect(r.event.message).not.toMatch(/[\uD800-\uDFFF]/);
    }
  });

  describe('size limit', () => {
    it('keeps a small context when dropping oversized params is enough', () => {
      const r = buildEvent('info', 'e', { params: { big: 'x'.repeat(9000) }, context: { user: 'u1' } }, NOW, redact);
      expect(r).toEqual({ ok: true, event: { level: 'info', event: 'e', context: { user: 'u1' }, clientTs: TS } });
    });

    it('drops an oversized context but keeps params', () => {
      const r = buildEvent('info', 'e', { params: { id: '1' }, context: { big: 'x'.repeat(9000) } }, NOW, redact);
      expect(r).toEqual({ ok: true, event: { level: 'info', event: 'e', params: { id: '1' }, clientTs: TS } });
    });

    it('drops both when params are oversized too, and still accepts the event', () => {
      const r = buildEvent(
        'info', 'e',
        { message: 'hi', params: { big: 'x'.repeat(9000) }, context: { big: 'y'.repeat(9000) } },
        NOW, redact,
      );
      expect(r).toEqual({ ok: true, event: { level: 'info', event: 'e', message: 'hi', clientTs: TS } });
    });

    it('leaves an event just under 8 KB untouched', () => {
      const base = JSON.stringify({ level: 'info', event: 'e', params: { s: '' }, clientTs: TS }).length;
      const s = 'x'.repeat(8192 - base - 1);
      const r = buildEvent('info', 'e', { params: { s } }, NOW, redact);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(utf8ByteLength(JSON.stringify(r.event))).toBe(8191);
        expect(r.event.params).toEqual({ s });
      }
    });

    it('counts UTF-8 bytes, not characters', () => {
      const text = 'ع'.repeat(4500); // 4,500 chars, 9,000 bytes
      expect(text.length).toBeLessThan(8192);
      const r = buildEvent('info', 'e', { params: { id: '1' }, context: { text } }, NOW, redact);
      expect(r).toEqual({ ok: true, event: { level: 'info', event: 'e', params: { id: '1' }, clientTs: TS } });
    });
  });
});
