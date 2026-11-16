import { describe, it, expect } from 'vitest';
import { isRecord, truncate } from '../src/util';

describe('isRecord', () => {
  it('is true only for plain objects', () => {
    expect(isRecord({})).toBe(true);
    for (const v of [null, [], 'x', 1]) expect(isRecord(v)).toBe(false);
  });
});

describe('truncate', () => {
  it('leaves short strings alone', () => {
    expect(truncate('ab', 5)).toBe('ab');
  });

  it('never leaves a lone high surrogate', () => {
    expect(truncate('a😀b', 2)).toBe('a');
    expect(truncate('a😀b', 3)).toBe('a😀');
  });
});
