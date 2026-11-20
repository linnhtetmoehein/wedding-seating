import test from 'node:test'; import assert from 'node:assert/strict';
import * as M from '../src/model.js';
import { applyOp, applyOps } from '../src/ops.js';
import { SyncEngine } from '../src/sync.js';

// A fake database that behaves like save_plan / get_plan (version check)
function fakeServer() {
  const db = { data: {}, version: 0, saves: 0 };
  const api = (delay = 0) => ({
    get: async () => ({ status: 'ok', data: structuredClone(db.data), version: db.version }),
    save: async (data, base) => {
      await new Promise((r) => setTimeout(r, delay));
      if (base !== db.version) return { status: 'conflict', data: structuredClone(db.data), version: db.version };
      db.data = structuredClone(data); db.version++; db.saves++;
      return { status: 'ok', version: db.version };
    },
  });
  return { db, api };
}
const settle = async (...engines) => { for (let i = 0; i < 50; i++) { await new Promise((r) => setTimeout(r, 5)); if (engines.every((e) => !e.pending.length && !e.inflight)) return; } throw new Error('did not settle'); };
const g = (id, name, group = '') => ({ id, name, group });

test('ops: add guests with ids, seat, unseat, remove, idempotent re-apply', () => {
  let s = applyOp(M.emptyState(), { type: 'addGuests', guests: [g('gA', 'Amy'), g('gB', 'Bob')] });
  s = applyOp(s, { type: 'addGuests', guests: [g('gA', 'Amy')] }); // applied twice -> no duplicate
  assert.equal(s.guests.length, 2);
  const op = { type: 'seat', gid: 'gA', table: 't-7', seat: 2, expect: null };
  s = applyOp(applyOp(s, op), op);
  assert.deepEqual(M.locate(s, 'gA'), { tableId: 't-7', seat: 2 });
  s = applyOp(s, { type: 'removeGuest', gid: 'gA' });
  assert.equal(M.seatedCount(s), 0); assert.equal(s.guests.length, 1);
  assert.equal(applyOp(s, { type: 'seat', gid: 'gZ', table: 't-7', seat: 0 }), s, 'unknown guest is ignored');
});

test('ops: seat on a chair someone else just filled moves to the next free chair instead', () => {
  let s = applyOps({}, [{ type: 'addGuests', guests: [g('gA', 'Amy'), g('gB', 'Bob')] }, { type: 'seat', gid: 'gB', table: 't-1', seat: 0, expect: null }]);
  s = applyOp(s, { type: 'seat', gid: 'gA', table: 't-1', seat: 0, expect: null }); // I saw it empty
  assert.deepEqual(M.locate(s, 'gB'), { tableId: 't-1', seat: 0 });
  assert.deepEqual(M.locate(s, 'gA'), { tableId: 't-1', seat: 1 });
  // a deliberate swap (I saw Bob there) still swaps
  s = applyOp(s, { type: 'seat', gid: 'gA', table: 't-1', seat: 0, expect: 'gB' });
  assert.deepEqual(M.locate(s, 'gA'), { tableId: 't-1', seat: 0 });
  assert.deepEqual(M.locate(s, 'gB'), { tableId: 't-1', seat: 1 });
});

test('ops: tables add/rename/move/vip/remove', () => {
  let s = applyOps({}, [{ type: 'addTable', id: 'tX' }, { type: 'addTable', id: 'tX' }, { type: 'renameTable', table: 'tX', label: 'Kids' }, { type: 'moveTable', table: 'tX', x: 500, y: 600 }, { type: 'setVip', table: 'tX', vip: true }]);
  const t = s.tables.find((x) => x.id === 'tX');
  assert.equal(s.tables.length, 16); assert.equal(t.label, 'Kids'); assert.equal(t.x, 500); assert.equal(t.vip, true);
  s = applyOp(s, { type: 'removeTable', table: 'tX' });
  assert.equal(s.tables.length, 15);
});

test('sync: two people editing at the same time – both changes kept', async () => {
  const { db, api } = fakeServer();
  const a = new SyncEngine(api(15), { debounce: 0 }), b = new SyncEngine(api(15), { debounce: 0 });
  await a.refresh(); await b.refresh();
  a.dispatch({ type: 'addGuests', guests: [g('gA', 'Amy', 'Bride')] });
  b.dispatch({ type: 'addGuests', guests: [g('gB', 'Bob', 'Groom')] });
  await settle(a, b);
  a.dispatch({ type: 'seat', gid: 'gA', table: 't-vip1', seat: 0, expect: null });
  b.dispatch({ type: 'addTable', id: 'tNew' });
  b.dispatch({ type: 'renameTable', table: 't-2', label: 'Family' });
  await settle(a, b);
  await a.refresh(); await b.refresh();
  for (const e of [a, b]) {
    assert.deepEqual(e.view.guests.map((x) => x.name).sort(), ['Amy', 'Bob']);
    assert.deepEqual(M.locate(e.view, 'gA'), { tableId: 't-vip1', seat: 0 });
    assert.ok(e.view.tables.some((t) => t.id === 'tNew'));
    assert.equal(e.view.tables.find((t) => t.id === 't-2').label, 'Family');
  }
  assert.ok(a.conflicts + b.conflicts >= 1, 'a conflict happened and was merged');
  assert.equal(db.data.guests.length, 2);
});

test('sync: both seat a guest on the same chair at once – nobody is lost', async () => {
  const { db, api } = fakeServer();
  const a = new SyncEngine(api(10), { debounce: 0 }), b = new SyncEngine(api(10), { debounce: 0 });
  await a.refresh(); a.dispatch({ type: 'addGuests', guests: [g('gA', 'Amy'), g('gB', 'Bob')] }); await settle(a);
  await b.refresh();
  a.dispatch({ type: 'seat', gid: 'gA', table: 't-5', seat: 3, expect: null });
  b.dispatch({ type: 'seat', gid: 'gB', table: 't-5', seat: 3, expect: null });
  await settle(a, b); await a.refresh();
  const s = M.sanitize(db.data);
  assert.equal(M.seatedCount(s), 2);
  assert.ok(M.locate(s, 'gA') && M.locate(s, 'gB'));
  assert.deepEqual(a.view, M.sanitize(db.data));
});

test('sync: offline – changes are kept and saved later', async () => {
  const { db, api } = fakeServer();
  let down = true;
  const real = api();
  const flaky = { get: real.get, save: (...x) => (down ? Promise.reject(new Error('net')) : real.save(...x)) };
  const statuses = [];
  const e = new SyncEngine(flaky, { debounce: 0, retryMs: 20, onStatus: (s) => statuses.push(s) });
  await e.refresh();
  e.dispatch({ type: 'addGuests', guests: [g('gA', 'Amy')] });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(statuses.includes('offline')); assert.equal(e.pending.length, 1); assert.equal(e.view.guests.length, 1);
  down = false;
  await settle(e);
  assert.equal(db.data.guests.length, 1); assert.equal(e.status, 'saved');
});

test('sync: wrong passcode status stops saving and keeps the change', async () => {
  const e = new SyncEngine({ get: async () => ({ status: 'bad' }), save: async () => ({ status: 'bad' }) }, { debounce: 0 });
  e.dispatch({ type: 'clearSeats' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(e.status, 'bad'); assert.equal(e.pending.length, 1);
});
