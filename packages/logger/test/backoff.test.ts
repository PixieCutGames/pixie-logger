import { describe, expect, it } from 'vitest';
import { createBackoff } from '../src/backoff';

describe('createBackoff', () => {
  it('doubles from 5 s up to 5 min (no jitter effect at random = 0.5)', () => {
    const b = createBackoff({ random: () => 0.5 });
    const delays = Array.from({ length: 8 }, () => b.next());
    expect(delays).toEqual([5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000]);
    expect(b.attempts).toBe(8);
  });

  it('applies ±20 % jitter', () => {
    expect(createBackoff({ random: () => 0 }).next()).toBe(4000);
    expect(createBackoff({ random: () => 1 }).next()).toBe(6000);
  });

  it('reset() starts again at 5 s', () => {
    const b = createBackoff({ random: () => 0.5 });
    b.next();
    b.next();
    b.next();
    b.reset();
    expect(b.attempts).toBe(0);
    expect(b.next()).toBe(5000);
  });
});
