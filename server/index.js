import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';

import agentsRouter from './api/agents.js';
import filesRouter from './api/files.js';
import { handleWS } from './ws.js';
import { agentManager } from '../core/agent-manager.js';
import { getAllMemory } from '../store/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILES_DIR = process.env.FILES_DIR ?? join(process.cwd(), 'data', 'files');
mkdirSync(FILES_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(join(__dirname, '..', 'public')));

// Serve uploaded files
app.use('/files', express.static(FILES_DIR));

// API routes
app.use('/api/agents', agentsRouter);
app.use('/api/files', filesRouter);

// Memory endpoint (flat, not under /api/agents to keep it simple)
app.get('/api/memory', (_req, res) => {
  res.json(getAllMemory());
});

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

// WebSocket
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => handleWS(ws, req));

// Restore agents from DB on startup
agentManager.restoreFromDB();

const PORT = process.env.PORT ?? 4280;
server.listen(PORT, () => {
  console.log(`claude-server v2 on http://localhost:${PORT}`);
});
