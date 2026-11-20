// Small helpers for the phone (tap) flow. Kept separate so they can be tested with node --test.

// What should tapping a chair do?
//  - 'place': a guest is picked (from the list, or "Move") -> put them on this chair (swap if taken)
//  - 'cancel': you tapped the picked guest's own chair -> stop moving
//  - 'pick': empty chair, nobody picked -> open the guest picker for this chair
//  - 'menu': someone sits here, nobody picked -> show their name with Unseat / Move
export function chairTapAction(picked, occupant) {
  if (picked) return picked === occupant ? 'cancel' : 'place';
  return occupant ? 'menu' : 'pick';
}

// Guests to offer in the picker: matches the search; unseated first (A–Z), seated after if asked for.
export function pickerGuests(state, query = '', includeSeated = false) {
  const seated = new Set(state.tables.flatMap((t) => t.seats.filter(Boolean)));
  const q = query.trim().toLowerCase();
  const match = (g) => !q || g.name.toLowerCase().includes(q) || (g.group || '').toLowerCase().includes(q);
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const free = state.guests.filter((g) => !seated.has(g.id) && match(g)).sort(byName);
  const taken = includeSeated ? state.guests.filter((g) => seated.has(g.id) && match(g)).sort(byName) : [];
  return [...free, ...taken];
}

// Keep the same spot in the middle of the screen when zooming the plan
export function zoomScroll(scroll, viewSize, oldZoom, newZoom) {
  return Math.max(0, ((scroll + viewSize / 2) * newZoom) / oldZoom - viewSize / 2);
}
export const clampZoom = (z, min = 0.6, max = 4) => Math.round(Math.min(max, Math.max(min, z)) * 100) / 100;
