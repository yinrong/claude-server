import { defineConfig } from '@playwright/test';

const PORT = parseInt(process.env.PORT ?? '37890');

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/chat-smoke.test.js', '**/ui-smoke.test.js', '**/auth.test.js'],
  timeout: 60000,
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    // Use a separate test DB so tests don't pollute production data
    command: `PORT=${PORT} DB_PATH=./data/test-${Date.now()}.db AUTH_DISABLED=true ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL ?? 'http://127.0.0.1:4290/anthropic'} ANTHROPIC_AUTH_TOKEN=${process.env.ANTHROPIC_AUTH_TOKEN ?? 'sk-UFop8bGkZVJZUz1FVS9E5w20r1591Kj1d8i6i6AlI7VXkeic'} ANTHROPIC_DEFAULT_SONNET_MODEL=${process.env.ANTHROPIC_DEFAULT_SONNET_MODEL ?? 'ppio/pa/claude-opus-4-6'} ANTHROPIC_DEFAULT_OPUS_MODEL=${process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? 'ppio/pa/claude-opus-4-6'} ANTHROPIC_DEFAULT_HAIKU_MODEL=${process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? 'ppio/pa/claude-opus-4-6'} node server/index.js`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 25000,
  },
});
