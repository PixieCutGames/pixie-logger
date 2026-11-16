// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webLifecycle, webStorage } from '../src/web';

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('webStorage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips via localStorage', async () => {
    const s = webStorage();
    expect(await s.getItem('k')).toBeNull();
    await s.setItem('k', 'v');
    expect(localStorage.getItem('k')).toBe('v');
    expect(await s.getItem('k')).toBe('v');
    await s.removeItem('k');
    expect(localStorage.getItem('k')).toBeNull();
    expect(await s.getItem('k')).toBeNull();
  });

  it('storage errors reject and never fall back to memory', async () => {
    let failing = true;
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => {
        if (failing) throw new Error('blocked');
        return data.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        if (failing) throw new Error('blocked');
        data.set(k, v);
      },
      removeItem: (k: string) => {
        if (failing) throw new Error('blocked');
        data.delete(k);
      },
    } as unknown as Storage;
    const s = webStorage(storage);
    await expect(s.setItem('k', 'v')).rejects.toThrow('blocked');
    await expect(s.getItem('k')).rejects.toThrow('blocked');
    await expect(s.removeItem('k')).rejects.toThrow('blocked');

    // The failed write was not kept in memory: a later read goes to the real storage.
    failing = false;
    expect(await s.getItem('k')).toBeNull();
  });

  describe('when reading localStorage throws', () => {
    let original: PropertyDescriptor | undefined;
    beforeEach(() => {
      original = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('SecurityError');
        },
        configurable: true,
      });
    });
    afterEach(() => {
      if (original) Object.defineProperty(window, 'localStorage', original);
      else delete (window as { localStorage?: Storage }).localStorage; // fall back to the prototype getter
    });

    it('round-trips through memory', async () => {
      const s = webStorage();
      expect(await s.getItem('k')).toBeNull();
      await s.setItem('k', 'v');
      expect(await s.getItem('k')).toBe('v');
      await s.removeItem('k');
      expect(await s.getItem('k')).toBeNull();
    });
  });
});

describe('webLifecycle', () => {
  afterEach(() => setVisibility('visible'));

  it('hidden → background once (pagehide ignored after it), visible → foreground', () => {
    const onBackground = vi.fn();
    const onForeground = vi.fn();
    const unsubscribe = webLifecycle().subscribe({ onBackground, onForeground });

    setVisibility('hidden');
    expect(onBackground).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(onBackground).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    expect(onForeground).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('hidden → background, pageshow → foreground, then pagehide → background again', () => {
    const onBackground = vi.fn();
    const onForeground = vi.fn();
    const unsubscribe = webLifecycle().subscribe({ onBackground, onForeground });

    setVisibility('hidden');
    expect(onBackground).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pageshow'));
    expect(onForeground).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('pagehide'));
    expect(onBackground).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('a throwing handler does not escape', () => {
    const unsubscribe = webLifecycle().subscribe({
      onBackground: () => {
        throw new Error('x');
      },
      onForeground: () => {},
    });
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
    unsubscribe();
  });

  it('unsubscribe removes all three listeners', () => {
    const onBackground = vi.fn();
    const onForeground = vi.fn();
    const unsubscribe = webLifecycle().subscribe({ onBackground, onForeground });
    unsubscribe();

    setVisibility('hidden');
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    setVisibility('visible');
    expect(onBackground).not.toHaveBeenCalled();
    expect(onForeground).not.toHaveBeenCalled();
  });
});
