import pty from 'node-pty';
import { AIAdapter } from './base.js';

/**
 * ClaudeCodeAdapter — persistent interactive PTY session.
 *
 * Spawns `claude --dangerously-skip-permissions` in a real PTY so that ALL
 * interactive features work: /resume, /compact, /clear, tool-use UI, etc.
 * The process stays alive across client disconnects.
 */
export class ClaudeCodeAdapter extends AIAdapter {
  constructor(config = {}) {
    super(config);
    this._pty = null;
    this._exited = false;
    this._spawn();
  }

  get type() { return 'claude-code'; }
  get alive() { return !this._exited && this._pty !== null; }

  _spawn() {
    const { cwd = process.cwd() } = this.config;
    const claudeBin = process.env.CLAUDE_BIN ?? 'claude';

    this._exited = false;
    this._pty = pty.spawn(claudeBin, ['--dangerously-skip-permissions'], {
      name: 'xterm-256color',
      cols: this.config.cols ?? 80,
      rows: this.config.rows ?? 24,
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
    });

    this._pty.onData((data) => {
      this.emit('data', data);
    });

    this._pty.onExit(({ exitCode }) => {
      this._exited = true;
      this._pty = null;
      this.emit('exit', exitCode);
    });
  }

  write(data) {
    if (this._pty) this._pty.write(data);
  }

  resize(cols, rows) {
    if (this._pty) {
      this._pty.resize(cols, rows);
      this.config.cols = cols;
      this.config.rows = rows;
    }
  }

  stop() {
    if (this._pty) {
      this._pty.kill();
      this._pty = null;
      this._exited = true;
    }
  }

  restart(newConfig) {
    this.stop();
    if (newConfig) Object.assign(this.config, newConfig);
    this._spawn();
  }
}
