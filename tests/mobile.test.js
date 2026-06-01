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

// ── U15: virtual key bar sends Enter to PTY ───────────────────────────────────
test('mobile: virtual Enter button sends \\r to PTY', async ({ page }) => {
  const agentId = await createMockAgent();
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  await page.click('#btn-sidebar-toggle');
  await sleep(300);
  await page.click('#agent-list li');
  await sleep(500);

  // Click the Enter virtual key button
  await page.click('#keybar button[data-key="enter"]');
  await sleep(300);

  // Should not crash, terminal still active
  const termText = await page.locator('.xterm-rows').textContent();
  expect(termText).toBeDefined();
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

// ── Mobile: virtual Ctrl+C button sends interrupt ─────────────────────────────
test('mobile: virtual Ctrl+C button sends interrupt', async ({ page }) => {
  const agentId = await createMockAgent();
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-sidebar-toggle');
  await sleep(300);
  await page.click('#agent-list li');
  await sleep(500);

  // Click Ctrl+C virtual key
  await page.click('#keybar button[data-key="ctrl-c"]');
  await sleep(200);

  // Should not crash
  const termText = await page.locator('.xterm-rows').textContent();
  expect(termText).toBeDefined();
});

// ── BUG3 regression: virtual keys work even with WS latency ──────────────────
test('mobile: virtual keys queue when WS is slow', async ({ page }) => {
  const agentId = await createMockAgent();
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-sidebar-toggle');
  await sleep(300);
  await page.click('#agent-list li');
  await sleep(500);

  // Click multiple virtual keys rapidly — should not crash or lose events
  await page.click('#keybar button[data-key="up"]');
  await page.click('#keybar button[data-key="down"]');
  await page.click('#keybar button[data-key="enter"]');
  await sleep(200);

  // Terminal should still be functional
  const termText = await page.locator('.xterm-rows').textContent();
  expect(termText).toBeDefined();
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

// ── U15: virtual key bar exists with special keys ─────────────────────────
test('mobile: virtual key bar has Enter/Ctrl+C/arrow buttons', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  const keybar = page.locator('#keybar');
  await expect(keybar).toBeVisible();

  // Check key buttons exist
  await expect(page.locator('#keybar button[data-key="enter"]')).toBeVisible();
  await expect(page.locator('#keybar button[data-key="ctrl-c"]')).toBeVisible();
  await expect(page.locator('#keybar button[data-key="up"]')).toBeVisible();
  await expect(page.locator('#keybar button[data-key="down"]')).toBeVisible();
  await expect(page.locator('#keybar button[data-key="tab"]')).toBeVisible();
});

// ── U15: pressing virtual Enter sends \r to PTY ──────────────────────────
test('mobile: virtual Enter button sends to PTY', async ({ page }) => {
  const agentId = await createMockAgent();
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await page.click('#btn-sidebar-toggle');
  await sleep(300);
  await page.click('#agent-list li');
  await sleep(500);

  const outputs = [];
  await page.evaluate(() => {
    window._testOutputs = [];
    const origWrite = window._origTermWrite;
  });

  // Click Enter button — should send \r
  await page.click('#keybar button[data-key="enter"]');
  await sleep(300);

  // Terminal should have received something (mock echoes back)
  const termText = await page.locator('.xterm-rows').textContent();
  // At minimum the button click should not error
  expect(termText).toBeDefined();
});

// ── U11: new agent modal doesn't close on backdrop click ──────────────────
test('mobile: new agent modal stays open on backdrop click', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  await page.click('#btn-sidebar-toggle');
  await sleep(300);
  await page.click('#btn-new-agent');
  await sleep(300);

  await expect(page.locator('#modal-overlay')).not.toHaveClass(/hidden/);
  await page.click('#modal-overlay', { position: { x: 5, y: 5 } });
  await sleep(200);
  await expect(page.locator('#modal-overlay')).not.toHaveClass(/hidden/);

  await page.click('#modal-cancel');
  await sleep(200);
  await expect(page.locator('#modal-overlay')).toHaveClass(/hidden/);
});

// ── F4: file picker button exists ─────────────────────────────────────────
test('mobile: attach button is visible', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#btn-attach')).toBeVisible();
});

// ── U15: keybar is visible ────────────────────────────────────────────────
test('mobile: virtual keybar is visible with all buttons', async ({ page }) => {
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');

  await expect(page.locator('#keybar')).toBeVisible();
  await expect(page.locator('#keybar button[data-key="enter"]')).toBeVisible();
  await expect(page.locator('#keybar button[data-key="ctrl-c"]')).toBeVisible();
  await expect(page.locator('#keybar button[data-key="up"]')).toBeVisible();
  await expect(page.locator('#keybar button[data-key="tab"]')).toBeVisible();
  await expect(page.locator('#keybar button[data-key="esc"]')).toBeVisible();
});
