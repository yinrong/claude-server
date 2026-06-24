import { defineConfig } from '@playwright/test';

const PORT = 37892; // dedicated port for auth tests

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/auth.test.js'],
  timeout: 30000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: [
      `PORT=${PORT}`,
      `DB_PATH=./data/test-auth-${Date.now()}.db`,
      `ANTHROPIC_BASE_URL=http://127.0.0.1:4290/anthropic`,
      `ANTHROPIC_AUTH_TOKEN=sk-UFop8bGkZVJZUz1FVS9E5w20r1591Kj1d8i6i6AlI7VXkeic`,
      // AUTH_DISABLED not set → auth is ON
      `node server/index.js`,
    ].join(' '),
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 25000,
  },
});
