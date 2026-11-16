import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogBatch } from '@pixie-logger/shared';
import { createLogger } from '../src/logger';
import { rnLifecycle, rnStorage, type AppStateLike, type AsyncStorageLike } from '../src/react-native';
import type { Transport } from '../src/types';

const STORAGE_KEY = 'pixie-logger:queue';

describe('logger + React Native adapters', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists on background and flushes with keepalive', async () => {
    const data = new Map<string, string>();
    const asyncStorage: AsyncStorageLike = {
      getItem: vi.fn(async (k: string) => data.get(k) ?? null),
      setItem: vi.fn(async (k: string, v: string) => void data.set(k, v)),
      removeItem: vi.fn(async (k: string) => void data.delete(k)),
    };

    let listener: ((s: string) => void) | undefined;
    const appState: AppStateLike = {
      currentState: 'active',
      addEventListener: (_type, l) => {
        listener = l;
        return { remove: vi.fn() };
      },
    };

    const calls: { batch: LogBatch; keepalive: boolean }[] = [];
    const transport: Transport = {
      send: async (batch, opts) => {
        calls.push({ batch: structuredClone(batch), keepalive: opts.keepalive });
        return { outcome: 'sent', rejected: 0 };
      },
    };

    const logger = createLogger(
      {
        endpoint: 'https://example.test/v1/logs',
        apiKey: 'pxl_test',
        appVersion: '1.0.0',
        platform: 'android',
        storage: rnStorage(asyncStorage),
        lifecycle: rnLifecycle(appState),
      },
      { transport },
    );

    logger.info('order_viewed');
    await vi.advanceTimersByTimeAsync(0);
    expect(asyncStorage.setItem).not.toHaveBeenCalled();

    listener!('background');
    await vi.advanceTimersByTimeAsync(0);

    expect(asyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.keepalive).toBe(true);
    expect(calls[0]!.batch.events.map((e) => e.event)).toEqual(['order_viewed']);

    await logger.shutdown();
  });
});
