// Shared plan settings. The publishable (anon) key is meant to be public: it can only call
// get_plan / save_plan, and those need the edit passcode. Leave url empty to use offline mode only.
export const SUPABASE_URL = 'https://ebyvnlflkxidrqswalwt.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Dvqg7ss1Ci4wx_TfHbr8Iw_njgW7ty3';
export const PLAN_ID = 'main';
export const POLL_SECONDS = 15; // fallback refresh if live updates are blocked
