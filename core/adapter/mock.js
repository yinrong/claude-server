import { AIAdapter } from './base.js';

/**
 * Mock adapter for testing — echoes input back after a short delay.
 */
export class MockAdapter extends AIAdapter {
  constructor(config = {}) {
    super(config);
    this._alive = true;
  }

  get type() { return 'mock'; }
  get alive() { return this._alive; }

  write(data) {
    if (!this._alive) return;
    // Echo back after a small delay to simulate async
    setTimeout(() => {
      const text = data.replace(/\r?\n$/, '');
      if (text) {
        this.emit('data', `[mock] echo: ${text}\r\n`);
      }
    }, 50);
  }

  resize() {}
  stop() { this._alive = false; this.emit('exit', 0); }
  restart(newConfig) {
    if (newConfig) Object.assign(this.config, newConfig);
    this._alive = true;
  }
}
