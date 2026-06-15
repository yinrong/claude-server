import { Router } from 'express';
import {
  saveProvider, getProvider, getAllProviders, updateProvider,
  deleteProvider, setDefaultProvider,
} from '../store/db.js';

const router = Router();

// Mask auth_token in response
function maskProvider(p) {
  return { ...p, auth_token: '***' };
}

// GET /api/providers
router.get('/', (_req, res) => {
  res.json(getAllProviders().map(maskProvider));
});

// POST /api/providers
router.post('/', (req, res) => {
  const { name, base_url, auth_token, use_model_proxy = 0, is_default = 0 } = req.body ?? {};
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!base_url) return res.status(400).json({ error: 'base_url required' });
  if (!auth_token) return res.status(400).json({ error: 'auth_token required' });
  try {
    const id = saveProvider({ name, base_url, auth_token, use_model_proxy, is_default });
    const provider = getProvider(id);
    res.status(201).json(maskProvider(provider));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/providers/:id
router.get('/:id', (req, res) => {
  const provider = getProvider(req.params.id);
  if (!provider) return res.status(404).json({ error: 'not found' });
  res.json(maskProvider(provider));
});

// PUT /api/providers/:id
router.put('/:id', (req, res) => {
  const provider = getProvider(req.params.id);
  if (!provider) return res.status(404).json({ error: 'not found' });
  try {
    updateProvider(req.params.id, req.body ?? {});
    res.json(maskProvider(getProvider(req.params.id)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/providers/:id
router.delete('/:id', (req, res) => {
  const provider = getProvider(req.params.id);
  if (!provider) return res.status(404).json({ error: 'not found' });
  try {
    deleteProvider(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/providers/:id/set-default
router.post('/:id/set-default', (req, res) => {
  try {
    setDefaultProvider(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
