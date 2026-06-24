import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const DATA_DIR = join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });

const dbPath = process.env.DB_PATH
  ? join(process.cwd(), process.env.DB_PATH)
  : join(DATA_DIR, 'claude-server.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'worker',   -- 'master' | 'worker'
    adapter_type TEXT NOT NULL DEFAULT 'claude-code',
    config TEXT NOT NULL DEFAULT '{}',     -- JSON: {cwd, systemPrompt, ...}
    status TEXT NOT NULL DEFAULT 'idle',   -- 'idle' | 'running' | 'error'
    created_at INTEGER NOT NULL,
    last_session_id TEXT                   -- claude session id for --resume on restart
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL,          -- 'user' | 'assistant' | 'dispatch'
    content TEXT NOT NULL,       -- JSON array of ContentBlock
    from_agent_id TEXT,          -- set when role='dispatch'
    ts INTEGER NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id, ts);

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,          -- absolute path on disk
    url TEXT NOT NULL,           -- web-accessible URL
    mime_type TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recent_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cwd TEXT NOT NULL,
    adapter_type TEXT NOT NULL DEFAULT 'claude-code',
    ts INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS output_buffer (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    data TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_output_agent ON output_buffer(agent_id, id);

  CREATE TABLE IF NOT EXISTS memory (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,      -- '代码风格' | '任务习惯' | '工具偏好' | '沟通偏好'
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL DEFAULT 0.8,
    source_agent_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(category, key)
  );

  CREATE TABLE IF NOT EXISTS models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    base_url TEXT NOT NULL,
    auth_token TEXT NOT NULL,
    use_model_proxy INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`);

// ── Migrations ─────────────────────────────────────────────────────────────
// Add last_session_id column to agents if it doesn't exist (idempotent migration)
try {
  db.exec(`ALTER TABLE agents ADD COLUMN last_session_id TEXT`);
} catch (_e) {
  // Column already exists — ignore
}

// Add provider_id column to agents if it doesn't exist (idempotent migration)
try {
  db.exec(`ALTER TABLE agents ADD COLUMN provider_id TEXT`);
} catch (_e) {
  // Column already exists — ignore
}

// ── Providers seed ────────────────────────────────────────────────────────
// On first startup (providers table empty), seed from env vars
{
  const providerCount = db.prepare('SELECT COUNT(*) as n FROM providers').get();
  if (providerCount.n === 0) {
    const baseUrl = process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com';
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? '';
    db.prepare(
      'INSERT INTO providers (id, name, base_url, auth_token, use_model_proxy, is_default, created_at) VALUES (?,?,?,?,?,?,?)'
    ).run(randomUUID(), 'mify', baseUrl, authToken, 0, 1, Date.now());
  }
}

// ── Agents ────────────────────────────────────────────────────────────────

const insertAgent = db.prepare(
  'INSERT INTO agents (id, name, type, adapter_type, config, status, created_at, provider_id) VALUES (?,?,?,?,?,?,?,?)'
);
const selectAgent = db.prepare('SELECT * FROM agents WHERE id = ?');
const selectAllAgents = db.prepare('SELECT * FROM agents ORDER BY created_at DESC');
const updateAgentStatus = db.prepare('UPDATE agents SET status = ? WHERE id = ?');
const updateAgentConfig = db.prepare('UPDATE agents SET config = ? WHERE id = ?');

export function saveAgent({ name, type = 'worker', adapterType = 'claude-code', config = {}, status = 'idle' }) {
  const id = randomUUID();
  const providerId = config.providerId ?? null;
  insertAgent.run(id, name, type, adapterType, JSON.stringify(config), status, Date.now(), providerId);
  return id;
}

export function getAgent(id) {
  const row = selectAgent.get(id);
  if (!row) return null;
  return { ...row, config: JSON.parse(row.config) };
}

export function getAllAgents() {
  return selectAllAgents.all().map(r => ({ ...r, config: JSON.parse(r.config) }));
}

export function setAgentStatus(id, status) {
  updateAgentStatus.run(status, id);
}

export function setAgentConfig(id, config) {
  updateAgentConfig.run(JSON.stringify(config), id);
}

const updateAgentSessionId = db.prepare('UPDATE agents SET last_session_id = ? WHERE id = ?');

export function setAgentSessionId(id, sessionId) {
  updateAgentSessionId.run(sessionId, id);
}

const deleteAgentStmt = db.prepare('DELETE FROM agents WHERE id = ?');
const deleteAgentOutput = db.prepare('DELETE FROM output_buffer WHERE agent_id = ?');

export function deleteAgentFromDB(id) {
  deleteAgentOutput.run(id);
  deleteAgentStmt.run(id);
}

// ── Messages ───────────────────────────────────────────────────────────────

const MAX_MSG_PER_AGENT = 2000;

const insertMessage = db.prepare(
  'INSERT INTO messages (id, agent_id, role, content, from_agent_id, ts) VALUES (?,?,?,?,?,?)'
);
const pruneMessages = db.prepare(`
  DELETE FROM messages WHERE agent_id = ? AND id NOT IN (
    SELECT id FROM messages WHERE agent_id = ? ORDER BY ts DESC LIMIT ${MAX_MSG_PER_AGENT}
  )
`);
const selectMessages = db.prepare(
  'SELECT * FROM messages WHERE agent_id = ? ORDER BY ts ASC LIMIT ?'
);

export function saveMessage({ agentId, role, content, fromAgentId = null }) {
  const id = randomUUID();
  insertMessage.run(id, agentId, role, JSON.stringify(content), fromAgentId, Date.now());
  pruneMessages.run(agentId, agentId);
  return id;
}

export function getMessages(agentId, limit = 200) {
  return selectMessages.all(agentId, limit).map(r => ({
    ...r,
    content: JSON.parse(r.content),
  }));
}

// ── Files ──────────────────────────────────────────────────────────────────

const insertFile = db.prepare(
  'INSERT INTO files (id, name, path, url, mime_type, created_at) VALUES (?,?,?,?,?,?)'
);
const selectFile = db.prepare('SELECT * FROM files WHERE id = ?');

export function saveFile({ name, path, url, mimeType }) {
  const id = randomUUID();
  insertFile.run(id, name, path, url, mimeType ?? null, Date.now());
  return id;
}

export function getFile(id) {
  return selectFile.get(id);
}

// ── Memory ─────────────────────────────────────────────────────────────────

const upsertMemory = db.prepare(`
  INSERT INTO memory (id, category, key, value, confidence, source_agent_id, created_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?)
  ON CONFLICT(category, key) DO UPDATE SET
    value = excluded.value,
    confidence = excluded.confidence,
    source_agent_id = excluded.source_agent_id,
    updated_at = excluded.updated_at
`);
const selectAllMemory = db.prepare('SELECT * FROM memory ORDER BY category, key');
const countMemorySince = db.prepare('SELECT COUNT(*) as n FROM memory WHERE updated_at > ?');

export function upsertMemoryItem({ category, key, value, confidence = 0.8, sourceAgentId }) {
  upsertMemory.run(randomUUID(), category, key, value, confidence, sourceAgentId ?? null, Date.now(), Date.now());
}

export function getAllMemory() {
  return selectAllMemory.all();
}

export function countMemoryUpdatedSince(ts) {
  return countMemorySince.get(ts).n;
}

// ── Output Buffer (PTY raw output) ───────────────────────────────────────

const MAX_OUTPUT = 5000;

const insertOutput = db.prepare(
  'INSERT INTO output_buffer (agent_id, data, ts) VALUES (?, ?, ?)'
);
const pruneOutput = db.prepare(`
  DELETE FROM output_buffer WHERE agent_id = ? AND id NOT IN (
    SELECT id FROM output_buffer WHERE agent_id = ? ORDER BY id DESC LIMIT ${MAX_OUTPUT}
  )
`);
const selectRecentOutput = db.prepare(
  'SELECT data FROM output_buffer WHERE agent_id = ? ORDER BY id DESC LIMIT ? OFFSET ?'
);
const countOutputStmt = db.prepare(
  'SELECT COUNT(*) as n FROM output_buffer WHERE agent_id = ?'
);

export function appendOutput(agentId, data) {
  insertOutput.run(agentId, data, Date.now());
  pruneOutput.run(agentId, agentId);
}

export function getRecentOutput(agentId, n = 200, offset = 0) {
  return selectRecentOutput.all(agentId, n, offset).reverse().map(r => r.data);
}

export function countOutput(agentId) {
  return countOutputStmt.get(agentId).n;
}

const selectOutputSinceTs = db.prepare(
  'SELECT data FROM output_buffer WHERE agent_id = ? AND ts > ? ORDER BY id ASC LIMIT ?'
);

export function getOutputSinceTs(agentId, sinceTs, limit = 5000) {
  return selectOutputSinceTs.all(agentId, sinceTs, limit).map(r => r.data);
}

// ── Recent Commands ──────────────────────────────────────────────────────

const insertCommand = db.prepare(
  'INSERT INTO recent_commands (cwd, adapter_type, ts) VALUES (?, ?, ?)'
);
const selectRecentCommands = db.prepare(
  'SELECT DISTINCT cwd, adapter_type, MAX(ts) as ts FROM recent_commands GROUP BY cwd ORDER BY ts DESC LIMIT 20'
);

export function recordCommand(cwd, adapterType = 'claude-code') {
  insertCommand.run(cwd, adapterType, Date.now());
}

export function getRecentCommands() {
  return selectRecentCommands.all();
}

// ── Models ────────────────────────────────────────────────────────────────

const upsertModel = db.prepare(`
  INSERT INTO models (name, display_name, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(name) DO UPDATE SET
    display_name = excluded.display_name,
    updated_at = excluded.updated_at
`);
const selectAllModels = db.prepare('SELECT * FROM models ORDER BY id ASC');

export function upsertModels(models) {
  const now = new Date().toISOString();
  const upsertMany = db.transaction((list) => {
    for (const m of list) {
      upsertModel.run(m.name, m.display_name ?? m.name, now);
    }
  });
  upsertMany(models);
}

export function getAllModels() {
  return selectAllModels.all();
}

export function clearModels() {
  db.prepare('DELETE FROM models').run();
}

// ── Providers ─────────────────────────────────────────────────────────────

const insertProvider = db.prepare(
  'INSERT INTO providers (id, name, base_url, auth_token, use_model_proxy, is_default, created_at) VALUES (?,?,?,?,?,?,?)'
);
const selectProvider = db.prepare('SELECT * FROM providers WHERE id = ?');
const selectDefaultProvider = db.prepare('SELECT * FROM providers WHERE is_default = 1 LIMIT 1');
const selectAllProviders = db.prepare('SELECT * FROM providers ORDER BY created_at ASC');
const deleteProviderStmt = db.prepare('DELETE FROM providers WHERE id = ?');
const clearDefaultProviders = db.prepare('UPDATE providers SET is_default = 0');
const setDefaultProviderStmt = db.prepare('UPDATE providers SET is_default = 1 WHERE id = ?');
const countAgentsByProvider = db.prepare('SELECT COUNT(*) as n FROM agents WHERE provider_id = ?');

export function saveProvider({ name, base_url, auth_token, use_model_proxy = 0, is_default = 0 }) {
  const id = randomUUID();
  if (is_default) {
    clearDefaultProviders.run();
  }
  insertProvider.run(id, name, base_url, auth_token, use_model_proxy ? 1 : 0, is_default ? 1 : 0, Date.now());
  return id;
}

export function getProvider(id) {
  return selectProvider.get(id) ?? null;
}

export function getDefaultProvider() {
  return selectDefaultProvider.get() ?? null;
}

export function getAllProviders() {
  return selectAllProviders.all();
}

export function updateProvider(id, fields) {
  const allowed = ['name', 'base_url', 'auth_token', 'use_model_proxy', 'is_default'];
  const updates = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (updates.length === 0) return;
  const setClauses = updates.map(([k]) => `${k} = ?`).join(', ');
  const values = updates.map(([, v]) => v);
  db.prepare(`UPDATE providers SET ${setClauses} WHERE id = ?`).run(...values, id);
}

export function deleteProvider(id) {
  const ref = countAgentsByProvider.get(id);
  if (ref && ref.n > 0) throw new Error(`Provider is referenced by ${ref.n} agent(s)`);
  deleteProviderStmt.run(id);
}

export function setDefaultProvider(id) {
  const provider = selectProvider.get(id);
  if (!provider) throw new Error(`Provider not found: ${id}`);
  db.transaction(() => {
    clearDefaultProviders.run();
    setDefaultProviderStmt.run(id);
  })();
}

// ── Users ──────────────────────────────────────────────────────────────────
export function createUser({ username, passwordHash, isAdmin = false }) {
  const id = randomUUID();
  const now = Date.now();
  db.prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?,?,?,?,?)').run(id, username, passwordHash, isAdmin ? 1 : 0, now);
  return { id, username, is_admin: isAdmin ? 1 : 0, created_at: now };
}

export function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) ?? null;
}

export function getAllUsers() {
  return db.prepare('SELECT id, username, is_admin, created_at FROM users ORDER BY created_at ASC').all();
}

export function updateUserPassword(id, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}

export function deleteUser(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}
