import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Clerk and Convex keys come from .env.local, like `next dev`.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const PORT = Number(process.env.E2E_PORT || 3100);
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: {timeout: 15_000},
  fullyParallel: false,
  workers: process.env.E2E_REQUIRE_AUTH === '1' ? 1 : undefined,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {baseURL, trace: 'retain-on-failure'},
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
  webServer: process.env.E2E_BASE_URL ? undefined : {command: `pnpm exec next dev --port ${PORT}`, url: `http://localhost:${PORT}/sign-in`, reuseExistingServer: true, timeout: 120_000},
});
