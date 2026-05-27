import { EventEmitter } from 'events';
import {
  saveAgent, getAgent, getAllAgents, setAgentStatus, setAgentConfig, deleteAgentFromDB,
  saveMessage, getMessages,
  getAllMemory, upsertMemoryItem, countMemoryUpdatedSince,
  appendOutput, getRecentOutput,
  recordCommand,
} from '../store/db.js';
import { MockAdapter } from './adapter/mock.js';
import { ClaudeCodeAdapter } from './adapter/claude-code.js';

class AgentManager extends EventEmitter {
  constructor() {
    super();
    // Map<agentId, { config, adapter, subscribers: Set<ws> }>
    this._sessions = new Map();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  createAgent({ name, type = 'worker', adapterType = 'claude-code', config = {} }) {
    const finalConfig = { cwd: process.cwd(), ...config };
    const id = saveAgent({ name, type, adapterType, config: finalConfig });
    const adapter = this._makeAdapter(adapterType, finalConfig);
    const session = { config: getAgent(id), adapter, subscribers: new Set() };
    this._sessions.set(id, session);
    this._wireAdapter(id, adapter);
    recordCommand(finalConfig.cwd, adapterType);
    return id;
  }

  getAgent(id) {
    const dbAgent = getAgent(id);
    if (!dbAgent) return null;
    const live = this._sessions.get(id);
    return {
      ...dbAgent,
      alive: live?.adapter?.alive ?? false,
      subscribers: live?.subscribers?.size ?? 0,
      waitingForInput: live?.waitingForInput ?? false,
    };
  }

  listAgents() {
    return getAllAgents().map(a => {
      const live = this._sessions.get(a.id);
      return {
        ...a,
        alive: live?.adapter?.alive ?? false,
        subscribers: live?.subscribers?.size ?? 0,
        waitingForInput: live?.waitingForInput ?? false,
      };
    });
  }

  restartAgent(agentId, newConfig) {
    const session = this._sessions.get(agentId);
    if (!session) throw new Error(`Agent ${agentId} not found`);
    session.adapter.restart(newConfig);
    setAgentConfig(agentId, newConfig);
    session.config.config = newConfig;
    this._wireAdapter(agentId, session.adapter);
    this._broadcast(agentId, { type: 'status', agentId, restarted: true, cwd: newConfig.cwd });
    recordCommand(newConfig.cwd, session.config.adapter_type ?? 'claude-code');
  }

  deleteAgent(agentId) {
    const session = this._sessions.get(agentId);
    if (session) {
      session.adapter.stop();
      this._sessions.delete(agentId);
    }
    deleteAgentFromDB(agentId);
  }

  subscribe(agentId, ws) {
    const session = this._sessions.get(agentId);
    if (session) session.subscribers.add(ws);
  }

  unsubscribe(agentId, ws) {
    const session = this._sessions.get(agentId);
    if (session) session.subscribers.delete(ws);
  }

  getHistory(agentId) {
    return getRecentOutput(agentId, 200);
  }

  // Write raw input to agent's PTY
  sendMessage(agentId, content) {
    const session = this._sessions.get(agentId);
    if (!session) throw new Error(`Agent ${agentId} not found`);

    // Extract text from structured content
    const text = content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    if (text) {
      session.adapter.write(text);
    }

    // Handle file references — inject paths
    for (const c of content) {
      if (c.type === 'image' || c.type === 'file') {
        session.adapter.write(`${c.path ?? c.url}\n`);
      }
    }
  }

  // Write raw string directly to PTY (for keyboard input from xterm)
  writeRaw(agentId, data) {
    const session = this._sessions.get(agentId);
    if (session?.adapter?.alive) {
      session.adapter.write(data);
    }
  }

  resize(agentId, cols, rows) {
    const session = this._sessions.get(agentId);
    if (session?.adapter) {
      session.adapter.resize(cols, rows);
    }
  }

  // Restore persisted agents on startup
  restoreFromDB() {
    for (const agent of getAllAgents()) {
      if (!this._sessions.has(agent.id)) {
        const adapter = this._makeAdapter(agent.adapter_type, agent.config);
        const session = { config: agent, adapter, subscribers: new Set() };
        this._sessions.set(agent.id, session);
        this._wireAdapter(agent.id, adapter);
      }
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _wireAdapter(agentId, adapter) {
    const session = this._sessions.get(agentId);
    if (session) session.waitingForInput = false;
    let idleTimer = null;

    adapter.on('data', (data) => {
      appendOutput(agentId, data);
      this._broadcast(agentId, { type: 'output', data });

      // Detect idle/waiting state: if no output for 2 seconds after a prompt-like character
      if (session) {
        session.waitingForInput = false;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          session.waitingForInput = true;
          this._broadcast(agentId, { type: 'status', agentId, waitingForInput: true });
        }, 2000);
      }
    });
    adapter.on('exit', (code) => {
      if (session) session.waitingForInput = false;
      setAgentStatus(agentId, 'stopped');
      this._broadcast(agentId, { type: 'exit', code });
    });
  }

  _broadcast(agentId, msg) {
    const session = this._sessions.get(agentId);
    if (!session) return;
    const json = JSON.stringify(msg);
    for (const ws of session.subscribers) {
      if (ws.readyState === 1) ws.send(json);
    }
  }

  _makeAdapter(adapterType, config) {
    switch (adapterType) {
      case 'claude-code': return new ClaudeCodeAdapter(config);
      case 'mock': return new MockAdapter(config);
      default: throw new Error(`Unknown adapter type: ${adapterType}`);
    }
  }
}

export const agentManager = new AgentManager();
