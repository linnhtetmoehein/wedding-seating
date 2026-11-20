import test from 'node:test'; import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import * as M from '../src/model.js';
import { guestsFromWorkbook, buildWorkbook } from '../src/io.js';

test('floor plan has exactly the 15 tables from the sketch, 10 chairs each', () => {
  const s = M.emptyState();
  assert.equal(s.tables.length, 15);
  assert.deepEqual(M.sortedTables(s).map((t) => t.label), ['VIP 1', 'VIP 2', '1', '2', '3', '5', '6', '7', '8', '9', '10', '11', '12', '13', '15']);
  assert.ok(s.tables.every((t) => t.seats.length === 10));
});

test('paste: one name per line, blank lines and spaces ignored, tab = group', () => {
  assert.deepEqual(M.parseText('  Aung  Tun \r\n\r\nMya Win\n').map((g) => g.name), ['Aung Tun', 'Mya Win']);
  const g = M.parseText('Name\tSide\nAung Tun\tBride\nMya Win\tGroom');
  assert.deepEqual(g.map((x) => [x.name, x.group]), [['Aung Tun', 'Bride'], ['Mya Win', 'Groom']]);
});

test('Excel/CSV: "Name" column found anywhere, otherwise first column', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['No', 'Group', 'Name'], [1, 'Bride family', 'Aung Tun'], [2, '', 'Mya Win'], [3, '', '']]), 'List');
  assert.deepEqual(guestsFromWorkbook(wb).map((g) => [g.name, g.group]), [['Aung Tun', 'Bride family'], ['Mya Win', '']]);
  const csv = XLSX.read('Kyaw Oo,Colleagues\nThida Lwin,Colleagues\n', { type: 'string' });
  assert.deepEqual(guestsFromWorkbook(csv).map((g) => [g.name, g.group]), [['Kyaw Oo', 'Colleagues'], ['Thida Lwin', 'Colleagues']]);
});

test('adding guests skips names already in the list', () => {
  let r = M.addGuests(M.emptyState(), M.parseText('A\nB'));
  r = M.addGuests(r.state, M.parseText('B\nC'));
  assert.equal(r.added, 1); assert.equal(r.skipped, 1); assert.equal(r.state.guests.length, 3);
});

test('seat, swap, move from list onto taken chair, unseat', () => {
  let s = M.addGuests(M.emptyState(), M.parseText('A\nB\nC')).state;
  const [a, b, c] = s.guests.map((g) => g.id);
  s = M.seatGuest(s, a, 't-7', 0);
  s = M.seatGuest(s, b, 't-vip1', 3);
  s = M.seatGuest(s, a, 't-vip1', 3); // swap: A to VIP1/4, B to 7/1
  assert.deepEqual(M.locate(s, a), { tableId: 't-vip1', seat: 3 });
  assert.deepEqual(M.locate(s, b), { tableId: 't-7', seat: 0 });
  s = M.seatGuest(s, c, 't-7', 0); // C from list takes B's chair, B back to list
  assert.equal(M.locate(s, b), null);
  s = M.unseat(s, a);
  assert.equal(M.seatedCount(s), 1);
});

test('export rows: sorted by table then seat, Group column, unseated list', () => {
  let s = M.addGuests(M.emptyState(), M.parseText('Name\tGroup\nZed\tBride\nAmy\tGroom\nBob\tBride\nCat\t')).state;
  const id = (n) => s.guests.find((g) => g.name === n).id;
  s = M.seatGuest(s, id('Zed'), 't-10', 2);
  s = M.seatGuest(s, id('Amy'), 't-2', 5);
  s = M.seatGuest(s, id('Bob'), 't-2', 0);
  s = M.renameTable(s, 't-vip1', 'VIP 1');
  const r = M.buildExportRows(s);
  assert.deepEqual(r.seated, [
    { Name: 'Bob', Table: 2, Seat: 1, Group: 'Bride' },
    { Name: 'Amy', Table: 2, Seat: 6, Group: 'Groom' },
    { Name: 'Zed', Table: 10, Seat: 3, Group: 'Bride' },
  ]);
  assert.deepEqual(r.unseated, [{ Name: 'Cat', Group: '' }]);
  const wb = buildWorkbook(s);
  assert.deepEqual(wb.SheetNames, ['Seating', 'Unseated', 'Tables']);
  assert.deepEqual(XLSX.utils.sheet_to_json(wb.Sheets.Seating, { header: 1 })[0], ['Name', 'Table', 'Seat', 'Group']);
});

test('no Group column when nobody has a group', () => {
  let s = M.addGuests(M.emptyState(), M.parseText('A')).state;
  s = M.seatGuest(s, s.guests[0].id, 't-1', 0);
  assert.deepEqual(M.buildExportRows(s).seated, [{ Name: 'A', Table: 1, Seat: 1 }]);
});

test('re-importing an exported file restores the seats', () => {
  let s = M.addGuests(M.emptyState(), M.parseText('A\tX\nB\tY')).state;
  s = M.seatGuest(s, s.guests[1].id, 't-vip2', 4);
  const back = guestsFromWorkbook(buildWorkbook(s));
  const r = M.addGuests(M.emptyState(), back);
  assert.equal(r.placed, 1);
  assert.equal(r.state.tables.find((t) => t.id === 't-vip2').seats[4], r.state.guests.find((g) => g.name === 'B').id);
});

test('add / remove table: removed table guests go back to the list', () => {
  let s = M.addGuests(M.emptyState(), M.parseText('A')).state;
  const { state, id } = M.addTable(s);
  assert.equal(state.tables.find((t) => t.id === id).label, '16');
  s = M.seatGuest(state, s.guests[0].id, id, 0);
  s = M.removeTable(s, id);
  assert.equal(s.tables.length, 15); assert.equal(M.seatedCount(s), 0); assert.equal(s.guests.length, 1);
});
