import { mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export class Memory {
  constructor(directory) {
    mkdirSync(directory, { recursive: true });
    this.directory = directory;
    this.file = join(directory, 'memory.json');
    try { this.data = JSON.parse(readFileSync(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot read ${this.file}. Restore or rename this file before starting: ${error.message}`);
      this.data = {};
    }
    if (!this.data || Array.isArray(this.data) || typeof this.data !== 'object') throw new Error('Invalid memory file.');
  }
  get(key, fallback) { return structuredClone(this.data[key] ?? fallback); }
  set(key, value) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid memory key.');
    this.data[key] = structuredClone(value);
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
  getWaypoint(name) { return this.get('waypoints', {})[name]; }
  setWaypoint(name, position, dimension) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('Use a short waypoint name with letters, numbers, _ or -.');
    const waypoints = this.get('waypoints', {});
    if (Object.keys(waypoints).length >= 100 && !waypoints[name]) throw new Error('Waypoint limit reached (100).');
    waypoints[name] = { position: { x: position.x, y: position.y, z: position.z }, dimension };
    this.set('waypoints', waypoints);
    return waypoints[name];
  }
  note(text) {
    const notes = this.get('notes', []);
    notes.push({ text: String(text).slice(0, 500), at: new Date().toISOString() });
    this.set('notes', notes.slice(-40));
  }
  snapshot() { return { waypoints: this.get('waypoints', {}), notes: this.get('notes', []) }; }
  journal(event) {
    const file = join(this.directory, 'events.jsonl');
    try { if (statSync(file).size > 5_000_000) renameSync(file, `${file}.previous`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    appendFileSync(file, JSON.stringify(event) + '\n', { mode: 0o600 });
  }
}
