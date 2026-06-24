import { Router } from 'express';
import { createHash } from 'crypto';
import { getAllUsers, createUser, updateUserPassword, deleteUser } from '../store/db.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'ai-hub-default-secret-change-in-prod';

function hashPassword(password) {
  return createHash('sha256').update(password + JWT_SECRET).digest('hex');
}

// Admin guard middleware
function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'admin required' });
  next();
}

router.use(requireAdmin);

// GET /api/admin/users
router.get('/users', (_req, res) => {
  res.json({ users: getAllUsers() });
});

// POST /api/admin/users — add user
router.post('/users', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'password too short (min 6)' });
  try {
    const user = createUser({ username, passwordHash: hashPassword(password) });
    res.status(201).json({ id: user.id, username: user.username });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'username already taken' });
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/admin/users/:id/password
router.patch('/users/:id/password', (req, res) => {
  const { password } = req.body ?? {};
  if (!password || password.length < 6) return res.status(400).json({ error: 'password too short (min 6)' });
  updateUserPassword(req.params.id, hashPassword(password));
  res.json({ ok: true });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
  if (req.params.id === req.user.sub) return res.status(400).json({ error: 'cannot delete yourself' });
  deleteUser(req.params.id);
  res.json({ ok: true });
});

export default router;
