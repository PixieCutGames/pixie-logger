import { describe, it, expect } from 'vitest';
import { CONTRACT_VERSION } from '../src/index';

describe('shared package', () => {
  it('exposes the contract version', () => {
    expect(CONTRACT_VERSION).toBe('v1');
  });
});
