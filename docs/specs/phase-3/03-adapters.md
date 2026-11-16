# Phase 3 — Task 3: Platform Adapters

Part of [Phase 3](README.md). Small pieces that connect the core to each platform's storage and app lifecycle.

## Entry points

| Import | For |
|---|---|
| `@pixie-logger/logger/web` | Browsers and PWAs |
| `@pixie-logger/logger/capacitor` | Ionic / Capacitor apps (Angular or React) |
| `@pixie-logger/logger/react-native` | React Native |

Each exports a **storage** adapter (to persist the queue) and a **lifecycle** adapter (to flush when the app goes to the background).

## The app passes in the platform module

The Capacitor and React Native adapters don't import Capacitor or React Native themselves. The app passes the module in:

```ts
// Ionic / Capacitor
import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { createLogger } from '@pixie-logger/logger';
import { capacitorStorage, capacitorLifecycle, capacitorPlatform } from '@pixie-logger/logger/capacitor';

export const logger = createLogger({
  endpoint, apiKey, appVersion,
  platform: capacitorPlatform(Capacitor),         // 'web' | 'android' | 'ios'
  storage: capacitorStorage(Preferences),
  lifecycle: capacitorLifecycle(App),
});
```

```ts
// React Native
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { rnStorage, rnLifecycle, rnPlatform } from '@pixie-logger/logger/react-native';

export const logger = createLogger({
  endpoint, apiKey, appVersion,
  platform: rnPlatform(Platform),
  storage: rnStorage(AsyncStorage),
  lifecycle: rnLifecycle(AppState),
});
```

```ts
// Web
import { webStorage, webLifecycle } from '@pixie-logger/logger/web';

export const logger = createLogger({
  endpoint, apiKey, appVersion, platform: 'web',
  storage: webStorage(),
  lifecycle: webLifecycle(),
});
```

**Why:** the logger then has no dependencies on Capacitor or React Native packages at all. An app's bundler never has to resolve a package the app doesn't use, and the app's own versions of those packages are always the ones used.

## Behaviour

| Platform | Storage | Background | Foreground |
|---|---|---|---|
| Web | `localStorage` (falls back to memory if blocked, e.g. private mode) | page hidden (`visibilitychange`) or `pagehide` | page visible again |
| Capacitor | `@capacitor/preferences` | `pause` | `resume` |
| React Native | AsyncStorage | `AppState` → `background` or `inactive` | `AppState` → `active` |

- On background: save the queue, then flush once (best effort).
- On foreground: flush.
- Storage key: `pixie-logger:queue`. Storage errors are ignored; the logger keeps working from memory.

## Out of scope

- Detecting platform for web builds of Capacitor apps beyond `Capacitor.getPlatform()`.
- Other platforms (Electron, Node servers).

## Done when

- All three entry points exist with storage, lifecycle and (Capacitor/RN) platform helpers, covered by unit tests with fake modules.
