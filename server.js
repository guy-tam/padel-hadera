// Padel Tournament Platform — שרת Express רב-טורנירים
// מודל: clubs[], organizers[], tournaments[], registrations[], applications{}
// ראוטים SSR + API.

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || (process.env.NODE_ENV === 'production'
  ? crypto.randomBytes(24).toString('hex')  // production: אם חסר, טוקן אקראי (אדמין לא יוכל להיכנס עד שיוגדר env var — זה הרצוי)
  : 'padel-admin-2026');
if (!process.env.ADMIN_TOKEN && process.env.NODE_ENV === 'production') {
  console.warn('[WARN] ADMIN_TOKEN not set in production — admin access disabled until configured');
}

// --- תיקיות ---
// על Vercel ה-FS ב-__dirname read-only; חייבים /tmp לדברים שנכתבים.
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const WRITABLE_ROOT = IS_SERVERLESS ? '/tmp' : __dirname;
const UPLOAD_DIR = path.join(WRITABLE_ROOT, 'uploads');
const DATA_DIR = path.join(WRITABLE_ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
// seed DB שארוז ב-repo (לקריאה בלבד) — משמש כ-fallback באתחול ראשון ב-serverless
const SEED_DB_PATH = path.join(__dirname, 'data', 'db.json');

try {
  for (const d of [UPLOAD_DIR, DATA_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
} catch (e) {
  console.warn('[WARN] could not create data dirs:', e.message);
}
if (!fs.existsSync(DB_PATH)) {
  let seed = null;
  try { if (fs.existsSync(SEED_DB_PATH)) seed = fs.readFileSync(SEED_DB_PATH, 'utf8'); } catch {}
  const initial = seed || JSON.stringify({
    clubs: [], organizers: [], tournaments: [], registrations: [],
    applications: { organizers: [], clubs: [], players: [] }
  }, null, 2);
  try { fs.writeFileSync(DB_PATH, initial); } catch (e) { console.warn('[WARN] could not write initial DB:', e.message); }
}

// --- DB (אטומי + גיבוי) ---
// תמיכה ב-Supabase: אם SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY מוגדרים —
// המצב נשמר בטבלת platform_state ב-Postgres (persistence אמיתי ב-serverless).
// אחרת — fallback לקובץ JSON מקומי (dev).
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
try { if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch {}

let SB = null;
try { SB = require('./lib/db-supabase'); } catch (e) { console.warn('[supabase adapter] not loaded:', e.message); }
const USE_SUPABASE = !!(SB && SB.enabled);
if (USE_SUPABASE) {
  console.log('🗄  Persistence: Supabase Postgres');
  // seed ראשוני מ-db.json אם השורה ריקה
  (async () => {
    try {
      let seed = null;
      if (fs.existsSync(SEED_DB_PATH)) seed = JSON.parse(fs.readFileSync(SEED_DB_PATH, 'utf8'));
      await SB.initIfEmpty(seed);
    } catch (e) { console.warn('[supabase seed]', e.message); }
  })();
} else if (IS_SERVERLESS) {
  console.error('🚨🚨🚨  אזהרה קריטית: רץ ב-serverless ללא Supabase!');
  console.error('🚨  כל הנתונים (הרשמות, טורנירים, קבצים) יאבדו בכל הפעלה מחדש של האינסטנס.');
  console.error('🚨  הגדר SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY ב-Vercel env כדי לאפשר persistence אמיתי.');
} else {
  console.log('🗄  Persistence: Local JSON (dev mode). Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY for production.');
}

// --- Health endpoint — שקיפות מלאה על מצב המערכת ---
function persistenceMode() {
  if (USE_SUPABASE) return 'supabase';
  if (IS_SERVERLESS) return 'ephemeral-tmp-DANGER';
  return 'local-json';
}

let DB_LOCK = Promise.resolve();
async function loadDB() {
  if (USE_SUPABASE) return SB.loadDB();
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    db.clubs ||= []; db.organizers ||= []; db.tournaments ||= []; db.registrations ||= [];
    db.applications ||= {}; db.applications.organizers ||= [];
    db.applications.clubs ||= []; db.applications.players ||= [];
    db.activityLog ||= [];
    return db;
  } catch {
    return { clubs: [], organizers: [], tournaments: [], registrations: [], activityLog: [],
             applications: { organizers: [], clubs: [], players: [] } };
  }
}
async function saveDB(db) {
  if (USE_SUPABASE) return SB.saveDB(db);
  const tmp = DB_PATH + '.tmp.' + process.pid;
  const json = JSON.stringify(db, null, 2);
  fs.writeFileSync(tmp, json, { encoding: 'utf8', flag: 'w' });
  fs.renameSync(tmp, DB_PATH);
  const stamp = new Date().toISOString().slice(0,10);
  const bkp = path.join(BACKUP_DIR, `db-${stamp}.json`);
  if (!fs.existsSync(bkp)) {
    try { fs.writeFileSync(bkp, json, 'utf8'); } catch {}
  }
}
async function withDB(fn) {
  DB_LOCK = DB_LOCK.then(async () => {
    const db = await loadDB();
    const result = await fn(db);
    await saveDB(db);
    return result;
  }).catch(e => { console.error('[db]', e); throw e; });
  return DB_LOCK;
}

function slugify(s) {
  return String(s || '')
    .trim().toLowerCase()
    .replace(/[^\w\u0590-\u05FFa-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || ('t-' + Date.now().toString(36));
}
function uniqSlug(base, existing) {
  let s = base, i = 2;
  const set = new Set(existing);
  while (set.has(s)) s = `${base}-${i++}`;
  return s;
}

// --- סטטוסים ---
const STATUSES = [
  'submitted', 'awaiting_payment', 'payment_under_review',
  'paid_confirmed', 'approved', 'waitlist',
  'cancelled', 'refund_pending', 'refunded'
];
const RESERVING = new Set(['awaiting_payment', 'payment_under_review', 'paid_confirmed', 'approved']);

function regsForTournament(db, tid) {
  return db.registrations.filter(r => r.tournamentId === tid);
}
function countReserved(db, tid) {
  return regsForTournament(db, tid).filter(r => RESERVING.has(r.status)).length;
}
function countApproved(db, tid) {
  return regsForTournament(db, tid).filter(r => r.status === 'approved' || r.status === 'paid_confirmed').length;
}

// --- Multer ---
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-א-ת ]/g, '_').slice(0, 80);
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safe}`);
  }
});
const ALLOWED_MIMES = new Set(['application/pdf','image/jpeg','image/jpg','image/png']);
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMES.has(file.mimetype))
      return cb(new Error('סוג קובץ לא חוקי. PDF / JPG / PNG בלבד.'));
    cb(null, true);
  }
});

// --- Mailer + WhatsApp notifications ---
// כתובת "from" — Resend דורש domain מאומת, אחרת מותר רק onboarding@resend.dev.
function mailFromAddr() {
  return process.env.MAIL_FROM || process.env.SMTP_USER || 'onboarding@resend.dev';
}
// מעטפת אחידה — מחזירה אובייקט עם sendMail(), מעדיף Resend, נופל ל-Gmail SMTP.
function buildTransport() {
  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    const client = new Resend(process.env.RESEND_API_KEY);
    return {
      async sendMail({ from, to, subject, html, text, replyTo }) {
        const payload = { from: from || mailFromAddr(), to, subject, html, text };
        if (replyTo) payload.reply_to = replyTo;
        const { data, error } = await client.emails.send(payload);
        if (error) throw new Error(error.message || 'resend send failed');
        return { messageId: data && data.id };
      }
    };
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}
// כתובת בסיס ציבורית לקישורים בתוך אימיילים
function getBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  if (req) return `${req.protocol}://${req.get('host')}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'https://padel.platform';
}
// תבנית HTML אחידה ויפה למיילים (RTL, מותג)
function mailShell(title, bodyHtml) {
  return `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;padding:0;background:#062318;font-family:'Rubik','Heebo',Arial,sans-serif;color:#e9fbc4">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#062318;padding:30px 12px">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0a2b1e;border:1px solid rgba(212,255,58,0.2);border-radius:18px;overflow:hidden">
        <tr><td style="padding:26px 28px;border-bottom:1px solid rgba(212,255,58,0.14)">
          <div style="font-size:13px;color:#d4ff3a;letter-spacing:1px;font-weight:700">🎾 PADEL · PLATFORM</div>
          <h1 style="margin:8px 0 0;font-size:22px;color:#ffffff;line-height:1.3">${title}</h1>
        </td></tr>
        <tr><td style="padding:24px 28px;font-size:15px;line-height:1.7;color:#d7e8df">${bodyHtml}</td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid rgba(212,255,58,0.1);font-size:12px;color:#8fa69c;text-align:center">
          הודעה זו נשלחה אוטומטית מהפלטפורמה.<br>אם זו טעות, אפשר פשוט להתעלם.
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}
function mailBtn(href, text) {
  return `<a href="${href}" style="display:inline-block;background:#d4ff3a;color:#062a1c;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:800;font-size:15px;margin:8px 0">${text}</a>`;
}
// =================================================================
//  Activity log — יומן CRM לכל תקשורת/שינוי סטטוס
//  נקרא ממקום אחד ומתועד גם ברשומת ההרשמה וגם בטבלה גלובלית
// =================================================================
function logActivity(db, entry) {
  if (!db || !entry) return;
  const row = {
    id: 'a-' + crypto.randomBytes(3).toString('hex'),
    at: new Date().toISOString(),
    type: entry.type,              // email_sent | wa_sent | status_change | note | call | manual_wa | manual_email
    channel: entry.channel || '',  // email | whatsapp | internal | manual
    direction: entry.direction || 'out', // out | in (עתידי)
    summary: entry.summary || '',
    meta: entry.meta || null,
    regId: entry.regId || null,
    tournamentId: entry.tournamentId || null,
    clubId: entry.clubId || null,
    organizerId: entry.organizerId || null,
    contactPhone: normalizePhone(entry.contactPhone || ''),
    contactEmail: (entry.contactEmail || '').toLowerCase(),
    by: entry.by || 'system'
  };
  if (!Array.isArray(db.activityLog)) db.activityLog = [];
  db.activityLog.push(row);
  // השאר קשור לרשומת ההרשמה לתצוגה מהירה
  if (row.regId) {
    const r = db.registrations.find(x => x.id === row.regId);
    if (r) {
      if (!Array.isArray(r.activity)) r.activity = [];
      r.activity.push({ id: row.id, at: row.at, type: row.type, channel: row.channel, summary: row.summary, by: row.by });
    }
  }
  return row;
}
function normalizePhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('972')) return '0' + d.slice(3);
  return d;
}
// כתיבה ליומן שלא דרך withDB — טוען ושומר עצמאית (לשימוש מחוץ לטרנזקציה)
async function logActivityStandalone(entry) {
  try {
    const db = await loadDB();
    logActivity(db, entry);
    await saveDB(db);
  } catch (e) { console.error('activity log err', e.message); }
}

async function notifyOrganizerWhatsApp(text) {
  const key = process.env.CALLMEBOT_API_KEY;
  const num = (process.env.ORGANIZER_WA_NUMBER || '').replace(/[^\d]/g, '');
  if (!key || !num) return;
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${num}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(key)}`;
    await fetch(url);
  } catch (e) { console.error('callmebot err', e.message); }
}

// --- Security Middleware ---
app.set('trust proxy', 1); // מאחורי proxy/tunnel
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "img-src": ["'self'", "data:", "https:", "blob:"],
      "media-src": ["'self'", "https:"],
      "script-src": ["'self'", "'unsafe-inline'", "https://www.youtube.com", "https://www.youtube-nocookie.com", "https://s.ytimg.com", "https://cdn.jsdelivr.net", "https://unpkg.com"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
      "frame-src": ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com"],
      "connect-src": ["'self'", "https://api.callmebot.com", "https://www.youtube.com"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false, // למנוע חסימת YouTube embed
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

app.use(compression());

// Rate limiting — הגנה על נקודות רגישות
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 דקות
  max: 300, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: 'יותר מדי בקשות. נסה/י שוב בעוד דקה.' }
});
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: 'יותר מדי ניסיונות. נסה/י שוב בעוד כמה דקות.' }
});
const adminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30, standardHeaders: true, legacyHeaders: false,
  message: { ok: false, error: 'יותר מדי ניסיונות אדמין.' }
});

app.use('/api/', generalLimiter);
app.use('/api/tournaments/', writeLimiter);
app.use('/api/payment-proof/', writeLimiter);
app.use('/api/applications/', writeLimiter);
app.use('/api/admin/', adminLimiter);

// --- Middleware ---
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
// סטטי עם index: false כדי שהראוט של / ילך ל-homepage שלנו
app.use(express.static(PUBLIC_DIR, {
  index: false,
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// אזהרה על טוקן ברירת-מחדל
if (ADMIN_TOKEN === 'padel-admin-2026') {
  console.warn('⚠️  ADMIN_TOKEN ברירת-מחדל! החלף ל-env חזק לפני פרודקשן.');
}

// --- עזר ---
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function validPhone(p) { return /^(0\d{8,9}|\+972\d{8,9})$/.test((p || '').replace(/[\s-]/g, '')); }
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || ''); }
function clean(s, max = 200) {
  return String(s || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, max);
}
function cleanLong(s, max = 2000) { return clean(s, max); }
// מסנן URL לשימוש בתוך style="background-image:url('...')" — מונע בריחה מתוך ה-quotes
function safeUrl(s) {
  const v = String(s || '').trim();
  if (!v) return '';
  // מאפשר רק תווים בטוחים: אותיות/ספרות, שורשים יחסיים/מוחלטים ותווי URL רגילים
  if (!/^[A-Za-z0-9\-._~:/?#\[\]@!$&()*+,;=%]+$/.test(v)) return '';
  return v;
}
function statusHe(s) {
  return ({
    submitted: 'נקלטה', awaiting_payment: 'ממתין לתשלום',
    payment_under_review: 'תשלום בבדיקה', paid_confirmed: 'תשלום אושר',
    approved: 'מאושר', waitlist: 'רשימת המתנה',
    cancelled: 'בוטל', refund_pending: 'החזר בתהליך', refunded: 'הוחזר'
  })[s] || s;
}

// =================================================================
//  SSR PAGES
// =================================================================

// מגיש HTML עם חיתוך templating פשוט + הזרקת widget נגישות
const A11Y_INJECT = `<link rel="stylesheet" href="/a11y.css"><link rel="stylesheet" href="/magic.css"><script src="/a11y.js" defer></script><script src="/magic.js" defer></script></body>`;
function serveTemplate(res, filename, vars) {
  const filePath = path.join(PUBLIC_DIR, filename);
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return res.status(500).send('Template error');
    let rendered = html.replace(/\{\{(\w+)\}\}/g, (_, k) =>
      vars[k] !== undefined ? vars[k] : '');
    // הזרקה רק אם לא קיים כבר
    if (!rendered.includes('/magic.css')) {
      rendered = rendered.replace('</body>', A11Y_INJECT);
    }
    res.type('html').send(rendered);
  });
}

// --- / · Platform homepage ---
app.get('/', async (_req, res) => {
  const db = await loadDB();
  const featured = db.tournaments.filter(t => t.visibility === 'public' && t.featured)
    .map(t => tournamentCardHtml(t, db)).join('');
  serveTemplate(res, 'home.html', { FEATURED_TOURNAMENTS: featured });
});

// --- /tournaments · discovery ---
app.get('/tournaments', async (_req, res) => {
  const db = await loadDB();
  const cards = db.tournaments.filter(t => t.visibility === 'public')
    .map(t => tournamentCardHtml(t, db)).join('');
  serveTemplate(res, 'tournaments.html', { TOURNAMENT_CARDS: cards || '<p class="empty">אין טורנירים פעילים כרגע.</p>' });
});

// --- /tournaments/:slug · dynamic tournament page ---
app.get('/tournaments/:slug', async (req, res) => {
  const db = await loadDB();
  const t = db.tournaments.find(x => x.slug === req.params.slug);
  if (!t) return res.status(404).type('html').send('<!doctype html><meta charset=utf-8><h1 style=font-family:sans-serif;text-align:center;padding:80px>טורניר לא נמצא</h1>');
  const club = db.clubs.find(c => c.id === t.clubId);
  const reserved = countReserved(db, t.id);
  const full = reserved >= t.format.maxPairs;
  serveTemplate(res, 'tournament.html', {
    TOURNAMENT_TITLE: escapeHtml(t.title),
    TOURNAMENT_SUBTITLE: escapeHtml(t.subtitle || ''),
    TOURNAMENT_SLUG: t.slug,
    TOURNAMENT_DESCRIPTION: escapeHtml(t.description),
    TOURNAMENT_LOCATION: escapeHtml(t.location || ''),
    CLUB_NAME: escapeHtml(club?.name || ''),
    CLUB_SLUG: club?.slug || '',
    MAX_PAIRS: t.format.maxPairs,
    LEVEL_2_5: escapeHtml(t.format.levels.find(l => l.code==='2.5')?.label || ''),
    LEVEL_3: escapeHtml(t.format.levels.find(l => l.code==='3')?.label || ''),
    PRICE_PAIR: t.pricing.perPair,
    PRICE_PERSON: t.pricing.perPerson,
    MATCH_RULES: escapeHtml(t.format.matchRules),
    HEALTH_FORM_URL: t.healthFormUrl || '',
    REFUND_POLICY: escapeHtml(t.refundPolicy),
    BIT_NAME: escapeHtml(t.payment.recipientName),
    BIT_PHONE: escapeHtml(t.payment.recipientPhone),
    BIT_GROUP: t.payment.groupLink || '',
    CAPACITY_TEXT: full ? `הטורניר מלא (${reserved}/${t.format.maxPairs}) · רשימת המתנה בלבד`
                        : `נותרו ${t.format.maxPairs - reserved} מקומות מתוך ${t.format.maxPairs} זוגות`,
    MIN_PAID_PAIRS: t.format.minPaidPairs || t.format.maxPairs,
    IS_CONFIRMED: t.confirmed ? 'yes' : 'no'
  });
});

// --- /clubs · list ---
app.get('/clubs', async (_req, res) => {
  const db = await loadDB();
  const cards = db.clubs.map(c => clubCardHtml(c, db)).join('');
  serveTemplate(res, 'clubs.html', { CLUB_CARDS: cards });
});

// --- /clubs/join (חייב לבוא לפני /clubs/:slug) ---
app.get('/clubs/join', (_req, res) => serveTemplate(res, 'clubs-join.html', {}));

// --- /clubs/:slug · detail ---
app.get('/clubs/:slug', async (req, res) => {
  const db = await loadDB();
  const c = db.clubs.find(x => x.slug === req.params.slug);
  if (!c) return res.status(404).type('html').send('<!doctype html><meta charset=utf-8><h1 style=font-family:sans-serif;text-align:center;padding:80px>מועדון לא נמצא</h1>');
  const hosted = db.tournaments.filter(t => t.clubId === c.id && t.visibility === 'public');
  const cards = hosted.map(t => tournamentCardHtml(t, db)).join('')
    || '<p class="empty">אין טורנירים פעילים כרגע במועדון הזה.</p>';
  serveTemplate(res, 'club.html', {
    CLUB_NAME: escapeHtml(c.name),
    CLUB_CITY: escapeHtml(c.city),
    CLUB_IMAGE: c.image,
    CLUB_DESCRIPTION: escapeHtml(c.description),
    CLUB_PHONE: escapeHtml(c.contactPhone || ''),
    CLUB_EMAIL: escapeHtml(c.contactEmail || ''),
    HOSTED_CARDS: cards
  });
});

// --- /organizers/apply + /players/join ---
app.get('/organizers/apply', (_req, res) => serveTemplate(res, 'organizers-apply.html', {}));
app.get('/players/join', (_req, res) => serveTemplate(res, 'players-join.html', {}));

// --- /accessibility · הצהרת נגישות ---
app.get('/accessibility', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'accessibility.html')));

// --- Dashboards (מינימליים) ---
app.get('/dashboard', (_req, res) => serveTemplate(res, 'dashboard.html', {}));
app.get('/dashboard/organizer', (_req, res) => serveTemplate(res, 'dashboard-organizer.html', {}));
app.get('/dashboard/club', (_req, res) => serveTemplate(res, 'dashboard-club.html', {}));

// --- sitemap.xml דינמי ---
app.get('/sitemap.xml', async (req, res) => {
  const db = await loadDB();
  const base = `${req.protocol}://${req.get('host')}`;
  const urls = [
    '/', '/tournaments', '/clubs', '/organizers/apply', '/clubs/join'
  ];
  db.tournaments.filter(t => t.visibility === 'public').forEach(t => urls.push(`/tournaments/${t.slug}`));
  db.clubs.forEach(c => urls.push(`/clubs/${c.slug}`));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${base}${u}</loc></url>`).join('\n')}
</urlset>`;
  res.type('application/xml').send(xml);
});

// --- Admin (נשאר) ---
app.get('/admin', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/admin.html', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

// =================================================================
//  Card builders
// =================================================================
function tournamentCardHtml(t, db) {
  const club = db.clubs.find(c => c.id === t.clubId);
  const reserved = countReserved(db, t.id);
  const remaining = Math.max(0, t.format.maxPairs - reserved);
  const isFull = reserved >= t.format.maxPairs;
  return `
    <a class="t-card" href="/tournaments/${t.slug}">
      <div class="t-card-img" style="background-image:url('${safeUrl(t.heroImage) || '/img/padel-hero.jpg'}')">
        <span class="t-card-badge ${isFull ? 'full' : ''}">${isFull ? 'מלא · רשימת המתנה' : `${remaining} מקומות פנויים`}</span>
      </div>
      <div class="t-card-body">
        <div class="t-card-club">${escapeHtml(club?.name || '')} · ${escapeHtml(club?.city || '')}</div>
        <h3>${escapeHtml(t.title)}</h3>
        <p>${escapeHtml(t.subtitle || '')}</p>
        <div class="t-card-meta">
          <span>זוגות · ${t.format.maxPairs}</span>
          <span>${t.pricing.perPair} ₪/זוג</span>
          <span>${t.format.levels.length} רמות</span>
        </div>
      </div>
    </a>`;
}
function clubCardHtml(c, db) {
  const count = db.tournaments.filter(t => t.clubId === c.id).length;
  return `
    <a class="club-card" href="/clubs/${c.slug}">
      <div class="club-card-img" style="background-image:url('${safeUrl(c.image)}')"></div>
      <div class="club-card-body">
        <h3>${escapeHtml(c.name)}</h3>
        <p>${escapeHtml(c.city)} · ${count} טורנירים</p>
        <p class="club-card-desc">${escapeHtml(c.shortDescription || '')}</p>
      </div>
    </a>`;
}

// =================================================================
//  API — scoped by tournament
// =================================================================

// קיבולת ציבורית
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    persistence: persistenceMode(),
    serverless: IS_SERVERLESS,
    supabase: USE_SUPABASE,
    mail: process.env.RESEND_API_KEY ? 'resend' : (process.env.SMTP_USER ? 'smtp' : 'disabled'),
    mail_from: mailFromAddr(),
    admin_token_set: !!process.env.ADMIN_TOKEN,
    node: process.version,
    ts: new Date().toISOString()
  });
});

app.get('/api/tournaments/:slug/capacity', async (req, res) => {
  const db = await loadDB();
  const t = db.tournaments.find(x => x.slug === req.params.slug);
  if (!t) return res.status(404).json({ ok: false, error: 'not found' });
  const reserved = countReserved(db, t.id);
  res.json({
    maxPairs: t.format.maxPairs,
    reserved,
    approved: countApproved(db, t.id),
    remaining: Math.max(0, t.format.maxPairs - reserved),
    full: reserved >= t.format.maxPairs
  });
});

// תאימות אחורה לאתר הישן
app.get('/api/capacity', async (req, res) => {
  const db = await loadDB();
  const t = db.tournaments.find(x => x.slug === 'hadera-2026');
  if (!t) return res.json({ maxPairs: 8, reserved: 0, approved: 0, remaining: 8, full: false });
  const reserved = countReserved(db, t.id);
  res.json({
    maxPairs: t.format.maxPairs, reserved,
    approved: countApproved(db, t.id),
    remaining: Math.max(0, t.format.maxPairs - reserved),
    full: reserved >= t.format.maxPairs
  });
});

// הרשמה — לטורניר ספציפי
app.post('/api/tournaments/:slug/register', async (req, res) => {
  const db = await loadDB();
  const t = db.tournaments.find(x => x.slug === req.params.slug);
  if (!t) return res.status(404).json({ ok: false, errors: ['טורניר לא נמצא.'] });

  upload.single('healthFile')(req, res, async (err) => {
    if (err) return res.status(400).json({ ok: false, errors: [err.message] });
    const errors = [];
    const { fullName, phone, email, level, partnerName, partnerPhone,
            notes, consent, healthConsent, paymentAck } = req.body;

    const levelCodes = t.format.levels.map(l => l.code);
    if (!fullName || fullName.trim().length < 2) errors.push('שם מלא חסר.');
    if (!validPhone(phone)) errors.push('טלפון לא תקין.');
    if (!validEmail(email)) errors.push('מייל לא תקין.');
    if (!levelCodes.includes(level)) errors.push('רמה לא תקינה.');
    if (t.format.pair) {
      if (!partnerName || partnerName.trim().length < 2) errors.push('שם שותף/ה חסר.');
      if (!validPhone(partnerPhone)) errors.push('טלפון שותף/ה לא תקין.');
    }
    if (!['on','true',true].includes(consent)) errors.push('יש לאשר תנאי השתתפות.');
    if (t.requireHealthDeclaration) {
      if (!['on','true',true].includes(healthConsent)) errors.push('יש לאשר את הצהרת הבריאות.');
      if (!req.file) errors.push('חובה להעלות הצהרת בריאות חתומה.');
      else if (req.file.size < 10 * 1024) errors.push('קובץ הצהרת בריאות קטן מדי.');
    }
    if (!['on','true',true].includes(paymentAck)) errors.push('יש לאשר את מדיניות התשלום.');

    if (errors.length) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ ok: false, errors });
    }

    const reserved = countReserved(db, t.id);
    const initialStatus = reserved >= t.format.maxPairs ? 'waitlist' : 'awaiting_payment';

    const id = 'HDR-' + Date.now().toString(36).toUpperCase()
      + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();

    const verifyToken = crypto.randomBytes(24).toString('hex');

    const record = {
      id,
      tournamentId: t.id,
      createdAt: new Date().toISOString(),
      status: initialStatus,
      fullName: clean(fullName, 100),
      phone: clean(phone, 20),
      email: clean(email, 100),
      level: clean(level, 10),
      partnerName: clean(partnerName, 100),
      partnerPhone: clean(partnerPhone, 20),
      notes: cleanLong(notes, 500),
      healthFile: req.file ? {
        original: req.file.originalname, stored: req.file.filename, size: req.file.size
      } : null,
      paymentProof: null,
      emailVerified: false,
      verifyToken,
      verifiedAt: null,
      notifiedStatuses: [],
      history: [{ at: new Date().toISOString(), status: initialStatus, by: 'system' }]
    };
    db.registrations.push(record);
    await saveDB(db);

    const baseUrl = getBaseUrl(req);
    sendRegistrationEmails(record, t, baseUrl).catch(e => console.error('mail err', e.message));
    notifyOrganizerWhatsApp(
      `🎾 הרשמה חדשה · ${t.title}\n${record.fullName} (${record.phone}) · רמה ${record.level}\n` +
      (record.partnerName ? `שותף/ה: ${record.partnerName}\n` : '') +
      `סטטוס: ${statusHe(initialStatus)} · מזהה: ${id}`
    ).catch(() => {});

    res.json({ ok: true, id, status: initialStatus, waitlist: initialStatus === 'waitlist' });
  });
});

// תאימות אחורה
app.post('/api/register', async (req, res, next) => {
  req.url = '/api/tournaments/hadera-2026/register';
  next('route');
});
app.post('/api/register', async (req, res) => {
  // מועבר הלאה — הגדרנו את ה-handler האמיתי למעלה
});

// העלאת אסמכתת תשלום
app.post('/api/payment-proof/:id', async (req, res) => {
  upload.single('paymentFile')(req, res, async (err) => {
    if (err) return res.status(400).json({ ok: false, errors: [err.message] });
    const db = await loadDB();
    const r = db.registrations.find(x => x.id === req.params.id);
    if (!r) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ ok: false, errors: ['הרשמה לא נמצאה.'] });
    }
    if (!req.file) return res.status(400).json({ ok: false, errors: ['חובה לצרף צילום מסך.'] });
    if (req.file.size < 5 * 1024) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ ok: false, errors: ['הקובץ קטן מדי.'] });
    }
    r.paymentProof = {
      original: req.file.originalname,
      stored: req.file.filename,
      size: req.file.size,
      at: new Date().toISOString()
    };
    if (r.status === 'awaiting_payment') {
      r.status = 'payment_under_review';
      r.history.push({ at: new Date().toISOString(), status: 'payment_under_review', by: 'user' });
    }
    await saveDB(db);
    const t = db.tournaments.find(x => x.id === r.tournamentId);
    sendPaymentProofEmail(r, t).catch(e => console.error('mail err', e.message));
    notifyOrganizerWhatsApp(
      `💳 אסמכתת תשלום · ${t?.title || ''}\n${r.fullName} · מזהה: ${r.id}`
    ).catch(() => {});
    res.json({ ok: true, status: r.status });
  });
});

// בדיקת סטטוס
app.get('/api/status/:id', async (req, res) => {
  const db = await loadDB();
  const r = db.registrations.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ ok: false, error: 'הרשמה לא נמצאה' });
  res.json({ ok: true, id: r.id, status: r.status, fullName: r.fullName, hasPaymentProof: !!r.paymentProof });
});

// --- Applications: arganizers / clubs ---
app.post('/api/applications/organizer', express.json(), async (req, res) => {
  const db = await loadDB();
  const { name, email, phone, city, experience, note,
          businessType, businessId, businessName, bitPhone, verifyAck } = req.body || {};
  const errs = [];
  if (!name || name.trim().length < 2) errs.push('שם חסר.');
  if (!validEmail(email)) errs.push('מייל לא תקין.');
  if (!validPhone(phone)) errs.push('טלפון לא תקין.');
  if (!['osek_patur','osek_murshe','company','none'].includes(businessType)) errs.push('סוג תיק עוסק חסר.');
  if (businessType && businessType !== 'none' && !/^\d{9}$/.test(String(businessId || ''))) errs.push('מספר ח.פ./ע.מ. חסר או לא תקין (9 ספרות).');
  if (!verifyAck) errs.push('יש לאשר את תנאי התשלום הישיר.');
  if (errs.length) return res.status(400).json({ ok: false, errors: errs });
  const entry = {
    id: 'ORG-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    createdAt: new Date().toISOString(),
    name: clean(name, 100), email: clean(email, 100), phone: clean(phone, 20),
    city: clean(city, 60),
    experience: clean(experience, 60), note: cleanLong(note, 500),
    business: {
      type: businessType,
      id: clean(businessId, 15),
      name: clean(businessName, 100),
      bitPhone: clean(bitPhone, 20),
      verified: false,
      verifiedAt: null
    },
    status: 'pending_verification'
  };
  db.applications.organizers.push(entry);
  await saveDB(db);
  notifyOrganizerWhatsApp(`🆕 יזם/ית טורניר חדש/ה:\n${entry.name} · ${entry.phone}\nעסק: ${entry.business.type} (${entry.business.id})\n${entry.note || ''}`).catch(()=>{});
  res.json({ ok: true, id: entry.id });
});

// שחקנים — עם dashboardToken אישי + פתיחת פרופיל
app.post('/api/applications/player', express.json(), async (req, res) => {
  const { name, email, phone, city, level, partnerName, note, consent } = req.body || {};
  const errs = [];
  if (!name || name.trim().length < 2) errs.push('שם חסר.');
  if (!validEmail(email)) errs.push('מייל לא תקין.');
  if (!validPhone(phone)) errs.push('טלפון לא תקין.');
  if (!city || city.trim().length < 2) errs.push('עיר חסרה.');
  if (!['2.5','3','unknown'].includes(level)) errs.push('רמה לא תקינה.');
  if (!consent) errs.push('יש לאשר תנאי שימוש.');
  if (errs.length) return res.status(400).json({ ok: false, errors: errs });

  const result = await withDB(db => {
    const token = crypto.randomBytes(16).toString('hex');
    const entry = {
      id: 'PL-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      dashboardToken: token,
      createdAt: new Date().toISOString(),
      name: clean(name, 100), email: clean(email, 100), phone: clean(phone, 20),
      city: clean(city, 60), level,
      partnerName: clean(partnerName, 100),
      note: cleanLong(note, 500),
      stats: { points: 0, tournaments: 0, wins: 0, finals: 0, semifinals: 0 },
      history: [],
      status: 'active'
    };
    db.applications.players.push(entry);
    return { ok: true, id: entry.id, dashboardToken: token, dashboardUrl: `/player/${token}` };
  });
  notifyOrganizerWhatsApp(`🎾 שחקן/ית חדש/ה ברשת:\n${name} · ${phone} · רמה ${level} · ${city}`).catch(()=>{});
  res.json(result);
});

app.post('/api/applications/club', express.json(), async (req, res) => {
  const db = await loadDB();
  const name = clean(req.body?.name, 120);
  const city = clean(req.body?.city, 80);
  const contactPerson = clean(req.body?.contactPerson, 120);
  const email = clean(req.body?.email, 200);
  const phone = clean(req.body?.phone, 40);
  const courts = clean(req.body?.courts, 80);
  const note = cleanLong(req.body?.note, 1000);
  const errs = [];
  if (!name || name.length < 2) errs.push('שם המועדון חסר.');
  if (!city || city.length < 2) errs.push('עיר חסרה.');
  if (!validEmail(email)) errs.push('מייל לא תקין.');
  if (!validPhone(phone)) errs.push('טלפון לא תקין.');
  if (errs.length) return res.status(400).json({ ok: false, errors: errs });
  const entry = {
    id: 'CLUB-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    createdAt: new Date().toISOString(),
    name, city, contactPerson, email, phone,
    courts, note, status: 'pending'
  };
  db.applications.clubs.push(entry);
  await saveDB(db);
  notifyOrganizerWhatsApp(`🏟 מועדון חדש מעוניין להצטרף:\n${entry.name} · ${entry.city} · ${entry.phone}`).catch(()=>{});
  res.json({ ok: true, id: entry.id });
});

// --- Admin ---
function adminAuth(req, res, next) {
  const token = String(req.headers['x-admin-token'] || req.query.token || '');
  // constant-time comparison למניעת timing attacks
  const a = Buffer.from(token.padEnd(64, ' ').slice(0, 64));
  const b = Buffer.from(String(ADMIN_TOKEN).padEnd(64, ' ').slice(0, 64));
  if (!crypto.timingSafeEqual(a, b)) return res.status(401).json({ ok: false, error: 'אין הרשאה' });
  next();
}

app.get('/api/admin/list', adminAuth, async (_req, res) => {
  const db = await loadDB();
  // עטיפה שתואמת ל-admin.html הישן (טורניר יחיד) וגם מאפשרת רב-טורנירים
  const mainT = db.tournaments[0];
  const tid = mainT?.id;
  const regs = tid ? regsForTournament(db, tid) : [];
  res.json({
    ok: true,
    capacity: { max: mainT?.format.maxPairs || 8, reserved: countReserved(db, tid), approved: countApproved(db, tid) },
    registrations: regs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    // חדש — רב-טורנירים:
    tournaments: db.tournaments.map(t => ({
      id: t.id, slug: t.slug, title: t.title,
      capacity: { max: t.format.maxPairs, reserved: countReserved(db, t.id), approved: countApproved(db, t.id) },
      registrations: regsForTournament(db, t.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt))
    })),
    applications: db.applications,
    // מועדונים פעילים — לשכפול קישור דשבורד/הפקת טוקן
    clubs: db.clubs.map(c => ({
      id: c.id, slug: c.slug, name: c.name, city: c.city, status: c.status,
      hasToken: !!c.dashboardToken,
      dashboardUrl: c.dashboardToken ? `/club/${c.dashboardToken}` : null,
      slotsCount: (c.slots || []).length
    })),
    organizers: db.organizers.map(o => ({
      id: o.id, slug: o.slug, name: o.name, status: o.status,
      hasToken: !!o.dashboardToken,
      dashboardUrl: o.dashboardToken ? `/organizer/${o.dashboardToken}` : null
    }))
  });
});

app.post('/api/admin/status/:id', adminAuth, express.json(), async (req, res) => {
  const { status, note } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'סטטוס לא חוקי' });
  try {
    // אחרי שמירה נרצה לשלוח מיילים — נאסוף את הנתונים ל-side-effects
    let updatedReg = null, updatedTournament = null, promotedWaiter = null;
    let justConfirmedTournament = false, justAllPaid = false, paidRegs = [];

    const result = await withDB(db => {
      const r = db.registrations.find(x => x.id === req.params.id);
      if (!r) throw new Error('לא נמצא');
      const prev = r.status;
      r.status = status;
      r.history.push({ at: new Date().toISOString(), status, by: 'admin', note: note || '' });
      logActivity(db, {
        type: 'status_change', channel: 'internal',
        summary: `סטטוס: ${statusHe(prev)} → ${statusHe(status)}${note ? ' · '+note : ''}`,
        regId: r.id, tournamentId: r.tournamentId,
        contactEmail: r.email, contactPhone: r.phone, by: 'admin', meta: { prev, next: status, note }
      });

      if (RESERVING.has(prev) && !RESERVING.has(status)) {
        const waiter = db.registrations.find(x => x.tournamentId === r.tournamentId && x.status === 'waitlist');
        if (waiter) {
          waiter.status = 'awaiting_payment';
          waiter.history.push({ at: new Date().toISOString(), status: 'awaiting_payment', by: 'system', note: 'קודם מרשימת המתנה' });
          promotedWaiter = waiter;
        }
      }

      // בדיקת קונפירמציה — האם הגענו למינימום זוגות בתשלום מאושר
      const t = db.tournaments.find(x => x.id === r.tournamentId);
      if (t) {
        paidRegs = db.registrations.filter(x => x.tournamentId === t.id &&
          (x.status === 'paid_confirmed' || x.status === 'approved'));
        const paid = paidRegs.length;
        const needed = t.format?.minPaidPairs || t.format?.maxPairs || 8;
        const max = t.format?.maxPairs || needed;
        if (!t.confirmed && paid >= needed) {
          t.confirmed = true;
          t.confirmedAt = new Date().toISOString();
          justConfirmedTournament = true;
          notifyOrganizerWhatsApp(`🎉 האירוע "${t.title}" אושר! הגיעו ל-${paid} זוגות בתשלום.`).catch(()=>{});
        }
        // כולם שילמו — הגיע ל-max
        if (!t.allPaidAt && paid >= max) {
          t.allPaidAt = new Date().toISOString();
          justAllPaid = true;
        }
        updatedTournament = t;
      }
      updatedReg = r;
      return { ok: true, status: r.status };
    });

    // Side effects — מיילים (אחרי saveDB) ==============================
    try {
      if (updatedReg && updatedTournament) {
        sendStatusUpdateEmail(updatedReg, updatedTournament, null, note)
          .catch(e => console.error('status mail err', e.message))
          .then(async () => { try { const db = await loadDB(); await saveDB(db); } catch(_){} });
      }
      if (promotedWaiter && updatedTournament) {
        sendStatusUpdateEmail(promotedWaiter, updatedTournament, 'waitlist', 'קודמת מרשימת המתנה')
          .catch(e => console.error('promo mail err', e.message));
      }
      if (justConfirmedTournament && updatedTournament) {
        sendTournamentConfirmedEmails(updatedTournament, paidRegs)
          .catch(e => console.error('confirm mail err', e.message))
          .then(async () => { try { const db = await loadDB(); await saveDB(db); } catch(_){} });
      }
      if (justAllPaid && updatedTournament) {
        sendAllPaidEmails(updatedTournament, paidRegs)
          .catch(e => console.error('allpaid mail err', e.message));
      }
    } catch (e) { console.error('email side-effects err', e.message); }

    res.json(result);
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// --- אימות מייל של נרשם/ת ---
app.get('/api/verify/:token', async (req, res) => {
  const token = String(req.params.token || '');
  if (!token || token.length < 20) return res.status(400).type('html').send(verifyPage('קישור לא תקין', 'הקישור פגום או ישן. אם ההרשמה קיימת — היא בתוקף.', false));
  try {
    const outcome = await withDB(db => {
      const r = db.registrations.find(x => x.verifyToken === token);
      if (!r) return { ok: false, msg: 'הקישור לא נמצא או שההרשמה בוטלה.' };
      if (r.emailVerified) return { ok: true, already: true, r };
      r.emailVerified = true;
      r.verifiedAt = new Date().toISOString();
      r.history.push({ at: r.verifiedAt, status: r.status, by: 'user', note: 'אומת מייל' });
      const t = db.tournaments.find(x => x.id === r.tournamentId);
      return { ok: true, r, t };
    });
    if (!outcome.ok) return res.status(404).type('html').send(verifyPage('קישור לא נמצא', outcome.msg, false));
    const title = outcome.already ? 'כבר אומתת ✓' : 'האימות הושלם! ✅';
    const msg = outcome.already
      ? 'המייל שלך אומת בעבר. ההרשמה בתוקף.'
      : 'תודה! זיהינו שזה באמת את/ה. נמשיך לעדכן אותך במייל בכל שינוי: אישור הרשמה, אימות תשלום, ואישור סופי של הטורניר.';
    res.type('html').send(verifyPage(title, msg, true, outcome.r));
  } catch (e) {
    res.status(500).type('html').send(verifyPage('שגיאה', 'משהו לא עבד כצפוי. נסו שוב.', false));
  }
});

function verifyPage(title, msg, ok, r) {
  const color = ok ? '#d4ff3a' : '#ff9aa4';
  return `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/platform.css">
  <link rel="stylesheet" href="/polish.css">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <body style="background:#062318;color:#e9fbc4;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:30px">
    <main style="max-width:520px;width:100%;background:#0a2b1e;border:1px solid rgba(212,255,58,0.25);border-radius:20px;padding:32px 28px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.35)">
      <div style="font-size:52px;line-height:1;margin-bottom:14px">${ok ? '✅' : '⚠️'}</div>
      <h1 style="color:${color};font-size:26px;margin:0 0 10px">${escapeHtml(title)}</h1>
      <p style="color:#d7e8df;font-size:16px;line-height:1.6">${escapeHtml(msg)}</p>
      ${r ? `<p style="color:#b5c9bf;font-size:13px;margin-top:16px">מזהה הרשמה: <b style="color:#d4ff3a">${r.id}</b></p>` : ''}
      <a href="/" class="btn btn-primary" style="margin-top:22px;display:inline-block">חזרה לדף הבית</a>
    </main>
  </body></html>`;
}

// ---------- אישור בקשות (applications → real entities) ----------
app.post('/api/admin/applications/:kind/:id/approve', adminAuth, express.json(), async (req, res) => {
  const { kind, id } = req.params;
  if (!['organizer','club','player'].includes(kind)) return res.status(400).json({ ok: false, error: 'לא חוקי' });
  try {
    const result = await withDB(db => {
      const listKey = kind === 'organizer' ? 'organizers' : kind === 'club' ? 'clubs' : 'players';
      const app = db.applications[listKey].find(x => x.id === id);
      if (!app) throw new Error('בקשה לא נמצאה');
      if (app.status === 'approved') return { ok: true, already: true };

      if (kind === 'organizer') {
        const token = crypto.randomBytes(16).toString('hex');
        const oid = 'o-' + crypto.randomBytes(4).toString('hex');
        const baseSlug = slugify(app.business?.name || app.name);
        const slug = uniqSlug(baseSlug, db.organizers.map(o => o.slug));
        db.organizers.push({
          id: oid, slug,
          name: app.business?.name || app.name,
          contactPerson: app.name,
          email: app.email, phone: app.phone,
          whatsapp: app.phone.replace(/\D/g,'').replace(/^0/, '972'),
          business: { ...(app.business || {}), verified: true, verifiedAt: new Date().toISOString() },
          status: 'active',
          dashboardToken: token,
          createdAt: new Date().toISOString()
        });
        app.status = 'approved';
        app.approvedAt = new Date().toISOString();
        app.organizerId = oid;
        app.dashboardToken = token;
        return { ok: true, organizerId: oid, dashboardUrl: `/organizer/${token}` };
      }
      if (kind === 'club') {
        const cid = 'c-' + crypto.randomBytes(4).toString('hex');
        const token = crypto.randomBytes(16).toString('hex');
        const baseSlug = slugify(app.name);
        const slug = uniqSlug(baseSlug, db.clubs.map(c => c.slug));
        db.clubs.push({
          id: cid, slug,
          name: app.name,
          city: app.city,
          description: app.note || '',
          shortDescription: '',
          image: '/img/padel-court.jpg',
          contactPerson: app.contactPerson || '',
          contactEmail: app.email, contactPhone: app.phone,
          courts: app.courts || '',
          status: 'active',
          dashboardToken: token,
          slots: [],
          createdAt: new Date().toISOString()
        });
        app.status = 'approved';
        app.approvedAt = new Date().toISOString();
        app.clubId = cid;
        app.dashboardToken = token;
        return { ok: true, clubId: cid, slug, dashboardUrl: `/club/${token}` };
      }
      // player — מסומן מאושר בלבד (אין "ישות" שחקן אמיתי עדיין)
      app.status = 'approved';
      app.approvedAt = new Date().toISOString();
      return { ok: true };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post('/api/admin/applications/:kind/:id/reject', adminAuth, express.json(), async (req, res) => {
  const { kind, id } = req.params;
  if (!['organizer','club','player'].includes(kind)) return res.status(400).json({ ok: false, error: 'לא חוקי' });
  try {
    await withDB(db => {
      const listKey = kind === 'organizer' ? 'organizers' : kind === 'club' ? 'clubs' : 'players';
      const app = db.applications[listKey].find(x => x.id === id);
      if (!app) throw new Error('בקשה לא נמצאה');
      app.status = 'rejected';
      app.rejectedAt = new Date().toISOString();
      app.rejectNote = req.body?.note || '';
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ---------- ניהול טורנירים (אדמין) ----------
// ביטול טורניר עקב אי-הגעה למינימום — מסמן כל ההרשמות לרפאנד
app.post('/api/admin/tournaments/:id/cancel-insufficient', adminAuth, async (req, res) => {
  try {
    const result = await withDB(db => {
      const t = db.tournaments.find(x => x.id === req.params.id);
      if (!t) throw new Error('לא נמצא');
      t.status = 'cancelled_insufficient';
      t.visibility = 'private';
      t.cancelledAt = new Date().toISOString();
      let refundCount = 0;
      for (const r of db.registrations) {
        if (r.tournamentId !== t.id) continue;
        if (['cancelled','refunded','refund_pending'].includes(r.status)) continue;
        r.status = 'refund_pending';
        r.history.push({ at: new Date().toISOString(), status: 'refund_pending', by: 'system', note: 'הטורניר בוטל - לא הוגעו למינימום זוגות' });
        refundCount++;
      }
      return { ok: true, refundCount };
    });
    res.json(result);
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// =================================================================
//  CRM — אגרגציית אנשי קשר, הערות ויומן פעילות, לכל תפקיד
// =================================================================

// עוזר: בונה פרופילי אנשי קשר מתוך רשימת הרשמות
function buildContactsCRM(regs, tournamentMap, allActivity, contactsStore) {
  const byKey = new Map();
  const norm = p => normalizePhone(p);
  for (const r of regs) {
    const key = norm(r.phone) || (r.email || '').toLowerCase();
    if (!key) continue;
    const t = tournamentMap.get(r.tournamentId);
    const rec = byKey.get(key) || {
      key,
      name: r.fullName,
      phone: r.phone,
      email: r.email,
      level: r.level,
      tournaments: 0,
      paid: 0,
      revenue: 0,
      lastSeen: r.createdAt,
      lastStatus: r.status,
      partners: new Set(),
      regs: []
    };
    rec.tournaments++;
    if (['paid_confirmed', 'approved'].includes(r.status)) {
      rec.paid++;
      if (t?.pricing?.perPair) rec.revenue += Math.round(t.pricing.perPair / 2); // מחיר לאדם
    }
    if (r.createdAt > rec.lastSeen) {
      rec.lastSeen = r.createdAt;
      rec.lastStatus = r.status;
      rec.level = r.level;
      rec.name = r.fullName;
    }
    if (r.partnerName) rec.partners.add(r.partnerName);
    rec.regs.push({
      id: r.id, tournamentId: r.tournamentId,
      tournamentTitle: t?.title || '', tournamentDate: t?.date || '',
      status: r.status, createdAt: r.createdAt,
      level: r.level, partnerName: r.partnerName, emailVerified: !!r.emailVerified
    });
    byKey.set(key, rec);
  }
  // שלב notes + activity
  return Array.from(byKey.values()).map(c => {
    const stored = (contactsStore || []).find(x => x.key === c.key);
    const acts = (allActivity || []).filter(a =>
      (a.contactPhone && a.contactPhone === c.key) ||
      (a.contactEmail && a.contactEmail === c.key) ||
      (a.contactPhone && norm(c.phone) === a.contactPhone)
    ).sort((a,b) => b.at.localeCompare(a.at)).slice(0, 30);
    return {
      ...c,
      partners: Array.from(c.partners).slice(0, 8),
      notes: stored?.notes || '',
      tags: stored?.tags || [],
      activity: acts,
      regs: c.regs.sort((a,b) => b.createdAt.localeCompare(a.createdAt))
    };
  }).sort((a,b) => b.lastSeen.localeCompare(a.lastSeen));
}

// CRM למועדון
app.get('/api/club/:token/crm', async (req, res) => {
  const db = await loadDB();
  const club = findClubByToken(db, req.params.token);
  if (!club) return res.status(401).json({ ok: false, error: 'אין הרשאה' });
  const clubTids = new Set(db.tournaments.filter(t => t.clubId === club.id).map(t => t.id));
  const regs = db.registrations.filter(r => clubTids.has(r.tournamentId));
  const tournamentMap = new Map(db.tournaments.map(t => [t.id, t]));
  const allActivity = (db.activityLog || []).filter(a => a.clubId === club.id || clubTids.has(a.tournamentId));
  if (!Array.isArray(club.contacts)) club.contacts = [];
  const contacts = buildContactsCRM(regs, tournamentMap, allActivity, club.contacts);
  // סטטיסטיקות CRM כלליות
  const totalRevenue = contacts.reduce((s,c) => s + c.revenue, 0);
  const repeatCount = contacts.filter(c => c.tournaments > 1).length;
  res.json({
    ok: true,
    club: { id: club.id, name: club.name },
    stats: {
      totalContacts: contacts.length,
      repeatPlayers: repeatCount,
      totalRevenue,
      activityCount: allActivity.length
    },
    contacts,
    recentActivity: allActivity.slice().sort((a,b) => b.at.localeCompare(a.at)).slice(0, 50)
  });
});

// CRM למארגן
app.get('/api/organizer/:token/crm', async (req, res) => {
  const db = await loadDB();
  const org = findOrganizerByToken(db, req.params.token);
  if (!org) return res.status(401).json({ ok: false, error: 'אין הרשאה' });
  const orgTids = new Set(db.tournaments.filter(t => t.organizerId === org.id).map(t => t.id));
  const regs = db.registrations.filter(r => orgTids.has(r.tournamentId));
  const tournamentMap = new Map(db.tournaments.map(t => [t.id, t]));
  const allActivity = (db.activityLog || []).filter(a => a.organizerId === org.id || orgTids.has(a.tournamentId));
  if (!Array.isArray(org.contacts)) org.contacts = [];
  const contacts = buildContactsCRM(regs, tournamentMap, allActivity, org.contacts);
  const totalRevenue = contacts.reduce((s,c) => s + c.revenue, 0);
  const repeatCount = contacts.filter(c => c.tournaments > 1).length;
  res.json({
    ok: true,
    organizer: { id: org.id, name: org.name },
    stats: {
      totalContacts: contacts.length,
      repeatPlayers: repeatCount,
      totalRevenue,
      activityCount: allActivity.length
    },
    contacts,
    recentActivity: allActivity.slice().sort((a,b) => b.at.localeCompare(a.at)).slice(0, 50)
  });
});

// עדכון הערת CRM לאיש קשר (מועדון)
app.post('/api/club/:token/contacts/:key/note', express.json(), async (req, res) => {
  try {
    const result = await withDB(db => {
      const club = findClubByToken(db, req.params.token);
      if (!club) throw new Error('אין הרשאה');
      if (!Array.isArray(club.contacts)) club.contacts = [];
      const key = req.params.key.toLowerCase();
      let c = club.contacts.find(x => x.key === key);
      if (!c) { c = { key, notes: '', tags: [] }; club.contacts.push(c); }
      c.notes = String(req.body?.notes || '').slice(0, 2000);
      c.tags = Array.isArray(req.body?.tags) ? req.body.tags.slice(0, 10).map(t => String(t).slice(0, 24)) : c.tags;
      c.updatedAt = new Date().toISOString();
      logActivity(db, {
        type: 'note', channel: 'internal', clubId: club.id,
        contactPhone: key, summary: 'הערת CRM עודכנה', by: 'club'
      });
      return { ok: true };
    });
    res.json(result);
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// תיעוד פעולה ידנית (שיחה/WA/מייל שנשלח ידנית)
app.post('/api/club/:token/contacts/:key/activity', express.json(), async (req, res) => {
  try {
    const result = await withDB(db => {
      const club = findClubByToken(db, req.params.token);
      if (!club) throw new Error('אין הרשאה');
      const { channel, summary } = req.body || {};
      if (!summary || summary.length < 2) throw new Error('טקסט חסר');
      logActivity(db, {
        type: channel === 'whatsapp' ? 'manual_wa' : channel === 'email' ? 'manual_email' : channel === 'call' ? 'call' : 'note',
        channel: channel || 'manual', clubId: club.id,
        contactPhone: req.params.key.toLowerCase(),
        summary: String(summary).slice(0, 500), by: 'club'
      });
      return { ok: true };
    });
    res.json(result);
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// אותו הדבר למארגן (endpoint מקביל — נוחות)
app.post('/api/organizer/:token/contacts/:key/note', express.json(), async (req, res) => {
  try {
    const result = await withDB(db => {
      const org = findOrganizerByToken(db, req.params.token);
      if (!org) throw new Error('אין הרשאה');
      if (!Array.isArray(org.contacts)) org.contacts = [];
      const key = req.params.key.toLowerCase();
      let c = org.contacts.find(x => x.key === key);
      if (!c) { c = { key, notes: '', tags: [] }; org.contacts.push(c); }
      c.notes = String(req.body?.notes || '').slice(0, 2000);
      c.tags = Array.isArray(req.body?.tags) ? req.body.tags.slice(0, 10).map(t => String(t).slice(0, 24)) : c.tags;
      c.updatedAt = new Date().toISOString();
      logActivity(db, {
        type: 'note', channel: 'internal', organizerId: org.id,
        contactPhone: key, summary: 'הערת CRM עודכנה', by: 'organizer'
      });
      return { ok: true };
    });
    res.json(result);
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/organizer/:token/contacts/:key/activity', express.json(), async (req, res) => {
  try {
    const result = await withDB(db => {
      const org = findOrganizerByToken(db, req.params.token);
      if (!org) throw new Error('אין הרשאה');
      const { channel, summary } = req.body || {};
      if (!summary || summary.length < 2) throw new Error('טקסט חסר');
      logActivity(db, {
        type: channel === 'whatsapp' ? 'manual_wa' : channel === 'email' ? 'manual_email' : channel === 'call' ? 'call' : 'note',
        channel: channel || 'manual', organizerId: org.id,
        contactPhone: req.params.key.toLowerCase(),
        summary: String(summary).slice(0, 500), by: 'organizer'
      });
      return { ok: true };
    });
    res.json(result);
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// CRM מלא לשחקן — חיפוש לפי מזהה הרשמה או telephone/email
app.get('/api/player/crm/:id', async (req, res) => {
  const id = String(req.params.id || '').toUpperCase();
  const db = await loadDB();
  const base = db.registrations.find(x => x.id === id);
  if (!base) return res.status(404).json({ ok: false, error: 'לא נמצא' });
  // כל ההרשמות ששייכות לאיש הקשר — דדופליקציה לפי מייל/טלפון
  const normEmail = (base.email || '').toLowerCase();
  const normPh = normalizePhone(base.phone);
  const allMine = db.registrations.filter(r =>
    (r.email && r.email.toLowerCase() === normEmail) ||
    (r.phone && normalizePhone(r.phone) === normPh)
  );
  const tournamentMap = new Map(db.tournaments.map(t => [t.id, t]));
  const myRegs = allMine.map(r => {
    const t = tournamentMap.get(r.tournamentId);
    return {
      id: r.id, status: r.status, createdAt: r.createdAt,
      level: r.level, partnerName: r.partnerName, emailVerified: !!r.emailVerified,
      hasPaymentProof: !!r.paymentProof,
      tournament: t ? {
        id: t.id, slug: t.slug, title: t.title, date: t.date, location: t.location,
        confirmed: !!t.confirmed, allPaidAt: t.allPaidAt || null,
        startDate: t.startDate || null, startTime: t.startTime || null
      } : null,
      activity: (r.activity || []).slice(-20).reverse()
    };
  }).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  // שותפים קבועים (מדדופלצים)
  const partners = {};
  for (const r of allMine) if (r.partnerName) {
    const k = normalizePhone(r.partnerPhone) || r.partnerName;
    partners[k] = partners[k] || { name: r.partnerName, phone: r.partnerPhone, times: 0 };
    partners[k].times++;
  }
  res.json({
    ok: true,
    me: { name: base.fullName, phone: base.phone, email: base.email, level: base.level },
    stats: {
      total: myRegs.length,
      paid: myRegs.filter(r => ['paid_confirmed','approved'].includes(r.status)).length,
      upcoming: myRegs.filter(r => r.tournament?.confirmed && !r.tournament?.allPaidAt).length
    },
    registrations: myRegs,
    partners: Object.values(partners).sort((a,b) => b.times - a.times)
  });
});

// ייצור/רענון טוקן דשבורד למועדון קיים (למועדונים שהיו במערכת לפני שהופעלה התכונה)
app.post('/api/admin/clubs/:id/generate-token', adminAuth, async (req, res) => {
  try {
    const result = await withDB(db => {
      const c = db.clubs.find(x => x.id === req.params.id);
      if (!c) throw new Error('מועדון לא נמצא');
      c.dashboardToken = crypto.randomBytes(16).toString('hex');
      if (!Array.isArray(c.slots)) c.slots = [];
      return { ok: true, dashboardUrl: `/club/${c.dashboardToken}` };
    });
    res.json(result);
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

app.post('/api/admin/tournaments/:id/publish', adminAuth, async (req, res) => {
  try {
    await withDB(db => {
      const t = db.tournaments.find(x => x.id === req.params.id);
      if (!t) throw new Error('לא נמצא');
      t.visibility = 'public';
      t.status = 'open';
      t.publishedAt = new Date().toISOString();
    });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});
app.post('/api/admin/tournaments/:id/unpublish', adminAuth, async (req, res) => {
  try {
    await withDB(db => {
      const t = db.tournaments.find(x => x.id === req.params.id);
      if (!t) throw new Error('לא נמצא');
      t.visibility = 'private';
    });
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// =================================================================
//  אזור שחקן — אימות לפי dashboardToken
// =================================================================
function findPlayerByToken(db, token) {
  return (db.applications.players || []).find(p => p.dashboardToken === token && p.status === 'active');
}
function findPlayerByEmailOrPhone(db, email, phone) {
  return (db.applications.players || []).find(p =>
    (p.email && email && p.email.toLowerCase() === email.toLowerCase()) ||
    (p.phone && phone && p.phone.replace(/\D/g,'') === phone.replace(/\D/g,''))
  );
}

app.get('/player/:token', async (req, res) => {
  const db = await loadDB();
  const p = findPlayerByToken(db, req.params.token);
  if (!p) return res.status(404).type('html').send('<!doctype html><meta charset=utf-8><link rel=stylesheet href="/platform.css"><div style="text-align:center;padding:80px;color:#fff"><h1>🔒 קישור לא תקף</h1><p>השתמש בקישור שקיבלת לאחר ההרשמה כשחקן.</p><a href="/players/join" style="color:#062a1c;background:#d4ff3a;padding:10px 20px;border-radius:999px;font-weight:700;display:inline-block;margin-top:20px">להרשמה כשחקן</a></div>');
  serveTemplate(res, 'player-dashboard.html', {
    TOKEN: req.params.token,
    PLAYER_NAME: escapeHtml(p.name),
    PLAYER_ID: p.id
  });
});

app.get('/api/player/:token/me', async (req, res) => {
  const db = await loadDB();
  const p = findPlayerByToken(db, req.params.token);
  if (!p) return res.status(401).json({ ok: false, error: 'אין הרשאה' });
  // מצטרף מידע על הרשמות שלי לטורנירים (by email match)
  const myRegs = db.registrations.filter(r =>
    (r.email && r.email.toLowerCase() === p.email.toLowerCase()) ||
    (r.phone && r.phone.replace(/\D/g,'') === p.phone.replace(/\D/g,''))
  );
  const enriched = myRegs.map(r => {
    const t = db.tournaments.find(x => x.id === r.tournamentId);
    const club = t ? db.clubs.find(c => c.id === t.clubId) : null;
    return {
      id: r.id,
      tournamentId: r.tournamentId,
      tournamentTitle: t?.title || '',
      tournamentSlug: t?.slug || '',
      tournamentDate: t?.date || '',
      clubName: club?.name || '',
      clubCity: club?.city || '',
      status: r.status,
      level: r.level,
      partnerName: r.partnerName,
      createdAt: r.createdAt,
      result: r.result || null // יוגדר בסיום הטורניר ע"י אדמין
    };
  }).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  res.json({
    ok: true,
    player: {
      id: p.id, name: p.name, email: p.email, phone: p.phone, city: p.city, level: p.level,
      stats: p.stats || { points: 0, tournaments: 0, wins: 0, finals: 0, semifinals: 0 },
      memberSince: p.createdAt
    },
    registrations: enriched,
    history: p.history || []
  });
});

// ranking גלובלי (Top N)
app.get('/api/leaderboard', async (_req, res) => {
  const db = await loadDB();
  const players = (db.applications.players || [])
    .filter(p => p.status === 'active' && (p.stats?.points || 0) > 0)
    .map(p => ({
      name: p.name,
      city: p.city,
      level: p.level,
      points: p.stats?.points || 0,
      tournaments: p.stats?.tournaments || 0,
      wins: p.stats?.wins || 0
    }))
    .sort((a,b) => b.points - a.points)
    .slice(0, 50);
  res.json({ ok: true, players });
});

// ---------- אדמין: רישום תוצאות טורניר ----------
// כשטורניר הסתיים, אדמין מתעד את הדירוג הסופי.
// דוגמה לבקשה:
// { results: [{ regId: 'HDR-...', place: 1 }, { regId: '...', place: 2 }, ...] }
// מערכת מעניקה נקודות: 1st=25, 2nd=15, 3rd=10, 4th=6, 5-8=3, 9+=1, השתתפות=1
const PLACE_POINTS = { 1: 25, 2: 15, 3: 10, 4: 6 };
function pointsForPlace(p) {
  if (PLACE_POINTS[p]) return PLACE_POINTS[p];
  if (p >= 5 && p <= 8) return 3;
  if (p > 8) return 1;
  return 1;
}
app.post('/api/admin/tournaments/:id/results', adminAuth, express.json(), async (req, res) => {
  const { results } = req.body || {};
  if (!Array.isArray(results) || !results.length) return res.status(400).json({ ok: false, error: 'results ריק' });
  try {
    const result = await withDB(db => {
      const t = db.tournaments.find(x => x.id === req.params.id);
      if (!t) throw new Error('לא נמצא');
      t.results = results.map(r => ({ regId: r.regId, place: parseInt(r.place, 10) }));
      t.finalizedAt = new Date().toISOString();
      t.status = 'completed';

      // עדכון ניקוד לשחקנים (לפי email/phone של ההרשמה)
      let updated = 0;
      for (const rr of t.results) {
        const reg = db.registrations.find(x => x.id === rr.regId);
        if (!reg) continue;
        reg.result = { place: rr.place, points: pointsForPlace(rr.place), tournamentId: t.id };
        // מצא את השחקן המקביל וגם את השותף
        for (const ident of [{ email: reg.email, phone: reg.phone }, { phone: reg.partnerPhone }]) {
          if (!ident.email && !ident.phone) continue;
          const p = findPlayerByEmailOrPhone(db, ident.email, ident.phone);
          if (!p) continue;
          p.stats = p.stats || { points: 0, tournaments: 0, wins: 0, finals: 0, semifinals: 0 };
          p.stats.points += pointsForPlace(rr.place);
          p.stats.tournaments += 1;
          if (rr.place === 1) p.stats.wins += 1;
          if (rr.place === 2) p.stats.finals += 1;
          if (rr.place === 3 || rr.place === 4) p.stats.semifinals += 1;
          p.history = p.history || [];
          p.history.push({
            tournamentId: t.id, tournamentTitle: t.title, tournamentSlug: t.slug,
            date: new Date().toISOString(),
            place: rr.place, points: pointsForPlace(rr.place), partner: reg.partnerName
          });
          updated++;
        }
      }
      return { ok: true, updated, totalResults: t.results.length };
    });
    res.json(result);
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// =================================================================
//  אזור מארגן — אימות לפי dashboardToken
// =================================================================
function findOrganizerByToken(db, token) {
  return db.organizers.find(o => o.dashboardToken === token && o.status === 'active');
}

app.get('/organizer/:token', async (req, res) => {
  const db = await loadDB();
  const org = findOrganizerByToken(db, req.params.token);
  if (!org) return res.status(404).type('html').send('<!doctype html><meta charset=utf-8><link rel=stylesheet href="/platform.css"><div style="text-align:center;padding:80px;color:#fff"><h1>🔒 קישור לא תקף</h1><p>פנה למארגני הפלטפורמה לקישור מעודכן.</p><a class=btn href="/" style="color:#062a1c;background:#d4ff3a;padding:10px 20px;border-radius:999px;font-weight:700;display:inline-block;margin-top:20px">חזרה לדף הבית</a></div>');
  serveTemplate(res, 'organizer-dashboard.html', {
    TOKEN: req.params.token,
    ORG_NAME: escapeHtml(org.name),
    ORG_ID: org.id
  });
});

// API — מארגן: רשימת טורנירים + יצירת טורניר חדש
app.get('/api/organizer/:token/me', async (req, res) => {
  const db = await loadDB();
  const org = findOrganizerByToken(db, req.params.token);
  if (!org) return res.status(401).json({ ok: false, error: 'אין הרשאה' });
  const tournaments = db.tournaments.filter(t => t.organizerId === org.id)
    .map(t => {
      const regs = db.registrations.filter(r => r.tournamentId === t.id);
      return {
        id: t.id, slug: t.slug, title: t.title, status: t.status,
        visibility: t.visibility, createdAt: t.createdAt,
        capacity: {
          max: t.format?.maxPairs || 8,
          reserved: regs.filter(r => RESERVING.has(r.status)).length,
          approved: regs.filter(r => r.status === 'approved' || r.status === 'paid_confirmed').length,
          total: regs.length
        }
      };
    });
  const clubs = db.clubs.filter(c => c.status === 'active').map(c => ({ id: c.id, slug: c.slug, name: c.name, city: c.city }));
  res.json({
    ok: true,
    organizer: { id: org.id, name: org.name, slug: org.slug, business: org.business },
    tournaments,
    clubs
  });
});

app.get('/api/organizer/:token/tournaments/:tid', async (req, res) => {
  const db = await loadDB();
  const org = findOrganizerByToken(db, req.params.token);
  if (!org) return res.status(401).json({ ok: false, error: 'אין הרשאה' });
  const t = db.tournaments.find(x => x.id === req.params.tid && x.organizerId === org.id);
  if (!t) return res.status(404).json({ ok: false, error: 'לא נמצא' });
  const regs = db.registrations.filter(r => r.tournamentId === t.id)
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ ok: true, tournament: t, registrations: regs });
});

app.post('/api/organizer/:token/tournaments', express.json(), async (req, res) => {
  try {
    const db0 = await loadDB();
    const org0 = findOrganizerByToken(db0, req.params.token);
    if (!org0) return res.status(401).json({ ok: false, error: 'אין הרשאה' });

    const b = req.body || {};
    const errs = [];
    if (!b.title || b.title.trim().length < 3) errs.push('שם טורניר חסר.');
    if (!b.clubId) errs.push('חובה לבחור מגרש מארח.');
    if (!b.maxPairs || b.maxPairs < 2 || b.maxPairs > 64) errs.push('מספר זוגות לא תקין (2-64).');
    if (!b.pricePair || b.pricePair < 0) errs.push('מחיר לזוג חסר.');
    if (!b.bitRecipientPhone || !validPhone(b.bitRecipientPhone)) errs.push('מספר bit לא תקין.');
    if (errs.length) return res.status(400).json({ ok: false, errors: errs });

    const result = await withDB(db => {
      const org = findOrganizerByToken(db, req.params.token);
      if (!org) throw new Error('אין הרשאה');
      const club = db.clubs.find(c => c.id === b.clubId);
      if (!club) throw new Error('מגרש לא נמצא');

      const id = 't-' + crypto.randomBytes(4).toString('hex');
      const baseSlug = slugify(b.title);
      const slug = uniqSlug(baseSlug, db.tournaments.map(t => t.slug));

      const tournament = {
        id, slug,
        title: clean(b.title, 100),
        subtitle: clean(b.subtitle, 120),
        clubId: club.id,
        organizerId: org.id,
        description: cleanLong(b.description, 1500),
        date: clean(b.date, 30),
        location: clean(b.location, 200) || `${club.city} · המיקום המדויק יישלח לנרשמים`,
        format: {
          pair: true,
          maxPairs: parseInt(b.maxPairs, 10),
          minPaidPairs: parseInt(b.minPaidPairs, 10) || parseInt(b.maxPairs, 10), // ברירת-מחדל: רק אם מלא
          levels: Array.isArray(b.levels) && b.levels.length ? b.levels : [
            { code: '2.5', label: 'רמה א' },
            { code: '3', label: 'רמה א+' }
          ],
          matchRules: clean(b.matchRules, 200) || 'מערכה אחת עד 6 משחקונים · מקס 20 דקות'
        },
        confirmationDeadline: clean(b.confirmationDeadline, 30), // תאריך יעד לקביעה
        confirmed: false, // יהפוך ל-true כשיגיעו למינימום התשלומים
        pricing: {
          perPair: parseInt(b.pricePair, 10),
          perPerson: parseInt(b.pricePerson, 10) || Math.round(parseInt(b.pricePair, 10) / 2),
          currency: 'ILS'
        },
        payment: {
          method: 'bit',
          recipientName: clean(b.bitRecipientName, 100) || org.name,
          recipientPhone: clean(b.bitRecipientPhone, 20),
          groupLink: clean(b.bitGroupLink, 300)
        },
        refundPolicy: clean(b.refundPolicy, 500) || 'החזר (ככל שיאושר) יבוצע עד 7 ימים לאחר סיום הטורניר',
        requireHealthDeclaration: b.requireHealthDeclaration !== false,
        healthFormUrl: clean(b.healthFormUrl, 500) || 'https://www.gov.il/blobFolder/generalpage/information-special-and-refund-requests/he/forms_doclib_62557516.pdf',
        status: 'pending_review',
        visibility: 'private',
        featured: false,
        heroVideo: '',
        createdAt: new Date().toISOString(),
        revenueSplit: { organizer: 70, club: 20, platform: 10 }
      };
      db.tournaments.push(tournament);
      return { ok: true, id, slug };
    });
    notifyOrganizerWhatsApp(`🆕 טורניר חדש ממתין לאישור: ${b.title} · מזהה: ${result.id}`).catch(()=>{});
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// מארגן יכול לעדכן פרטי טורניר (לפני פרסום)
app.patch('/api/organizer/:token/tournaments/:tid', express.json(), async (req, res) => {
  try {
    const result = await withDB(db => {
      const org = findOrganizerByToken(db, req.params.token);
      if (!org) throw new Error('אין הרשאה');
      const t = db.tournaments.find(x => x.id === req.params.tid && x.organizerId === org.id);
      if (!t) throw new Error('לא נמצא');
      const allowed = ['title','subtitle','description','date','location','heroVideo'];
      for (const k of allowed) if (req.body[k] !== undefined) t[k] = clean(req.body[k], 1500);
      return { ok: true };
    });
    res.json(result);
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// =================================================================
//  אזור אישי לשחקן — בדיקת סטטוס חי לפי מזהה הרשמה
// =================================================================
app.get('/my/:id', async (req, res) => {
  const id = String(req.params.id || '').toUpperCase();
  const db = await loadDB();
  const r = db.registrations.find(x => x.id === id);
  if (!r) return res.status(404).type('html').send('<!doctype html><meta charset=utf-8><body style="font-family:sans-serif;text-align:center;padding:80px;background:#062318;color:#fff"><h1>הרשמה לא נמצאה</h1><a style="color:#d4ff3a" href="/">חזרה לדף הבית</a></body>');
  serveTemplate(res, 'player-crm.html', {
    REG_ID: escapeHtml(r.id),
    PLAYER_NAME: escapeHtml(r.fullName)
  });
});

// =================================================================
//  Club Dashboard — "לוח זמנים" עם יצירת טורניר אוטומטית
// =================================================================
function findClubByToken(db, token) {
  return db.clubs.find(c => c.dashboardToken === token && c.status === 'active');
}

// SSR לדשבורד מועדון (מזריק טוקן לתבנית)
app.get('/club/:token', async (req, res) => {
  const db = await loadDB();
  const club = findClubByToken(db, req.params.token);
  if (!club) return res.status(404).type('html').send('<!doctype html><meta charset=utf-8><h1 style=font-family:sans-serif;text-align:center;padding:80px>דשבורד לא נמצא או פג תוקף</h1>');
  serveTemplate(res, 'club-dashboard.html', {
    TOKEN: req.params.token,
    CLUB_NAME: escapeHtml(club.name),
    CLUB_CITY: escapeHtml(club.city || ''),
    CLUB_ID: escapeHtml(club.id)
  });
});

// בסיס API: מועדון ניגש רק עם טוקן שנתן לו האדמין באישור
app.get('/api/club/:token/me', async (req, res) => {
  const db = await loadDB();
  const c = findClubByToken(db, req.params.token);
  if (!c) return res.status(401).json({ ok: false, error: 'אין הרשאה' });
  // כל הטורנירים של המועדון + מצב חי
  const tournaments = db.tournaments
    .filter(t => t.clubId === c.id)
    .map(t => {
      const regs = db.registrations.filter(r => r.tournamentId === t.id);
      return {
        id: t.id, slug: t.slug, title: t.title, date: t.date, location: t.location,
        visibility: t.visibility, status: t.status, confirmed: !!t.confirmed,
        confirmedAt: t.confirmedAt || null, allPaidAt: t.allPaidAt || null,
        slotId: t.slotId || null,
        capacity: {
          max: t.format.maxPairs,
          minPaid: t.format.minPaidPairs,
          reserved: countReserved(db, t.id),
          approved: countApproved(db, t.id),
          paid: regs.filter(r => ['paid_confirmed','approved'].includes(r.status)).length,
          total: regs.length
        },
        registrations: regs.map(r => ({
          id: r.id, fullName: r.fullName, phone: r.phone, email: r.email,
          level: r.level, partnerName: r.partnerName, partnerPhone: r.partnerPhone,
          status: r.status, emailVerified: !!r.emailVerified,
          createdAt: r.createdAt, hasPaymentProof: !!r.paymentProof
        })).sort((a,b) => b.createdAt.localeCompare(a.createdAt))
      };
    });
  res.json({
    ok: true,
    club: { id: c.id, name: c.name, city: c.city, slug: c.slug, courts: c.courts, contactEmail: c.contactEmail },
    slots: c.slots || [],
    tournaments
  });
});

// יצירת slot חודשי — נוצר טורניר מייד ועולה לאוויר
app.post('/api/club/:token/slots', express.json(), async (req, res) => {
  try {
    const b = req.body || {};
    const errs = [];
    if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) errs.push('תאריך לא תקין (נדרש YYYY-MM-DD).');
    if (!b.startTime || !/^\d{2}:\d{2}$/.test(b.startTime)) errs.push('שעת התחלה חסרה.');
    if (!b.endTime || !/^\d{2}:\d{2}$/.test(b.endTime)) errs.push('שעת סיום חסרה.');
    const courts = parseInt(b.courts, 10);
    if (!courts || courts < 1 || courts > 16) errs.push('מספר מגרשים 1-16.');
    const pricePair = parseInt(b.pricePair, 10);
    if (!pricePair || pricePair < 0) errs.push('מחיר לזוג חסר/לא תקין.');
    if (!['2.5','3','both'].includes(b.level)) errs.push('יש לבחור רמה (א / א+ / מעורב).');
    if (!b.bitRecipientPhone || !validPhone(b.bitRecipientPhone)) errs.push('מספר bit לא תקין.');
    if (errs.length) return res.status(400).json({ ok: false, errors: errs });

    const result = await withDB(db => {
      const club = findClubByToken(db, req.params.token);
      if (!club) throw new Error('אין הרשאה');
      if (!Array.isArray(club.slots)) club.slots = [];

      const slotId = 's-' + crypto.randomBytes(4).toString('hex');
      // פורמט תאריך יפה בעברית
      const niceDate = formatHebDate(b.date);
      const levels = b.level === 'both'
        ? [{ code: '2.5', label: 'רמה א' }, { code: '3', label: 'רמה א+' }]
        : b.level === '2.5'
          ? [{ code: '2.5', label: 'רמה א' }]
          : [{ code: '3', label: 'רמה א+' }];

      // 1 זוג למגרש (4 שחקנים) — ברירת מחדל סטנדרטית
      const maxPairs = courts;
      const minPaidPairs = Math.max(2, Math.floor(maxPairs * 0.75));

      const title = (b.title && b.title.trim())
        ? clean(b.title, 100)
        : `${club.name} · ${niceDate}`;
      const baseSlug = slugify(`${club.name}-${b.date}-${b.startTime}`);
      const slug = uniqSlug(baseSlug, db.tournaments.map(t => t.slug));

      const tournamentId = 't-' + crypto.randomBytes(4).toString('hex');
      const t = {
        id: tournamentId, slug,
        title,
        subtitle: `${b.startTime}–${b.endTime} · ${courts} מגרשים`,
        clubId: club.id,
        organizerId: null, // נוצר מהמועדון ישירות
        slotId,
        description: clean(b.description, 1500)
          || `טורניר פאדל ב-${club.name}${club.city ? ' · ' + club.city : ''}. ${niceDate} בין ${b.startTime} ל-${b.endTime}. ${courts} מגרשים פעילים.`,
        date: niceDate,
        location: clean(b.location, 200) || `${club.name}${club.city ? ' · ' + club.city : ''}`,
        startDate: b.date,    // ISO — לצורך ICS ומיון
        startTime: b.startTime,
        endTime: b.endTime,
        format: {
          pair: true,
          maxPairs,
          minPaidPairs,
          levels,
          matchRules: clean(b.matchRules, 200) || 'מערכה אחת עד 6 משחקונים · מקס 20 דקות'
        },
        confirmationDeadline: b.confirmationDeadline || '',
        confirmed: false,
        pricing: {
          perPair: pricePair,
          perPerson: Math.round(pricePair / 2),
          currency: 'ILS'
        },
        payment: {
          method: 'bit',
          recipientName: clean(b.bitRecipientName, 100) || club.name,
          recipientPhone: clean(b.bitRecipientPhone, 20),
          groupLink: clean(b.bitGroupLink, 300)
        },
        refundPolicy: clean(b.refundPolicy, 500) || 'החזר מלא אם הטורניר לא מתמלא במועד. החזרים אחרים עד 7 ימים אחרי הטורניר.',
        requireHealthDeclaration: b.requireHealthDeclaration !== false,
        healthFormUrl: 'https://www.gov.il/blobFolder/generalpage/information-special-and-refund-requests/he/forms_doclib_62557516.pdf',
        status: 'open',
        visibility: 'public', // מועדון מאושר יכול לפרסם ישירות
        featured: false,
        heroVideo: '',
        createdAt: new Date().toISOString(),
        publishedAt: new Date().toISOString(),
        revenueSplit: { club: 90, platform: 10 }
      };
      db.tournaments.push(t);

      // רשומת slot אצל המועדון
      const slot = {
        id: slotId,
        tournamentId,
        tournamentSlug: slug,
        date: b.date,
        startTime: b.startTime,
        endTime: b.endTime,
        courts,
        level: b.level,
        pricePair,
        status: 'open', // open → confirmed → completed / cancelled
        createdAt: new Date().toISOString()
      };
      club.slots.push(slot);
      return { ok: true, slot, tournament: { id: t.id, slug: t.slug, title: t.title } };
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ביטול slot — מותר רק ללא הרשמות פעילות
app.delete('/api/club/:token/slots/:slotId', async (req, res) => {
  try {
    const result = await withDB(db => {
      const club = findClubByToken(db, req.params.token);
      if (!club) throw new Error('אין הרשאה');
      const slot = (club.slots || []).find(s => s.id === req.params.slotId);
      if (!slot) throw new Error('לא נמצא');
      const regs = db.registrations.filter(r => r.tournamentId === slot.tournamentId &&
        !['cancelled','refunded'].includes(r.status));
      if (regs.length > 0) throw new Error('לא ניתן לבטל — יש ' + regs.length + ' הרשמות פעילות');
      // הסר טורניר (טיוטה שלא התפרסמה / ללא נרשמים)
      const tIdx = db.tournaments.findIndex(t => t.id === slot.tournamentId);
      if (tIdx >= 0) db.tournaments.splice(tIdx, 1);
      slot.status = 'cancelled';
      slot.cancelledAt = new Date().toISOString();
      return { ok: true };
    });
    res.json(result);
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// עדכון סטטוס הרשמה ע"י מועדון (רק לטורנירים שלו)
app.post('/api/club/:token/registrations/:id/status', express.json(), async (req, res) => {
  const { status, note } = req.body || {};
  if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'סטטוס לא חוקי' });
  try {
    let updatedReg = null, updatedT = null, justConfirmed = false, justAllPaid = false, paidRegs = [];
    const result = await withDB(db => {
      const club = findClubByToken(db, req.params.token);
      if (!club) throw new Error('אין הרשאה');
      const r = db.registrations.find(x => x.id === req.params.id);
      if (!r) throw new Error('לא נמצא');
      const t = db.tournaments.find(x => x.id === r.tournamentId && x.clubId === club.id);
      if (!t) throw new Error('הטורניר לא שייך למועדון');
      const prev = r.status;
      r.status = status;
      r.history.push({ at: new Date().toISOString(), status, by: 'club', note: note || '' });
      logActivity(db, {
        type: 'status_change', channel: 'internal',
        summary: `סטטוס: ${statusHe(prev)} → ${statusHe(status)}${note ? ' · '+note : ''}`,
        regId: r.id, tournamentId: r.tournamentId, clubId: club.id,
        contactEmail: r.email, contactPhone: r.phone, by: 'club', meta: { prev, next: status, note }
      });
      // סנכרון confirmed / allPaid
      paidRegs = db.registrations.filter(x => x.tournamentId === t.id &&
        (x.status === 'paid_confirmed' || x.status === 'approved'));
      const needed = t.format?.minPaidPairs || t.format?.maxPairs || 8;
      const max = t.format?.maxPairs || needed;
      if (!t.confirmed && paidRegs.length >= needed) {
        t.confirmed = true;
        t.confirmedAt = new Date().toISOString();
        justConfirmed = true;
      }
      if (!t.allPaidAt && paidRegs.length >= max) {
        t.allPaidAt = new Date().toISOString();
        justAllPaid = true;
      }
      updatedReg = r; updatedT = t;
      return { ok: true, status: r.status };
    });
    // מיילים
    try {
      if (updatedReg && updatedT) sendStatusUpdateEmail(updatedReg, updatedT, null, note).catch(()=>{});
      if (justConfirmed && updatedT) sendTournamentConfirmedEmails(updatedT, paidRegs).catch(()=>{});
      if (justAllPaid && updatedT) sendAllPaidEmails(updatedT, paidRegs).catch(()=>{});
    } catch (_) {}
    res.json(result);
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

// ---- ICS export לכל טורניר — שחקן יכול להוסיף ליומן ----
app.get('/api/tournaments/:slug/calendar.ics', async (req, res) => {
  const db = await loadDB();
  const t = db.tournaments.find(x => x.slug === req.params.slug);
  if (!t) return res.status(404).send('not found');
  const uid = `${t.id}@padel.platform`;
  const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'');
  // משתמשים ב-startDate + startTime/endTime אם קיים, אחרת תאריך יום שלם לפי t.date
  let dtStart, dtEnd;
  if (t.startDate && t.startTime) {
    const [H, M] = t.startTime.split(':');
    const [EH, EM] = (t.endTime || t.startTime).split(':');
    const d = t.startDate.replace(/-/g, '');
    dtStart = `${d}T${H}${M}00`;
    dtEnd = `${d}T${EH}${EM}00`;
  }
  const desc = (t.description || '').replace(/\n/g, '\\n').slice(0, 500);
  const loc = (t.location || '').replace(/,/g, '\\,');
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Padel Platform//HE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp.split('.')[0]}Z`,
    dtStart ? `DTSTART;TZID=Asia/Jerusalem:${dtStart}` : null,
    dtEnd ? `DTEND;TZID=Asia/Jerusalem:${dtEnd}` : null,
    `SUMMARY:${t.title}`,
    `DESCRIPTION:${desc}`,
    `LOCATION:${loc}`,
    `URL:${getBaseUrl(req)}/tournaments/${t.slug}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');
  res.type('text/calendar; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${t.slug}.ics"`);
  res.send(body);
});

// עזר לעיצוב תאריך עברי מבסיס YYYY-MM-DD
function formatHebDate(iso) {
  try {
    const d = new Date(iso + 'T00:00:00');
    const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
    const days = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
    return `${d.getDate()} ב${months[d.getMonth()]} ${d.getFullYear()}, ${days[d.getDay()]}`;
  } catch { return iso; }
}

app.get('/api/admin/file/:id/:kind', adminAuth, async (req, res) => {
  const db = await loadDB();
  const r = db.registrations.find(x => x.id === req.params.id);
  if (!r) return res.status(404).send('not found');
  const f = req.params.kind === 'health' ? r.healthFile : r.paymentProof;
  if (!f) return res.status(404).send('no file');
  res.download(path.join(UPLOAD_DIR, f.stored), f.original);
});

// --- Emails ---
async function sendRegistrationEmails(r, t, baseUrl) {
  const tr = buildTransport();
  const admin = process.env.ADMIN_EMAIL;
  if (!tr) return;
  const base = baseUrl || getBaseUrl();
  const verifyUrl = `${base}/api/verify/${r.verifyToken}`;

  // מייל למנהל (כולל הצהרת בריאות כקובץ מצורף)
  if (admin && admin !== 'to_be_provided_by_user') {
    await tr.sendMail({
      from: `"${t.title}" <${mailFromAddr()}>`,
      to: admin, subject: `הרשמה חדשה · ${r.fullName}`,
      html: `<div dir="rtl" style="font-family:Arial,sans-serif">
        <h2>הרשמה חדשה · ${escapeHtml(t.title)}</h2>
        <p><b>מזהה:</b> ${r.id} · <b>סטטוס:</b> ${statusHe(r.status)}</p>
        <p><b>שם:</b> ${escapeHtml(r.fullName)} · ${escapeHtml(r.phone)} · ${escapeHtml(r.email)}</p>
        <p><b>רמה:</b> ${r.level}${r.partnerName ? ` · <b>שותף/ה:</b> ${escapeHtml(r.partnerName)} (${escapeHtml(r.partnerPhone)})` : ''}</p>
        ${r.notes ? `<p><b>הערות:</b> ${escapeHtml(r.notes)}</p>` : ''}
      </div>`,
      attachments: r.healthFile ? [{ filename: r.healthFile.original, path: path.join(UPLOAD_DIR, r.healthFile.stored) }] : []
    });
  }

  // מייל לנרשם/ת — אימות זהות + פרטי ההרשמה
  const body = `
    <p>היי ${escapeHtml(r.fullName.split(' ')[0] || r.fullName)} 👋</p>
    <p>קיבלנו את ההרשמה שלך ל<b>${escapeHtml(t.title)}</b>. כדי שנוכל לאשר שהכתובת באמת שלך, צריך רק אישור מהיר:</p>
    <p style="text-align:center;margin:24px 0">${mailBtn(verifyUrl, '✅ זה באמת אני — אישור ההרשמה')}</p>
    <p style="font-size:13px;color:#b5c9bf">או העתק/י את הקישור: <span style="color:#d4ff3a;word-break:break-all">${verifyUrl}</span></p>
    <hr style="border:0;border-top:1px solid rgba(212,255,58,0.15);margin:22px 0">
    <p><b>פרטי הרשמה</b></p>
    <ul style="padding-inline-start:18px;margin:8px 0">
      <li>מזהה: <b style="color:#d4ff3a">${r.id}</b></li>
      <li>סטטוס נוכחי: <b>${statusHe(r.status)}</b></li>
      <li>רמה: <b>${escapeHtml(r.level)}</b></li>
      ${r.partnerName ? `<li>שותף/ה: <b>${escapeHtml(r.partnerName)}</b></li>` : ''}
      ${t.date ? `<li>תאריך משוער: <b>${escapeHtml(t.date)}</b></li>` : ''}
      ${t.location ? `<li>מיקום: <b>${escapeHtml(t.location)}</b></li>` : ''}
    </ul>
    <p style="font-size:13px;color:#b5c9bf">
      ${r.status === 'awaiting_payment'
        ? 'המקום יישמר סופית אחרי תשלום ב-bit ואישור המארגן. נעדכן אותך במייל בכל שינוי.'
        : 'כרגע את/ה ברשימת המתנה. אם יתפנה מקום נעדכן אותך מייד.'}
    </p>
    <p style="font-size:13px;color:#b5c9bf">בנוסף — נשלח לך הודעות אוטומטיות כשההרשמה תאושר, כשהתשלום יאומת, וכשהטורניר יצא לדרך בפועל.</p>
    <p style="text-align:center;margin:18px 0">${mailBtn(`${base}/my/${r.id}`, '👤 האזור האישי שלי')}</p>`;

  await tr.sendMail({
    from: `"${t.title}" <${mailFromAddr()}>`,
    to: r.email,
    subject: `אישור זהות · ${t.title}`,
    html: mailShell('קיבלנו את ההרשמה שלך 🎾', body)
  });
  logActivityStandalone({
    type: 'email_sent', channel: 'email', summary: `מייל אימות זהות נשלח · ${t.title}`,
    regId: r.id, tournamentId: t.id, clubId: t.clubId, organizerId: t.organizerId,
    contactEmail: r.email, contactPhone: r.phone, by: 'system'
  });
}

// מייל עדכון סטטוס לנרשם — כשהמארגן משנה את הסטטוס ידנית
async function sendStatusUpdateEmail(r, t, prevStatus, note) {
  const tr = buildTransport();
  if (!tr || !r?.email) return;
  // כותרת ומסר מותאם לפי הסטטוס החדש
  const statusMeta = {
    approved: {
      title: 'הרשמתך אושרה! 🎉',
      intro: 'המארגן אישר רשמית את ההרשמה שלך. המקום שמור.',
      next: 'נעדכן אותך במייל נפרד כשהטורניר יאושר סופית (מינימום משתתפים).'
    },
    paid_confirmed: {
      title: 'התשלום אומת ✅',
      intro: 'קיבלנו וידאנו את התשלום שלך. ההרשמה סופית והמקום שמור.',
      next: 'כשכל הזוגות ישלמו והטורניר יוצא לפועל — נשלח לך הודעת אישור אחרונה עם פרטים מלאים.'
    },
    payment_under_review: {
      title: 'אסמכתת התשלום התקבלה',
      intro: 'קיבלנו את הצילום של התשלום. זה בבדיקה — בדרך כלל זה לוקח עד 24 שעות.',
      next: 'נעדכן אותך ברגע שהתשלום יאושר.'
    },
    waitlist: {
      title: 'הועברת לרשימת המתנה',
      intro: 'כרגע אין מקום פנוי. אם יתפנה — את/ה הבאים בתור.',
      next: 'נעדכן אותך מייד אם תקודם/י.'
    },
    cancelled: {
      title: 'ההרשמה בוטלה',
      intro: 'ההרשמה שלך לטורניר הזה בוטלה.',
      next: note ? `סיבה: ${escapeHtml(note)}` : 'אם יש שאלות — אפשר להשיב למייל הזה.'
    },
    refund_pending: {
      title: 'החזר כספי בתהליך',
      intro: 'אישרנו בקשת החזר — הכסף יחזור בקרוב.',
      next: 'נשלח אישור נוסף כשההחזר יבוצע.'
    },
    refunded: {
      title: 'ההחזר בוצע',
      intro: 'ההחזר הכספי בוצע מצדנו.',
      next: 'תודה על ההבנה, ונתראה בטורניר הבא!'
    }
  };
  const m = statusMeta[r.status];
  if (!m) return;
  // מנע דופליקט — אל תשלח את אותו סטטוס פעמיים לאותה הרשמה
  if (!Array.isArray(r.notifiedStatuses)) r.notifiedStatuses = [];
  if (r.notifiedStatuses.includes(r.status)) return;
  r.notifiedStatuses.push(r.status);

  const body = `
    <p>היי ${escapeHtml((r.fullName || '').split(' ')[0] || 'משתתף/ת')},</p>
    <p>${m.intro}</p>
    <p><b>טורניר:</b> ${escapeHtml(t.title)}</p>
    <p><b>מזהה הרשמה:</b> <span style="color:#d4ff3a">${r.id}</span></p>
    ${note ? `<p style="background:rgba(212,255,58,0.08);padding:10px 14px;border-radius:10px"><b>הערת מארגן:</b> ${escapeHtml(note)}</p>` : ''}
    <hr style="border:0;border-top:1px solid rgba(212,255,58,0.15);margin:20px 0">
    <p style="font-size:13.5px;color:#b5c9bf">${m.next}</p>
    <p style="text-align:center;margin:16px 0">${mailBtn(`${getBaseUrl()}/my/${r.id}`, '👤 צפייה בסטטוס החי')}</p>`;

  await tr.sendMail({
    from: `"${t.title}" <${mailFromAddr()}>`,
    to: r.email,
    subject: `${m.title} · ${t.title}`,
    html: mailShell(m.title, body)
  });
  logActivityStandalone({
    type: 'email_sent', channel: 'email', summary: `${m.title} · ${t.title}`,
    regId: r.id, tournamentId: t.id, clubId: t.clubId, organizerId: t.organizerId,
    contactEmail: r.email, contactPhone: r.phone, by: 'system'
  });
}

// מייל אישור טורניר — לכל מי ששילם/אושר, ברגע שהטורניר יוצא לפועל
async function sendTournamentConfirmedEmails(t, paidRegs) {
  const tr = buildTransport();
  if (!tr || !paidRegs?.length) return;
  const subject = `הטורניר מתקיים! 🎾 ${t.title}`;
  const body = (r) => `
    <p>חדשות מצויינות ${escapeHtml((r.fullName || '').split(' ')[0] || '')}! 🔥</p>
    <p>הגענו למינימום המשתתפים — <b>${escapeHtml(t.title)}</b> יוצא לפועל.</p>
    <div style="background:rgba(212,255,58,0.08);border:1px solid rgba(212,255,58,0.25);padding:16px 18px;border-radius:14px;margin:18px 0">
      ${t.date ? `<p style="margin:4px 0"><b>📅 תאריך:</b> ${escapeHtml(t.date)}</p>` : ''}
      ${t.location ? `<p style="margin:4px 0"><b>📍 מיקום:</b> ${escapeHtml(t.location)}</p>` : ''}
      <p style="margin:4px 0"><b>🆔 מזהה ההרשמה שלך:</b> <span style="color:#d4ff3a">${r.id}</span></p>
      ${r.partnerName ? `<p style="margin:4px 0"><b>🤝 שותף/ה:</b> ${escapeHtml(r.partnerName)}</p>` : ''}
    </div>
    <p>מכאן — אנחנו רק מוודאים שכל הזוגות השלימו תשלום וסוגרים את הלו"ז הסופי. נשלח מייל אחרון עם כל הפרטים המלאים (שעת התייצבות, לוח משחקים, הוראות הגעה) יום-יומיים לפני האירוע.</p>
    <p style="text-align:center;margin:18px 0">
      ${mailBtn(`${getBaseUrl()}/api/tournaments/${t.slug}/calendar.ics`, '📅 הוסף ליומן')}
      &nbsp;
      ${mailBtn(`${getBaseUrl()}/my/${r.id}`, '👤 אזור אישי')}
    </p>
    <p style="font-size:13px;color:#b5c9bf">אם יש שינוי אצלך — אפשר להשיב למייל הזה.</p>`;

  for (const r of paidRegs) {
    if (!r.email) continue;
    if (Array.isArray(r.notifiedStatuses) && r.notifiedStatuses.includes('tournament_confirmed')) continue;
    try {
      await tr.sendMail({
        from: `"${t.title}" <${mailFromAddr()}>`,
        to: r.email,
        subject,
        html: mailShell('הטורניר יוצא לדרך! 🎾', body(r))
      });
      r.notifiedStatuses = r.notifiedStatuses || [];
      r.notifiedStatuses.push('tournament_confirmed');
      logActivityStandalone({
        type: 'email_sent', channel: 'email', summary: `הטורניר יוצא לדרך · ${t.title}`,
        regId: r.id, tournamentId: t.id, clubId: t.clubId, organizerId: t.organizerId,
        contactEmail: r.email, contactPhone: r.phone, by: 'system'
      });
    } catch (e) { console.error('confirm mail err', r.id, e.message); }
  }
}

// מייל אחרון — כולם שילמו, הטורניר נעול
async function sendAllPaidEmails(t, paidRegs) {
  const tr = buildTransport();
  if (!tr || !paidRegs?.length) return;
  const subject = `כל הזוגות שילמו — נתראה בטורניר! · ${t.title}`;
  const body = (r) => `
    <p>הגיע הרגע 💪</p>
    <p>כל הזוגות ב<b>${escapeHtml(t.title)}</b> השלימו תשלום. האירוע נעול סופית.</p>
    <div style="background:rgba(212,255,58,0.08);border:1px solid rgba(212,255,58,0.25);padding:16px 18px;border-radius:14px;margin:18px 0">
      ${t.date ? `<p style="margin:4px 0"><b>📅 תאריך:</b> ${escapeHtml(t.date)}</p>` : ''}
      ${t.location ? `<p style="margin:4px 0"><b>📍 מיקום:</b> ${escapeHtml(t.location)}</p>` : ''}
      <p style="margin:4px 0"><b>🆔 מזהה ההרשמה שלך:</b> <span style="color:#d4ff3a">${r.id}</span></p>
    </div>
    <p>קחו כדור, נעליים, בקבוק מים ומצב רוח טוב 🎾</p>
    <p style="font-size:13px;color:#b5c9bf">לכל שאלה אפשר להשיב למייל הזה.</p>`;

  for (const r of paidRegs) {
    if (!r.email) continue;
    if (Array.isArray(r.notifiedStatuses) && r.notifiedStatuses.includes('all_paid')) continue;
    try {
      await tr.sendMail({
        from: `"${t.title}" <${mailFromAddr()}>`,
        to: r.email, subject,
        html: mailShell('כולם שילמו · מוכנים לטורניר 🎾', body(r))
      });
      r.notifiedStatuses = r.notifiedStatuses || [];
      r.notifiedStatuses.push('all_paid');
      logActivityStandalone({
        type: 'email_sent', channel: 'email', summary: `כולם שילמו — סגירה סופית · ${t.title}`,
        regId: r.id, tournamentId: t.id, clubId: t.clubId, organizerId: t.organizerId,
        contactEmail: r.email, contactPhone: r.phone, by: 'system'
      });
    } catch (e) { console.error('all-paid mail err', r.id, e.message); }
  }
}

async function sendPaymentProofEmail(r, t) {
  const tr = buildTransport();
  const admin = process.env.ADMIN_EMAIL;
  if (!tr || !admin || admin === 'to_be_provided_by_user') return;
  await tr.sendMail({
    from: `"${t?.title || 'Padel Platform'}" <${mailFromAddr()}>`,
    to: admin,
    subject: `אסמכתת תשלום · ${r.fullName} (${r.id})`,
    html: `<div dir="rtl"><p>${escapeHtml(r.fullName)} העלה/תה אסמכתת תשלום.</p><p>מזהה: ${r.id}</p></div>`,
    attachments: [{ filename: r.paymentProof.original, path: path.join(UPLOAD_DIR, r.paymentProof.stored) }]
  });
}

// --- 404 handler ---
app.use((req, res) => {
  if (req.accepts('html')) {
    res.status(404).type('html').send(`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8">
      <title>404 — לא נמצא</title>
      <link rel="stylesheet" href="/platform.css">
      <body><header class="pnav"><div class="pnav-inner"><a href="/" class="pnav-logo">🎾 padel<span class="dot">.</span>platform</a></div></header>
      <section class="section"><div class="wrap" style="text-align:center">
        <h1 style="font-size:80px;color:#d4ff3a;margin:20px 0">404</h1>
        <h2>הדף שחיפשת לא נמצא</h2>
        <p class="lead" style="margin:14px auto">אולי הוא עבר, אולי הוא לא עלה עדיין. בינתיים יש המון פעילות פאדל ברשת.</p>
        <a class="btn btn-primary" href="/">חזרה לדף הבית</a>
      </div></section></body></html>`);
  } else {
    res.status(404).json({ ok: false, error: 'not found' });
  }
});

// --- Error handler ---
app.use((err, _req, res, _next) => {
  console.error('[err]', err.message);
  res.status(500).json({ ok: false, errors: ['שגיאת שרת. נסה/י שוב.'] });
});

app.listen(PORT, () => {
  console.log(`🎾 Padel Platform on :${PORT}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`   admin token: ${ADMIN_TOKEN}`);
  }
});
