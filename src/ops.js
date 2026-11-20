// Every change is a small "operation" (op). The same op is applied on this screen straight away
// and, in shared mode, re-applied on top of the latest saved plan if someone else saved first.
// Ops are written so that applying them again, or on a slightly different plan, is safe.
import * as M from './model.js';

export const newId = (prefix) => prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export function applyOp(state, op) {
  if (!op || !op.type) return state;
  switch (op.type) {
    case 'addGuests': return M.addGuests(state, op.guests || []).state;
    case 'removeGuest': return M.removeGuest(state, op.gid);
    case 'unseat': return M.unseat(state, op.gid);
    case 'seat': {
      const t = state.tables.find((x) => x.id === op.table);
      if (!t) return state;
      let seat = op.seat;
      const occ = t.seats[seat] ?? null;
      // Someone else put a different guest on this chair since we looked: don't kick them off,
      // use the next free chair at the same table instead (or skip if the table is full).
      if (op.expect !== undefined && occ !== op.expect && occ !== op.gid) {
        seat = t.seats.indexOf(null);
        if (seat < 0) return state;
      }
      return M.seatGuest(state, op.gid, op.table, seat);
    }
    case 'fillTable': return M.fillTable(state, op.table, op.gids || []);
    case 'clearSeats': return M.clearSeats(state);
    case 'clearTable': return state.tables.find((t) => t.id === op.table)?.seats.filter(Boolean).reduce((s, gid) => M.unseat(s, gid), state) ?? state;
    case 'renameTable': return M.renameTable(state, op.table, String(op.label ?? '').slice(0, 30));
    case 'moveTable': return M.moveTable(state, op.table, op.x, op.y);
    case 'setVip': return { ...state, tables: state.tables.map((t) => (t.id === op.table ? { ...t, vip: !!op.vip } : t)) };
    case 'addTable': return M.addTable(state, op.id).state;
    case 'removeTable': return M.removeTable(state, op.table);
    case 'reset': return M.emptyState();
    default: return state;
  }
}
export const applyOps = (state, ops) => ops.reduce(applyOp, M.sanitize(state));
