import { defineConfig } from '@playwright/test';

const PORT = 37891;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/ui-smoke.test.js',
  timeout: 300000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    viewport: { width: 1280, height: 800 },
    video: 'retain-on-failure',
  },
  webServer: {
    command: `PORT=${PORT} DB_PATH=./data/smoke-test.db node server/index.js`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 25000,
  },
});
