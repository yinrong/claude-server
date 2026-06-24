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

// ── T19: Agent output summary API (middleware layer for Master) ────────────
test('T19: GET /api/agents/:id/summary returns recent text output', async () => {
  const agentId = await createAgent();
  const ws = await wsConnect(agentId);
  await nextMsg(ws, 5000);
  ws.send(JSON.stringify({ type: 'input', data: 'SUMMARY_TEST\n' }));
  await sleep(500);
  ws.close();

  const res = await fetch(`${BASE}/api/agents/${agentId}/summary`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('text');
  expect(body.text).toContain('SUMMARY_TEST');
});

// ── T20: Master can see all agents' summaries ─────────────────────────────
test('T20: GET /api/agents/summaries returns all agents text', async () => {
  const a1 = await createAgent({ name: 'W1' });
  const a2 = await createAgent({ name: 'W2' });

  // Generate output in both
  const ws1 = await wsConnect(a1);
  await nextMsg(ws1, 5000);
  ws1.send(JSON.stringify({ type: 'input', data: 'OUTPUT_A1\n' }));
  await sleep(300);
  ws1.close();

  const ws2 = await wsConnect(a2);
  await nextMsg(ws2, 5000);
  ws2.send(JSON.stringify({ type: 'input', data: 'OUTPUT_A2\n' }));
  await sleep(300);
  ws2.close();

  const res = await fetch(`${BASE}/api/agents/summaries`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  const texts = body.map(s => s.text).join(' ');
  expect(texts).toContain('OUTPUT_A1');
  expect(texts).toContain('OUTPUT_A2');
});

// ── T21: Master can inject message into Worker via API ────────────────────
test('T21: POST /api/agents/:id/inject sends text to PTY', async () => {
  const agentId = await createAgent();
  const ws = await wsConnect(agentId);
  await nextMsg(ws, 5000);

  const outputs = [];
  ws.on('message', d => { try { const m = JSON.parse(d); if (m.type === 'output') outputs.push(m.data); } catch {} });

  // Inject via API (simulates Master controlling Worker)
  const res = await fetch(`${BASE}/api/agents/${agentId}/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'INJECTED_BY_MASTER\n' }),
  });
  expect(res.status).toBe(200);

  await sleep(500);
  expect(outputs.join('')).toContain('INJECTED_BY_MASTER');
  ws.close();
});

// ── T22: @dispatch auto-routing from Master to Worker ─────────────────────
test('T22: Master output with @dispatch injects into Worker', async () => {
  // Create a "master" and a "worker"
  const masterRes = await fetch(`${BASE}/api/agents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'DispMaster', type: 'master', adapterType: 'mock' }),
  });
  const master = await masterRes.json();

  const workerRes = await fetch(`${BASE}/api/agents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'DispWorker', type: 'worker', adapterType: 'mock' }),
  });
  const worker = await workerRes.json();

  // Subscribe to worker output
  const wsWorker = await wsConnect(worker.id);
  await nextMsg(wsWorker, 5000);
  const workerOutputs = [];
  wsWorker.on('message', d => { try { const m = JSON.parse(d); if (m.type === 'output') workerOutputs.push(m.data); } catch {} });

  // Send message to master that will trigger mock echo containing @dispatch
  const wsMaster = await wsConnect(master.id);
  await nextMsg(wsMaster, 5000);
  // Mock adapter echoes back, so we send text that contains @dispatch pattern
  wsMaster.send(JSON.stringify({ type: 'input', data: `@dispatch ${worker.id}: DO_THE_TASK\n` }));

  // Wait for idle timer (2s) + dispatch propagation
  await sleep(3000);

  // Worker should have received the injected task
  const combined = workerOutputs.join('');
  expect(combined).toContain('DO_THE_TASK');

  wsMaster.close();
  wsWorker.close();
});

// ── T23: Memory extraction triggered after agent goes idle (M3) ───────────
test('T23: memory extraction API exists', async ({ request }) => {
  // Verify the memory analysis can be triggered manually
  const agentId = await createAgent();
  const ws = await wsConnect(agentId);
  await nextMsg(ws, 5000);
  ws.send(JSON.stringify({ type: 'input', data: 'I prefer TypeScript over JavaScript\n' }));
  await sleep(300);
  ws.close();

  // Trigger analysis explicitly via API
  const res = await request.post(`/api/agents/${agentId}/analyze`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('ok');
});

// ── T24: Worker swappability — mock adapter proves interface works ─────────
test('T24: different adapter types work through same API', async () => {
  // Create mock agent
  const mockId = await createAgent({ name: 'MockWorker', adapterType: 'mock' });
  const ws = await wsConnect(mockId);
  await nextMsg(ws, 5000);
  const outputs = [];
  ws.on('message', d => { try { const m = JSON.parse(d); if (m.type === 'output') outputs.push(m.data); } catch {} });
  ws.send(JSON.stringify({ type: 'input', data: 'SWAP_TEST\n' }));
  await sleep(300);
  expect(outputs.join('')).toContain('SWAP_TEST');
  ws.close();

  // Verify agent info shows correct adapter type
  const info = await (await fetch(`${BASE}/api/agents/${mockId}`)).json();
  expect(info.adapter_type).toBe('mock');
});

// ── T18: Recent commands (C11) ────────────────────────────────────────────
test('T18: GET /api/recent-commands returns history of cwd/commands', async () => {
  // Create agent with specific cwd
  await fetch(`${BASE}/api/agents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'CmdTest', type: 'worker', adapterType: 'mock', config: { cwd: '/home' } }),
  });
  await fetch(`${BASE}/api/agents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'CmdTest2', type: 'worker', adapterType: 'mock', config: { cwd: '/var' } }),
  });

  const res = await fetch(`${BASE}/api/recent-commands`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  // Should contain the cwds we just used
  const cwds = body.map(c => c.cwd);
  expect(cwds).toContain('/home');
  expect(cwds).toContain('/var');
});

// ── T27: Download file API (U20) ──────────────────────────────────────────
test('T27: GET /api/download?path= returns file with Content-Disposition', async ({ request }) => {
  const res = await request.get('/api/download?path=/etc/hostname');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-disposition']).toContain('attachment');
  const body = await res.body();
  expect(body.length).toBeGreaterThan(0);
});

// ── T26: Real claude binary works (BUG5 regression) ──────────────────────
test('T26: real claude-code-stream agent responds to a message', async () => {
  const agentId = await createAgent({ name: 'RealClaude', adapterType: 'claude-code-stream', config: { cwd: '/tmp' } });

  const ws = await wsConnect(agentId);
  await nextMsg(ws, 5000); // history

  // Send a trivial message via chat protocol
  ws.send(JSON.stringify({ type: 'chat', agentId, text: 'say OK' }));

  // Wait for assistant_done
  const done = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 30000);
    ws.on('message', d => {
      const m = JSON.parse(d.toString());
      if (m.type === 'assistant_done') { clearTimeout(timeout); resolve(m); }
    });
  });

  expect(done).not.toBeNull();
  expect(done.text.length).toBeGreaterThan(0);
  ws.close();
});

// ── T25: Auto-create directory on agent creation (C12) ────────────────────
test('T25: creating agent with non-existent cwd auto-creates the directory', async () => {
  const testDir = `/tmp/claude-test-mkdir-${Date.now()}`;
  // Ensure dir does not exist
  expect(fs.existsSync(testDir)).toBe(false);

  const res = await fetch(`${BASE}/api/agents`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'MkdirTest', type: 'worker', adapterType: 'mock', config: { cwd: testDir } }),
  });
  expect(res.status).toBe(201);

  // Directory should now exist
  expect(fs.existsSync(testDir)).toBe(true);

  // Cleanup
  fs.rmdirSync(testDir);
});

// ── MS1: Agent creation with model field ─────────────────────────────────
test('MS1: create agent with model field stores model in config', async ({ request }) => {
  const res = await request.post('/api/agents', {
    data: {
      name: 'ModelWorker',
      type: 'worker',
      adapterType: 'mock',
      config: { cwd: '/tmp', model: 'claude-opus-4-8' },
    },
  });
  expect(res.status()).toBe(201);
  const agent = await res.json();
  expect(agent).toHaveProperty('id');

  // Fetch agent info and verify model is stored
  const infoRes = await request.get(`/api/agents/${agent.id}`);
  expect(infoRes.status()).toBe(200);
  const info = await infoRes.json();
  expect(info.config).toHaveProperty('model', 'claude-opus-4-8');
});

// ── MS2a: POST /api/models/refresh populates models table ────────────────
test('MS2a: POST /api/models/refresh returns model list and persists to DB', async ({ request }) => {
  const res = await request.post('/api/models/refresh');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('ok', true);
  expect(Array.isArray(body.models)).toBe(true);
  expect(body.models.length).toBeGreaterThan(0);
  // Each model has name field
  expect(body.models[0]).toHaveProperty('name');
});

// ── MS2b: GET /api/models returns persisted model list ───────────────────
test('MS2b: GET /api/models returns model list from DB', async ({ request }) => {
  // Ensure models are populated first
  await request.post('/api/models/refresh');

  const res = await request.get('/api/models');
  expect(res.status()).toBe(200);
  const models = await res.json();
  expect(Array.isArray(models)).toBe(true);
  expect(models.length).toBeGreaterThan(0);

  // All model names should have provider/id format
  const names = models.map(m => m.name);
  const allHaveSlash = names.every(n => n.includes('/'));
  expect(allHaveSlash).toBe(true);
});

// ── MS2c: Default model list contains expected models ────────────────────
test('MS2c: default model list includes claude models with provider prefix', async ({ request }) => {
  await request.post('/api/models/refresh');
  const res = await request.get('/api/models');
  const models = await res.json();
  const names = models.map(m => m.name);
  // Models should have provider/id format (e.g. pa/claude-opus-4-8 or anthropic/claude-opus-4-8)
  const hasClaudeWithSlash = names.some(n => n.includes('/') && n.toLowerCase().includes('claude'));
  expect(hasClaudeWithSlash).toBe(true);
});

// ── BUG6: Model names must be owned_by/id (full provider prefix) ─────────────
// Regression: fetchModelsFromProxy used m.id directly when id already contained '/',
// dropping owned_by. For any model where owned_by is set, name must equal owned_by/id.
test('BUG6: model names after refresh equal owned_by/id for all upstream models', async ({ request }) => {
  // Fetch raw model list directly from the same proxy the server uses
  const proxyUrl = 'http://127.0.0.1:4290/v1/models';
  const token = process.env.ANTHROPIC_AUTH_TOKEN ?? '';
  const rawRes = await fetch(proxyUrl, {
    headers: { 'Authorization': `Bearer ${token}`, 'x-api-key': token },
    signal: AbortSignal.timeout(5000),
  });
  expect(rawRes.ok).toBe(true);
  const rawBody = await rawRes.json();
  const rawModels = (rawBody.data ?? []).filter(m => !m.model_type || m.model_type === 'llm');

  // Trigger refresh and get stored names
  const refreshRes = await request.post('/api/models/refresh');
  expect(refreshRes.status()).toBe(200);
  const { models } = await refreshRes.json();
  const storedNames = new Set(models.map(m => m.name));

  // Every raw model with owned_by must be stored as owned_by/id
  const violations = rawModels
    .filter(m => m.owned_by)
    .filter(m => !storedNames.has(`${m.owned_by}/${m.id}`));

  expect(violations).toEqual([]);
});

// ── T28: Session restore — last_session_id persisted and used on restart ──────
test('T28: agent last_session_id is saved and used on restart', async () => {
  // Step 1: Create a mock agent
  const agentId = await createAgent({ name: 'SessionAgent' });

  // Step 2: Set a fake session_id via API
  const fakeSessionId = 'test-session-abc123';
  const setRes = await fetch(`${BASE}/api/agents/${agentId}/set-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: fakeSessionId }),
  });
  expect(setRes.status).toBe(200);
  const setBody = await setRes.json();
  expect(setBody.ok).toBe(true);

  // Step 3: GET agent should return last_session_id
  const infoRes = await fetch(`${BASE}/api/agents/${agentId}`);
  const info = await infoRes.json();
  expect(info.last_session_id).toBe(fakeSessionId);

  // Step 4: Restart the agent — adapter should receive resumeSessionId in config
  const restartRes = await fetch(`${BASE}/api/agents/${agentId}/restart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(restartRes.status).toBe(200);

  // Step 5: After restart, config should include resumeSessionId
  await sleep(300);
  const afterRes = await fetch(`${BASE}/api/agents/${agentId}`);
  const after = await afterRes.json();
  expect(after.config.resumeSessionId).toBe(fakeSessionId);
});

// ── T29: Session restore on server startup (restoreFromDB uses last_session_id) ─
test('T29: restoreFromDB passes last_session_id as resumeSessionId to adapter', async () => {
  // Step 1: Create a mock agent and set its last_session_id
  const agentId = await createAgent({ name: 'RestoreAgent' });
  const fakeSessionId = 'restore-session-xyz789';

  const setRes = await fetch(`${BASE}/api/agents/${agentId}/set-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: fakeSessionId }),
  });
  expect(setRes.status).toBe(200);

  // Step 2: Verify the session_id is persisted in DB (via GET)
  const infoRes = await fetch(`${BASE}/api/agents/${agentId}`);
  const info = await infoRes.json();
  expect(info.last_session_id).toBe(fakeSessionId);

  // Step 3: Trigger restoreFromDB via dedicated endpoint
  const restoreRes = await fetch(`${BASE}/api/restore`, { method: 'POST' });
  expect(restoreRes.status).toBe(200);

  // Step 4: After restore, agent's config should include resumeSessionId
  await sleep(300);
  const afterRes = await fetch(`${BASE}/api/agents/${agentId}`);
  const after = await afterRes.json();
  expect(after.config.resumeSessionId).toBe(fakeSessionId);
});

// ── MC1-T1: GET /api/v2/agents — 标准格式响应 ────────────────────────────────
test('MC1-T1: GET /api/v2/agents returns standard format {ok, data, error, ts}', async ({ request }) => {
  const res = await request.get('/api/v2/agents');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('ok', true);
  expect(Array.isArray(body.data)).toBe(true);
  expect(body.error).toBeNull();
  expect(typeof body.ts).toBe('number');
});

// ── MC1-T2: GET /api/v2/agents/:id — 标准格式响应 ───────────────────────────
test('MC1-T2: GET /api/v2/agents/:id returns standard format', async ({ request }) => {
  // Create an agent first
  const createRes = await request.post('/api/agents', {
    data: { name: 'V2Worker', type: 'worker', adapterType: 'mock' },
  });
  const agent = await createRes.json();

  const res = await request.get(`/api/v2/agents/${agent.id}`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('ok', true);
  expect(body.data).toHaveProperty('id', agent.id);
  expect(body.data).toHaveProperty('name', 'V2Worker');
  expect(body.error).toBeNull();
  expect(typeof body.ts).toBe('number');
});

// ── MC1-T3: GET /api/v2/agents/:id/history — 支持 since_ts 过滤 ──────────────
test('MC1-T3: GET /api/v2/agents/:id/history returns history with since_ts filter', async () => {
  const agentId = await createAgent({ name: 'HistoryV2' });
  const ws = await wsConnect(agentId);
  await nextMsg(ws, 5000);

  // Send input to generate output
  ws.send(JSON.stringify({ type: 'input', data: 'V2_HISTORY_TEST\n' }));
  await sleep(300);

  const tsBefore = Date.now();

  ws.send(JSON.stringify({ type: 'input', data: 'AFTER_TS\n' }));
  await sleep(300);
  ws.close();

  // Without since_ts — should return all history
  const res1 = await fetch(`${BASE}/api/v2/agents/${agentId}/history`);
  expect(res1.status).toBe(200);
  const body1 = await res1.json();
  expect(body1).toHaveProperty('ok', true);
  expect(Array.isArray(body1.data.chunks)).toBe(true);
  expect(body1.data.chunks.length).toBeGreaterThan(0);
  expect(body1.data.chunks.join('')).toContain('V2_HISTORY_TEST');
  expect(typeof body1.ts).toBe('number');

  // With since_ts — should only return records after tsBefore
  const res2 = await fetch(`${BASE}/api/v2/agents/${agentId}/history?since_ts=${tsBefore}`);
  expect(res2.status).toBe(200);
  const body2 = await res2.json();
  expect(body2).toHaveProperty('ok', true);
  expect(Array.isArray(body2.data.chunks)).toBe(true);
  // Records after tsBefore should contain AFTER_TS but not necessarily V2_HISTORY_TEST
  const text = body2.data.chunks.join('');
  expect(text).toContain('AFTER_TS');
});

// ── MC1-T4: POST /api/v2/agents/:id/input — 发送文字输入 ─────────────────────
test('MC1-T4: POST /api/v2/agents/:id/input sends text input to agent', async () => {
  const agentId = await createAgent({ name: 'InputV2' });
  const ws = await wsConnect(agentId);
  await nextMsg(ws, 5000);

  const outputs = [];
  ws.on('message', d => { try { const m = JSON.parse(d); if (m.type === 'output') outputs.push(m.data); } catch {} });

  // Send input via v2 REST API
  const res = await fetch(`${BASE}/api/v2/agents/${agentId}/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'V2_INPUT_TEST\n' }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('ok', true);
  expect(body.error).toBeNull();

  // Wait for echo from mock adapter
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    if (outputs.join('').includes('V2_INPUT_TEST')) break;
  }
  expect(outputs.join('')).toContain('V2_INPUT_TEST');
  ws.close();
});

// ── MC1-T5: 不存在的 agent 返回标准错误格式 ──────────────────────────────────
test('MC1-T5: non-existent agent returns standard error format {ok:false, error}', async ({ request }) => {
  const fakeId = 'non-existent-agent-id-12345';

  // GET /api/v2/agents/:id — not found
  const res1 = await request.get(`/api/v2/agents/${fakeId}`);
  expect(res1.status()).toBe(404);
  const body1 = await res1.json();
  expect(body1).toHaveProperty('ok', false);
  expect(body1.data).toBeNull();
  expect(typeof body1.error).toBe('string');
  expect(body1.error.length).toBeGreaterThan(0);
  expect(typeof body1.ts).toBe('number');

  // POST /api/v2/agents/:id/input — not found
  const res2 = await request.post(`/api/v2/agents/${fakeId}/input`, {
    data: { text: 'hello' },
  });
  expect(res2.status()).toBe(404);
  const body2 = await res2.json();
  expect(body2).toHaveProperty('ok', false);
  expect(body2.data).toBeNull();
  expect(typeof body2.error).toBe('string');
});

// ── MC8-T1: GET /api/v2/agents/:id/diff — git repo 返回 diff 文本 ────────────
test('MC8-T1: GET /api/v2/agents/:id/diff returns standard format with diff string', async () => {
  // 在 git repo 目录下创建 agent
  const agentId = await createAgent({
    name: 'DiffGitAgent',
    adapterType: 'mock',
    config: { cwd: '/home/yinrong/dev/ai/claude-server' },
  });

  const res = await fetch(`${BASE}/api/v2/agents/${agentId}/diff`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('ok', true);
  expect(body.data).toHaveProperty('diff');
  expect(typeof body.data.diff).toBe('string');
  expect(body.error).toBeNull();
  expect(typeof body.ts).toBe('number');
});

// ── MC8-T2: GET /api/v2/agents/:id/diff — 非 git repo 返回空字符串 ───────────
test('MC8-T2: GET /api/v2/agents/:id/diff returns empty string for non-git cwd', async () => {
  const agentId = await createAgent({
    name: 'DiffNoGitAgent',
    adapterType: 'mock',
    config: { cwd: '/tmp' },
  });

  const res = await fetch(`${BASE}/api/v2/agents/${agentId}/diff`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('ok', true);
  expect(body.data).toHaveProperty('diff', '');
  expect(body.error).toBeNull();
});

// ── T30: MS1 frontend — modal-model select is populated when modal opens ──────
test('T30: new-agent modal shows model select with options after refresh', async ({ page }) => {
  // Seed models first
  await fetch(`${BASE}/api/models/refresh`, { method: 'POST' });

  await page.goto(`${BASE}/`);
  // Open new agent modal
  await page.click('#btn-new-agent');
  // modal-model select should be visible
  const select = page.locator('#modal-model');
  await select.waitFor({ state: 'visible', timeout: 5000 });
  // Should have at least one option (from the seeded models)
  const count = await select.locator('option').count();
  expect(count).toBeGreaterThan(0);
  // At least one option should contain a model name
  const firstText = await select.locator('option').first().textContent();
  expect(firstText.length).toBeGreaterThan(0);
});

// ── T31: MS1 frontend — selecting model stores it in agent config ─────────────
test('T31: creating agent via modal with selected model stores config.model', async ({ page }) => {
  // Seed models
  const refreshRes = await fetch(`${BASE}/api/models/refresh`, { method: 'POST' });
  const { models } = await refreshRes.json();
  const targetModel = models[0].name;

  await page.goto(`${BASE}/`);
  // Open modal
  await page.click('#btn-new-agent');
  const select = page.locator('#modal-model');
  await select.waitFor({ state: 'visible', timeout: 5000 });

  // Fill in agent name
  await page.fill('#modal-name', 'ModelTestAgent');

  // Select the target model
  await select.selectOption(targetModel);

  // Confirm creation
  await page.click('#modal-confirm');
  await sleep(500);

  // Find the newly created agent via API
  const listRes = await fetch(`${BASE}/api/agents`);
  const agents = await listRes.json();
  const agent = agents.find(a => a.name === 'ModelTestAgent');
  expect(agent).toBeDefined();

  const infoRes = await fetch(`${BASE}/api/agents/${agent.id}`);
  const info = await infoRes.json();
  expect(info.config).toHaveProperty('model', targetModel);
});

// ── PV1: POST /api/providers creates provider, GET lists with masked token ─
test('PV1: create provider and list with masked auth_token', async ({ request }) => {
  const uniqueName = `test-provider-pv1-${Date.now()}`;
  const createRes = await request.post('/api/providers', {
    data: {
      name: uniqueName,
      base_url: 'https://api.example.com',
      auth_token: 'secret-token-123',
    },
  });
  expect(createRes.status()).toBe(201);
  const created = await createRes.json();
  expect(created).toHaveProperty('id');
  expect(created.name).toBe(uniqueName);

  // GET list — auth_token must be masked
  const listRes = await request.get('/api/providers');
  expect(listRes.status()).toBe(200);
  const providers = await listRes.json();
  const found = providers.find(p => p.name === uniqueName);
  expect(found).toBeDefined();
  expect(found.auth_token).toBe('***');
  expect(found.base_url).toBe('https://api.example.com');
});

// ── PV2: POST /api/providers/:id/set-default switches default provider ─────
test('PV2: set-default switches default provider', async ({ request }) => {
  const ts = Date.now();
  // Create two providers
  const r1 = await request.post('/api/providers', {
    data: { name: `pv2-provider-a-${ts}`, base_url: 'https://a.example.com', auth_token: 'tok-a' },
  });
  const p1 = await r1.json();

  const r2 = await request.post('/api/providers', {
    data: { name: `pv2-provider-b-${ts}`, base_url: 'https://b.example.com', auth_token: 'tok-b' },
  });
  const p2 = await r2.json();

  // Set p2 as default
  const setRes = await request.post(`/api/providers/${p2.id}/set-default`);
  expect(setRes.status()).toBe(200);
  const setBody = await setRes.json();
  expect(setBody.ok).toBe(true);

  // Check p2 is default, p1 is not
  const listRes = await request.get('/api/providers');
  const providers = await listRes.json();
  const pa = providers.find(p => p.id === p1.id);
  const pb = providers.find(p => p.id === p2.id);
  expect(pb.is_default).toBe(1);
  expect(pa.is_default).toBe(0);
});

// ── PV3: POST /api/agents with providerId stores it in config ──────────────
test('PV3: create agent with providerId stores it in config', async ({ request }) => {
  // First create a provider
  const provRes = await request.post('/api/providers', {
    data: { name: `pv3-provider-${Date.now()}`, base_url: 'https://pv3.example.com', auth_token: 'tok-pv3' },
  });
  const provider = await provRes.json();

  // Create agent with providerId
  const agentRes = await request.post('/api/agents', {
    data: {
      name: 'PV3Agent',
      type: 'worker',
      adapterType: 'mock',
      providerId: provider.id,
    },
  });
  expect(agentRes.status()).toBe(201);
  const agent = await agentRes.json();

  // Fetch agent — config.providerId must match
  const infoRes = await request.get(`/api/agents/${agent.id}`);
  expect(infoRes.status()).toBe(200);
  const info = await infoRes.json();
  expect(info.config).toHaveProperty('providerId', provider.id);
});

// ── PV4: DELETE /api/providers/:id with agent reference returns 400 ────────
test('PV4: delete provider with agent reference returns 400', async ({ request }) => {
  // Create a provider
  const provRes = await request.post('/api/providers', {
    data: { name: `pv4-provider-${Date.now()}`, base_url: 'https://pv4.example.com', auth_token: 'tok-pv4' },
  });
  const provider = await provRes.json();

  // Create agent referencing that provider
  await request.post('/api/agents', {
    data: {
      name: 'PV4Agent',
      type: 'worker',
      adapterType: 'mock',
      providerId: provider.id,
    },
  });

  // Attempt to delete provider — should fail with 400
  const delRes = await request.delete(`/api/providers/${provider.id}`);
  expect(delRes.status()).toBe(400);
  const body = await delRes.json();
  expect(body).toHaveProperty('error');
});

// ── PV5: GET /api/v2/providers returns standard format ────────────────────
test('PV5: GET /api/v2/providers returns standard format {ok:true, data:[...]}', async ({ request }) => {
  const res = await request.get('/api/v2/providers');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('ok', true);
  expect(Array.isArray(body.data)).toBe(true);
  expect(body.error).toBeNull();
  expect(typeof body.ts).toBe('number');
});

// ── MS3: models/refresh returns all models with provider/ prefix ──────────
test('MS3: refresh returns all models with {provider}/{id} name format', async ({ request }) => {
  const res = await request.post('/api/models/refresh');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(Array.isArray(body.models)).toBe(true);
  // All model names should contain a slash (provider/id format)
  const names = body.models.map(m => m.name);
  const allHaveSlash = names.every(n => n.includes('/'));
  expect(allHaveSlash).toBe(true);
  // In real env: should return many models (>10); in test env defaults used
  // Just verify the format is correct for whatever is returned
  expect(names.length).toBeGreaterThan(0);
});

// ── BUG7: inaccessible cwd returns 400, not 201 + crashing PTY ───────────────
// claude 逻辑路径：无（测试 HTTP 校验层，不涉及 claude 调用）
test('BUG7-T1: creating agent with inaccessible cwd returns 400, not crashing PTY', async ({ request }) => {
  const badCwd = '/root/nonexistent-restricted-dir-' + Date.now();
  const res = await request.post('/api/agents', {
    data: { name: 'BadCwdAgent', type: 'worker', adapterType: 'claude-code', config: { cwd: badCwd } },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body).toHaveProperty('error');
  expect(body.error.toLowerCase()).toMatch(/permission|directory|cwd|access/);
});

// claude 逻辑路径：无（测试 PTY 崩溃熔断机制，使用 claudeBin 指向不存在的二进制触发崩溃）
test('BUG7-T2: claude-code agent with non-existent binary stops restarting after repeated failures', async ({ request }) => {
  test.setTimeout(30000);
  // config.claudeBin 覆盖 CLAUDE_BIN env，让 PTY 每次启动都失败
  const res = await request.post('/api/agents', {
    data: {
      name: 'CrashAgent',
      type: 'worker',
      adapterType: 'claude-code',
      config: { cwd: '/tmp', claudeBin: '/nonexistent/fake-claude-' + Date.now() },
    },
  });
  expect(res.status()).toBe(201);
  const agent = await res.json();

  // 等 5 秒，然后检查 agent 已进入 errored 状态（不再重启）
  await new Promise(r => setTimeout(r, 5000));

  const statusRes = await request.get(`/api/agents/${agent.id}`);
  expect(statusRes.status()).toBe(200);
  const info = await statusRes.json();

  // agent 应该处于 errored 状态，而不是仍在不断重启
  expect(info.status).toBe('errored');
});
