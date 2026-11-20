// End-to-end check against the real Supabase project (needs a passcode that is set).
// Usage:  WS_PASSCODE=... node scripts/e2e-shared.mjs      (WARNING: writes test data to the plan, then resets it)
import { createRemote } from '../src/remote.js';
import { SyncEngine } from '../src/sync.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../src/config.js';
import * as M from '../src/model.js';
import { isDeepStrictEqual } from 'node:util';

const passcode = process.env.WS_PASSCODE;
if (!passcode) { console.error('Set WS_PASSCODE'); process.exit(1); }
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ', m); };
const mk = (name) => { const r = createRemote({ url: SUPABASE_URL, key: SUPABASE_KEY, passcode, name }); const e = new SyncEngine(r.api, { debounce: 0 }); e.remote = r; e.onSaved = (v) => r.notify(v); return e; };
const settle = async (...es) => { for (let i = 0; i < 200; i++) { await new Promise((r) => setTimeout(r, 50)); if (es.every((e) => !e.pending.length && !e.inflight)) return; } throw new Error('not settled'); };

const bad = createRemote({ url: SUPABASE_URL, key: SUPABASE_KEY, passcode: 'wrong-' + Math.random() });
ok((await bad.api.get()).status === 'bad', 'wrong passcode is refused');
ok((await bad.api.save({ guests: [], tables: [] }, 0)).status === 'bad', 'wrong passcode cannot save');

const a = mk('Tester A'), b = mk('Tester B');
await a.refresh(); await b.refresh();
ok(a.status === 'saved' && a.server.version >= 0, 'A loads the plan (version ' + a.server.version + ')');

// live updates + presence
let bHeard = 0, people = [];
await a.remote.connect({ onRemoteSave: () => {}, onPeople: (p) => (people = p), onLive: () => {} });
await b.remote.connect({ onRemoteSave: (v) => { bHeard = v; b.refresh(); }, onPeople: () => {}, onLive: () => {} });
await new Promise((r) => setTimeout(r, 2500));
ok(people.length >= 2, 'presence: A sees ' + people.map((p) => p.name).join(', '));

a.dispatch({ type: 'reset' }); await settle(a);
a.dispatch({ type: 'addGuests', guests: [{ id: 'gT1', name: 'Test Amy', group: 'T' }, { id: 'gT2', name: 'Test Bob', group: 'T' }] });
await settle(a);
for (let i = 0; i < 40 && !b.view.guests.length; i++) await new Promise((r) => setTimeout(r, 100));
ok(bHeard > 0 && b.view.guests.length === 2, 'B got A\'s change live (broadcast version ' + bHeard + ')');

// simultaneous edits on the same chair + different things
a.dispatch({ type: 'seat', gid: 'gT1', table: 't-3', seat: 0, expect: null });
b.dispatch({ type: 'seat', gid: 'gT2', table: 't-3', seat: 0, expect: null });
b.dispatch({ type: 'renameTable', table: 't-9', label: 'Nine' });
a.dispatch({ type: 'addTable', id: 'tE2E' });
await settle(a, b); await a.refresh(); await b.refresh();
const fin = (await a.remote.api.get());
const s = M.sanitize(fin.data);
ok(M.locate(s, 'gT1') && M.locate(s, 'gT2'), 'both guests seated, none lost: ' + JSON.stringify([M.locate(s, 'gT1'), M.locate(s, 'gT2')]));
ok(s.tables.find((t) => t.id === 't-9').label === 'Nine' && s.tables.some((t) => t.id === 'tE2E'), 'rename by B and new table by A both kept');
ok(a.server.version === b.server.version && isDeepStrictEqual(a.view, b.view), 'A and B show the same plan (v' + a.server.version + ') (conflicts merged: ' + (a.conflicts + b.conflicts) + ')');

if (process.env.WS_KEEP !== '1') { a.dispatch({ type: 'reset' }); await settle(a); console.log('test data reset'); }
a.remote.close(); b.remote.close();
process.exit(0);
