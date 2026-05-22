import { defineConfig } from '@playwright/test';

const PORT = 37890;

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    // Use a separate test DB so tests don't pollute production data
    command: `PORT=${PORT} DB_PATH=./data/test.db node server/index.js`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 25000,
  },
});
