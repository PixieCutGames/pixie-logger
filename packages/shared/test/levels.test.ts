import { describe, it, expect } from 'vitest';
import { levelAtLeast } from '../src/levels';

describe('levelAtLeast', () => {
  it('compares by severity', () => {
    expect(levelAtLeast('error', 'warn')).toBe(true);
    expect(levelAtLeast('info', 'warn')).toBe(false);
    expect(levelAtLeast('warn', 'warn')).toBe(true);
    expect(levelAtLeast('fatal', 'debug')).toBe(true);
    expect(levelAtLeast('debug', 'fatal')).toBe(false);
  });
});
