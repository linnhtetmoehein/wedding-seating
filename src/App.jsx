import React, { useEffect, useRef, useState } from 'react';
import Planner, { demoState } from './Planner.jsx';
import * as M from './model.js';
import { applyOp } from './ops.js';
import { SyncEngine } from './sync.js';
import { createRemote } from './remote.js';
import { SUPABASE_URL, SUPABASE_KEY, PLAN_ID, POLL_SECONDS } from './config.js';

const LOCAL_KEY = 'wedding-seating-v1';
const LOGIN_KEY = 'wedding-seating-login';
const CACHE_KEY = 'wedding-seating-shared-cache';
const params = new URLSearchParams(location.search);
const sharedAvailable = !!(SUPABASE_URL && SUPABASE_KEY);

export default function App() {
  if (params.has('demo')) return <LocalPlan mode="demo" />;
  if (params.has('local') || !sharedAvailable) return <LocalPlan mode="local" />;
  return <SharedGate />;
}

// ---------- offline mode: saved in this browser only (and ?demo, which never saves) ----------
function LocalPlan({ mode }) {
  const [state, setState] = useState(() => {
    if (mode === 'demo') return demoState();
    try { const raw = localStorage.getItem(LOCAL_KEY); if (raw) return M.sanitize(JSON.parse(raw)); } catch { /* ignore */ }
    return M.emptyState();
  });
  const ref = useRef(state);
  const hist = useRef([]);
  const lastMerge = useRef(null);
  useEffect(() => { if (mode !== 'demo') try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); } catch { /* full */ } }, [state, mode]);
  const dispatch = (op, opts = {}) => {
    const s = ref.current, n = applyOp(s, op);
    if (n === s) return;
    if (!(opts.merge && opts.merge === lastMerge.current)) { hist.current.push(s); if (hist.current.length > 60) hist.current.shift(); }
    lastMerge.current = opts.merge || null;
    ref.current = n; setState(n);
  };
  const undo = () => { const p = hist.current.pop(); if (!p) return false; lastMerge.current = null; ref.current = p; setState(p); return true; };
  const bar = (
    <span className="sync local">
      {mode === 'demo' ? 'Demo – not saved' : 'Offline mode – saved on this computer only'}
      {sharedAvailable && mode === 'local' && <a href={location.pathname}>switch to shared plan</a>}
    </span>
  );
  return <Planner state={state} dispatch={dispatch} undo={undo} canUndo={hist.current.length > 0} mode={mode} syncBar={bar} />;
}

// ---------- shared mode ----------
const STATUS_TEXT = {
  loading: ['Loading…', 'busy'], saving: ['Saving…', 'busy'], saved: ['✓ All changes saved', 'ok'],
  offline: ['⚠ Offline – your changes are kept and will be saved when back online', 'warn'],
  bad: ['⚠ Passcode no longer works', 'err'], not_set: ['⚠ Passcode not set yet', 'err'], locked: ['⚠ Too many wrong passcodes – wait 10 min', 'err'],
  invalid: ['⚠ Save rejected (plan too big?)', 'err'], no_plan: ['⚠ Plan not found', 'err'],
};

function SharedGate() {
  const [login, setLogin] = useState(() => { try { return JSON.parse(localStorage.getItem(LOGIN_KEY) || 'null'); } catch { return null; } });
  const [error, setError] = useState('');
  const logout = (why = '') => { localStorage.removeItem(LOGIN_KEY); localStorage.removeItem(CACHE_KEY); setError(why); setLogin(null); };
  if (!login) return <LoginScreen error={error} onLogin={(l) => { localStorage.setItem(LOGIN_KEY, JSON.stringify(l)); setError(''); setLogin(l); }} />;
  return <SharedPlan key={login.passcode} login={login} onLogout={logout} />;
}

function LoginScreen({ onLogin, error }) {
  const [name, setName] = useState(() => { try { return JSON.parse(localStorage.getItem(LOGIN_KEY) || '{}').name || localStorage.getItem('wedding-seating-name') || ''; } catch { return ''; } });
  const [pass, setPass] = useState('');
  const [msg, setMsg] = useState(error);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const r = await createRemote({ url: SUPABASE_URL, key: SUPABASE_KEY, passcode: pass, plan: PLAN_ID }).api.get();
      if (r.status === 'ok') { localStorage.setItem('wedding-seating-name', name.trim()); onLogin({ name: name.trim() || 'Someone', passcode: pass }); return; }
      setMsg({ bad: 'Wrong passcode. Please check and try again.', not_set: 'The passcode has not been set up yet. Ask Linn.', locked: 'Too many wrong tries. Please wait 10 minutes.' }[r.status] || 'Error: ' + r.status);
    } catch (err) { setMsg('Could not reach the server. Check your internet. (' + (err.message || err) + ')'); }
    setBusy(false);
  }
  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>💍 Wedding Seating</h1>
        <p>This is the shared seating plan. Everyone with the passcode sees and edits the same plan.</p>
        <label>Your name (so others can see who is online)<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Linn" maxLength={40} /></label>
        <label>Edit passcode<input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus required /></label>
        {msg && <div className="lerr">{msg}</div>}
        <button className="primary" disabled={busy || !pass}>{busy ? 'Checking…' : 'Open the plan'}</button>
        <p className="small">The passcode is remembered on this device until you click “Sign out”.<br />
          <a href="?local">Use offline on this computer only</a> · <a href="?demo">See a demo</a></p>
      </form>
    </div>
  );
}

function SharedPlan({ login, onLogout }) {
  const [, force] = useState(0);
  const [status, setStatus] = useState('loading');
  const [people, setPeople] = useState([]);
  const [live, setLive] = useState(false);
  const engineRef = useRef(null);
  if (!engineRef.current) {
    const remote = createRemote({ url: SUPABASE_URL, key: SUPABASE_KEY, passcode: login.passcode, name: login.name, plan: PLAN_ID });
    const engine = new SyncEngine(remote.api, { storage: localStorage, storageKey: CACHE_KEY });
    engine.remote = remote;
    engineRef.current = engine;
  }
  const engine = engineRef.current;
  useEffect(() => {
    engine.onChange = () => force((n) => n + 1);
    engine.onStatus = (s) => { setStatus(s); if (s === 'bad' || s === 'not_set') onLogout(s === 'bad' ? 'The passcode has changed. Please enter the new one.' : 'The passcode has not been set up yet. Ask Linn.'); };
    engine.onSaved = (v) => engine.remote.notify(v);
    engine.refresh();
    engine.remote.connect({ onRemoteSave: () => engine.refresh(), onPeople: setPeople, onLive: setLive });
    const poll = setInterval(() => { if (document.visibilityState === 'visible') engine.refresh(); }, POLL_SECONDS * 1000);
    const onVis = () => document.visibilityState === 'visible' && engine.refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(poll); document.removeEventListener('visibilitychange', onVis); engine.remote.close(); };
  }, []);
  const dispatch = (op, opts = {}) => {
    const last = engine.pending[engine.pending.length - 1];
    // typing a table name: replace the previous unsaved keystroke instead of piling up ops
    if (opts.merge && last && last._merge === opts.merge && !engine.inflight) engine.pending.pop(); // not while that op is being saved
    engine.dispatch(opts.merge ? { ...op, _merge: opts.merge } : op);
  };
  const [text, cls] = engine.pending.length && status === 'saved' ? STATUS_TEXT.saving : STATUS_TEXT[status] || [status, 'warn'];
  const others = people.filter((p) => !p.me);
  const bar = (
    <span className={'sync ' + cls}>
      <span className="pill">{text}</span>
      <span className="people" title={live ? 'Live updates on' : 'Live updates off – checking every ' + POLL_SECONDS + 's'}>
        <i className={'live' + (live ? ' on' : '')} />
        {others.length ? <>Also here: {others.map((p) => <b key={p.id}>{p.name}</b>)}</> : 'Only you here'}
      </span>
      <button className="link" onClick={() => { if (!engine.pending.length || confirm('Some changes are not saved yet. Sign out anyway?')) onLogout(); }}>Sign out ({login.name})</button>
    </span>
  );
  return <Planner state={engine.view} dispatch={dispatch} mode="shared" syncBar={bar} />;
}
