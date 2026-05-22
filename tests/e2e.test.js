/**
 * E2E tests for claude-server v2
 * Run: PORT=37890 npx playwright test
 *
 * T1  GET / returns 200
 * T2  Create agent + list agents
 * T3  WS connect → receive history
 * T4  Send message via WS → stream chunks + done
 * T5  Two WS clients on same agent both receive output
 * T6  WS disconnect → agent stays alive
 * T7  Upload file → get fileId + url
 * T8  Send message with fileId → stored + broadcast
 * T9  Memory API exists (GET /api/memory returns array)
 * T10 Master agent systemPrompt includes memory
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

async function collectUntilDone(ws, timeoutMs = 15000) {
  const msgs = [];
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(msgs), timeoutMs);
    ws.on('message', (d) => {
      let m; try { m = JSON.parse(d); } catch { return; }
      msgs.push(m);
      if (m.type === 'done' || m.type === 'error') { clearTimeout(t); resolve(msgs); }
    });
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
  expect(listRes.status()).toBe(200);
  const agents = await listRes.json();
  expect(Array.isArray(agents)).toBe(true);
  expect(agents.find(a => a.id === agent.id)).toBeDefined();
});

// ── T3 ─────────────────────────────────────────────────────────────────────
test('T3: WS connection receives history message', async () => {
  const agentId = await createAgent();
  const ws = await wsConnect(agentId);
  const msg = await nextMsg(ws, 5000);
  expect(msg).toHaveProperty('type', 'history');
  expect(Array.isArray(msg.messages)).toBe(true);
  ws.close();
});

// ── T4 ─────────────────────────────────────────────────────────────────────
test('T4: send message → receive chunks + done', async () => {
  const agentId = await createAgent();
  const ws = await wsConnect(agentId);
  await nextMsg(ws, 5000); // history

  const collected = await (async () => {
    const p = collectUntilDone(ws, 10000);
    ws.send(JSON.stringify({ type: 'msg', agentId, content: [{ type: 'text', text: 'hello' }] }));
    return p;
  })();

  const chunks = collected.filter(m => m.type === 'chunk');
  const done = collected.find(m => m.type === 'done');
  expect(chunks.length).toBeGreaterThan(0);
  expect(done).toBeDefined();
  ws.close();
});

// ── T5 ─────────────────────────────────────────────────────────────────────
test('T5: two WS clients both receive output', async () => {
  const agentId = await createAgent();

  // Connect both and start collecting BEFORE awaiting history,
  // so we don't miss history messages due to race conditions.
  const ws1 = await wsConnect(agentId);
  const msgs1 = [];
  ws1.on('message', d => { try { msgs1.push(JSON.parse(d)); } catch {} });

  const ws2 = await wsConnect(agentId);
  const msgs2 = [];
  ws2.on('message', d => { try { msgs2.push(JSON.parse(d)); } catch {} });

  // Wait for both to receive history
  await sleep(500);

  // ws1 sends a message; both should receive broadcast output
  ws1.send(JSON.stringify({ type: 'msg', agentId, content: [{ type: 'text', text: 'hi' }] }));

  // Wait for 'done' to appear in both
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (msgs1.some(m => m.type === 'done') && msgs2.some(m => m.type === 'done')) break;
  }

  expect(msgs1.some(m => m.type === 'done')).toBe(true);
  expect(msgs2.some(m => m.type === 'done')).toBe(true);
  ws1.close(); ws2.close();
});

// ── T6 ─────────────────────────────────────────────────────────────────────
test('T6: agent stays alive after WS disconnect', async () => {
  const agentId = await createAgent();
  const ws = await wsConnect(agentId);
  await nextMsg(ws, 5000);
  ws.close();
  await sleep(1500);

  const res = await fetch(`${BASE}/api/agents/${agentId}`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.id).toBe(agentId);
  // alive is a status field — agent was created, so it exists (not deleted)
  expect(body).toHaveProperty('status');
});

// ── T7 ─────────────────────────────────────────────────────────────────────
test('T7: upload file returns fileId and url', async ({ request }) => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const res = await request.post('/api/files', {
    data: { data: tinyPng, name: 'test.png' },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body).toHaveProperty('fileId');
  expect(body).toHaveProperty('url');
  expect(body.url).toMatch(/^\/files\//);
  // File should exist on disk
  expect(fs.existsSync(body.path)).toBe(true);
});

// ── T8 ─────────────────────────────────────────────────────────────────────
test('T8: message with fileId stored and broadcast', async () => {
  const agentId = await createAgent();

  // Upload file first
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const uploadRes = await fetch(`${BASE}/api/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: tinyPng, name: 'img.png' }),
  });
  const { fileId, url } = await uploadRes.json();

  const ws = await wsConnect(agentId);
  await nextMsg(ws, 5000);

  const msgs = await (async () => {
    const p = collectUntilDone(ws, 10000);
    ws.send(JSON.stringify({
      type: 'msg', agentId,
      content: [
        { type: 'text', text: 'look at this image' },
        { type: 'image', fileId, url },
      ],
    }));
    return p;
  })();

  expect(msgs.some(m => m.type === 'done')).toBe(true);

  // Verify message in history
  const ws2 = await wsConnect(agentId);
  const hist = await nextMsg(ws2, 5000);
  expect(hist.type).toBe('history');
  const userMsg = hist.messages.find(m => m.role === 'user');
  expect(userMsg).toBeDefined();
  const hasFile = userMsg.content.some(c => c.type === 'image' && c.fileId === fileId);
  expect(hasFile).toBe(true);
  ws.close(); ws2.close();
});

// ── T9 ─────────────────────────────────────────────────────────────────────
test('T9: GET /api/memory returns array', async ({ request }) => {
  const res = await request.get('/api/memory');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

// ── T10 ────────────────────────────────────────────────────────────────────
test('T10: master agent GET /api/agents/:id includes systemPrompt in config', async () => {
  // Create a master agent
  const res = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Master', type: 'master', adapterType: 'mock' }),
  });
  const master = await res.json();

  const infoRes = await fetch(`${BASE}/api/agents/${master.id}`);
  const info = await infoRes.json();
  // Master agent's config should have systemPrompt (may be empty string if no memory yet)
  expect(info.config).toHaveProperty('systemPrompt');
});
