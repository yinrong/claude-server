/**
 * UI Smoke Test — 模拟真实用户操作
 *
 * 步骤：
 * 1. 打开 UI，确认空白状态
 * 2. 创建 Master agent（claude-code）
 * 3. 创建 Worker agent（claude-code）
 * 4. 向 Master 发送消息，等待真实 claude 响应
 * 5. 用 Worker 发消息，确认多 Agent 独立
 * 6. 模拟图片粘贴（injecting clipboard）
 * 7. 测试 @dispatch 派发
 * 8. 打开记忆面板
 * 截图保存在 test-results/screenshots/
 */

import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 37891}`;
const SHOT_DIR = join(process.cwd(), 'test-results', 'screenshots');
mkdirSync(SHOT_DIR, { recursive: true });

let shotIdx = 0;
async function shot(page, name) {
  const path = join(SHOT_DIR, `${String(++shotIdx).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`📸 ${path}`);
}

// ── Helper: open New Agent modal and fill ────────────────────────────────────
async function createAgent(page, { name, type, cwd }) {
  await page.click('#btn-new-agent');
  await page.waitForSelector('#modal-overlay:not(.hidden)', { state: 'visible' });
  await page.fill('#modal-name', name);
  await page.selectOption('#modal-type', type);
  await page.fill('#modal-cwd', cwd ?? process.cwd());
  await page.selectOption('#modal-adapter', 'claude-code');
  await shot(page, `modal-${name}`);
  await page.click('#modal-confirm');
  await page.waitForFunction(() => document.getElementById('modal-overlay').classList.contains('hidden'), { timeout: 10000 });
  // Wait for agent to appear in sidebar
  await page.waitForFunction(
    (n) => [...document.querySelectorAll('#agent-list .agent-name')].some(el => el.textContent === n),
    name, { timeout: 5000 }
  );
  console.log(`✅ Agent 创建: ${name} (${type})`);
}

// ── Helper: send message and wait for done ────────────────────────────────────
async function sendMessage(page, text, timeoutMs = 60000) {
  await page.fill('#msg-input', text);
  await shot(page, 'before-send');
  await page.click('#btn-send');
  console.log(`📤 发送: "${text.slice(0, 50)}"`);
  // Wait until btn-send is re-enabled (means 'done' received)
  await page.waitForFunction(
    () => !document.getElementById('btn-send').disabled,
    { timeout: timeoutMs }
  );
}

// ── Main test ────────────────────────────────────────────────────────────────

test.describe('UI Smoke Test', () => {
  test.setTimeout(300000); // 5 min — real claude can be slow

  test('完整用户流程', async ({ page }) => {
    // ── 1. 打开 UI ─────────────────────────────────────────────────────────
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    await shot(page, 'initial');
    console.log('✅ UI 加载完成');

    // ── 2. 创建 Master agent ─────────────────────────────────────────────
    await createAgent(page, { name: 'Master', type: 'master', cwd: process.cwd() });
    await shot(page, 'after-create-master');

    // Master 应该自动被选中并连接
    await page.waitForFunction(
      () => document.getElementById('agent-label').textContent.includes('Master'),
      { timeout: 5000 }
    );
    // 等待连接绿点
    await page.waitForSelector('.status-dot.connected', { timeout: 8000 });
    await shot(page, 'master-connected');
    console.log('✅ Master 已连接');

    // ── 3. 创建 Worker agent ─────────────────────────────────────────────
    await createAgent(page, { name: 'Worker-1', type: 'worker', cwd: '/tmp' });
    // 切回 Master
    await page.click('#agent-list li:has(.agent-name:text("Master"))');
    await page.waitForSelector('.status-dot.connected', { timeout: 8000 });
    console.log('✅ Worker-1 已创建，切回 Master');

    // ── 4. 向 Master 发送消息 ────────────────────────────────────────────
    console.log('⏳ 等待 Master 真实 claude 响应...');
    await sendMessage(page, '你好！请用一句话介绍你自己。', 60000);

    // 验证有 assistant 气泡
    const bubbles = await page.$$('.msg-wrap.assistant .msg-bubble');
    expect(bubbles.length).toBeGreaterThan(0);
    const reply = await bubbles[0].textContent();
    console.log(`🤖 Master 回复: "${reply.slice(0, 100)}..."`);
    await shot(page, 'master-replied');

    // ── 5. 测试 Worker 独立对话 ──────────────────────────────────────────
    await page.click('#agent-list li:has(.agent-name:text("Worker-1"))');
    await page.waitForSelector('.status-dot.connected', { timeout: 8000 });
    await shot(page, 'worker-selected');

    console.log('⏳ 等待 Worker claude 响应...');
    await sendMessage(page, 'echo: WORKER_TEST_OK', 60000);

    const workerBubbles = await page.$$('.msg-wrap.assistant .msg-bubble');
    expect(workerBubbles.length).toBeGreaterThan(0);
    const workerReply = await workerBubbles[0].textContent();
    console.log(`🤖 Worker 回复: "${workerReply.slice(0, 100)}"`);
    await shot(page, 'worker-replied');

    // ── 6. 模拟图片上传（文件选择器） ────────────────────────────────────
    // 切回 Master
    await page.click('#agent-list li:has(.agent-name:text("Master"))');
    await page.waitForSelector('.status-dot.connected', { timeout: 8000 });

    // 用 setInputFiles 通过文件选择器上传图片（绕过 clipboard API 限制）
    const tinyRedPngBuf = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12P4z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    await page.setInputFiles('#file-input', {
      name: 'test-image.png',
      mimeType: 'image/png',
      buffer: tinyRedPngBuf,
    });

    await page.waitForSelector('#media-strip .media-thumb', { timeout: 5000 });
    await shot(page, 'image-via-filepicker');
    console.log('✅ 图片通过文件选择器附加');

    // 填文字 + 发送
    await page.fill('#msg-input', '请描述一下这张图片的颜色');
    console.log('⏳ 发送带图片的消息...');
    await page.click('#btn-send');
    await page.waitForFunction(() => !document.getElementById('btn-send').disabled, { timeout: 60000 });
    await shot(page, 'after-image-message');

    // ── 7. 测试 @dispatch 派发按钮 ──────────────────────────────────────
    // 找到 Master 的 assistant 气泡 → 点"派发给 Worker"
    const dispatchBtns = await page.$$('.msg-actions button');
    if (dispatchBtns.length > 0) {
      await dispatchBtns[0].click();
      await page.waitForSelector('#dispatch-overlay:not(.hidden)', { state: 'visible', timeout: 3000 });
      await shot(page, 'dispatch-modal-open');

      // 选 Worker-1，填任务内容
      const opts = await page.$$('#dispatch-target option');
      if (opts.length > 0) {
        await page.fill('#dispatch-text', 'DISPATCH_TEST: reply with OK');
        await shot(page, 'dispatch-filled');
        await page.click('#dispatch-confirm');
        await page.waitForFunction(() => document.getElementById('dispatch-overlay').classList.contains('hidden'), { timeout: 5000 });
        console.log('✅ 派发操作完成');
      } else {
        console.log('⚠️ 没有可用的 Worker target，跳过派发');
        await page.click('#dispatch-cancel');
      }
    }

    // ── 8. 打开记忆面板 ──────────────────────────────────────────────────
    await page.click('#btn-memory');
    await page.waitForSelector('#memory-panel:not(.hidden)', { state: 'visible', timeout: 3000 });
    await shot(page, 'memory-panel');
    const memContent = await page.textContent('#memory-content');
    console.log(`🧠 记忆面板内容: "${memContent.slice(0, 100).trim()}"`);
    await page.click('#btn-close-memory');

    await shot(page, 'final-state');
    console.log('\n✅ 全部 UI 流程验证完成');
    console.log(`📁 截图保存在: test-results/screenshots/`);
  });

  // ── 回归测试：多轮对话上下文 ─────────────────────────────────────────────
  // 原始 bug：stream-json 模式下 claude 对历史里每条 user 消息都响应，
  // adapter 只捕获第一个响应，导致所有问题的回答都一样。
  test('回归: 多轮对话答案随问题变化', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // 每次创建干净的 agent，避免历史污染
    const res = await fetch(`${BASE}/api/agents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `MultiTurnTest-${Date.now()}`, type: 'worker', adapterType: 'claude-code', config: { cwd: '/tmp' } }),
    });
    const agentId = (await res.json()).id;

    // 通过 API 直接发送多轮消息，不依赖 UI click 流程
    const WS_URL = `ws://localhost:4280/ws?agentId=${agentId}`;
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(WS_URL);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

    // Collect chunks per turn: each 'done' marks end of one assistant turn
    const turns = [];   // each element is the full text of one assistant reply
    let currentChunks = [];
    ws.on('message', d => {
      try {
        const m = JSON.parse(d);
        if (m.type === 'chunk') currentChunks.push(m.text);
        if (m.type === 'done') { turns.push(currentChunks.join('')); currentChunks = []; }
      } catch {}
    });

    // 消耗 history message
    await new Promise(r => setTimeout(r, 500));

    const sendAndWaitTurn = (text) => new Promise((resolve) => {
      const before = turns.length;
      ws.send(JSON.stringify({ type: 'msg', agentId, content: [{ type: 'text', text }] }));
      const poll = setInterval(() => {
        if (turns.length > before) { clearInterval(poll); resolve(); }
      }, 300);
    });

    // 第 1 轮：建立上下文
    await sendAndWaitTurn('请记住这个数字：42。只需回复"已记住42"。');
    // 第 2 轮：完全不同的问题
    await sendAndWaitTurn('现在告诉我：1+1等于几？只回复数字。');
    // 第 3 轮：检验上下文是否保持
    await sendAndWaitTurn('你之前让我记住的数字是多少？');

    ws.close();

    const [r1, r2, r3] = turns;
    console.log(`轮1回复: "${(r1 ?? '(无)').slice(0, 80)}"`);
    console.log(`轮2回复: "${(r2 ?? '(无)').slice(0, 80)}"`);
    console.log(`轮3回复: "${(r3 ?? '(无)').slice(0, 80)}"`);

    // 三轮都必须有回复
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(r3).toBeDefined();

    // 不同问题 → 不同答案（原始 bug：三轮全部相同）
    expect(r1).not.toBe(r2);
    expect(r1).not.toBe(r3);

    // 轮2：1+1=2
    expect(r2).toMatch(/2/);

    // 轮3：应记得 42（多轮上下文）
    expect(r3).toMatch(/42/);

    console.log('✅ 多轮对话回归测试通过');
  });
});
