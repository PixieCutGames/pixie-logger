import type { Platform } from '@pixie-logger/shared';
import type { LifecycleAdapter, LifecycleHandlers, StorageAdapter } from './types';

export type { StorageAdapter, LifecycleAdapter } from './types';

/** Structural subset of `@capacitor/preferences`' `Preferences`. */
export interface PreferencesLike {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}
/** Structural subset of Capacitor's `PluginListenerHandle`. */
export interface ListenerHandleLike { remove(): Promise<void> | void; }
/** Structural subset of `@capacitor/app`'s `App`. */
export interface AppLike {
  addListener(event: 'pause' | 'resume', cb: () => void): Promise<ListenerHandleLike> | ListenerHandleLike;
}
/** Structural subset of `@capacitor/core`'s `Capacitor`. */
export interface CapacitorLike { getPlatform(): string; }

/** Errors from `preferences` are not caught: they surface as a rejected promise. */
export function capacitorStorage(preferences: PreferencesLike): StorageAdapter {
  return {
    async getItem(key) {
      const result = await preferences.get({ key });
      return typeof result?.value === 'string' ? result.value : null;
    },
    async setItem(key, value) {
      await preferences.set({ key, value });
    },
    async removeItem(key) {
      await preferences.remove({ key });
    },
  };
}

export function capacitorLifecycle(app: AppLike): LifecycleAdapter {
  return {
    subscribe(handlers: LifecycleHandlers): () => void {
      let unsubscribed = false;
      const handles: ListenerHandleLike[] = [];

      const removeHandle = (handle: ListenerHandleLike) => {
        try {
          void Promise.resolve(handle.remove()).catch(() => {});
        } catch {
          // ignore
        }
      };

      const add = (event: 'pause' | 'resume', cb: () => void) => {
        let pending: Promise<ListenerHandleLike>;
        try {
          pending = Promise.resolve(app.addListener(event, cb));
        } catch {
          return;
        }
        pending.then(
          (handle) => {
            if (!handle) return;
            if (unsubscribed) removeHandle(handle);
            else handles.push(handle);
          },
          () => {},
        );
      };

      add('pause', () => {
        try {
          handlers.onBackground();
        } catch {
          // ignore
        }
      });
      add('resume', () => {
        try {
          handlers.onForeground();
        } catch {
          // ignore
        }
      });

      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        for (const handle of handles.splice(0)) removeHandle(handle);
      };
    },
  };
}

/** `'ios'` / `'android'` pass through; anything else (including errors) → `'web'`. */
export function capacitorPlatform(capacitor: CapacitorLike): Platform {
  try {
    const p = capacitor.getPlatform();
    return p === 'ios' || p === 'android' ? p : 'web';
  } catch {
    return 'web';
  }
}
