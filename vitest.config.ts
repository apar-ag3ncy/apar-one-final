import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only` throws when imported from a client/jsdom context.
      // In tests we want to exercise server modules directly, so alias the
      // marker package to a no-op.
      'server-only': path.resolve(__dirname, './tests/__shims__/server-only.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'drizzle'],
  },
});
