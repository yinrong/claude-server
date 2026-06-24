/**
 * Playwright config for deploy smoke test.
 * Requires a RUNNING server at BASE_URL — does not start one.
 * Usage: BASE_URL=http://host:port npx playwright test --config=playwright.deploy-smoke.config.js
 */
import { defineConfig } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'http://localhost:4280';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/deploy-smoke.test.js'],
  timeout: 60000,
  use: { baseURL: BASE },
  // No webServer — target must already be running
});
