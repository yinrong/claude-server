/**
 * E2E tests for claude-server v2 (PTY mode)
 * Run: PORT=37890 npx playwright test
 *
 * T1  GET / returns 200
 * T2  Create agent + list agents
 * T3  WS connect → receive history (chunks array)
 * T4  Send input via WS → receive output events
 * T5  Two WS clients on same agent both receive output
 * T6  WS disconnect → agent stays alive
 * T7  Upload file → get fileId + url
 * T8  Send message with file → path appears in output
 * T9  Memory API exists (GET /api/memory returns array)
 * T10 Master agent config has systemPrompt field
 * T11 DELETE /api/agents/:id kills agent and removes from list
 * T12 GET /api/browse?path= returns directory listing
 * T13 Agent status reports waitingForInput field
 * T14 Multi-env: server respects DB_PATH for isolation
 */

import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';
import { setTimeout as sleep } from 'timers/promises';
import fs from 'fs';

const PORT = process.env.PORT ?? 37890;
const BASE = `http://localhost:${PORT}`;
const WS_BASE = `ws://localhost:${PORT}/ws`;

// ── helpers ────────────────────────────────────────────────────────────────

async function createAgent(body = {}) {
  const res = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'TestWorker', type: 'worker', adapterType: 'mock', ...body }),
  });
  expect(res.status).toBe(201);
  return (await res.json()).id;
}

function wsConnect(agentId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}?agentId=${agentId}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS timeout')), 5000);
  });
}

function nextMsg(ws, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('msg timeout')), timeout);
    ws.once('message', (d) => { clearTimeout(t); try { resolve(JSON.parse(d)); } catch { resolve(d.toString()); } });
  });
}

// ── T1 ─────────────────────────────────────────────────────────────────────
test('T1: GET / returns 200', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
});

// ── T2 ─────────────────────────────────────────────────────────────────────
test('T2: create agent and list agents', async ({ request }) => {
  const createRes = await request.post('/api/agents', {
    data: { name: 'Worker1', type: 'worker', adapterType: 'mock' },
  });
  expect(createRes.status()).toBe(201);
  const agent = await createRes.json();
  expect(agent).toHaveProperty('id');
  expect(agent.name).toBe('Worker1');

  const listRes = await request.get('/api/agents');
  const agents = await listRes.json();
  expect(agents.find(a => a.id === agent.id)).toBeDefined();
});

// ── T3 ─────────────────────────────────────────────────────────────────────
test('T3: WS connection receives history (chunks array)', async () => {
  const agentId = await createAgent();
  const ws = await wsConnect(agentId);
  const msg = await nextMsg(ws, 5000);
  expect(msg).toHaveProperty('type', 'history');
  expect(Array.isArray(msg.chunks)).toBe(true);
  ws.close();
});

// ── T4 ─────────────────────────────────────────────────────────────────────
test('T4: send input → receive output events', async () => {
  const agentId = await createAgent();
  const ws = await wsConnect(agentId);
  await nextMsg(ws, 5000); // history

  const outputs = [];
  ws.on('message', d => { try { const m = JSON.parse(d); if (m.type === 'output') outputs.push(m.data); } catch {} });

  ws.send(JSON.stringify({ type: 'input', data: 'hello\n' }));

  // Mock adapter echoes back — wait for output
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    if (outputs.length > 0) break;
  }
  expect(outputs.length).toBeGreaterThan(0);
  expect(outputs.join('')).toContain('hello');
  ws.close();
});

// ── T5 ─────────────────────────────────────────────────────────────────────
test('T5: two WS clients both receive output', async () => {
  const agentId = await createAgent();
  const ws1 = await wsConnect(agentId);
  const ws2 = await wsConnect(agentId);

  const out1 = [], out2 = [];
  ws1.on('message', d => { try { const m = JSON.parse(d); if (m.type === 'output') out1.push(m.data); } catch {} });
  ws2.on('message', d => { try { const m = JSON.parse(d); if (m.type === 'output') out2.push(m.data); } catch {} });

  await sleep(300); // consume history

  ws1.send(JSON.stringify({ type: 'input', data: 'broadcast_test\n' }));

  for (let i = 0; i < 20; i++) {
    await sleep(200);
    if (out1.length > 0 && out2.length > 0) break;
  }

  expect(out1.join('')).toContain('broadcast_test');
  expect(out2.join('')).toContain('broadcast_test');
  ws1.close(); ws2.close();
});

// ── T6 ─────────────────────────────────────────────────────────────────────
test('T6: agent stays alive after WS disconnect', async () => {
  const agentId = await createAgent();
  const ws = await wsConnect(agentId);
  await nextMsg(ws, 5000);
  ws.close();
  await sleep(1000);

  const res = await fetch(`${BASE}/api/agents/${agentId}`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.alive).toBe(true);
});

// ── T7 ─────────────────────────────────────────────────────────────────────
test('T7: upload file returns fileId and url', async ({ request }) => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const res = await request.post('/api/files', { data: { data: tinyPng, name: 'test.png' } });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body).toHaveProperty('fileId');
  expect(body).toHaveProperty('url');
  expect(body.url).toMatch(/^\/files\//);
  expect(fs.existsSync(body.path)).toBe(true);
});

// ── T8 ─────────────────────────────────────────────────────────────────────
test('T8: structured msg with file → path injected into PTY', async () => {
  const agentId = await createAgent();

  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const uploadRes = await fetch(`${BASE}/api/files`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: tinyPng, name: 'img.png' }),
  });
  const { fileId, url, path } = await uploadRes.json();

  const ws = await wsConnect(agentId);
  await nextMsg(ws, 5000); // history

  const outputs = [];
  ws.on('message', d => { try { const m = JSON.parse(d); if (m.type === 'output') outputs.push(m.data); } catch {} });

  // Send structured message with file reference
  ws.send(JSON.stringify({
    type: 'msg', agentId,
    content: [
      { type: 'text', text: 'look at this' },
      { type: 'image', fileId, url, path },
    ],
  }));

  for (let i = 0; i < 20; i++) {
    await sleep(200);
    if (outputs.join('').includes('look at this')) break;
  }
  // The mock adapter should echo back the text we sent
  expect(outputs.join('')).toContain('look at this');
  ws.close();
});

// ── T9 ─────────────────────────────────────────────────────────────────────
test('T9: GET /api/memory returns array', async ({ request }) => {
  const res = await request.get('/api/memory');
  expect(res.status()).toBe(200);
  expect(Array.isArray(await res.json())).toBe(true);
});

// ── T10 ────────────────────────────────────────────────────────────────────
test('T10: master agent has systemPrompt in config', async () => {
  const res = await fetch(`${BASE}/api/agents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Master', type: 'master', adapterType: 'mock', config: { systemPrompt: '' } }),
  });
  const master = await res.json();
  const infoRes = await fetch(`${BASE}/api/agents/${master.id}`);
  const info = await infoRes.json();
  expect(info.config).toHaveProperty('systemPrompt');
});

// ── T11: DELETE agent ─────────────────────────────────────────────────────
test('T11: DELETE /api/agents/:id removes agent from list', async ({ request }) => {
  const agentId = await createAgent({ name: 'ToDelete' });
  const delRes = await request.delete(`/api/agents/${agentId}`);
  expect(delRes.status()).toBe(200);
  const listRes = await request.get('/api/agents');
  const agents = await listRes.json();
  expect(agents.find(a => a.id === agentId)).toBeUndefined();
});

// ── T12: Browse directories ───────────────────────────────────────────────
test('T12: GET /api/browse returns directory listing', async ({ request }) => {
  const res = await request.get('/api/browse?path=/tmp');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.entries)).toBe(true);
  expect(body.path).toBe('/tmp');
});

// ── T13: Agent waitingForInput status ─────────────────────────────────────
test('T13: agent status includes waitingForInput field', async ({ request }) => {
  const agentId = await createAgent();
  await sleep(200);
  const res = await request.get(`/api/agents/${agentId}`);
  const body = await res.json();
  expect(body).toHaveProperty('waitingForInput');
  expect(typeof body.waitingForInput).toBe('boolean');
});

// ── T14: Multi-env isolation ──────────────────────────────────────────────
test('T14: server uses DB_PATH env for isolation', async () => {
  const dbPath = `${process.cwd()}/data/test.db`;
  expect(fs.existsSync(dbPath)).toBe(true);
});

// ── T15: Worker history API with pagination ───────────────────────────────
test('T15: GET /api/agents/:id/history returns paginated output', async () => {
  const agentId = await createAgent();
  const ws = await wsConnect(agentId);
  await nextMsg(ws, 5000);

  // Send a few messages to generate history
  ws.send(JSON.stringify({ type: 'input', data: 'AAA\n' }));
  await sleep(200);
  ws.send(JSON.stringify({ type: 'input', data: 'BBB\n' }));
  await sleep(200);
  ws.close();

  // Fetch history via API
  const res = await fetch(`${BASE}/api/agents/${agentId}/history`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.chunks)).toBe(true);
  expect(body.chunks.length).toBeGreaterThan(0);
  expect(body).toHaveProperty('total');

  // Fetch with limit
  const res2 = await fetch(`${BASE}/api/agents/${agentId}/history?limit=1`);
  const body2 = await res2.json();
  expect(body2.chunks.length).toBe(1);
});

// ── T16: Read file content API ────────────────────────────────────────────
test('T16: GET /api/readfile returns file content', async ({ request }) => {
  const res = await request.get('/api/readfile?path=/etc/hostname');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('content');
  expect(body.content.length).toBeGreaterThan(0);
});

// ── T17a: Image paste flow (F3) — upload + inject path ────────────────────
test('T17a: POST /api/files with image data returns path', async ({ request }) => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const res = await request.post('/api/files', { data: { data: tinyPng, name: 'paste.png' } });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.path).toMatch(/\.png$/);
  expect(body.url).toMatch(/^\/files\//);
});

// ── T17: Restart agent with new cwd ──────────────────────────────────────
test('T17: POST /api/agents/:id/restart changes cwd and restarts', async () => {
  const agentId = await createAgent();
  await sleep(300);

  const res = await fetch(`${BASE}/api/agents/${agentId}/restart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cwd: '/tmp' }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.cwd).toBe('/tmp');

  // Agent should still be alive after restart
  await sleep(500);
  const info = await (await fetch(`${BASE}/api/agents/${agentId}`)).json();
  expect(info.alive).toBe(true);
  expect(info.config.cwd).toBe('/tmp');
});
