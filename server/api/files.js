import { Router } from 'express';
import { storeFile } from '../../store/files.js';

const router = Router();

// POST /api/files  { data: 'data:image/png;base64,...', name: 'foo.png' }
router.post('/', (req, res) => {
  const { data, name = 'upload' } = req.body ?? {};
  if (!data) return res.status(400).json({ error: 'data required' });
  try {
    const result = storeFile(data, name);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
