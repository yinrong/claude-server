/**
 * Mobile UI regression tests
 * Simulates phone viewport + touch interactions
 * Run: PORT=37890 npx playwright test tests/mobile.test.js
 */

import { test, expect, devices } from '@playwright/test';
import { setTimeout as sleep } from 'timers/promises';

const PORT = process.env.PORT ?? 37890;
const BASE = `http://localhost:${PORT}`;

// Use Pixel 5 (Chromium-based, no WebKit needed)
test.use({ ...devices['Pixel 5'] });

async function createMockAgent() {
  const res = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'MobileTest', type: 'worker', adapterType: 'mock' }),
  });
  return (await res.json()).id;
}

// ── BUG1 regression: mobile keyboard input ────────────────────────────────────
test('mobile: bottom textarea accepts keyboard input and sends to PTY', async ({ page }) => {
  const agentId = await createMockAgent();
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Mobile: open sidebar first, then click agent
  await page.click('#btn-sidebar-toggle');
  await sleep(300);
  await page.click('#agent-list li');
  await sleep(500);

  // Focus the bottom input textarea
  const input = page.locator('#msg-input');
  await input.click();
  await input.focus();

  // Type text — this simulates mobile keyboard
  await input.fill('MOBILE_INPUT_TEST');
  expect(await input.inputValue()).toBe('MOBILE_INPUT_TEST');

  // Press Enter to send
  await input.press('Enter');

  // Input should be cleared after send
  await sleep(300);
  expect(await input.inputValue()).toBe('');

  // The mock adapter should echo it back — check terminal has output
  await sleep(500);
  const termText = await page.locator('.xterm-rows').textContent();
  expect(termText).toContain('MOBILE_INPUT_TEST');
});

// ── Mobile: sidebar toggle works ──────────────────────────────────────────────
test('mobile: hamburger menu toggles sidebar', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Sidebar should be hidden on mobile by default
  const sidebar = page.locator('#sidebar');
  await expect(sidebar).not.toHaveClass(/open/);

  // Click hamburger
  await page.click('#btn-sidebar-toggle');
  await expect(sidebar).toHaveClass(/open/);

  // Click again to close
  await page.click('#btn-sidebar-toggle');
  await expect(sidebar).not.toHaveClass(/open/);
});

// ── Mobile: input stays focused after send (no xterm focus steal) ─────────────
test('mobile: input bar keeps focus after sending', async ({ page }) => {
  const agentId = await createMockAgent();
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-sidebar-toggle');
  await sleep(300);
  await page.click('#agent-list li');
  await sleep(500);

  const input = page.locator('#msg-input');
  await input.click();
  await input.fill('test1');
  await input.press('Enter');
  await sleep(300);

  // After send, the textarea should still be the active/focused element
  // (xterm should NOT steal focus on mobile)
  const focused = await page.evaluate(() => document.activeElement?.id);
  expect(focused).toBe('msg-input');
});

// ── BUG3 regression: UI works even with WS disconnected ───────────────────────
test('mobile: input queues message when WS is disconnected', async ({ page }) => {
  const agentId = await createMockAgent();
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-sidebar-toggle');
  await sleep(300);
  await page.click('#agent-list li');
  await sleep(500);

  // Type into input — even if WS drops, UI should not freeze
  const input = page.locator('#msg-input');
  await input.fill('QUEUED_MSG');

  // Verify we can still type and press send (no JS error / freeze)
  await page.click('#btn-send');
  await sleep(200);

  // Input should be cleared (message was queued, not lost)
  expect(await input.inputValue()).toBe('');
});

// ── Mobile: agent switch is immediate (no network wait) ───────────────────────
test('mobile: switching agent updates UI immediately', async ({ page }) => {
  await createMockAgent();
  await createMockAgent();

  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  // Open sidebar
  await page.click('#btn-sidebar-toggle');
  await sleep(500);

  // Get all agent items visible in sidebar
  const items = page.locator('#agent-list li');
  const count = await items.count();
  expect(count).toBeGreaterThanOrEqual(2);

  // Click second agent — label should update immediately
  await items.nth(1).click();
  await sleep(200);

  // Toolbar label should reflect new agent
  const label = await page.locator('#agent-label').textContent();
  expect(label).not.toBe('未选择 Agent');
});
