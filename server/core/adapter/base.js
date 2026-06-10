import { EventEmitter } from 'events';

/**
 * Abstract AI adapter interface — event-driven PTY model.
 *
 * Events emitted:
 *   'data'  (string)  — raw terminal output
 *   'exit'  ()        — process exited
 *
 * Methods:
 *   write(data)         — send input to the process
 *   resize(cols, rows)  — resize terminal
 *   stop()              — kill the process
 *   restart(newConfig)  — kill and respawn with new config
 */
export class AIAdapter extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
  }

  write(_data) { throw new Error('not implemented'); }
  resize(_cols, _rows) {}
  stop() {}
  restart(_newConfig) {}

  get type() { return 'base'; }
  get alive() { return false; }
}
