import { describe, expect, it, vi } from 'vitest';
import {
  capacitorLifecycle,
  capacitorPlatform,
  capacitorStorage,
  type AppLike,
  type ListenerHandleLike,
  type PreferencesLike,
} from '../src/capacitor';

const flushPromises = () => new Promise((r) => setTimeout(r, 0));

describe('capacitorStorage', () => {
  it('maps to get / set / remove', async () => {
    const prefs: PreferencesLike = {
      get: vi.fn(async () => ({ value: 'v' })),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    };
    const s = capacitorStorage(prefs);
    expect(await s.getItem('k')).toBe('v');
    expect(prefs.get).toHaveBeenCalledWith({ key: 'k' });
    await s.setItem('k', 'v2');
    expect(prefs.set).toHaveBeenCalledWith({ key: 'k', value: 'v2' });
    await s.removeItem('k');
    expect(prefs.remove).toHaveBeenCalledWith({ key: 'k' });
  });

  it('errors reject', async () => {
    const prefs: PreferencesLike = {
      get: vi.fn(async () => {
        throw new Error('x');
      }),
      set: vi.fn(async () => {
        throw new Error('x');
      }),
      remove: vi.fn(() => {
        throw new Error('sync');
      }),
    };
    const s = capacitorStorage(prefs);
    await expect(s.getItem('k')).rejects.toThrow('x');
    await expect(s.setItem('k', 'v')).rejects.toThrow('x');
    await expect(s.removeItem('k')).rejects.toThrow('sync');
  });
});

function fakeApp(mode: 'promise' | 'direct', gate?: Promise<void>) {
  const listeners: Record<string, () => void> = {};
  const handles: Record<string, ListenerHandleLike & { remove: ReturnType<typeof vi.fn> }> = {};
  const app: AppLike = {
    addListener(event, cb) {
      listeners[event] = cb;
      const handle = { remove: vi.fn(async () => void delete listeners[event]) };
      handles[event] = handle;
      if (mode === 'direct') return handle;
      return (gate ?? Promise.resolve()).then(() => handle);
    },
  };
  return { app, listeners, handles };
}

describe('capacitorLifecycle', () => {
  for (const mode of ['promise', 'direct'] as const) {
    it(`pause → background, resume → foreground; unsubscribe removes both (${mode})`, async () => {
      const f = fakeApp(mode);
      const onBackground = vi.fn();
      const onForeground = vi.fn();
      const unsubscribe = capacitorLifecycle(f.app).subscribe({ onBackground, onForeground });
      await flushPromises();

      f.listeners.pause!();
      expect(onBackground).toHaveBeenCalledTimes(1);
      f.listeners.resume!();
      expect(onForeground).toHaveBeenCalledTimes(1);

      unsubscribe();
      await flushPromises();
      expect(f.handles.pause!.remove).toHaveBeenCalledTimes(1);
      expect(f.handles.resume!.remove).toHaveBeenCalledTimes(1);
    });
  }

  it('unsubscribe before the handles resolve still removes them', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const f = fakeApp('promise', gate);
    const unsubscribe = capacitorLifecycle(f.app).subscribe({ onBackground: vi.fn(), onForeground: vi.fn() });
    unsubscribe();
    expect(f.handles.pause!.remove).not.toHaveBeenCalled();

    open();
    await flushPromises();
    expect(f.handles.pause!.remove).toHaveBeenCalledTimes(1);
    expect(f.handles.resume!.remove).toHaveBeenCalledTimes(1);
  });

  it('ignores addListener and remove errors', async () => {
    const app: AppLike = {
      addListener: vi.fn(() => {
        throw new Error('x');
      }),
    };
    const unsubscribe = capacitorLifecycle(app).subscribe({ onBackground: vi.fn(), onForeground: vi.fn() });
    expect(() => unsubscribe()).not.toThrow();

    const rejecting: AppLike = { addListener: () => Promise.reject(new Error('x')) };
    const unsub2 = capacitorLifecycle(rejecting).subscribe({ onBackground: vi.fn(), onForeground: vi.fn() });
    await flushPromises();
    expect(() => unsub2()).not.toThrow();

    const badRemove: AppLike = {
      addListener: () => ({
        remove: () => Promise.reject(new Error('x')),
      }),
    };
    const unsub3 = capacitorLifecycle(badRemove).subscribe({ onBackground: vi.fn(), onForeground: vi.fn() });
    await flushPromises();
    expect(() => unsub3()).not.toThrow();
    await flushPromises();
  });
});

describe('capacitorPlatform', () => {
  it.each([
    ['ios', 'ios'],
    ['android', 'android'],
    ['web', 'web'],
    ['electron', 'web'],
  ])('%s → %s', (input, expected) => {
    expect(capacitorPlatform({ getPlatform: () => input })).toBe(expected);
  });

  it('throwing getPlatform → web', () => {
    expect(
      capacitorPlatform({
        getPlatform: () => {
          throw new Error('x');
        },
      }),
    ).toBe('web');
  });
});
