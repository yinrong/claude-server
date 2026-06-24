/**
 * BUG8-T1: Deployment smoke test — runs against any target server via BASE_URL.
 *
 * Usage:
 *   BASE_URL=http://localhost:4280 npx playwright test tests/deploy-smoke.test.js
 *   BASE_URL=http://111.229.143.69:4280 npx playwright test tests/deploy-smoke.test.js
 *
 * Catches environment problems (missing claude binary, wrong cwd permissions, etc.)
 * that only manifest on the actual deployment target — not the local test server.
 *
 * This test MUST be run after every deployment to prod/remote.
 * claude 逻辑路径：PTY 模式 spawn → waitingForInput (claude 进入就绪状态)
 */

import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';

const BASE = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 4280}`;
const WS_BASE = BASE.replace(/^http/, 'ws') + '/ws';

test.setTimeout(60000);

// ── BUG8-T1: Server health ────────────────────────────────────────────────────
test('BUG8-T1a: deployed server health check passes', async () => {
  const res = await fetch(`${BASE}/health`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
});

// ── BUG8-T1b: claude binary is available and PTY can start ───────────────────
// 这是捕获"部署后 claude 未安装"问题的关键测试
// claude 逻辑路径：ClaudeCodeAdapter._spawn() → pty.spawn(claudeBin) → waitingForInput
test('BUG8-T1b: claude-code PTY agent starts and reaches waitingForInput state', async () => {
  // Create agent
  const createRes = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'SmokeTest',
      type: 'worker',
      adapterType: 'claude-code',
      config: { cwd: '/tmp' },
    }),
  });
  expect(createRes.status, 'agent creation should succeed (200/201)').toBe(201);
  const agent = await createRes.json();

  // Connect WebSocket and wait for waitingForInput=true (claude binary found and started)
  const ws = new WebSocket(`${WS_BASE}?agentId=${agent.id}`);
  await new Promise((resolve, reject) => {
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS connect timeout')), 5000);
    ws.on('open', resolve);
  });

  let gotWaitingForInput = false;
  const result = await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      // Check if agent is errored (binary not found)
      fetch(`${BASE}/api/agents/${agent.id}`)
        .then(r => r.json())
        .then(info => {
          if (info.status === 'errored') {
            reject(new Error(
              `claude PTY entered errored state — claude binary likely not installed on ${BASE}. ` +
              `Install claude CLI on the server first.`
            ));
          } else {
            reject(new Error(`waitingForInput not received within 30s on ${BASE}`));
          }
        })
        .catch(() => reject(new Error('timeout + agent status check failed')));
    }, 30000);

    ws.on('message', (d) => {
      let msg;
      try { msg = JSON.parse(d.toString()); } catch { return; }
      if (msg.type === 'status' && msg.waitingForInput === true) {
        clearTimeout(t);
        gotWaitingForInput = true;
        resolve('ok');
      }
    });
  });

  ws.close();
  expect(result).toBe('ok');
  expect(gotWaitingForInput).toBe(true);

  // Cleanup
  await fetch(`${BASE}/api/agents/${agent.id}`, { method: 'DELETE' });
});
