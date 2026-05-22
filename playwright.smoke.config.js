import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/ui-smoke.test.js',
  timeout: 300000,
  use: {
    baseURL: 'http://localhost:4280',
    headless: false,              // 显示浏览器窗口
    viewport: { width: 1280, height: 800 },
    video: 'retain-on-failure',
  },
  // Server already running via PM2, don't start/stop it
});
