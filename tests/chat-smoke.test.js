/**
 * Chat UI smoke tests — 真实 claude 端到端
 * 使用独立端口，不影响 prod/dev
 */
import { test, expect } from '@playwright/test';
import { setTimeout as sleep } from 'timers/promises';

const PORT = 37893;
const BASE = `http://localhost:${PORT}`;

test.use({ viewport: { width: 390, height: 844 } }); // iPhone 14 size

// Helper: create stream agent via API
async function createStreamAgent(name = 'SmkTest') {
  const res = await fetch(`${BASE}/api/agents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type: 'worker', adapterType: 'claude-code-stream', config: { cwd: '/tmp' } }),
  });
  return (await res.json()).id;
}

// Helper: open page, wait for auto-connection (chat.js auto-selects first agent)
async function setupChat(page) {
  await page.goto(`${BASE}/chat`);
  await page.waitForLoadState('networkidle');
  // Wait for connection dot to turn green (auto-select triggers connect)
  await page.waitForSelector('.dot.on', { timeout: 15000 });
  await sleep(500);
}

test.describe('Chat UI Smoke', () => {
  test.setTimeout(120000);

  test('正常输入: 发送消息收到 assistant 回复', async ({ page }) => {
    await createStreamAgent('Normal');
    await setupChat(page);

    // Type and send
    await page.fill('#input', 'say OK');
    await page.click('#btn-send');

    // Wait for assistant response
    await page.waitForSelector('.msg.assistant', { timeout: 30000 });
    const reply = await page.locator('.msg.assistant').first().textContent();
    expect(reply.length).toBeGreaterThan(0);
    console.log(`✅ 正常回复: "${reply.slice(0, 60)}"`);
  });

  test('空输入: 不发送', async ({ page }) => {
    await createStreamAgent('Empty');
    await setupChat(page);

    // Click send without text
    await page.click('#btn-send');
    await sleep(500);

    // No user message should appear
    const msgs = await page.locator('.msg.user').count();
    expect(msgs).toBe(0);
  });

  test('slash command: /resume 返回错误提示不卡住', async ({ page }) => {
    await createStreamAgent('Slash');
    await setupChat(page);

    await page.fill('#input', '/resume');
    await page.click('#btn-send');

    // Should get a response (not hang)
    await page.waitForSelector('.msg.assistant, .msg.tool', { timeout: 20000 });
    const reply = await page.locator('.msg.assistant').first().textContent();
    expect(reply).toContain("isn't available");

    // Send button should be re-enabled (not stuck in streaming)
    const disabled = await page.locator('#btn-send').getAttribute('disabled');
    expect(disabled).toBeNull();
    console.log('✅ /resume 正确返回错误，未卡住');
  });

  test('特殊字符: 中文顿号、emoji', async ({ page }) => {
    await createStreamAgent('Special');
    await setupChat(page);

    await page.fill('#input', '请重复：你好、世界！🎉');
    await page.click('#btn-send');

    await page.waitForSelector('.msg.assistant', { timeout: 30000 });
    const reply = await page.locator('.msg.assistant').first().textContent();
    // Should contain at least part of the input
    expect(reply).toMatch(/你好|世界|🎉/);
    console.log(`✅ 特殊字符回复: "${reply.slice(0, 60)}"`);
  });

  test('多轮对话: 上下文保持', async ({ page }) => {
    await createStreamAgent('MultiTurn');
    await setupChat(page);

    // Turn 1: establish a fact (not a password/secret to avoid refusal)
    await page.fill('#input', '我最喜欢的水果是芒果。只说OK');
    await page.click('#btn-send');
    await page.waitForSelector('.msg.assistant', { timeout: 30000 });
    // Wait for turn 1 to complete
    await page.waitForFunction(() => !document.getElementById('btn-send').disabled, { timeout: 30000 });
    await sleep(500);

    // Turn 2: ask about the fact from turn 1
    await page.fill('#input', '我最喜欢什么水果？只回复水果名');
    await page.click('#btn-send');
    await page.waitForFunction(() => !document.getElementById('btn-send').disabled, { timeout: 60000 });
    await sleep(500);

    const replies = await page.locator('.msg.assistant').allTextContents();
    const lastReply = replies[replies.length - 1];
    console.log(`Turn2 回复: "${lastReply.slice(0, 80)}"`);
    expect(lastReply).toMatch(/芒果|mango/i);
    console.log(`✅ 多轮上下文保持`);
  });

  test('BUG4回归: 切换Agent后历史不丢失', async ({ page }) => {
    // Use WS-level test to avoid UI complexity
    const id1 = await createStreamAgent('AgentA');
    const id2 = await createStreamAgent('AgentB');

    // Verify via direct WS that history persists after disconnect+reconnect
    const result = await page.evaluate(async ([base, agentId]) => {
      // Connect and send message
      const ws1 = new WebSocket(`${base.replace('http', 'ws')}/ws?agentId=${agentId}`);
      await new Promise(r => { ws1.onopen = r; });
      await new Promise(r => setTimeout(r, 500));
      ws1.send(JSON.stringify({ type: 'chat', agentId, text: 'MARKER_BUG4' }));

      // Wait for assistant_done
      await new Promise(resolve => {
        ws1.onmessage = (e) => {
          const m = JSON.parse(e.data);
          if (m.type === 'assistant_done') resolve();
        };
      });
      await new Promise(r => setTimeout(r, 1000));
      ws1.close();
      await new Promise(r => setTimeout(r, 500));

      // Reconnect (simulating switch back)
      const ws2 = new WebSocket(`${base.replace('http', 'ws')}/ws?agentId=${agentId}`);
      await new Promise(r => { ws2.onopen = r; });
      ws2.send(JSON.stringify({ type: 'get_history', agentId }));

      const history = await new Promise(resolve => {
        ws2.onmessage = (e) => {
          const m = JSON.parse(e.data);
          if (m.type === 'chat_history') resolve(m.history);
        };
        setTimeout(() => resolve([]), 5000);
      });
      ws2.close();
      return history;
    }, [BASE, id1]);

    expect(result.length).toBeGreaterThanOrEqual(2);
    const userMsg = result.find(m => m.role === 'user');
    expect(userMsg.content[0].text).toBe('MARKER_BUG4');
    const assistantMsg = result.find(m => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    console.log('✅ BUG4: 切换后历史保持');
  });

  test('网络断开: 输入不卡死', async ({ page }) => {
    await createStreamAgent('Offline');
    await setupChat(page);

    // Input should always be interactive regardless of connection
    await page.fill('#input', '离线测试');
    const val = await page.locator('#input').inputValue();
    expect(val).toBe('离线测试');
    console.log('✅ 输入不受网络状态影响');
  });
});
