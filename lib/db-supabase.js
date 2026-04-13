// Supabase persistence adapter
// שומר את ה-DB כולו כשורה JSONB אחת בטבלת platform_state.
// זה שומר על תאימות מלאה עם הקוד הקיים (loadDB/saveDB) —
// ומביא persistence אמיתי בפרודקשן (Vercel serverless) + גיבוי ב-Postgres.
//
// עתידית, אפשר לפצל לטבלאות יחסיות אמיתיות; כרגע זה מאפשר deploy חי מייד.

const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

const ENABLED = !!(URL && KEY);
let client = null;
if (ENABLED) {
  client = createClient(URL, KEY, { auth: { persistSession: false } });
}

// cache in-process (חוסך read מיותר בתוך אותה בקשה/אינסטנס)
let STATE_CACHE = null;
let STATE_CACHE_AT = 0;
const CACHE_TTL_MS = 2000; // 2 שניות — מספיק לצמצם סבב read/write אבל לא לאבד עדכונים

async function loadDB() {
  if (!ENABLED) throw new Error('Supabase not configured');
  const now = Date.now();
  if (STATE_CACHE && (now - STATE_CACHE_AT) < CACHE_TTL_MS) return clone(STATE_CACHE);

  const { data, error } = await client
    .from('platform_state')
    .select('state')
    .eq('id', 'singleton')
    .maybeSingle();
  if (error) throw new Error('supabase load: ' + error.message);

  const state = (data && data.state) || emptyState();
  ensureShape(state);
  STATE_CACHE = state;
  STATE_CACHE_AT = now;
  return clone(state);
}

async function saveDB(db) {
  if (!ENABLED) throw new Error('Supabase not configured');
  ensureShape(db);
  const { error } = await client
    .from('platform_state')
    .upsert({ id: 'singleton', state: db, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) throw new Error('supabase save: ' + error.message);
  STATE_CACHE = clone(db);
  STATE_CACHE_AT = Date.now();
}

// אתחול: יוצר את השורה אם לא קיימת, עם seed אופציונלי (מעבירים את ה-db.json המקורי פעם אחת)
async function initIfEmpty(seed) {
  if (!ENABLED) return;
  const { data } = await client
    .from('platform_state')
    .select('id')
    .eq('id', 'singleton')
    .maybeSingle();
  if (!data) {
    const initial = seed || emptyState();
    ensureShape(initial);
    await client.from('platform_state').insert({ id: 'singleton', state: initial });
  }
}

function emptyState() {
  return {
    clubs: [], organizers: [], tournaments: [], registrations: [],
    applications: { organizers: [], clubs: [], players: [] },
    activityLog: []
  };
}

function ensureShape(db) {
  db.clubs ||= [];
  db.organizers ||= [];
  db.tournaments ||= [];
  db.registrations ||= [];
  db.applications ||= {};
  db.applications.organizers ||= [];
  db.applications.clubs ||= [];
  db.applications.players ||= [];
  db.activityLog ||= [];
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// ---------- Supabase Storage (uploads) ----------
async function uploadFile(buffer, filename, mime) {
  if (!ENABLED) throw new Error('Supabase not configured');
  const key = `${Date.now()}-${Math.random().toString(36).slice(2,8)}-${filename}`.replace(/[^\w.\-]/g, '_');
  const { error } = await client.storage.from(BUCKET).upload(key, buffer, {
    contentType: mime || 'application/octet-stream',
    upsert: false
  });
  if (error) throw new Error('upload: ' + error.message);
  return { key, bucket: BUCKET };
}

async function downloadFile(key) {
  if (!ENABLED) throw new Error('Supabase not configured');
  const { data, error } = await client.storage.from(BUCKET).download(key);
  if (error) throw new Error('download: ' + error.message);
  return Buffer.from(await data.arrayBuffer());
}

function getSignedUrl(key, expiresIn = 3600) {
  if (!ENABLED) return null;
  return client.storage.from(BUCKET).createSignedUrl(key, expiresIn);
}

module.exports = {
  enabled: ENABLED,
  loadDB, saveDB, initIfEmpty,
  uploadFile, downloadFile, getSignedUrl,
  BUCKET
};
