/**
 * /api/v2 — 统一接口层（手机客户端友好）
 *
 * 所有响应使用标准化格式：
 *   { ok: true,  data: {...}, error: null, ts: <unix_ms> }
 *   { ok: false, data: null, error: "msg", ts: <unix_ms> }
 */
import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { agentManager } from '../core/agent-manager.js';
import { getRecentOutput, getOutputSinceTs, countOutput, getAllProviders } from '../store/db.js';

const execAsync = promisify(exec);

const router = Router();

// ── 标准响应包装工具 ────────────────────────────────────────────────────────

function ok(res, data, status = 200) {
  return res.status(status).json({ ok: true, data, error: null, ts: Date.now() });
}

function fail(res, message, status = 400) {
  return res.status(status).json({ ok: false, data: null, error: message, ts: Date.now() });
}

// ── GET /api/v2/agents — 列出所有 agent ────────────────────────────────────
router.get('/agents', (_req, res) => {
  const agents = agentManager.listAgents();
  return ok(res, agents);
});

// ── GET /api/v2/agents/:id — 获取单个 agent ────────────────────────────────
router.get('/agents/:id', (req, res) => {
  const agent = agentManager.getAgent(req.params.id);
  if (!agent) return fail(res, `Agent not found: ${req.params.id}`, 404);
  return ok(res, agent);
});

// ── GET /api/v2/agents/:id/history — 增量历史查询 ──────────────────────────
// 支持 ?since_ts=<unix_ms> 参数，只返回该时间戳之后的记录
router.get('/agents/:id/history', (req, res) => {
  const { id } = req.params;
  const agent = agentManager.getAgent(id);
  if (!agent) return fail(res, `Agent not found: ${id}`, 404);

  const sinceTs = req.query.since_ts ? parseInt(req.query.since_ts, 10) : null;
  const limit = Math.min(parseInt(req.query.limit) || 5000, 5000);

  let chunks;
  if (sinceTs != null && !isNaN(sinceTs)) {
    chunks = getOutputSinceTs(id, sinceTs, limit);
  } else {
    chunks = getRecentOutput(id, limit);
  }

  const total = countOutput(id);
  return ok(res, { chunks, total, since_ts: sinceTs });
});

// ── GET /api/v2/agents/:id/diff — 获取 agent cwd 的 git diff ─────────────
router.get('/agents/:id/diff', async (req, res) => {
  const { id } = req.params;
  const agent = agentManager.getAgent(id);
  if (!agent) return fail(res, `Agent not found: ${id}`, 404);

  const cwd = agent.config?.cwd ?? process.cwd();

  try {
    const { stdout } = await execAsync('git diff HEAD', { cwd, timeout: 10000 });
    return ok(res, { diff: stdout });
  } catch (err) {
    // 不是 git repo 或无 HEAD（空 repo）时返回空字符串
    return ok(res, { diff: '' });
  }
});

// ── POST /api/v2/agents/:id/input — 发送文字输入（替代 WS input）──────────
router.post('/agents/:id/input', (req, res) => {
  const { id } = req.params;
  const { text } = req.body ?? {};

  const agent = agentManager.getAgent(id);
  if (!agent) return fail(res, `Agent not found: ${id}`, 404);

  if (!text) return fail(res, 'text is required', 400);

  try {
    agentManager.writeRaw(id, text);
    return ok(res, { agentId: id });
  } catch (err) {
    return fail(res, err.message, 500);
  }
});

// ── GET /api/v2/providers — 列出所有 provider（标准格式，token 遮蔽）──────
router.get('/providers', (_req, res) => {
  const providers = getAllProviders().map(p => ({ ...p, auth_token: '***' }));
  return ok(res, providers);
});

export default router;
