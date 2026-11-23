import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    web: 'src/web.ts',
    capacitor: 'src/capacitor.ts',
    'react-native': 'src/react-native.ts',
  },
  format: ['esm', 'cjs'],
  tsconfig: 'tsconfig.build.json',
  dts: { resolve: ['@pixie-logger/shared'] },
  clean: true,
  sourcemap: true,
  minify: false,
  treeshake: true,
  splitting: false,
  target: 'es2019',
  platform: 'neutral',
  noExternal: ['@pixie-logger/shared'],
});
