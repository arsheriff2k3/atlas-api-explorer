import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Clerk and Convex keys come from .env.local, like `next dev`.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const PORT = Number(process.env.E2E_PORT || 3100);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: {timeout: 15_000},
  fullyParallel: false,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure'},
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
  webServer: {command: `pnpm exec next dev --port ${PORT}`, url: `http://localhost:${PORT}/sign-in`, reuseExistingServer: true, timeout: 120_000},
});
