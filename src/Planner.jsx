import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as M from './model.js';
import { readGuestFile, exportExcel } from './io.js';
import { sampleGuests } from './sample.js';
import { newId } from './ops.js';
import { chairTapAction, pickerGuests, zoomScroll, clampZoom } from './tap.js';

const MOBILE_Q = '(max-width: 800px)';
function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia(MOBILE_Q).matches);
  useEffect(() => { const mq = window.matchMedia(MOBILE_Q); const f = () => setM(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);
  return m;
}

const TABLE_R = 36, RING = 56, CHAIR_R = 13;
const PALETTE = ['#e07a5f', '#3d85c6', '#5aa469', '#9b72cf', '#e0a020', '#2a9d8f', '#d1495b', '#7a7a7a', '#c2569b', '#4c6ef5'];
const S = M.SCALE;

export function demoState() {
  let { state } = M.addGuests(M.emptyState(), sampleGuests());
  const ids = state.guests.map((g) => g.id);
  let k = 0;
  for (const t of M.sortedTables(state)) {
    const take = ids.slice(k, k + (t.vip ? 10 : 8));
    state = M.fillTable(state, t.id, take);
    k += take.length;
  }
  return state;
}
const initials = (name) => { const p = name.split(' ').filter(Boolean); return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : p[0]?.[1] || '')).toUpperCase(); };
const shortName = (name) => name.split(' ')[0].slice(0, 10);
function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const d = el && el.closest('[data-drop]');
  if (!d) return null;
  return { kind: d.dataset.drop, table: d.dataset.table, seat: d.dataset.seat != null ? Number(d.dataset.seat) : null };
}
const tKey = (t) => (t ? `${t.kind}:${t.table || ''}:${t.seat ?? ''}` : '');

// The planner screen. It shows `state` and sends every change as a small op through dispatch(op).
export default function Planner({ state: liveState, dispatch, undo, canUndo, mode, syncBar }) {
  const stateRef = useRef(liveState);
  const [movePreview, setMovePreview] = useState(null);
  const state = movePreview ? { ...liveState, tables: liveState.tables.map((t) => (t.id === movePreview.id ? { ...t, x: movePreview.x, y: movePreview.y } : t)) } : liveState;
  stateRef.current = liveState;
  const [selTable, setSelTable] = useState(mode === 'demo' ? 't-vip1' : null);
  const [selGuest, setSelGuest] = useState(null);
  const [search, setSearch] = useState('');
  const [showSeated, setShowSeated] = useState(false);
  const isMobile = useIsMobile();
  const [zoom, setZoomRaw] = useState(() => (window.matchMedia(MOBILE_Q).matches ? 2 : 1));
  const [mtab, setMtab] = useState('plan');          // phone: which panel is showing
  const [menuOpen, setMenuOpen] = useState(false);   // phone: ☰ menu
  const [picker, setPicker] = useState(null);        // {table, seat}: choose a guest for this chair
  const [pickerQ, setPickerQ] = useState('');
  const [pickerAll, setPickerAll] = useState(false);
  const [chairMenu, setChairMenu] = useState(null);  // phone: tapped a seated chair
  const scrollRef = useRef(null);
  const zoomRef = useRef(zoom);
  const [arrange, setArrange] = useState(false);
  const [drag, setDrag] = useState(null);
  const [hover, setHover] = useState(null);
  const [msg, setMsg] = useState('');
  const [paste, setPaste] = useState('');
  const [showNames, setShowNames] = useState(true);
  const justDragged = useRef(false);
  const svgRef = useRef(null);
  const fileRef = useRef(null);

  // zoom around the middle of the visible plan
  const setZoom = (z) => setZoomRaw((old) => clampZoom(typeof z === 'function' ? z(old) : z));
  useLayoutEffect(() => {
    const el = scrollRef.current, old = zoomRef.current;
    zoomRef.current = zoom;
    if (!el || old === zoom) return;
    el.scrollLeft = zoomScroll(el.scrollLeft, el.clientWidth, old, zoom);
    el.scrollTop = zoomScroll(el.scrollTop, el.clientHeight, old, zoom);
  }, [zoom]);
  // two-finger pinch on the plan changes the zoom (one finger scrolls as normal)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let start = null;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const ts = (e) => { if (e.touches.length === 2) start = { d: dist(e.touches), z: zoomRef.current }; };
    const tm = (e) => { if (e.touches.length === 2 && start) { e.preventDefault(); setZoom(start.z * (dist(e.touches) / start.d)); } };
    const te = (e) => { if (e.touches.length < 2) start = null; };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te);
    return () => { el.removeEventListener('touchstart', ts); el.removeEventListener('touchmove', tm); el.removeEventListener('touchend', te); };
  }, [isMobile]);
  // phone: start with the plan centred left-right
  useEffect(() => {
    const el = scrollRef.current;
    if (isMobile && el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [isMobile]);
  const openPicker = (table, seat) => { setPicker({ table, seat }); setPickerQ(''); setPickerAll(false); };
  const doUndo = () => { if (undo && undo()) say('Undone'); };
  const say = (t) => { setMsg(t); clearTimeout(say.t); say.t = setTimeout(() => setMsg(''), 4000); };

  useEffect(() => {
    const onKey = (e) => {
      if (/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
      if (e.key === 'Escape') { setSelGuest(null); setSelTable(null); setPicker(null); setChairMenu(null); setMenuOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  const byId = useMemo(() => new Map(state.guests.map((g) => [g.id, g])), [state.guests]);
  const where = useMemo(() => { const m = new Map(); state.tables.forEach((t) => t.seats.forEach((g, i) => g && m.set(g, { table: t, seat: i }))); return m; }, [state.tables]);
  const groups = useMemo(() => [...new Set(state.guests.map((g) => g.group).filter(Boolean))].sort(), [state.guests]);
  const color = (g) => (g?.group ? PALETTE[groups.indexOf(g.group) % PALETTE.length] : '#4a6fa5');
  const seated = where.size, total = state.guests.length, chairs = state.tables.reduce((n, t) => n + t.seats.length, 0);
  const q = search.trim().toLowerCase();
  const listed = state.guests.filter((g) => (showSeated || !where.has(g.id)) && (!q || g.name.toLowerCase().includes(q) || g.group.toLowerCase().includes(q)));
  const listedUnseated = listed.filter((g) => !where.has(g.id));
  const table = state.tables.find((t) => t.id === selTable);

  // ---------- drag and drop (pointer based, works for list, chairs and the side panel) ----------
  function startDrag(e, gid) {
    if (e.button !== 0 || arrange || e.pointerType === 'touch') return; // phones use tap-to-seat instead
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let active = false;
    const move = (ev) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      active = true; setHover(null);
      setDrag({ gid, x: ev.clientX, y: ev.clientY, over: tKey(dropTargetAt(ev.clientX, ev.clientY)) });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (!active) return;
      justDragged.current = true; setTimeout(() => (justDragged.current = false), 50);
      setDrag(null);
      drop(gid, dropTargetAt(ev.clientX, ev.clientY));
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }
  function drop(gid, t) {
    if (!t) return;
    const g = byId.get(gid);
    if (t.kind === 'list') { if (where.has(gid)) { dispatch({ type: 'unseat', gid }); say(`${g.name} moved back to the list`); } return; }
    const tb = stateRef.current.tables.find((x) => x.id === t.table);
    if (!tb) return;
    let seat = t.seat;
    if (t.kind === 'table') {
      seat = M.firstEmptySeat(tb);
      if (seat < 0) { say(`Table ${tb.label} is full`); return; }
    }
    const occ = tb.seats[seat] && byId.get(tb.seats[seat]);
    dispatch({ type: 'seat', gid, table: tb.id, seat, expect: tb.seats[seat] ?? null });
    setSelGuest(null);
    const fromSeat = where.has(gid);
    say(`${g.name} → Table ${tb.label} seat ${seat + 1}` + (occ && occ.id !== gid ? (fromSeat ? ` (swapped with ${occ.name})` : ` (${occ.name} went back to the list)`) : ''));
  }
  function clickSeat(t, i) {
    if (justDragged.current || arrange) return;
    const occ = t.seats[i] || null;
    const action = chairTapAction(selGuest, occ);
    if (action === 'cancel') { setSelGuest(null); say('Move cancelled'); return; }
    if (action === 'place') { drop(selGuest, { kind: 'seat', table: t.id, seat: i }); setSelTable(t.id); return; }
    if (!isMobile) { setSelTable(t.id); return; }
    if (action === 'pick') openPicker(t.id, i); else setChairMenu({ gid: occ, table: t.id, seat: i });
  }
  function startTableMove(e, t) {
    e.preventDefault();
    const svg = svgRef.current;
    const pt = (ev) => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
    const p0 = pt(e), ox = t.x - p0.x, oy = t.y - p0.y;
    const clamp = (v, max) => Math.round(Math.max(80, Math.min(max - 80, v)));
    let last = null;
    const move = (ev) => { const p = pt(ev); last = { id: t.id, x: clamp(p.x + ox, M.PLAN_W), y: clamp(p.y + oy, M.PLAN_H) }; setMovePreview(last); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (last) dispatch({ type: 'moveTable', table: t.id, x: last.x, y: last.y });
      setMovePreview(null);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    setSelTable(t.id);
  }

  // ---------- import / export ----------
  function addList(list, source) {
    if (!list.length) { say(`No names found in ${source}`); return; }
    const guests = list.map((g) => ({ ...g, id: newId('g') }));
    const r = M.addGuests(stateRef.current, guests);
    dispatch({ type: 'addGuests', guests });
    let t = `Added ${r.added} guest${r.added === 1 ? '' : 's'} from ${source}`;
    if (r.skipped) t += `, skipped ${r.skipped} already in the list`;
    if (r.placed) t += `, seated ${r.placed} from the Table/Seat columns`;
    if (r.notPlaced) t += ` (${r.notPlaced} had a table that doesn't exist)`;
    say(t);
  }
  async function onFile(e) {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { addList(await readGuestFile(f), f.name); } catch (err) { say('Could not read file: ' + err.message); }
  }
  const addPaste = () => { addList(M.parseText(paste), 'the paste box'); setPaste(''); };

  // ---------- floor plan ----------
  const chairPos = (t, i) => { const a = ((-90 + (i * 360) / t.seats.length) * Math.PI) / 180; return [t.x + RING * Math.cos(a), t.y + RING * Math.sin(a), a]; };
  const showTip = (e, g, t, i) => !isMobile && setHover({ x: e.clientX, y: e.clientY, title: g ? g.name : `Empty seat`, sub: `Table ${t.label} · Seat ${i + 1}${g?.group ? ' · ' + g.group : ''}` });
  const plan = (
    <svg ref={svgRef} viewBox={`0 0 ${M.PLAN_W} ${M.PLAN_H}`} className="plan" style={isMobile ? { width: `${zoom * 100}%`, height: 'auto' } : { height: `${zoom * 100}%` }}>
      <g transform={`scale(${S})`} className="room">
        <rect x="20" y="40" width="640" height="690" className="wall" />
        {[120, 315, 510].map((x) => <g key={x}><rect x={x} y="36" width="50" height="8" className="gap" /><path d={`M${x} 40 A50 50 0 0 1 ${x + 50} 40`} className="swing" transform={`translate(0,0)`} /></g>)}
        <rect x="150" y="56" width="380" height="16" className="led" /><text x="340" y="68" className="led-t">LED Panel</text>
        <rect x="215" y="82" width="250" height="112" className="stage" /><text x="340" y="142" className="stage-t">Stage</text>
        {[[193, 140], [465, 140]].map(([x, y]) => <rect key={x} x={x} y={y} width="22" height="40" className="steps" />)}
        <rect x="305" y="194" width="70" height="14" className="steps" />
        <rect x="22" y="96" width="62" height="44" className="av" /><text x="53" y="114" className="small-t">AV</text><text x="53" y="128" className="small-t">Console</text>
        {[[55, 220], [615, 218], [52, 492], [614, 494]].map(([x, y]) => <circle key={x + '' + y} cx={x} cy={y} r="11" className="pillar" />)}
        <rect x="290" y="726" width="100" height="8" className="gap" />
        <path d="M290 730 A50 50 0 0 0 340 680 M390 730 A50 50 0 0 1 340 680" className="swing" />
        <text x="340" y="672" className="march">March-in ↑</text>
      </g>
      {state.tables.map((t) => {
        const n = t.seats.filter(Boolean).length;
        return (
          <g key={t.id} className={'tbl' + (t.id === selTable ? ' sel' : '') + (arrange ? ' arrange' : '')}>
            <circle cx={t.x} cy={t.y} r={TABLE_R} data-drop="table" data-table={t.id}
              className={'table' + (t.vip ? ' vip' : '') + (drag && drag.over === `table:${t.id}:` ? ' over' : '') + (n === t.seats.length ? ' full' : '')}
              onPointerDown={arrange ? (e) => startTableMove(e, t) : undefined} onClick={() => { if (arrange || justDragged.current) return; setSelTable(t.id); if (isMobile) setMtab('table'); }} />
            <text x={t.x} y={t.y - 3} className="tlabel">{t.label}</text>
            <text x={t.x} y={t.y + 14} className="tcount">{n}/{t.seats.length}</text>
            {t.seats.map((gid, i) => {
              const [cx, cy, a] = chairPos(t, i);
              const g = gid && byId.get(gid);
              const over = drag && drag.over === `seat:${t.id}:${i}`;
              return (
                <g key={i} data-drop="seat" data-table={t.id} data-seat={i} className={'chair' + (g ? ' taken' : '') + (over ? ' over' : '') + (g && selGuest === gid ? ' picked' : '')}
                  onPointerDown={g ? (e) => startDrag(e, gid) : undefined} onClick={() => clickSeat(t, i)}
                  onDoubleClick={g && !isMobile ? () => { dispatch({ type: 'unseat', gid }); say(`${g.name} moved back to the list`); } : undefined}
                  onMouseEnter={(e) => showTip(e, g, t, i)} onMouseMove={(e) => showTip(e, g, t, i)} onMouseLeave={() => setHover(null)}>
                  <circle cx={cx} cy={cy} r={17} className="hit" />
                  <circle cx={cx} cy={cy} r={CHAIR_R} style={g ? { fill: color(g) } : undefined} />
                  <text x={cx} y={cy + 4}>{g ? initials(g.name) : i + 1}</text>
                </g>
              );
            })}
          </g>
        );
      })}
      {showNames && zoom >= (isMobile ? 3 : 1.5) && state.tables.map((t) => t.seats.map((gid, i) => {
        const g = gid && byId.get(gid);
        if (!g) return null;
        const a = chairPos(t, i)[2], r = RING + CHAIR_R + 3;
        return <text key={t.id + i} x={t.x + r * Math.cos(a)} y={t.y + r * Math.sin(a) + 3} className="cname" textAnchor={Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle'}>{shortName(g.name)}</text>;
      }))}
    </svg>
  );

  const chip = (g, extra, inSeat) => {
    const w = where.get(g.id);
    return (
      <div key={g.id} className={'chip' + (selGuest === g.id ? ' picked' : '') + (w ? ' seated' : '')} onPointerDown={(e) => startDrag(e, g.id)}
        onClick={() => {
          if (justDragged.current) return;
          if (isMobile) { setSelGuest(g.id); setMtab('plan'); return; }
          setSelGuest(selGuest === g.id ? null : g.id);
        }} title="Drag onto a chair, or click then click a chair">
        <span className="dot" style={{ background: color(g) }} />
        <span className="nm">{g.name}</span>
        {g.group && <span className="tag">{g.group}</span>}
        {w && !inSeat && <span className="tag where">T{w.table.label}·{w.seat + 1}</span>}
        {extra}
      </div>
    );
  };

  return (
    <div className={'app' + (drag ? ' dragging' : '') + ` m-tab-${mtab}` + (menuOpen ? ' menu-open' : '') + (selGuest ? ' picking' : '')}>
      <header>
        <h1>💍 <span className="d-only">Wedding </span>Seating</h1>
        {syncBar}
        <div className="stats">
          <b>{seated}</b> / {total} <span className="d-only">guests </span>seated<span className="d-only"> · {chairs} chairs · {state.tables.length} tables</span>
          {total - seated > 0 && <span className="warn d-only"> · {total - seated} not seated</span>}
        </div>
        <button className="m-only menubtn" aria-label="Menu" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? '✕' : '☰'}</button>
        <div className="tools" onClick={(e) => { if (isMobile && e.target.closest('button')) setMenuOpen(false); }}>
          <button className="m-only" onClick={() => { setMtab('guests'); }}>➕ Add / paste names</button>
          <button className="m-only" onClick={() => fileRef.current.click()}>📄 Import Excel / CSV…</button>
          {undo && <button onClick={doUndo} disabled={!canUndo} title="Ctrl+Z">↶ Undo</button>}
          <button onClick={() => { const id = newId('t'); const r = M.addTable(stateRef.current, id); dispatch({ type: 'addTable', id }); setSelTable(id); say(`Table ${r.state.tables.at(-1).label} added in a free spot. Use "Move tables" to place it exactly.`); }}>+ Table</button>
          <button className={arrange ? 'on' : ''} onClick={() => setArrange(!arrange)}>{arrange ? '✓ Done moving' : '✥ Move tables'}</button>
          <span className="zoom d-only">
            <button onClick={() => setZoom(Math.max(0.6, +(zoom - 0.25).toFixed(2)))}>−</button>
            <button onClick={() => setZoom(1)} title="Fit to screen">{Math.round(zoom * 100)}%</button>
            <button onClick={() => setZoom(Math.min(3, +(zoom + 0.25).toFixed(2)))}>+</button>
          </span>
          <button className="primary" onClick={() => { exportExcel(stateRef.current); say('Excel file downloaded'); }} disabled={!total}>⬇ Export Excel</button>
          <button onClick={() => { if (confirm('Take everyone off their chairs? (Guest list and tables stay.)')) { dispatch({ type: 'clearSeats' }); say('All seats cleared'); } }}>Clear seats</button>
          <button className="danger" onClick={() => { if (confirm(mode === 'shared' ? 'Start over? This deletes the guest list and seating FOR EVERYONE using the shared plan.' : 'Start over? This deletes the guest list, seating and table changes.')) { dispatch({ type: 'reset' }); setSelTable(null); say('Started over'); } }}>Reset all</button>
        </div>
      </header>

      <aside className="left">
        <section className="import">
          <h2>1. Add guests</h2>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Paste names, one per line\n(or copy 2 columns from Excel: Name, Group)'} rows={4} />
          <div className="row">
            <button onClick={addPaste} disabled={!paste.trim()}>Add names</button>
            <button onClick={() => fileRef.current.click()}>Import Excel / CSV…</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={onFile} />
          </div>
        </section>
        <section className="list-head">
          <h2>{isMobile ? '2. Tap a guest, then tap a chair' : '2. Drag guests to chairs'}</h2>
          <input className="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or group…" />
          <label className="chk"><input type="checkbox" checked={showSeated} onChange={(e) => setShowSeated(e.target.checked)} /> show seated guests too</label>
          {selGuest && byId.get(selGuest) && <div className="hint">Now click a chair for <b>{byId.get(selGuest).name}</b> (Esc to cancel)</div>}
        </section>
        <div className={'guestlist' + (drag && drag.over === 'list::' ? ' over' : '')} data-drop="list">
          {listed.length ? listed.map((g) => chip(g, <button className="x" title="Delete guest" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); if (confirm(`Delete ${g.name} from the guest list?`)) dispatch({ type: 'removeGuest', gid: g.id }); }}>×</button>))
            : <div className="empty">{total ? (q ? 'No match' : 'Everyone is seated 🎉') : 'No guests yet. Paste names or import a file above.'}</div>}
        </div>
        <div className="foot">{listedUnseated.length} not seated shown · drop a guest here to unseat</div>
        {groups.length > 0 && <div className="legend">{groups.map((g) => <span key={g} onClick={() => setSearch(g)}><i style={{ background: PALETTE[groups.indexOf(g) % PALETTE.length] }} />{g}</span>)}</div>}
      </aside>

      <main className="planwrap">
        {mode === 'demo' && <div className="banner d-only">Demo with made-up names. Nothing here is saved.</div>}
        {arrange && <div className="banner">Move tables: drag a table's centre to a new spot. Click "Done moving" when finished.</div>}
        <div className="planscroll" ref={scrollRef}>{plan}</div>
        <div className="mzoom m-only">
          <button onClick={() => setZoom((z) => z + 0.5)} aria-label="Zoom in">+</button>
          <button onClick={() => setZoom(2)} className="zl">{Math.round(zoom * 100)}%</button>
          <button onClick={() => setZoom((z) => z - 0.5)} aria-label="Zoom out">−</button>
        </div>
        <div className="planfoot">Hover a chair to see the name · click a table to see its 10 seats · double-click a chair to unseat
          <label className="chk"><input type="checkbox" checked={showNames} onChange={(e) => setShowNames(e.target.checked)} /> names on plan when zoomed ≥150%</label></div>
      </main>

      <aside className="right">
        {table ? (
          <div className="detail">
            <div className="dhead">
              <input className="tname" value={table.label} onChange={(e) => dispatch({ type: 'renameTable', table: table.id, label: e.target.value }, { merge: 'rename:' + table.id })} title="Rename table" />
              <span className="cnt">{table.seats.filter(Boolean).length}/{table.seats.length}</span>
              <button className="x" onClick={() => setSelTable(null)} title="Close">×</button>
            </div>
            <div className="seats">
              {table.seats.map((gid, i) => {
                const g = gid && byId.get(gid);
                return (
                  <div key={i} className={'seatrow' + (drag && drag.over === `seat:${table.id}:${i}` ? ' over' : '')} data-drop="seat" data-table={table.id} data-seat={i}
                    onClick={() => { if (selGuest) drop(selGuest, { kind: 'seat', table: table.id, seat: i }); else if (!gid) openPicker(table.id, i); }}>
                    <span className="no">{i + 1}</span>
                    {g ? chip(g, <>
                      <button className="mv m-only" onClick={(e) => { e.stopPropagation(); setSelGuest(gid); setMtab('plan'); }}>Move</button>
                      <button className="x" title="Remove from seat" aria-label="Unseat" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); dispatch({ type: 'unseat', gid }); say(`${g.name} moved back to the list`); }}>×</button></>, true)
                      : <span className="free">{selGuest ? (isMobile ? 'tap to seat here' : 'click to seat here') : (isMobile ? 'empty – tap to choose a guest' : 'empty – drop a guest here, or click to choose')}</span>}
                  </div>
                );
              })}
            </div>
            <div className="dtools">
              <button disabled={!listedUnseated.length || M.firstEmptySeat(table) < 0} onClick={() => { dispatch({ type: 'fillTable', table: table.id, gids: listedUnseated.map((g) => g.id) }); say(`Filled Table ${table.label} from the list${q ? ` (search "${search}")` : ''}`); }}>
                Fill empty seats from list{q ? ` ("${search}")` : ''}</button>
              <button onClick={() => dispatch({ type: 'setVip', table: table.id, vip: !table.vip })}>{table.vip ? 'Make normal (grey)' : 'Make VIP (red)'}</button>
              <button onClick={() => { dispatch({ type: 'clearTable', table: table.id }); }}>Clear this table</button>
              <button className="danger" onClick={() => { if (confirm(`Remove table ${table.label}? Its guests go back to the list.`)) { dispatch({ type: 'removeTable', table: table.id }); setSelTable(null); } }}>Remove table</button>
            </div>
          </div>
        ) : (
          <div className="help">
            <h2>How to use</h2>
            <ol>
              <li>Paste names or import an Excel/CSV list (first column = name, optional <i>Group</i> column).</li>
              <li>Drag a name from the list onto a chair. Or click a name, then click a chair.</li>
              <li>Drag between chairs to move; dropping on a taken chair swaps the two guests.</li>
              <li>Drag a seated guest back to the list, or double-click the chair, to unseat.</li>
              <li>Click a table to see and edit its 10 seats here.</li>
              <li>Export Excel when done. Everything saves in this browser automatically.</li>
            </ol>
          </div>
        )}
        <h2 className="tl-h">Tables</h2>
        <div className="tablelist">
          {M.sortedTables(state).map((t) => { const n = t.seats.filter(Boolean).length; return (
            <button key={t.id} className={'tl' + (t.id === selTable ? ' sel' : '') + (n === t.seats.length ? ' full' : n ? ' part' : '')} onClick={() => { setSelTable(t.id); if (isMobile) document.querySelector('aside.right')?.scrollTo({ top: 0 }); }}
              data-drop="table" data-table={t.id}>{t.label}<small>{n}/{t.seats.length}</small></button>); })}
        </div>
      </aside>

      {selGuest && byId.get(selGuest) && (
        <div className="selbar m-only">
          <span>{where.has(selGuest) ? 'Moving' : 'Seating'}: <b>{byId.get(selGuest).name}</b> – tap a chair{mtab === 'table' ? ' or seat row' : ''}{where.has(selGuest) ? ' (a taken chair swaps)' : ''}</span>
          <button onClick={() => setSelGuest(null)}>Cancel</button>
        </div>
      )}
      <nav className="tabbar m-only">
        <button className={mtab === 'plan' ? 'on' : ''} onClick={() => setMtab('plan')}><span>🗺️</span>Plan</button>
        <button className={mtab === 'guests' ? 'on' : ''} onClick={() => setMtab('guests')}><span>👥</span>Guests{total - seated > 0 ? ` (${total - seated})` : ''}</button>
        <button className={mtab === 'table' ? 'on' : ''} onClick={() => setMtab('table')}><span>🪑</span>{table ? `Table ${table.label}` : 'Tables'}</button>
      </nav>
      {picker && (() => {
        const t = state.tables.find((x) => x.id === picker.table);
        if (!t) return null;
        const list = pickerGuests(state, pickerQ, pickerAll);
        const occ = t.seats[picker.seat] && byId.get(t.seats[picker.seat]);
        return (
          <div className="sheet-bg" onClick={() => setPicker(null)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose a guest">
              <div className="sheet-h">
                <div><b>Who sits at Table {t.label}, seat {picker.seat + 1}?</b>{occ && <div className="sub">Now: {occ.name} (will swap / go back to list)</div>}</div>
                <button className="x big" onClick={() => setPicker(null)} aria-label="Close">×</button>
              </div>
              <input className="search" value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} placeholder="Search name or group…" />
              <label className="chk"><input type="checkbox" checked={pickerAll} onChange={(e) => setPickerAll(e.target.checked)} /> include seated guests (moves them here)</label>
              <div className="picklist">
                {list.map((g) => { const w = where.get(g.id); return (
                  <button key={g.id} className="pick" onClick={() => { drop(g.id, { kind: 'seat', table: t.id, seat: picker.seat }); setPicker(null); }}>
                    <span className="dot" style={{ background: color(g) }} /><span className="nm">{g.name}</span>
                    {g.group && <span className="tag">{g.group}</span>}{w && <span className="tag where">T{w.table.label}·{w.seat + 1}</span>}
                  </button>); })}
                {!list.length && <div className="empty">{total ? (pickerQ ? 'No match' : 'Everyone is seated – tick “include seated guests” to move someone here') : 'No guests yet – add some in the Guests tab'}</div>}
              </div>
            </div>
          </div>
        );
      })()}
      {chairMenu && (() => {
        const g = byId.get(chairMenu.gid), t = state.tables.find((x) => x.id === chairMenu.table);
        if (!g || !t) return null;
        const close = () => setChairMenu(null);
        return (
          <div className="sheet-bg" onClick={close}>
            <div className="sheet small" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={g.name}>
              <div className="sheet-h">
                <div><b className="big-name">{g.name}</b><div className="sub">Table {t.label} · Seat {chairMenu.seat + 1}{g.group ? ' · ' + g.group : ''}</div></div>
                <button className="x big" onClick={close} aria-label="Close">×</button>
              </div>
              <div className="sheet-actions">
                <button className="primary" onClick={() => { setSelGuest(g.id); close(); }}>Move to another chair</button>
                <button onClick={() => { dispatch({ type: 'unseat', gid: g.id }); say(`${g.name} moved back to the list`); close(); }}>Unseat (back to guest list)</button>
                <button onClick={() => { setSelTable(t.id); setMtab('table'); close(); }}>Open table {t.label}</button>
                <button onClick={close}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}
      {drag && byId.get(drag.gid) && <div className="ghost" style={{ left: drag.x + 12, top: drag.y + 8 }}><span className="dot" style={{ background: color(byId.get(drag.gid)) }} />{byId.get(drag.gid).name}</div>}
      {hover && !drag && <div className="tip" style={{ left: hover.x + 14, top: hover.y + 14 }}><b>{hover.title}</b><div>{hover.sub}</div></div>}
      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}
