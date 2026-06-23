/**
 * File detection & download tests (FD1–FD4)
 *
 * FD1  PTY output triggers file_created WS event with file info sorted by mtime desc
 * FD2  GET /api/agents/:id/files returns cwd files sorted by mtime desc
 * FD3  Download link from file list works (/api/download)
 * FD4  POST /api/agents/:id/zip {paths[]} returns a zip archive stream
 */

import { test, expect } from '@playwright/test';
import { WebSocket } from 'ws';
import { setTimeout as sleep } from 'timers/promises';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT ?? 37890;
const BASE = `http://localhost:${PORT}`;
const WS_BASE = `ws://localhost:${PORT}/ws`;

async function createAgent(body = {}) {
  const res = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'FDTest', type: 'worker', adapterType: 'mock', ...body }),
  });
  expect(res.status).toBe(201);
  return res.json();
}

// ── FD2: GET /api/agents/:id/files returns file list sorted by mtime desc ──
test('FD2-T1: GET /api/agents/:id/files returns files sorted by mtime desc', async () => {
  const workDir = `/tmp/fd2-${Date.now()}`;
  fs.mkdirSync(workDir, { recursive: true });

  // Create files with different timestamps
  const a = path.join(workDir, 'aaa.txt');
  const b = path.join(workDir, 'bbb.txt');
  const c = path.join(workDir, 'ccc.txt');
  fs.writeFileSync(a, 'aaa');
  await sleep(20);
  fs.writeFileSync(b, 'bbb');
  await sleep(20);
  fs.writeFileSync(c, 'ccc');

  const agent = await createAgent({ config: { cwd: workDir } });

  const res = await fetch(`${BASE}/api/agents/${agent.id}/files`);
  expect(res.status).toBe(200);
  const body = await res.json();

  expect(Array.isArray(body.files)).toBe(true);
  expect(body.files.length).toBe(3);
  // Sorted by mtime desc (newest first)
  expect(body.files[0].name).toBe('ccc.txt');
  expect(body.files[1].name).toBe('bbb.txt');
  expect(body.files[2].name).toBe('aaa.txt');
  // Each entry has path, mtime, size, download_url
  const f = body.files[0];
  expect(f).toHaveProperty('name');
  expect(f).toHaveProperty('path');
  expect(f).toHaveProperty('mtime');
  expect(f).toHaveProperty('size');
  expect(f).toHaveProperty('download_url');
  expect(f.download_url).toContain('/api/download');

  fs.rmSync(workDir, { recursive: true, force: true });
});

// ── FD3: download_url from file list actually works ────────────────────────
test('FD3-T1: download_url from /api/agents/:id/files returns file content', async () => {
  const workDir = `/tmp/fd3-${Date.now()}`;
  fs.mkdirSync(workDir, { recursive: true });
  const filePath = path.join(workDir, 'report.txt');
  fs.writeFileSync(filePath, 'hello report');

  const agent = await createAgent({ config: { cwd: workDir } });

  const listRes = await fetch(`${BASE}/api/agents/${agent.id}/files`);
  const { files } = await listRes.json();
  expect(files.length).toBe(1);

  const dlRes = await fetch(`${BASE}${files[0].download_url}`);
  expect(dlRes.status).toBe(200);
  expect(dlRes.headers.get('content-disposition')).toContain('attachment');
  const content = await dlRes.text();
  expect(content).toBe('hello report');

  fs.rmSync(workDir, { recursive: true, force: true });
});

// ── FD4: POST /api/agents/:id/zip returns a zip stream ────────────────────
test('FD4-T1: POST /api/agents/:id/zip returns zip archive containing selected files', async () => {
  const workDir = `/tmp/fd4-${Date.now()}`;
  fs.mkdirSync(workDir, { recursive: true });
  const f1 = path.join(workDir, 'foo.txt');
  const f2 = path.join(workDir, 'bar.txt');
  fs.writeFileSync(f1, 'foo content');
  fs.writeFileSync(f2, 'bar content');

  const agent = await createAgent({ config: { cwd: workDir } });

  const res = await fetch(`${BASE}/api/agents/${agent.id}/zip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: [f1, f2] }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('zip');
  expect(res.headers.get('content-disposition')).toContain('attachment');

  // Verify it's a valid zip (starts with PK magic bytes)
  const buf = Buffer.from(await res.arrayBuffer());
  expect(buf[0]).toBe(0x50); // 'P'
  expect(buf[1]).toBe(0x4b); // 'K'
  expect(buf.length).toBeGreaterThan(100);

  fs.rmSync(workDir, { recursive: true, force: true });
});

// ── FD1: WS file_created event emitted when PTY output mentions new file ──
test('FD1-T1: WS broadcasts file_created event when agent generates a file', async () => {
  const workDir = `/tmp/fd1-${Date.now()}`;
  fs.mkdirSync(workDir, { recursive: true });

  const agent = await createAgent({
    adapterType: 'mock',
    config: { cwd: workDir },
  });

  const ws = new WebSocket(`${WS_BASE}?agentId=${agent.id}`);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS timeout')), 5000);
  });
  // consume history frame
  await new Promise(r => { ws.once('message', r); setTimeout(r, 200); });

  // Create a file in the agent's cwd (simulating what claude would do)
  const newFile = path.join(workDir, 'generated.py');
  fs.writeFileSync(newFile, 'print("hello")');

  // Register listener BEFORE triggering, so we don't miss the event
  const evtPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no file_created event')), 5000);
    ws.on('message', d => {
      let msg; try { msg = JSON.parse(d.toString()); } catch { return; }
      if (msg.type === 'file_created') { clearTimeout(t); resolve(msg); }
    });
  });

  // Trigger detection via the notify endpoint
  const notifyRes = await fetch(`${BASE}/api/agents/${agent.id}/notify-files`, {
    method: 'POST',
  });
  expect(notifyRes.status).toBe(200);

  const evt = await evtPromise;

  expect(evt.files).toBeDefined();
  expect(evt.files[0].name).toBe('generated.py');
  expect(evt.files[0]).toHaveProperty('download_url');

  ws.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});
