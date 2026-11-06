import { configDefaults, defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  esbuild: { jsx: 'automatic' },
  test: {
    setupFiles: ['./src/test/setup.ts'],
    environment: 'jsdom',
    restoreMocks: true,
    // Playwright specs in e2e/ run with `pnpm test:e2e`.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
