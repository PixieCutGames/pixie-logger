import { describe, expect, it, vi } from 'vitest';
import { rnLifecycle, rnPlatform, rnStorage, type AppStateLike, type AsyncStorageLike } from '../src/react-native';

describe('rnStorage', () => {
  it('passes through', async () => {
    const data = new Map<string, string>();
    const as: AsyncStorageLike = {
      getItem: vi.fn(async (k: string) => data.get(k) ?? null),
      setItem: vi.fn(async (k: string, v: string) => void data.set(k, v)),
      removeItem: vi.fn(async (k: string) => void data.delete(k)),
    };
    const s = rnStorage(as);
    await s.setItem('k', 'v');
    expect(as.setItem).toHaveBeenCalledWith('k', 'v');
    expect(await s.getItem('k')).toBe('v');
    await s.removeItem('k');
    expect(as.removeItem).toHaveBeenCalledWith('k');
    expect(await s.getItem('k')).toBeNull();
  });

  it('errors reject', async () => {
    const as: AsyncStorageLike = {
      getItem: vi.fn(async () => {
        throw new Error('x');
      }),
      setItem: vi.fn(async () => {
        throw new Error('x');
      }),
      removeItem: vi.fn(async () => {
        throw new Error('x');
      }),
    };
    const s = rnStorage(as);
    await expect(s.getItem('k')).rejects.toThrow('x');
    await expect(s.setItem('k', 'v')).rejects.toThrow('x');
    await expect(s.removeItem('k')).rejects.toThrow('x');
  });
});

function fakeAppState(currentState?: string | null) {
  let listener: ((s: string) => void) | undefined;
  const remove = vi.fn();
  const appState: AppStateLike = {
    currentState,
    addEventListener: (_type, l) => {
      listener = l;
      return { remove };
    },
  };
  return { appState, remove, emit: (s: string) => listener!(s) };
}

describe('rnLifecycle', () => {
  it('maps transitions and unsubscribes', () => {
    const f = fakeAppState('active');
    const onBackground = vi.fn();
    const onForeground = vi.fn();
    const unsubscribe = rnLifecycle(f.appState).subscribe({ onBackground, onForeground });

    f.emit('background'); // active → background: bg
    expect([onBackground.mock.calls.length, onForeground.mock.calls.length]).toEqual([1, 0]);
    f.emit('inactive'); // background → inactive: none
    expect([onBackground.mock.calls.length, onForeground.mock.calls.length]).toEqual([1, 0]);
    f.emit('active'); // inactive → active: fg
    expect([onBackground.mock.calls.length, onForeground.mock.calls.length]).toEqual([1, 1]);
    f.emit('inactive'); // active → inactive: bg
    expect([onBackground.mock.calls.length, onForeground.mock.calls.length]).toEqual([2, 1]);
    f.emit('active'); // inactive → active: fg
    expect([onBackground.mock.calls.length, onForeground.mock.calls.length]).toEqual([2, 2]);
    f.emit('active'); // active → active: none
    expect([onBackground.mock.calls.length, onForeground.mock.calls.length]).toEqual([2, 2]);

    unsubscribe();
    expect(f.remove).toHaveBeenCalledTimes(1);
  });

  it('missing currentState is treated as active', () => {
    const f = fakeAppState(null);
    const onBackground = vi.fn();
    rnLifecycle(f.appState).subscribe({ onBackground, onForeground: vi.fn() });
    f.emit('background');
    expect(onBackground).toHaveBeenCalledTimes(1);
  });

  it("'unknown' currentState counts as active", () => {
    const f = fakeAppState('unknown');
    const onBackground = vi.fn();
    const onForeground = vi.fn();
    rnLifecycle(f.appState).subscribe({ onBackground, onForeground });
    f.emit('background');
    expect(onBackground).toHaveBeenCalledTimes(1);
    expect(onForeground).not.toHaveBeenCalled();

    const g = fakeAppState('unknown');
    const onBackground2 = vi.fn();
    const onForeground2 = vi.fn();
    rnLifecycle(g.appState).subscribe({ onBackground: onBackground2, onForeground: onForeground2 });
    g.emit('active');
    expect(onBackground2).not.toHaveBeenCalled();
    expect(onForeground2).not.toHaveBeenCalled();
  });

  it('a throwing handler does not escape', () => {
    const f = fakeAppState('active');
    rnLifecycle(f.appState).subscribe({
      onBackground: () => {
        throw new Error('x');
      },
      onForeground: vi.fn(),
    });
    expect(() => f.emit('background')).not.toThrow();
  });
});

describe('rnPlatform', () => {
  it.each([
    ['ios', 'ios'],
    ['android', 'android'],
    ['windows', 'web'],
  ])('%s → %s', (input, expected) => {
    expect(rnPlatform({ OS: input })).toBe(expected);
  });
});
