import { Router } from 'express';
import { agentManager } from '../../core/agent-manager.js';
import { getAllMemory, getRecentOutput, countOutput } from '../../store/db.js';

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
  const { name, type, adapterType, config } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const id = agentManager.createAgent({ name, type, adapterType, config });
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
  agentManager.restartAgent(id, newConfig);
  res.json({ ok: true, cwd: newConfig.cwd });
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
