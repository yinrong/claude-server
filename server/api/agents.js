import { Router } from 'express';
import { agentManager } from '../../core/agent-manager.js';
import { getAllMemory, getRecentOutput, countOutput } from '../../store/db.js';

const router = Router();

// GET /api/agents
router.get('/', (_req, res) => {
  res.json(agentManager.listAgents());
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

// GET /api/agents/:id/history — paginated output buffer
router.get('/:id/history', (req, res) => {
  const { id } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 500, 5000);
  const offset = parseInt(req.query.offset) || 0;
  const chunks = getRecentOutput(id, limit, offset);
  const total = countOutput(id);
  res.json({ chunks, total, limit, offset });
});

// GET /api/memory
router.get('/memory/all', (_req, res) => {
  res.json(getAllMemory());
});

export default router;
