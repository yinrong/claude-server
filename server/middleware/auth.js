import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'ai-hub-default-secret-change-in-prod';

// Returns Express middleware that enforces JWT auth.
// Skips auth when AUTH_DISABLED=true (single-user / dev mode).
export function authMiddleware() {
  if (process.env.AUTH_DISABLED === 'true') {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    // Allow auth endpoints without token (/api/auth/* → req.path = /auth/*)
    if (req.path.startsWith('/auth/')) return next();

    const header = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;

    if (!token) return res.status(401).json({ error: 'authentication required' });

    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ error: 'invalid or expired token' });
    }
  };
}

// Validate token for WebSocket upgrades (called before WS handler).
export function verifyWsToken(req) {
  if (process.env.AUTH_DISABLED === 'true') return true;
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token') ?? req.headers['authorization']?.slice(7);
  if (!token) return false;
  try { jwt.verify(token, JWT_SECRET); return true; } catch { return false; }
}
