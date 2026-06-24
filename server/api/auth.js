import { Router } from 'express';
import { createHash } from 'crypto';
import jwt from 'jsonwebtoken';
import { createUser, getUserByUsername } from '../store/db.js';

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? 'ai-hub-default-secret-change-in-prod';

function hashPassword(password) {
  return createHash('sha256').update(password + JWT_SECRET).digest('hex');
}

export function signToken(userId, username, isAdmin = false) {
  return jwt.sign({ sub: userId, username, is_admin: isAdmin ? 1 : 0 }, JWT_SECRET, { expiresIn: '30d' });
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (username.length < 2) return res.status(400).json({ error: 'username too short' });
  if (password.length < 6) return res.status(400).json({ error: 'password too short (min 6)' });

  try {
    const user = createUser({ username, passwordHash: hashPassword(password) });
    const token = signToken(user.id, user.username, user.is_admin);
    res.status(201).json({ token, username: user.username });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'username already taken' });
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });

  const user = getUserByUsername(username);
  if (!user || user.password_hash !== hashPassword(password)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const token = signToken(user.id, user.username, user.is_admin);
  res.json({ token, username: user.username, is_admin: user.is_admin });
});

export default router;
