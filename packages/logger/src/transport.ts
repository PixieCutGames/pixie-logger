import type { Transport } from './types';

export function createFetchTransport(_opts: { endpoint: string; apiKey: string; fetch?: typeof fetch }): Transport {
  return { send: async () => ({ outcome: 'retry' }) };   // replaced in Task 2
}
