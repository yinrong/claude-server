import { spawn } from 'child_process';
import { EventEmitter } from 'events';

/**
 * ClaudeCodeStreamAdapter — stream-json API mode.
 *
 * Uses `claude --print --input-format stream-json --output-format stream-json`
 * per turn. Each user message spawns a new process with full conversation
 * history in stdin. Claude handles tools internally.
 *
 * Events:
 *   'text'    (string)           — streaming text chunk
 *   'tool'    ({name, input})    — tool call started
 *   'result'  ({text, usage})    — turn complete
 *   'error'   (string)           — error occurred
 *
 * No PTY, no xterm dependency. All rendering done by custom UI.
 */
export class ClaudeCodeStreamAdapter extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this._proc = null;
    this._history = []; // [{role: 'user'|'assistant', content: [...]}]
    this._alive = true;
  }

  get type() { return 'claude-code-stream'; }
  get alive() { return this._alive; }
  get history() { return this._history; }

  async sendMessage(content) {
    if (this._proc) return; // don't allow concurrent sends

    const { cwd = process.cwd(), systemPrompt } = this.config;
    const claudeBin = process.env.CLAUDE_BIN ?? 'claude';

    // Encode history in --append-system-prompt (NOT stdin) to avoid
    // the multi-response bug where claude responds to each user message in stdin
    let historyPrompt = systemPrompt ?? '';
    if (this._history.length > 0) {
      const turns = this._history.map(m => {
        const text = m.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
        return `<turn><role>${m.role}</role><content>${text}</content></turn>`;
      }).join('\n');
      historyPrompt += `\n\n<conversation_history>\n${turns}\n</conversation_history>`;
    }

    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
      '--no-session-persistence',
      '--include-partial-messages',
    ];
    if (historyPrompt.trim()) args.push('--append-system-prompt', historyPrompt);

    const proc = spawn(claudeBin, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this._proc = proc;

    // Only send the NEW user message via stdin (plain text, not stream-json)
    const newText = content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    proc.stdin.write(newText);
    proc.stdin.end();

    // Save user message to history (will be removed if turn fails)
    this._history.push({ role: 'user', content });

    // Parse stdout
    let buffer = '';
    let fullText = '';
    let resultEmitted = false;
    const toolCalls = [];

    proc.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'result') resultEmitted = true;
          this._handleEvent(evt, { fullText: () => fullText, setFullText: (t) => { fullText = t; }, toolCalls, setResultText: (t) => { resultText = t; } });
        } catch {}
      }
    });

    let stderrBuf = '';
    proc.stderr.on('data', (d) => { stderrBuf += d.toString(); });

    let resultText = '';

    return new Promise((resolve) => {
      proc.on('close', (code) => {
        // Process ALL remaining lines in buffer
        if (buffer.trim()) {
          for (const line of buffer.split('\n')) {
            if (!line.trim()) continue;
            try {
              const evt = JSON.parse(line);
              if (evt.type === 'result') resultEmitted = true;
              this._handleEvent(evt, {
                fullText: () => fullText,
                setFullText: (t) => { fullText = t; },
                toolCalls,
                setResultText: (t) => { resultText = t; },
              });
            } catch {}
          }
        }

        const finalText = fullText || resultText;

        // If process exited without emitting a 'result' event, emit one now
        // so clients always exit streaming state
        if (!resultEmitted) {
          const errorMsg = stderrBuf.trim() || (code ? `进程退出 (code ${code})` : '');
          const text = finalText || errorMsg || '';
          this.emit('result', { text, isError: !!code || !finalText, usage: null });
        }

        // Only save if not already saved in _handleEvent (race condition fix)
        if (!this._historySavedForCurrentTurn && finalText) {
          const assistantContent = [{ type: 'text', text: finalText }];
          for (const t of toolCalls) {
            assistantContent.push({ type: 'tool_use', name: t.name, input: t.input });
          }
          this._history.push({ role: 'assistant', content: assistantContent });
        }

        // If no assistant response was saved, remove the orphaned user message
        if (!this._historySavedForCurrentTurn && !finalText) {
          this._history.pop();
        }
        this._historySavedForCurrentTurn = false;

        this._proc = null;
        resolve({ text: finalText, toolCalls });
      });
    });
  }

  _handleEvent(evt, ctx) {
    if (evt.type === 'stream_event') {
      const e = evt.event;
      if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
        ctx.setFullText(ctx.fullText() + e.delta.text);
        this.emit('text', e.delta.text);
      } else if (e?.type === 'content_block_start' && e.content_block?.type === 'tool_use') {
        this.emit('tool_start', { name: e.content_block.name, id: e.content_block.id });
      }
    } else if (evt.type === 'assistant' && evt.message?.content) {
      for (const block of evt.message.content) {
        if (block.type === 'tool_use') {
          ctx.toolCalls.push({ name: block.name, input: block.input, id: block.id });
          this.emit('tool', { name: block.name, input: block.input, id: block.id });
        }
      }
    } else if (evt.type === 'result') {
      const text = ctx.fullText() || evt.result || '';
      ctx.setFullText(text);
      if (ctx.setResultText) ctx.setResultText(evt.result || text);

      // Save assistant to history IMMEDIATELY (before proc.close, before emit)
      // so it's available if client reconnects right after receiving 'result'
      if (text && !evt.is_error) {
        const assistantContent = [{ type: 'text', text }];
        for (const t of ctx.toolCalls) {
          assistantContent.push({ type: 'tool_use', name: t.name, input: t.input });
        }
        this._history.push({ role: 'assistant', content: assistantContent });
        this._historySavedForCurrentTurn = true;
      }

      this.emit('result', {
        text,
        isError: evt.is_error,
        usage: evt.usage,
        duration: evt.duration_ms,
      });
    }
  }

  // Compact: summarize history when too long
  async compact() {
    if (this._history.length < 4) return;
    const claudeBin = process.env.CLAUDE_BIN ?? 'claude';
    const historyText = this._history.map(m => {
      const text = m.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
      return `[${m.role}]: ${text}`;
    }).join('\n\n');

    const prompt = `请将以下对话压缩为一段简洁的摘要（保留关键事实、决策和上下文），用中文：\n\n${historyText.slice(0, 8000)}`;

    return new Promise((resolve) => {
      const proc = spawn(claudeBin, ['--print', '-p', prompt, '--no-session-persistence', '--dangerously-skip-permissions'], {
        cwd: this.config.cwd || process.cwd(),
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let output = '';
      proc.stdout.on('data', d => { output += d.toString(); });
      proc.on('close', () => {
        if (output.trim()) {
          this._history = [{
            role: 'user',
            content: [{ type: 'text', text: `[对话历史摘要]\n${output.trim()}` }],
          }, {
            role: 'assistant',
            content: [{ type: 'text', text: '好的，我已了解之前的对话上下文。请继续。' }],
          }];
          this.emit('compacted', output.trim());
        }
        resolve();
      });
    });
  }

  clearHistory() {
    this._history = [];
    this.emit('cleared');
  }

  stop() {
    if (this._proc) { this._proc.kill('SIGTERM'); this._proc = null; }
    this._alive = false;
  }

  restart(newConfig) {
    this.stop();
    if (newConfig) Object.assign(this.config, newConfig);
    this._history = [];
    this._alive = true;
  }
}
