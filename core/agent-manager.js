import { EventEmitter } from 'events';
import { spawn as spawnChild } from 'child_process';
import {
  saveAgent, getAgent, getAllAgents, setAgentStatus, setAgentConfig, deleteAgentFromDB,
  saveMessage, getMessages,
  getAllMemory, upsertMemoryItem, countMemoryUpdatedSince,
  appendOutput, getRecentOutput,
  recordCommand,
} from '../store/db.js';
import { MockAdapter } from './adapter/mock.js';
import { ClaudeCodeAdapter } from './adapter/claude-code.js';
import { ClaudeCodeStreamAdapter } from './adapter/claude-code-stream.js';

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

  // Send structured chat message (for stream adapter)
  async sendChat(agentId, text) {
    const session = this._sessions.get(agentId);
    if (!session) throw new Error(`Agent ${agentId} not found`);

    const adapter = session.adapter;
    if (adapter.type !== 'claude-code-stream') {
      // Fallback: write to PTY
      this.writeRaw(agentId, text + '\n');
      return;
    }

    const content = [{ type: 'text', text }];
    // Broadcast user message
    this._broadcast(agentId, { type: 'user_msg', text });

    // Stream adapter sends and streams back
    await adapter.sendMessage(content);
  }

  // Compact history for stream adapter
  async compactHistory(agentId) {
    const session = this._sessions.get(agentId);
    if (!session) return;
    if (session.adapter.type === 'claude-code-stream') {
      await session.adapter.compact();
    }
  }

  // Get chat history for stream adapter
  getChatHistory(agentId) {
    const session = this._sessions.get(agentId);
    if (!session) return [];
    if (session.adapter.type === 'claude-code-stream') {
      return session.adapter.history;
    }
    return [];
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

  triggerAnalysis(agentId, text) {
    if (!text || text.length < 20) return;
    const claudeBin = process.env.CLAUDE_BIN ?? 'claude';
    const prompt = `Analyze this conversation excerpt and extract user preferences as JSON array:
[{"category":"...", "key":"...", "value":"...", "confidence":0.8}]
Categories: 代码风格, 任务习惯, 工具偏好, 沟通偏好, 其他偏好.
If no clear preference, return [].
Excerpt: ${text.slice(-1500)}`;

    try {
      const proc = spawnChild(claudeBin, ['--print', '-p', prompt, '--bare'], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let output = '';
      proc.stdout.on('data', d => { output += d.toString(); });
      proc.on('close', () => {
        try {
          const match = output.match(/\[[\s\S]*\]/);
          if (match) {
            const items = JSON.parse(match[0]);
            for (const item of items) {
              if (item.category && item.key && item.value) {
                upsertMemoryItem({ ...item, sourceAgentId: agentId });
              }
            }
          }
        } catch { /* ignore parse errors */ }
      });
    } catch { /* ignore spawn errors — analysis is best-effort */ }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _wireAdapter(agentId, adapter) {
    const session = this._sessions.get(agentId);
    if (session) session.waitingForInput = false;
    let idleTimer = null;
    let outputBuffer = '';

    // PTY adapter events
    adapter.on('data', (data) => {
      appendOutput(agentId, data);
      this._broadcast(agentId, { type: 'output', data });

      if (session) {
        session.waitingForInput = false;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          session.waitingForInput = true;
          this._broadcast(agentId, { type: 'status', agentId, waitingForInput: true });
          this._checkDispatch(agentId, outputBuffer);
          outputBuffer = '';
        }, 2000);
      }

      outputBuffer += data;
      if (outputBuffer.length > 4096) outputBuffer = outputBuffer.slice(-4096);
    });

    adapter.on('exit', (code) => {
      if (session) session.waitingForInput = false;
      setAgentStatus(agentId, 'stopped');
      this._broadcast(agentId, { type: 'exit', code });
    });

    // Stream adapter events
    adapter.on('text', (text) => {
      this._broadcast(agentId, { type: 'stream_text', text });
      if (session) session.waitingForInput = false;
    });

    adapter.on('tool_start', (tool) => {
      this._broadcast(agentId, { type: 'tool_start', name: tool.name, id: tool.id });
    });

    adapter.on('tool', (tool) => {
      this._broadcast(agentId, { type: 'tool_done', name: tool.name, input: tool.input, id: tool.id });
    });

    adapter.on('result', (result) => {
      this._broadcast(agentId, { type: 'assistant_done', text: result.text, usage: result.usage });
      if (session) {
        session.waitingForInput = true;
        this._broadcast(agentId, { type: 'status', agentId, waitingForInput: true });
      }
      // Check @dispatch
      if (result.text) this._checkDispatch(agentId, result.text);
    });

    adapter.on('compacted', (summary) => {
      this._broadcast(agentId, { type: 'compacted', summary });
    });
  }

  _checkDispatch(fromAgentId, text) {
    // Strip ANSI codes for reliable pattern matching
    const clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const re = /@dispatch\s+([\w-]+):\s*(.+)/g;
    let m;
    while ((m = re.exec(clean)) !== null) {
      const toAgentId = m[1].trim();
      const task = m[2].trim();
      if (this._sessions.has(toAgentId)) {
        this.writeRaw(toAgentId, task + '\n');
        this._broadcast(fromAgentId, { type: 'dispatched', toAgentId, task });
      }
    }
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
      case 'claude-code-stream': return new ClaudeCodeStreamAdapter(config);
      case 'mock': return new MockAdapter(config);
      default: throw new Error(`Unknown adapter type: ${adapterType}`);
    }
  }
}

export const agentManager = new AgentManager();
