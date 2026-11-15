import { describe, it, expect } from 'vitest';
import { utf8ByteLength } from '../src/utf8';

describe('utf8ByteLength', () => {
  it.each([
    ['', 0],
    ['abc', 3],
    ['é', 2],
    ['€', 3],
    ['😀', 4],
    ['مصاري', 10],
  ])('%j → %i bytes', (input, expected) => {
    expect(utf8ByteLength(input)).toBe(expected);
  });
});
