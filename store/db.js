import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });

const dbPath = process.env.DB_PATH
  ? join(dirname(fileURLToPath(import.meta.url)), '..', process.env.DB_PATH)
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
    created_at INTEGER NOT NULL
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
`);

// ── Agents ────────────────────────────────────────────────────────────────

const insertAgent = db.prepare(
  'INSERT INTO agents (id, name, type, adapter_type, config, status, created_at) VALUES (?,?,?,?,?,?,?)'
);
const selectAgent = db.prepare('SELECT * FROM agents WHERE id = ?');
const selectAllAgents = db.prepare('SELECT * FROM agents ORDER BY created_at DESC');
const updateAgentStatus = db.prepare('UPDATE agents SET status = ? WHERE id = ?');
const updateAgentConfig = db.prepare('UPDATE agents SET config = ? WHERE id = ?');

export function saveAgent({ name, type = 'worker', adapterType = 'claude-code', config = {}, status = 'idle' }) {
  const id = randomUUID();
  insertAgent.run(id, name, type, adapterType, JSON.stringify(config), status, Date.now());
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
  'SELECT data FROM output_buffer WHERE agent_id = ? ORDER BY id DESC LIMIT ?'
);

export function appendOutput(agentId, data) {
  insertOutput.run(agentId, data, Date.now());
  pruneOutput.run(agentId, agentId);
}

export function getRecentOutput(agentId, n = 200) {
  return selectRecentOutput.all(agentId, n).reverse().map(r => r.data);
}
