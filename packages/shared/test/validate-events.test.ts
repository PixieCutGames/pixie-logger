import { describe, it, expect } from 'vitest';
import { validateEvents } from '../src/api';

const ev = (event: string) => ({ level: 'info', event, clientTs: '2026-11-15T12:30:00.000Z' });

describe('validateEvents', () => {
  it('accepts all valid events', () => {
    const { valid, rejected } = validateEvents([ev('a'), ev('b'), ev('c')]);
    expect(valid).toHaveLength(3);
    expect(rejected).toEqual([]);
  });

  it('splits a mixed batch, keeping order and indexes', () => {
    const { valid, rejected } = validateEvents([
      ev('first'),
      {},
      ev('second'),
      { level: 'nope', event: 'x', clientTs: '2026-11-15T12:30:00.000Z' },
    ]);
    expect(valid.map((e) => e.event)).toEqual(['first', 'second']);
    expect(rejected.map((r) => r.index)).toEqual([1, 3]);
    for (const r of rejected) {
      expect(r.errors.length).toBeGreaterThan(0);
      for (const msg of r.errors) {
        expect(typeof msg).toBe('string');
        expect(msg.length).toBeGreaterThan(0);
      }
    }
  });

  it('rejects all invalid events', () => {
    const { valid, rejected } = validateEvents([{}, { level: 'info' }]);
    expect(valid).toEqual([]);
    expect(rejected).toHaveLength(2);
  });

  it('rejects non-object items without throwing', () => {
    const { valid, rejected } = validateEvents([null, 42, 'str']);
    expect(valid).toEqual([]);
    expect(rejected.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it('strips unknown keys from valid items', () => {
    const { valid } = validateEvents([{ ...ev('a'), foo: 'bar' }]);
    expect(valid).toHaveLength(1);
    expect('foo' in valid[0]!).toBe(false);
  });
});
