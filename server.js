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
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'padel-admin-2026';

// --- תיקיות ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

for (const d of [UPLOAD_DIR, DATA_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({
    clubs: [], organizers: [], tournaments: [], registrations: [],
    applications: { organizers: [], clubs: [] }
  }, null, 2));
}

// --- DB (אטומי + גיבוי) ---
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
let DB_LOCK = Promise.resolve();
function loadDB() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    db.clubs ||= []; db.organizers ||= []; db.tournaments ||= []; db.registrations ||= [];
    db.applications ||= {}; db.applications.organizers ||= [];
    db.applications.clubs ||= []; db.applications.players ||= [];
    return db;
  } catch {
    return { clubs: [], organizers: [], tournaments: [], registrations: [],
             applications: { organizers: [], clubs: [], players: [] } };
  }
}
// כתיבה אטומית: temp file + rename + גיבוי יומי
function saveDB(db) {
  const tmp = DB_PATH + '.tmp.' + process.pid;
  const json = JSON.stringify(db, null, 2);
  fs.writeFileSync(tmp, json, { encoding: 'utf8', flag: 'w' });
  fs.renameSync(tmp, DB_PATH);
  // גיבוי יומי (שם לפי תאריך)
  const stamp = new Date().toISOString().slice(0,10);
  const bkp = path.join(BACKUP_DIR, `db-${stamp}.json`);
  if (!fs.existsSync(bkp)) {
    try { fs.writeFileSync(bkp, json, 'utf8'); } catch {}
  }
}
// עטיפה שסוררת שינויים במקביל
async function withDB(fn) {
  DB_LOCK = DB_LOCK.then(async () => {
    const db = loadDB();
    const result = await fn(db);
    saveDB(db);
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
function buildTransport() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
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
      "script-src": ["'self'", "'unsafe-inline'", "https://www.youtube.com", "https://www.youtube-nocookie.com", "https://s.ytimg.com"],
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
const A11Y_INJECT = `<link rel="stylesheet" href="/a11y.css"><script src="/a11y.js" defer></script></body>`;
function serveTemplate(res, filename, vars) {
  const filePath = path.join(PUBLIC_DIR, filename);
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return res.status(500).send('Template error');
    let rendered = html.replace(/\{\{(\w+)\}\}/g, (_, k) =>
      vars[k] !== undefined ? vars[k] : '');
    // הזרקה רק אם לא קיים כבר
    if (!rendered.includes('/a11y.css')) {
      rendered = rendered.replace('</body>', A11Y_INJECT);
    }
    res.type('html').send(rendered);
  });
}

// --- / · Platform homepage ---
app.get('/', (_req, res) => {
  const db = loadDB();
  const featured = db.tournaments.filter(t => t.visibility === 'public' && t.featured)
    .map(t => tournamentCardHtml(t, db)).join('');
  serveTemplate(res, 'home.html', { FEATURED_TOURNAMENTS: featured });
});

// --- /tournaments · discovery ---
app.get('/tournaments', (_req, res) => {
  const db = loadDB();
  const cards = db.tournaments.filter(t => t.visibility === 'public')
    .map(t => tournamentCardHtml(t, db)).join('');
  serveTemplate(res, 'tournaments.html', { TOURNAMENT_CARDS: cards || '<p class="empty">אין טורנירים פעילים כרגע.</p>' });
});

// --- /tournaments/:slug · dynamic tournament page ---
app.get('/tournaments/:slug', (req, res) => {
  const db = loadDB();
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
app.get('/clubs', (_req, res) => {
  const db = loadDB();
  const cards = db.clubs.map(c => clubCardHtml(c, db)).join('');
  serveTemplate(res, 'clubs.html', { CLUB_CARDS: cards });
});

// --- /clubs/join (חייב לבוא לפני /clubs/:slug) ---
app.get('/clubs/join', (_req, res) => serveTemplate(res, 'clubs-join.html', {}));

// --- /clubs/:slug · detail ---
app.get('/clubs/:slug', (req, res) => {
  const db = loadDB();
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
app.get('/sitemap.xml', (req, res) => {
  const db = loadDB();
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
      <div class="t-card-img" style="background-image:url('${t.heroImage || '/img/padel-hero.jpg'}')">
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
      <div class="club-card-img" style="background-image:url('${c.image}')"></div>
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
app.get('/api/tournaments/:slug/capacity', (req, res) => {
  const db = loadDB();
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
app.get('/api/capacity', (req, res) => {
  const db = loadDB();
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
app.post('/api/tournaments/:slug/register', (req, res) => {
  const db = loadDB();
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
      history: [{ at: new Date().toISOString(), status: initialStatus, by: 'system' }]
    };
    db.registrations.push(record);
    saveDB(db);

    sendRegistrationEmails(record, t).catch(e => console.error('mail err', e.message));
    notifyOrganizerWhatsApp(
      `🎾 הרשמה חדשה · ${t.title}\n${record.fullName} (${record.phone}) · רמה ${record.level}\n` +
      (record.partnerName ? `שותף/ה: ${record.partnerName}\n` : '') +
      `סטטוס: ${statusHe(initialStatus)} · מזהה: ${id}`
    ).catch(() => {});

    res.json({ ok: true, id, status: initialStatus, waitlist: initialStatus === 'waitlist' });
  });
});

// תאימות אחורה
app.post('/api/register', (req, res, next) => {
  req.url = '/api/tournaments/hadera-2026/register';
  next('route');
});
app.post('/api/register', (req, res) => {
  // מועבר הלאה — הגדרנו את ה-handler האמיתי למעלה
});

// העלאת אסמכתת תשלום
app.post('/api/payment-proof/:id', (req, res) => {
  upload.single('paymentFile')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, errors: [err.message] });
    const db = loadDB();
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
    saveDB(db);
    const t = db.tournaments.find(x => x.id === r.tournamentId);
    sendPaymentProofEmail(r, t).catch(e => console.error('mail err', e.message));
    notifyOrganizerWhatsApp(
      `💳 אסמכתת תשלום · ${t?.title || ''}\n${r.fullName} · מזהה: ${r.id}`
    ).catch(() => {});
    res.json({ ok: true, status: r.status });
  });
});

// בדיקת סטטוס
app.get('/api/status/:id', (req, res) => {
  const db = loadDB();
  const r = db.registrations.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ ok: false, error: 'הרשמה לא נמצאה' });
  res.json({ ok: true, id: r.id, status: r.status, fullName: r.fullName, hasPaymentProof: !!r.paymentProof });
});

// --- Applications: arganizers / clubs ---
app.post('/api/applications/organizer', express.json(), (req, res) => {
  const db = loadDB();
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
  saveDB(db);
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

app.post('/api/applications/club', express.json(), (req, res) => {
  const db = loadDB();
  const { name, city, contactPerson, email, phone, courts, note } = req.body || {};
  const errs = [];
  if (!name || name.trim().length < 2) errs.push('שם המועדון חסר.');
  if (!city || city.trim().length < 2) errs.push('עיר חסרה.');
  if (!validEmail(email)) errs.push('מייל לא תקין.');
  if (!validPhone(phone)) errs.push('טלפון לא תקין.');
  if (errs.length) return res.status(400).json({ ok: false, errors: errs });
  const entry = {
    id: 'CLUB-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    createdAt: new Date().toISOString(),
    name, city, contactPerson: contactPerson || '', email, phone,
    courts: courts || '', note: note || '', status: 'pending'
  };
  db.applications.clubs.push(entry);
  saveDB(db);
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

app.get('/api/admin/list', adminAuth, (_req, res) => {
  const db = loadDB();
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
    applications: db.applications
  });
});

app.post('/api/admin/status/:id', adminAuth, express.json(), async (req, res) => {
  const { status, note } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'סטטוס לא חוקי' });
  try {
    const result = await withDB(db => {
      const r = db.registrations.find(x => x.id === req.params.id);
      if (!r) throw new Error('לא נמצא');
      const prev = r.status;
      r.status = status;
      r.history.push({ at: new Date().toISOString(), status, by: 'admin', note: note || '' });
      if (RESERVING.has(prev) && !RESERVING.has(status)) {
        const waiter = db.registrations.find(x => x.tournamentId === r.tournamentId && x.status === 'waitlist');
        if (waiter) {
          waiter.status = 'awaiting_payment';
          waiter.history.push({ at: new Date().toISOString(), status: 'awaiting_payment', by: 'system', note: 'קודם מרשימת המתנה' });
        }
      }
      // בדיקת קונפירמציה — האם הגענו למינימום זוגות בתשלום מאושר
      const t = db.tournaments.find(x => x.id === r.tournamentId);
      if (t) {
        const paid = db.registrations.filter(x => x.tournamentId === t.id &&
          (x.status === 'paid_confirmed' || x.status === 'approved')).length;
        const needed = t.format?.minPaidPairs || t.format?.maxPairs || 8;
        if (!t.confirmed && paid >= needed) {
          t.confirmed = true;
          t.confirmedAt = new Date().toISOString();
          notifyOrganizerWhatsApp(`🎉 האירוע "${t.title}" אושר! הגיעו ל-${paid} זוגות בתשלום.`).catch(()=>{});
        }
      }
      return { ok: true, status: r.status };
    });
    res.json(result);
  } catch (e) { res.status(400).json({ ok: false, error: e.message }); }
});

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
          createdAt: new Date().toISOString()
        });
        app.status = 'approved';
        app.approvedAt = new Date().toISOString();
        app.clubId = cid;
        return { ok: true, clubId: cid, slug };
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

app.get('/player/:token', (req, res) => {
  const db = loadDB();
  const p = findPlayerByToken(db, req.params.token);
  if (!p) return res.status(404).type('html').send('<!doctype html><meta charset=utf-8><link rel=stylesheet href="/platform.css"><div style="text-align:center;padding:80px;color:#fff"><h1>🔒 קישור לא תקף</h1><p>השתמש בקישור שקיבלת לאחר ההרשמה כשחקן.</p><a href="/players/join" style="color:#062a1c;background:#d4ff3a;padding:10px 20px;border-radius:999px;font-weight:700;display:inline-block;margin-top:20px">להרשמה כשחקן</a></div>');
  serveTemplate(res, 'player-dashboard.html', {
    TOKEN: req.params.token,
    PLAYER_NAME: escapeHtml(p.name),
    PLAYER_ID: p.id
  });
});

app.get('/api/player/:token/me', (req, res) => {
  const db = loadDB();
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
app.get('/api/leaderboard', (_req, res) => {
  const db = loadDB();
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

app.get('/organizer/:token', (req, res) => {
  const db = loadDB();
  const org = findOrganizerByToken(db, req.params.token);
  if (!org) return res.status(404).type('html').send('<!doctype html><meta charset=utf-8><link rel=stylesheet href="/platform.css"><div style="text-align:center;padding:80px;color:#fff"><h1>🔒 קישור לא תקף</h1><p>פנה למארגני הפלטפורמה לקישור מעודכן.</p><a class=btn href="/" style="color:#062a1c;background:#d4ff3a;padding:10px 20px;border-radius:999px;font-weight:700;display:inline-block;margin-top:20px">חזרה לדף הבית</a></div>');
  serveTemplate(res, 'organizer-dashboard.html', {
    TOKEN: req.params.token,
    ORG_NAME: escapeHtml(org.name),
    ORG_ID: org.id
  });
});

// API — מארגן: רשימת טורנירים + יצירת טורניר חדש
app.get('/api/organizer/:token/me', (req, res) => {
  const db = loadDB();
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

app.get('/api/organizer/:token/tournaments/:tid', (req, res) => {
  const db = loadDB();
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
    const db0 = loadDB();
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
            { code: '2.5', label: 'מתחילים — רמה 2.5' },
            { code: '3', label: 'בינוניים — רמה 3' }
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

app.get('/api/admin/file/:id/:kind', adminAuth, (req, res) => {
  const db = loadDB();
  const r = db.registrations.find(x => x.id === req.params.id);
  if (!r) return res.status(404).send('not found');
  const f = req.params.kind === 'health' ? r.healthFile : r.paymentProof;
  if (!f) return res.status(404).send('no file');
  res.download(path.join(UPLOAD_DIR, f.stored), f.original);
});

// --- Emails ---
async function sendRegistrationEmails(r, t) {
  const tr = buildTransport();
  const admin = process.env.ADMIN_EMAIL;
  if (!tr || !admin || admin === 'to_be_provided_by_user') return;
  const html = `<div dir="rtl" style="font-family:Arial,sans-serif">
    <h2>הרשמה חדשה · ${escapeHtml(t.title)}</h2>
    <p><b>מזהה:</b> ${r.id} · <b>סטטוס:</b> ${statusHe(r.status)}</p>
    <p><b>שם:</b> ${escapeHtml(r.fullName)} · ${escapeHtml(r.phone)} · ${escapeHtml(r.email)}</p>
    <p><b>רמה:</b> ${r.level}${r.partnerName ? ` · <b>שותף/ה:</b> ${escapeHtml(r.partnerName)} (${escapeHtml(r.partnerPhone)})` : ''}</p>
    ${r.notes ? `<p><b>הערות:</b> ${escapeHtml(r.notes)}</p>` : ''}
  </div>`;
  await tr.sendMail({
    from: `"${t.title}" <${process.env.SMTP_USER}>`,
    to: admin, subject: `הרשמה חדשה · ${r.fullName}`, html,
    attachments: r.healthFile ? [{ filename: r.healthFile.original, path: path.join(UPLOAD_DIR, r.healthFile.stored) }] : []
  });
  await tr.sendMail({
    from: `"${t.title}" <${process.env.SMTP_USER}>`,
    to: r.email,
    subject: `אישור קליטת הרשמה · ${t.title}`,
    html: `<div dir="rtl" style="font-family:Arial,sans-serif">
      <h2>הרשמתך נקלטה! 🎾</h2>
      <p>מזהה: <b>${r.id}</b></p>
      <p>סטטוס: <b>${statusHe(r.status)}</b></p>
      ${r.status === 'awaiting_payment' ? '<p>המקום יישמר סופית לאחר תשלום ב-bit ואישור.</p>' : '<p>הטורניר מלא כרגע — את/ה ברשימת המתנה.</p>'}
    </div>`
  });
}
async function sendPaymentProofEmail(r, t) {
  const tr = buildTransport();
  const admin = process.env.ADMIN_EMAIL;
  if (!tr || !admin || admin === 'to_be_provided_by_user') return;
  await tr.sendMail({
    from: `"${t?.title || 'Padel Platform'}" <${process.env.SMTP_USER}>`,
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
  console.log(`   admin token: ${ADMIN_TOKEN}`);
});
