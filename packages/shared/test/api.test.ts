import { describe, it, expect } from 'vitest';
import { errorResponse } from '../src/api';
import { ERROR_CODES } from '../src/constants';

describe('api helpers', () => {
  it('builds an error response', () => {
    expect(errorResponse('unauthorized', 'Missing API key')).toEqual({
      error: { code: 'unauthorized', message: 'Missing API key' },
    });
  });

  it('has exactly the 7 error codes', () => {
    expect([...ERROR_CODES].sort()).toEqual(
      [
        'invalid_json',
        'invalid_envelope',
        'no_valid_events',
        'invalid_query',
        'unauthorized',
        'payload_too_large',
        'rate_limited',
      ].sort(),
    );
  });
});
