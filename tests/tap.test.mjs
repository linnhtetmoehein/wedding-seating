import test from 'node:test'; import assert from 'node:assert/strict';
import * as M from '../src/model.js';
import { chairTapAction, pickerGuests, zoomScroll, clampZoom } from '../src/tap.js';

test('chair tap: pick / menu / place / cancel', () => {
  assert.equal(chairTapAction(null, null), 'pick');
  assert.equal(chairTapAction(null, 'g1'), 'menu');
  assert.equal(chairTapAction('g2', null), 'place');
  assert.equal(chairTapAction('g2', 'g1'), 'place'); // swap
  assert.equal(chairTapAction('g1', 'g1'), 'cancel');
});

test('guest picker: search, unseated first, seated only when asked', () => {
  let s = M.addGuests(M.emptyState(), M.parseText('Name\tGroup\nZoe\tBride\namy\tGroom\nBen\tBride')).state;
  const id = (n) => s.guests.find((g) => g.name === n).id;
  s = M.seatGuest(s, id('Ben'), 't-1', 0);
  assert.deepEqual(pickerGuests(s).map((g) => g.name), ['amy', 'Zoe']);
  assert.deepEqual(pickerGuests(s, '', true).map((g) => g.name), ['amy', 'Zoe', 'Ben']);
  assert.deepEqual(pickerGuests(s, 'bride', true).map((g) => g.name), ['Zoe', 'Ben']);
  assert.deepEqual(pickerGuests(s, 'xyz', true), []);
});

test('zoom keeps the centre of the view in place', () => {
  assert.equal(zoomScroll(0, 400, 1, 2), 200);   // centre 200 -> 400, minus half view
  assert.equal(zoomScroll(300, 400, 2, 1), 50);
  assert.equal(zoomScroll(0, 400, 2, 1), 0);     // never negative
  assert.equal(clampZoom(9), 4); assert.equal(clampZoom(0.1), 0.6); assert.equal(clampZoom(1.234), 1.23);
});
