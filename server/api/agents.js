import { Router } from 'express';
import { hostname } from 'os';
import { readdirSync, statSync, createReadStream } from 'fs';
import { join, basename } from 'path';
import { ZipArchive } from 'archiver';
import { agentManager } from '../core/agent-manager.js';
import { getAllMemory, getRecentOutput, countOutput, setAgentSessionId } from '../store/db.js';

const router = Router();

// GET /api/agents
router.get('/', (_req, res) => {
  res.json(agentManager.listAgents());
});

// GET /api/agents/summaries — all agents' recent output (for Master to see)
// Must be BEFORE /:id to avoid "summaries" being treated as an id
router.get('/summaries', (_req, res) => {
  const agents = agentManager.listAgents();
  const summaries = agents.map(a => {
    const chunks = getRecentOutput(a.id, 50);
    const text = chunks.join('').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    return { agentId: a.id, name: a.name, type: a.type, alive: a.alive,
      waitingForInput: a.waitingForInput, text: text.slice(-1000) };
  });
  res.json(summaries);
});

// POST /api/agents
router.post('/', (req, res) => {
  const { name, type, adapterType, config, providerId } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const id = agentManager.createAgent({ name, type, adapterType, config, providerId });
    const agent = agentManager.getAgent(id);
    res.status(201).json(agent);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/agents/:id
router.get('/:id', (req, res) => {
  const agent = agentManager.getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'not found' });
  res.json(agent);
});

// DELETE /api/agents/:id
router.delete('/:id', (req, res) => {
  agentManager.deleteAgent(req.params.id);
  res.json({ ok: true });
});

// GET /api/agents/:id/history
router.get('/:id/history', (req, res) => {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 500, 5000);
  const offset = parseInt(req.query.offset) || 0;
  const chunks = getRecentOutput(id, limit, offset);
  const total = countOutput(id);
  res.json({ chunks, total, limit, offset });
});

// GET /api/agents/:id/summary
router.get('/:id/summary', (req, res) => {
  const chunks = getRecentOutput(req.params.id, 100);
  const text = chunks.join('').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  res.json({ agentId: req.params.id, text: text.slice(-2000) });
});

// POST /api/agents/:id/restart
router.post('/:id/restart', (req, res) => {
  const { id } = req.params;
  const { cwd } = req.body ?? {};
  const agent = agentManager.getAgent(id);
  if (!agent) return res.status(404).json({ error: 'not found' });
  const newConfig = { ...agent.config, ...(cwd ? { cwd } : {}) };
  // Inject last_session_id as resumeSessionId for PTY adapter
  if (agent.last_session_id) {
    newConfig.resumeSessionId = agent.last_session_id;
  }
  agentManager.restartAgent(id, newConfig);
  res.json({ ok: true, cwd: newConfig.cwd });
});

// POST /api/agents/:id/set-session — persist last_session_id to DB
router.post('/:id/set-session', (req, res) => {
  const { id } = req.params;
  const { sessionId } = req.body ?? {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const agent = agentManager.getAgent(id);
  if (!agent) return res.status(404).json({ error: 'not found' });
  setAgentSessionId(id, sessionId);
  res.json({ ok: true, sessionId });
});

// POST /api/agents/:id/analyze — trigger memory extraction from recent output
router.post('/:id/analyze', async (req, res) => {
  const agent = agentManager.getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'not found' });
  const chunks = getRecentOutput(req.params.id, 50);
  const text = chunks.join('').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  // In production, this would call claude --print to analyze.
  // For now, acknowledge the request (async analysis runs in background)
  agentManager.triggerAnalysis(req.params.id, text);
  res.json({ ok: true, textLength: text.length });
});

// GET /api/agents/:id/workspace — returns SSH/VSCode Remote SSH connection info
// Lets users open the agent's working directory in VSCode via Remote SSH.
router.get('/:id/workspace', (req, res) => {
  const agent = agentManager.getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const cwd = agent.config?.cwd ?? process.cwd();
  const sshHost = process.env.SSH_HOST ?? hostname();
  const sshPort = parseInt(process.env.SSH_PORT ?? '22');
  const sshUser = process.env.SSH_USER ?? process.env.USER ?? 'user';
  // vscode-remote://ssh-remote+user@host/path
  const vscodeUri = `vscode-remote://ssh-remote+${sshUser}@${sshHost}${cwd}`;
  res.json({ ssh_host: sshHost, ssh_port: sshPort, ssh_user: sshUser, cwd, vscode_uri: vscodeUri });
});

// ── File detection & download helpers ────────────────────────────────────────

function listAgentFiles(cwd) {
  try {
    return readdirSync(cwd)
      .map(name => {
        const full = join(cwd, name);
        try {
          const st = statSync(full);
          if (!st.isFile()) return null;
          return { name, path: full, mtime: st.mtimeMs, size: st.size,
            download_url: `/api/download?path=${encodeURIComponent(full)}` };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
}

// GET /api/agents/:id/files — list cwd files sorted by mtime desc
router.get('/:id/files', (req, res) => {
  const agent = agentManager.getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const cwd = agent.config?.cwd ?? process.cwd();
  res.json({ cwd, files: listAgentFiles(cwd) });
});

// POST /api/agents/:id/zip — zip selected files and stream download
router.post('/:id/zip', (req, res) => {
  const agent = agentManager.getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const { paths } = req.body ?? {};
  if (!Array.isArray(paths) || paths.length === 0)
    return res.status(400).json({ error: 'paths array required' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="files.zip"');

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('error', err => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
  archive.pipe(res);
  for (const p of paths) {
    try { archive.file(p, { name: basename(p) }); } catch { /* skip inaccessible */ }
  }
  archive.finalize();
});

// POST /api/agents/:id/notify-files — scan cwd and broadcast file_created WS event
router.post('/:id/notify-files', (req, res) => {
  const agent = agentManager.getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'agent not found' });
  const cwd = agent.config?.cwd ?? process.cwd();
  const files = listAgentFiles(cwd);
  agentManager.broadcastToAgent(req.params.id, { type: 'file_created', files });
  res.json({ ok: true, count: files.length });
});

// POST /api/agents/:id/inject — Master injects text into Worker's PTY
router.post('/:id/inject', (req, res) => {
  const { text } = req.body ?? {};
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    agentManager.writeRaw(req.params.id, text);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
