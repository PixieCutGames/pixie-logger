import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@pixie-logger/logger': new URL('./src/index.ts', import.meta.url).pathname } },
});
