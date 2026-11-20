// Plain logic for the seating planner (no React here, so it can be tested with node --test).
export const SEATS = 10;
export const SCALE = 1.4; // floor plan drawn from the sketch (680 x 750) scaled up so chairs fit
export const PLAN_W = 680 * SCALE;
export const PLAN_H = 750 * SCALE;

// [label, x, y, vip] — positions taken from the floor plan sketch
const LAYOUT = [
  ['VIP 1', 265, 284, true], ['VIP 2', 431, 282, true],
  ['1', 148, 284], ['2', 148, 384], ['3', 150, 486], ['5', 150, 586],
  ['6', 266, 541], ['7', 265, 416], ['8', 433, 380], ['9', 433, 483],
  ['10', 435, 583], ['11', 548, 586], ['12', 550, 486], ['13', 548, 384], ['15', 548, 284],
];

export const tableId = (label) => 't-' + String(label).toLowerCase().replace(/\s+/g, '');

export function defaultTables() {
  return LAYOUT.map(([label, x, y, vip]) => ({ id: tableId(label), label, x: x * SCALE, y: y * SCALE, vip: !!vip, seats: Array(SEATS).fill(null) }));
}
export const emptyState = () => ({ guests: [], tables: defaultTables(), nextId: 1 });

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const NAME_H = /^(name|names|guest|guests|guest name|full name|nama)$/i;
const GROUP_H = /^(group|side|category|tag|relation|from)$/i;
const TABLE_H = /^(table|table no\.?|table number)$/i;
const SEAT_H = /^(seat|seat no\.?|seat number|chair)$/i;

// rows = array of arrays (from a sheet or pasted text) -> [{ name, group, table, seat }]
export function rowsToGuests(rows) {
  const data = (rows || []).map((r) => (Array.isArray(r) ? r : [r]).map(clean)).filter((r) => r.some(Boolean));
  if (!data.length) return [];
  const head = data[0];
  const find = (re) => head.findIndex((c) => re.test(c));
  let nameI = find(NAME_H), groupI = find(GROUP_H), tableI = find(TABLE_H), seatI = find(SEAT_H);
  const hasHeader = nameI >= 0 || groupI >= 0 || tableI >= 0;
  let body = data;
  if (hasHeader) {
    body = data.slice(1);
    if (nameI < 0) nameI = head.findIndex((_, i) => i !== groupI && i !== tableI && i !== seatI);
  } else {
    nameI = 0; groupI = data.some((r) => r[1]) ? 1 : -1; tableI = -1; seatI = -1;
  }
  return body
    .map((r) => ({ name: r[nameI] || '', group: groupI >= 0 ? r[groupI] || '' : '', table: tableI >= 0 ? r[tableI] || '' : '', seat: seatI >= 0 ? r[seatI] || '' : '' }))
    .filter((g) => g.name);
}

// Pasted text: one name per line. Tab-separated columns (copied from Excel) also work: Name <tab> Group
export const parseText = (text) => rowsToGuests(String(text || '').split(/\r?\n/).map((l) => l.split('\t')));

const sameGuest = (a, b) => a.name.toLowerCase() === b.name.toLowerCase() && (a.group || '').toLowerCase() === (b.group || '').toLowerCase();

// Adds guests; skips names already in the list. If a row has Table/Seat (e.g. re-importing an export), seats them.
export function addGuests(state, list) {
  let s = { ...state, guests: [...state.guests], nextId: state.nextId || 1 };
  const before = state.guests;
  let added = 0, skipped = 0, placed = 0, notPlaced = 0;
  for (const g of list) {
    if (before.some((b) => sameGuest(b, g) || (g.id && b.id === g.id))) { skipped++; continue; }
    let id = g.id || 'g' + s.nextId;
    while (s.guests.some((x) => x.id === id)) id = 'g' + ++s.nextId;
    const guest = { id, name: g.name, group: g.group || '' };
    s.nextId++; s.guests.push(guest); added++;
    if (g.table) {
      const t = s.tables.find((t) => t.label.toLowerCase() === String(g.table).toLowerCase());
      let seat = parseInt(g.seat, 10) - 1;
      if (t && !(seat >= 0 && seat < t.seats.length && !t.seats[seat])) seat = t.seats.indexOf(null);
      if (t && seat >= 0) { s = seatGuest(s, guest.id, t.id, seat); placed++; } else notPlaced++;
    }
  }
  return { state: s, added, skipped, placed, notPlaced };
}

export function locate(state, gid) {
  for (const t of state.tables) { const i = t.seats.indexOf(gid); if (i >= 0) return { tableId: t.id, seat: i }; }
  return null;
}

// Put guest on a chair. If the chair is taken, the two guests swap
// (or the person already there goes back to the list if the dragged guest came from the list).
export function seatGuest(state, gid, tid, seat) {
  const tables = state.tables.map((t) => ({ ...t, seats: [...t.seats] }));
  const T = tables.find((t) => t.id === tid);
  if (!state.guests.some((g) => g.id === gid)) return state;
  if (!T || seat < 0 || seat >= T.seats.length) return state;
  const occupant = T.seats[seat];
  if (occupant === gid) return state;
  const from = locate(state, gid);
  if (from) tables.find((t) => t.id === from.tableId).seats[from.seat] = occupant ?? null;
  T.seats[seat] = gid;
  return { ...state, tables };
}

export const firstEmptySeat = (table) => table.seats.indexOf(null);

export function unseat(state, gid) {
  return { ...state, tables: state.tables.map((t) => (t.seats.includes(gid) ? { ...t, seats: t.seats.map((x) => (x === gid ? null : x)) } : t)) };
}
export function removeGuest(state, gid) {
  const s = unseat(state, gid);
  return { ...s, guests: s.guests.filter((g) => g.id !== gid) };
}
export function clearSeats(state) {
  return { ...state, tables: state.tables.map((t) => ({ ...t, seats: Array(t.seats.length).fill(null) })) };
}
// Fill empty chairs of one table with the given guests (in order)
export function fillTable(state, tid, gids) {
  let s = state;
  for (const gid of gids) {
    if (locate(s, gid)) continue; // only guests who are not seated yet
    const t = s.tables.find((t) => t.id === tid);
    const i = firstEmptySeat(t);
    if (i < 0) break;
    s = seatGuest(s, gid, tid, i);
  }
  return s;
}

export const renameTable = (state, tid, label) => ({ ...state, tables: state.tables.map((t) => (t.id === tid ? { ...t, label } : t)) });
export const moveTable = (state, tid, x, y) => ({ ...state, tables: state.tables.map((t) => (t.id === tid ? { ...t, x, y } : t)) });
export const removeTable = (state, tid) => ({ ...state, tables: state.tables.filter((t) => t.id !== tid) });
export const toggleVip = (state, tid) => ({ ...state, tables: state.tables.map((t) => (t.id === tid ? { ...t, vip: !t.vip } : t)) });

// Find an empty spot in the room for a new table (away from other tables, the stage and walls)
export const TABLE_GAP = 140; // centre-to-centre distance so chairs don't overlap
export function freeSpot(tables) {
  for (let y = 300 * SCALE; y <= 680 * SCALE; y += 10) {
    for (let x = 100 * SCALE; x <= 580 * SCALE; x += 10) {
      if (tables.every((t) => Math.hypot(t.x - x, t.y - y) >= TABLE_GAP)) return [x, y];
    }
  }
  return [340 * SCALE, 660 * SCALE]; // room is full: put it near March-in, drag it with "Move tables"
}

export function addTable(state, wantId) {
  const nums = state.tables.map((t) => parseInt(t.label, 10)).filter((n) => !isNaN(n) && String(n) === String(n));
  const label = String((nums.length ? Math.max(...nums) : 0) + 1);
  if (wantId && state.tables.some((t) => t.id === wantId)) return { state, id: wantId };
  let id = wantId || tableId(label), k = 2;
  while (state.tables.some((t) => t.id === id)) id = tableId(label) + '-' + k++;
  const [x, y] = freeSpot(state.tables);
  return { state: { ...state, tables: [...state.tables, { id, label, x, y, vip: false, seats: Array(SEATS).fill(null) }] }, id };
}

// Table order for export: VIP tables first, then numbers in natural order (1, 2, 3, 5, ... 15)
export function compareLabels(a, b) {
  const va = /^vip/i.test(a), vb = /^vip/i.test(b);
  if (va !== vb) return va ? -1 : 1;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}
export const sortedTables = (state) => [...state.tables].sort((a, b) => compareLabels(a.label, b.label));

const tableValue = (label) => (/^\d+$/.test(label) ? Number(label) : label);

export function buildExportRows(state) {
  const byId = new Map(state.guests.map((g) => [g.id, g]));
  const hasGroup = state.guests.some((g) => g.group);
  const seated = [], seatedIds = new Set();
  for (const t of sortedTables(state)) {
    t.seats.forEach((gid, i) => {
      const g = gid && byId.get(gid);
      if (!g) return;
      seatedIds.add(gid);
      const row = { Name: g.name, Table: tableValue(t.label), Seat: i + 1 };
      if (hasGroup) row.Group = g.group;
      seated.push(row);
    });
  }
  const unseated = state.guests.filter((g) => !seatedIds.has(g.id)).map((g) => (hasGroup ? { Name: g.name, Group: g.group } : { Name: g.name }));
  const summary = sortedTables(state).map((t) => ({ Table: tableValue(t.label), Seated: t.seats.filter(Boolean).length, Chairs: t.seats.length }));
  return { seated, unseated, summary, hasGroup };
}

export const seatedCount = (state) => state.tables.reduce((n, t) => n + t.seats.filter(Boolean).length, 0);

// Make sure saved data is usable (drops seats pointing at deleted guests)
export function sanitize(s) {
  if (!s || !Array.isArray(s.guests) || !Array.isArray(s.tables)) return emptyState();
  const ids = new Set(s.guests.map((g) => g.id));
  return { ...s, nextId: s.nextId || s.guests.length + 1, tables: s.tables.map((t) => ({ ...t, seats: (t.seats || Array(SEATS).fill(null)).map((x) => (ids.has(x) ? x : null)) })) };
}
