import { Router } from 'express';
import { upsertModels, getAllModels, clearModels } from '../store/db.js';

const router = Router();

/**
 * Default model list (used when proxy does not support model listing,
 * or ANTHROPIC_BASE_URL is not set).
 */
const DEFAULT_MODELS = [
  { name: 'anthropic/claude-opus-4-8',   display_name: 'Claude Opus 4 (Extended)' },
  { name: 'anthropic/claude-sonnet-4-6', display_name: 'Claude Sonnet 4 (1M)' },
  { name: 'anthropic/claude-haiku-4-5',  display_name: 'Claude Haiku 4' },
];

/**
 * Try to fetch model list from the proxy's /v1/models endpoint.
 * Falls back to DEFAULT_MODELS on any error.
 */
async function fetchModelsFromProxy() {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  if (!baseUrl) return DEFAULT_MODELS;

  try {
    // Strip /anthropic suffix if present — models endpoint is at /v1/models on the proxy root
    const proxyRoot = baseUrl.replace(/\/anthropic\/?$/, '').replace(/\/$/, '');
    const url = `${proxyRoot}/v1/models`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? ''}`,
        'x-api-key': process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return DEFAULT_MODELS;
    const body = await res.json();
    // OpenAI-compatible format: { data: [{ id, ... }] }
    const data = Array.isArray(body.data) ? body.data : [];
    const llmModels = data.filter(m => !m.model_type || m.model_type === 'llm');
    if (llmModels.length === 0) return DEFAULT_MODELS;
    return llmModels.map(m => {
      const name = m.owned_by ? `${m.owned_by}/${m.id}` : m.id;
      return { name, display_name: name };
    });
  } catch {
    return DEFAULT_MODELS;
  }
}

// GET /api/models — return cached model list from DB
router.get('/', (_req, res) => {
  const models = getAllModels();
  res.json(models);
});

// POST /api/models/refresh — fetch from proxy (or use defaults) and persist
router.post('/refresh', async (_req, res) => {
  try {
    const models = await fetchModelsFromProxy();
    clearModels();
    upsertModels(models);
    const saved = getAllModels();
    res.json({ ok: true, models: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
