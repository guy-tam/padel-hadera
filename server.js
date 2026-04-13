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

// --- DB ---
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch {
    return { clubs: [], organizers: [], tournaments: [], registrations: [], applications: { organizers: [], clubs: [] } };
  }
}
function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
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

// מגיש HTML עם חיתוך templating פשוט
function serveTemplate(res, filename, vars) {
  const filePath = path.join(PUBLIC_DIR, filename);
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return res.status(500).send('Template error');
    const rendered = html.replace(/\{\{(\w+)\}\}/g, (_, k) =>
      vars[k] !== undefined ? vars[k] : '');
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
                        : `נותרו ${t.format.maxPairs - reserved} מקומות מתוך ${t.format.maxPairs} זוגות`
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

// --- /organizers/apply ---
app.get('/organizers/apply', (_req, res) => serveTemplate(res, 'organizers-apply.html', {}));

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
  const { name, email, phone, city, experience, note } = req.body || {};
  const errs = [];
  if (!name || name.trim().length < 2) errs.push('שם חסר.');
  if (!validEmail(email)) errs.push('מייל לא תקין.');
  if (!validPhone(phone)) errs.push('טלפון לא תקין.');
  if (errs.length) return res.status(400).json({ ok: false, errors: errs });
  const entry = {
    id: 'ORG-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
    createdAt: new Date().toISOString(),
    name, email, phone, city: city || '', experience: experience || '', note: note || '',
    status: 'pending'
  };
  db.applications.organizers.push(entry);
  saveDB(db);
  notifyOrganizerWhatsApp(`🆕 מארגן/ת חדש/ה מעוניין/ת להצטרף:\n${entry.name} · ${entry.phone} · ${entry.email}\n${entry.note || ''}`).catch(()=>{});
  res.json({ ok: true, id: entry.id });
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

app.post('/api/admin/status/:id', adminAuth, express.json(), (req, res) => {
  const { status, note } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'סטטוס לא חוקי' });
  const db = loadDB();
  const r = db.registrations.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ ok: false, error: 'לא נמצא' });
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
  saveDB(db);
  res.json({ ok: true, status: r.status });
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
