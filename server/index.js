import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { mkdirSync, readdirSync, statSync, readFileSync } from 'fs';

import agentsRouter from './api/agents.js';
import filesRouter from './api/files.js';
import { handleWS } from './ws.js';
import { agentManager } from './core/agent-manager.js';
import { getAllMemory, getRecentCommands } from './store/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILES_DIR = process.env.FILES_DIR ?? join(process.cwd(), 'data', 'files');
mkdirSync(FILES_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(join(__dirname, '..', 'web')));

// Serve uploaded files
app.use('/files', express.static(FILES_DIR));

// API routes
app.use('/api/agents', agentsRouter);
app.use('/api/files', filesRouter);

// Memory endpoint
app.get('/api/memory', (_req, res) => { res.json(getAllMemory()); });

// Recent commands (cwd history for quick-select)
app.get('/api/recent-commands', (_req, res) => { res.json(getRecentCommands()); });

// Browse server directories (and optionally files)
app.get('/api/browse', (req, res) => {
  const targetPath = req.query.path || '/';
  const showFiles = req.query.files === '1';
  try {
    const items = readdirSync(targetPath);
    const entries = items.slice(0, 200).map(name => {
      try {
        const full = join(targetPath, name);
        const st = statSync(full);
        return { name, type: st.isDirectory() ? 'dir' : 'file' };
      } catch { return { name, type: 'unknown' }; }
    }).filter(e => showFiles ? (e.type === 'dir' || e.type === 'file') : e.type === 'dir');
    res.json({ path: targetPath, entries });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Download file (for file browser — actual file download)
app.get('/api/download', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    statSync(filePath);
    const filename = filePath.split('/').pop();
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.sendFile(filePath);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Read file content (for file browser UI)
app.get('/api/readfile', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  try {
    const st = statSync(filePath);
    if (st.size > 1024 * 1024) return res.status(413).json({ error: 'file too large (>1MB)' });
    const content = readFileSync(filePath, 'utf-8');
    res.json({ path: filePath, content, size: st.size });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Chat UI route (方案A)
app.get('/chat', (_req, res) => res.sendFile('chat.html', { root: join(__dirname, '..', 'web') }));

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
