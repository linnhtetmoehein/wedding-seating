import { createClient } from '@supabase/supabase-js';

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Talks to Supabase: get_plan / save_plan (passcode checked by the database) and a live channel.
export function createRemote({ url, key, passcode, name, plan = 'main' }) {
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const call = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw error;
    return data;
  };
  const api = {
    get: () => call('get_plan', { p_passcode: passcode, p_plan: plan }),
    save: (data, version) => call('save_plan', { p_passcode: passcode, p_data: data, p_base_version: version, p_by: name || null, p_plan: plan }),
  };
  let channel = null;
  // The channel name comes from the passcode, so only people who know it can find the channel.
  // Messages only say "version N saved" – never any guest names.
  async function connect({ onRemoteSave, onPeople, onLive }) {
    const topic = 'plan-' + (await sha256(plan + ':' + passcode)).slice(0, 32);
    const me = Math.random().toString(36).slice(2);
    channel = sb.channel(topic, { config: { broadcast: { self: false }, presence: { key: me } } });
    channel
      .on('broadcast', { event: 'saved' }, ({ payload }) => onRemoteSave(payload?.version ?? 0))
      .on('presence', { event: 'sync' }, () => {
        const st = channel.presenceState();
        onPeople(Object.entries(st).map(([k, v]) => ({ id: k, name: v[0]?.name || 'Someone', me: k === me })));
      })
      .subscribe(async (status) => {
        onLive(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') await channel.track({ name: name || 'Someone' });
      });
  }
  const notify = (version) => channel?.send({ type: 'broadcast', event: 'saved', payload: { version } });
  const close = () => { if (channel) sb.removeChannel(channel); channel = null; };
  return { api, connect, notify, close };
}
