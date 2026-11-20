// Keeps this screen in step with the shared plan in the database.
// - Your changes are kept as a list of pending ops and shown immediately.
// - Saving sends (latest saved plan + your ops) with the version it was based on.
// - If someone else saved in between, the server says "conflict" and returns the newest plan;
//   we re-apply your ops on top of that and try again. Nobody's change is overwritten.
import { applyOps } from './ops.js';
import { sanitize } from './model.js';

export class SyncEngine {
  constructor(api, { onChange = () => {}, onStatus = () => {}, onSaved = () => {}, storage = null, storageKey = 'wedding-seating-shared-cache', debounce = 250, retryMs = 5000 } = {}) {
    Object.assign(this, { api, onChange, onStatus, onSaved, storage, storageKey, debounce, retryMs });
    this.server = { data: {}, version: -1 };
    this.pending = [];
    this.inflight = false;
    this.status = 'loading';
    this.conflicts = 0;
    this._view = null;
    if (storage) {
      try { const c = JSON.parse(storage.getItem(storageKey) || 'null'); if (c && c.server) { this.server = c.server; this.pending = c.pending || []; } } catch { /* ignore */ }
    }
  }
  get view() {
    if (!this._view) this._view = applyOps(sanitize(this.server.data), this.pending);
    return this._view;
  }
  _changed() { this._view = null; this.persist(); this.onChange(this.view); }
  persist() { if (this.storage) try { this.storage.setItem(this.storageKey, JSON.stringify({ server: this.server, pending: this.pending })); } catch { /* full */ } }
  setStatus(s, info) { this.status = s; this.onStatus(s, info); }
  dispatch(op) {
    this.pending.push(op);
    this._changed();
    this.setStatus('saving');
    this.scheduleFlush();
  }
  scheduleFlush(ms = this.debounce) { clearTimeout(this._t); this._t = setTimeout(() => this.flush(), ms); }
  async flush() {
    if (this.inflight || !this.pending.length) return;
    this.inflight = true;
    this.setStatus('saving');
    let failed = null;
    try {
      for (let tries = 0; tries < 20 && this.pending.length; tries++) {
        const batch = this.pending.slice();
        const data = applyOps(sanitize(this.server.data), batch);
        const r = await this.api.save(data, this.server.version);
        if (r.status === 'ok') {
          this.server = { data, version: r.version };
          this.pending = this.pending.slice(batch.length);
          this._changed();
          this.onSaved(r.version);
        } else if (r.status === 'conflict') {
          this.conflicts++;
          this.server = { data: r.data, version: r.version };
          this._changed();
        } else { failed = r.status; break; }
      }
    } catch (e) { failed = 'offline'; }
    this.inflight = false;
    if (failed) { this.setStatus(failed); if (failed === 'offline') this.scheduleFlush(this.retryMs); return; }
    if (this.pending.length) this.scheduleFlush(); else this.setStatus('saved');
  }
  // Fetch the latest plan (on start, when someone else saved, or every few seconds as a fallback)
  async refresh() {
    let r;
    try { r = await this.api.get(); } catch { if (this.status !== 'saving') this.setStatus('offline'); return 'offline'; }
    if (r.status !== 'ok') { this.setStatus(r.status); return r.status; }
    if (r.version > this.server.version && !this.inflight) { this.server = { data: r.data, version: r.version }; this._changed(); }
    if (this.pending.length) this.flush(); else if (!this.inflight) this.setStatus('saved');
    return 'ok';
  }
  clearCache() { if (this.storage) this.storage.removeItem(this.storageKey); }
}
