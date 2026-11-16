import type { LifecycleAdapter, LifecycleHandlers, StorageAdapter } from './types';

export type { StorageAdapter, LifecycleAdapter } from './types';

/**
 * Storage backed by `localStorage` (or the given `Storage`). The backing storage is resolved
 * once, on first use; if none is available (missing, or reading it throws `SecurityError`),
 * an in-memory map is used for the lifetime of the adapter.
 * Errors from a real storage are not caught: they surface as a rejected promise.
 */
export function webStorage(storage?: Storage): StorageAdapter {
  const memory = new Map<string, string>();
  let backing: Storage | null | undefined; // undefined = not resolved yet

  function resolve(): Storage | null {
    if (backing !== undefined) return backing;
    if (storage) {
      backing = storage;
    } else {
      try {
        const ls = (globalThis as { localStorage?: Storage }).localStorage;
        // Some runtimes (e.g. Node 25 without --localstorage-file) expose a `localStorage`
        // object with no methods; treat that as unavailable.
        backing =
          typeof ls === 'object' &&
          ls !== null &&
          typeof ls.getItem === 'function' &&
          typeof ls.setItem === 'function' &&
          typeof ls.removeItem === 'function'
            ? ls
            : null;
      } catch {
        backing = null; // accessing localStorage can throw SecurityError
      }
    }
    return backing;
  }

  return {
    async getItem(key) {
      const s = resolve();
      if (s) return s.getItem(key);
      return memory.get(key) ?? null;
    },
    async setItem(key, value) {
      const s = resolve();
      if (s) {
        s.setItem(key, value);
        return;
      }
      memory.set(key, value);
    },
    async removeItem(key) {
      const s = resolve();
      if (s) {
        s.removeItem(key);
        return;
      }
      memory.delete(key);
    },
  };
}

/**
 * Lifecycle from `visibilitychange` (hidden → background, visible → foreground),
 * `pagehide` (→ background) and `pageshow` (→ foreground). Repeated signals of the same kind are ignored.
 */
export function webLifecycle(target?: { document: Document; window: Window }): LifecycleAdapter {
  return {
    subscribe(handlers: LifecycleHandlers): () => void {
      const noop = () => {};
      try {
        const doc = target ? target.document : typeof document !== 'undefined' ? document : undefined;
        const win = target ? target.window : typeof window !== 'undefined' ? window : undefined;
        if (!doc || !win) return noop;

        let last: 'background' | 'foreground' | null = null;

        const background = () => {
          if (last === 'background') return;
          last = 'background';
          try {
            handlers.onBackground();
          } catch {
            // ignore
          }
        };
        const foreground = () => {
          if (last === 'foreground') return;
          last = 'foreground';
          try {
            handlers.onForeground();
          } catch {
            // ignore
          }
        };

        const onVisibility = () => {
          try {
            if (doc.visibilityState === 'hidden') background();
            else if (doc.visibilityState === 'visible') foreground();
          } catch {
            // ignore
          }
        };
        const onPageHide = () => background();
        const onPageShow = () => foreground();

        doc.addEventListener('visibilitychange', onVisibility);
        win.addEventListener('pagehide', onPageHide);
        win.addEventListener('pageshow', onPageShow);

        return () => {
          try {
            doc.removeEventListener('visibilitychange', onVisibility);
          } catch {
            // ignore
          }
          try {
            win.removeEventListener('pagehide', onPageHide);
          } catch {
            // ignore
          }
          try {
            win.removeEventListener('pageshow', onPageShow);
          } catch {
            // ignore
          }
        };
      } catch {
        return noop;
      }
    },
  };
}
