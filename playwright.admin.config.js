import { defineConfig } from '@playwright/test';

const PORT = 37893;

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/admin.test.js'],
  timeout: 30000,
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: [
      `PORT=${PORT}`,
      `DB_PATH=./data/test-admin-${Date.now()}.db`,
      `ANTHROPIC_BASE_URL=http://127.0.0.1:4290/anthropic`,
      `ANTHROPIC_AUTH_TOKEN=sk-UFop8bGkZVJZUz1FVS9E5w20r1591Kj1d8i6i6AlI7VXkeic`,
      `ADMIN_USERNAME=18519038770`,
      `ADMIN_PASSWORD=123456abC#`,
      `node server/index.js`,
    ].join(' '),
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 25000,
  },
});
