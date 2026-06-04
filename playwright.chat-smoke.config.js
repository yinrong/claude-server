import { defineConfig } from '@playwright/test';

const PORT = 37893;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/chat-smoke.test.js',
  timeout: 120000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
  },
  webServer: {
    command: `PORT=${PORT} DB_PATH=./data/chat-smoke.db node server/index.js`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 25000,
  },
});
