import { defineConfig } from '@playwright/test';

/**
 * E2E config for the OS desktop UI. Runs against a dev server (default
 * http://localhost:3000) — start it with the local Postgres `apar_run` DB
 * (which carries the same migrations as prod) before running `npm run e2e`.
 * Override the target with E2E_BASE_URL (e.g. a Vercel Preview URL).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
});
