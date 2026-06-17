import { defineConfig } from '@playwright/test';

const PORT = parseInt(process.env.PORT ?? '37890');

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/chat-smoke.test.js', '**/ui-smoke.test.js'],
  timeout: 60000,
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    // Use a separate test DB so tests don't pollute production data
    command: `PORT=${PORT} DB_PATH=./data/test.db ANTHROPIC_BASE_URL=http://127.0.0.1:4290/anthropic ANTHROPIC_AUTH_TOKEN=${process.env.ANTHROPIC_AUTH_TOKEN ?? ''} node server/index.js`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 25000,
  },
});
