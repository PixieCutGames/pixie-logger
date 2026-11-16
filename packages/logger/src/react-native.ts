import type { Platform } from '@pixie-logger/shared';
import type { LifecycleAdapter, LifecycleHandlers, StorageAdapter } from './types';

export type { StorageAdapter, LifecycleAdapter } from './types';

/** Structural subset of `@react-native-async-storage/async-storage`. */
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
/** Structural subset of React Native's `AppState`. */
export interface AppStateLike {
  currentState?: string | null;
  addEventListener(type: 'change', listener: (state: string) => void): { remove(): void };
}
/** Structural subset of React Native's `Platform`. */
export interface PlatformLike { OS: string; }

/** Errors from `asyncStorage` are not caught: they surface as a rejected promise. */
export function rnStorage(asyncStorage: AsyncStorageLike): StorageAdapter {
  return {
    async getItem(key) {
      const value = await asyncStorage.getItem(key);
      return typeof value === 'string' ? value : null;
    },
    async setItem(key, value) {
      await asyncStorage.setItem(key, value);
    },
    async removeItem(key) {
      await asyncStorage.removeItem(key);
    },
  };
}

export function rnLifecycle(appState: AppStateLike): LifecycleAdapter {
  return {
    subscribe(handlers: LifecycleHandlers): () => void {
      try {
        // Any state other than 'background' / 'inactive' (e.g. 'unknown') counts as active.
        const isAway = (s: string | null | undefined) => s === 'background' || s === 'inactive';
        let previous: string = appState.currentState ?? 'active';
        const subscription = appState.addEventListener('change', (state) => {
          try {
            if (isAway(state) && !isAway(previous)) {
              handlers.onBackground();
            } else if (state === 'active' && isAway(previous)) {
              handlers.onForeground();
            }
          } catch {
            // ignore
          }
          previous = state;
        });
        return () => {
          try {
            subscription.remove();
          } catch {
            // ignore
          }
        };
      } catch {
        return () => {};
      }
    },
  };
}

/** `'ios'` / `'android'` pass through; anything else → `'web'`. */
export function rnPlatform(platform: PlatformLike): Platform {
  try {
    const os = platform.OS;
    return os === 'ios' || os === 'android' ? os : 'web';
  } catch {
    return 'web';
  }
}
