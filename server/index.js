import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { mkdirSync, readdirSync, statSync, readFileSync } from 'fs';

import agentsRouter from './api/agents.js';
import filesRouter from './api/files.js';
import modelsRouter from './api/models.js';
import v2Router from './api/v2.js';
import providersRouter from './api/providers.js';
import authRouter from './api/auth.js';
import adminRouter from './api/admin.js';
import { authMiddleware, verifyWsToken } from './middleware/auth.js';
import { handleWS } from './ws.js';
import { agentManager } from './core/agent-manager.js';
import { getAllMemory, getRecentCommands, getUserByUsername, createUser } from './store/db.js';
import { createHash } from 'crypto';
import { signToken } from './api/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILES_DIR = process.env.FILES_DIR ?? join(process.cwd(), 'data', 'files');
mkdirSync(FILES_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(join(__dirname, '..', 'web')));

// Serve uploaded files
app.use('/files', express.static(FILES_DIR));

// Auth routes (public — no token required)
app.use('/api/auth', authRouter);

// Apply auth middleware to all /api/* routes
app.use('/api', authMiddleware());

// Admin routes (require admin token — checked inside adminRouter)
app.use('/api/admin', adminRouter);

// API routes
app.use('/api/agents', agentsRouter);
app.use('/api/files', filesRouter);
app.use('/api/models', modelsRouter);
app.use('/api/v2', v2Router);
app.use('/api/providers', providersRouter);

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

// Chat UI route
app.get('/chat', (_req, res) => res.sendFile('chat.html', { root: join(__dirname, '..', 'web') }));

// Admin UI route
app.get('/admin', (_req, res) => res.sendFile('admin.html', { root: join(__dirname, '..', 'web') }));

// Trigger restoreFromDB (for testing and manual restore)
app.post('/api/restore', (_req, res) => {
  agentManager.restoreFromDB();
  res.json({ ok: true });
});

// Health
app.get('/health', (_req, res) => res.json({ ok: true }));

// WebSocket
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  if (!verifyWsToken(req)) { ws.close(4001, 'unauthorized'); return; }
  handleWS(ws, req);
});

// Restore agents from DB on startup
agentManager.restoreFromDB();

// Seed super admin on startup if configured
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (ADMIN_USERNAME && ADMIN_PASSWORD) {
  const JWT_SECRET = process.env.JWT_SECRET ?? 'ai-hub-default-secret-change-in-prod';
  const passwordHash = createHash('sha256').update(ADMIN_PASSWORD + JWT_SECRET).digest('hex');
  if (!getUserByUsername(ADMIN_USERNAME)) {
    createUser({ username: ADMIN_USERNAME, passwordHash, isAdmin: true });
    console.log(`[auth] Super admin created: ${ADMIN_USERNAME}`);
  }
}

const PORT = process.env.PORT ?? 4280;
server.listen(PORT, () => {
  console.log(`claude-server v2 on http://localhost:${PORT}`);
});
