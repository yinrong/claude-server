/**
 * Local proxy that fixes the model name for claude-code --continue/--resume.
 *
 * Problem: claude-code strips the "ppio/" prefix from model IDs on session resume,
 * sending "pa/claude-opus-4-6" instead of "ppio/pa/claude-opus-4-6".
 * PPIO rejects the truncated name with 400.
 *
 * Solution: intercept requests and prepend "ppio/" if the model doesn't already have it.
 *
 * Usage:
 *   node model-proxy.js
 *   # Then set ANTHROPIC_BASE_URL=http://127.0.0.1:4290/anthropic
 *
 * Or configure in ~/.claude/settings.json:
 *   "ANTHROPIC_BASE_URL": "http://127.0.0.1:4290/anthropic"
 */
import http from 'http';

const UPSTREAM = process.env.UPSTREAM_URL || 'http://model.mify.ai.srv';
const PORT = parseInt(process.env.PROXY_PORT || '4290');
const MODEL_PREFIX = 'ppio/';

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    // Fix model in POST requests to messages endpoint
    if (req.method === 'POST' && body) {
      try {
        const parsed = JSON.parse(body);
        if (parsed.model && !parsed.model.startsWith(MODEL_PREFIX)) {
          parsed.model = MODEL_PREFIX + parsed.model;
          body = JSON.stringify(parsed);
        }
      } catch {}
    }

    const url = new URL(req.url, UPSTREAM);
    const proxyReq = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: req.method,
      headers: {
        ...req.headers,
        host: url.host,
        'content-length': Buffer.byteLength(body),
      },
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      res.writeHead(502);
      res.end(JSON.stringify({ error: { message: `Proxy error: ${err.message}` } }));
    });

    proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Model-fix proxy running on http://127.0.0.1:${PORT}`);
  console.log(`Upstream: ${UPSTREAM}`);
  console.log(`Auto-prepending "${MODEL_PREFIX}" to model names`);
});
