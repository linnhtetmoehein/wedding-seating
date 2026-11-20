import * as XLSX from 'xlsx';
import { rowsToGuests, buildExportRows } from './model.js';

// First sheet of a workbook -> guest list
export function guestsFromWorkbook(wb) {
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return rowsToGuests(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }));
}
export async function readGuestFile(file) {
  const wb = XLSX.read(await file.arrayBuffer());
  return guestsFromWorkbook(wb);
}
export function buildWorkbook(state) {
  const { seated, unseated, summary, hasGroup } = buildExportRows(state);
  const wb = XLSX.utils.book_new();
  const h1 = hasGroup ? ['Name', 'Table', 'Seat', 'Group'] : ['Name', 'Table', 'Seat'];
  const ws1 = XLSX.utils.json_to_sheet(seated, { header: h1 });
  ws1['!cols'] = [{ wch: 30 }, { wch: 8 }, { wch: 6 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Seating');
  const ws2 = XLSX.utils.json_to_sheet(unseated, { header: hasGroup ? ['Name', 'Group'] : ['Name'] });
  ws2['!cols'] = [{ wch: 30 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Unseated');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary, { header: ['Table', 'Seated', 'Chairs'] }), 'Tables');
  return wb;
}
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export function exportExcel(state) {
  XLSX.writeFile(buildWorkbook(state), `Wedding-Seating-${localDate()}.xlsx`);
}
