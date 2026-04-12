// טורניר פאדל חדרה — שרת Express
// זרימה אמיתית: הרשמה -> העלאת הצהרת בריאות -> סטטוס ממתין לתשלום ->
// העלאת אסמכתא bit -> בדיקה ידנית של המארגן -> אישור.
// מגבלה: 8 זוגות מאושרים.

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'padel-admin-2026';
const MAX_PAIRS = 8;

// --- תיקיות ---
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'registrations.json');
for (const d of [UPLOAD_DIR, DATA_DIR]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, '[]', 'utf8');

// --- DB פשוט מבוסס קובץ JSON ---
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return []; }
}
function saveDB(list) {
  fs.writeFileSync(DB_PATH, JSON.stringify(list, null, 2), 'utf8');
}

// סטטוסים חוקיים
const STATUSES = [
  'submitted', 'awaiting_payment', 'payment_under_review',
  'paid_confirmed', 'approved', 'waitlist',
  'cancelled', 'refund_pending', 'refunded'
];

// סטטוסים שתופסים מקום מתוך 8 הזוגות
const RESERVING = new Set([
  'awaiting_payment', 'payment_under_review', 'paid_confirmed', 'approved'
]);

function countReserved(db) {
  return db.filter(r => RESERVING.has(r.status)).length;
}
function countApproved(db) {
  return db.filter(r => r.status === 'approved' || r.status === 'paid_confirmed').length;
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

// --- Mailer ---
function buildTransport() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- עזר ---
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function validPhone(p) {
  return /^(0\d{8,9}|\+972\d{8,9})$/.test((p || '').replace(/[\s-]/g, ''));
}
function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
}

// --- בקרת קיבולת (ציבורית) ---
app.get('/api/capacity', (_req, res) => {
  const db = loadDB();
  const reserved = countReserved(db);
  const approved = countApproved(db);
  res.json({
    maxPairs: MAX_PAIRS,
    reserved,
    approved,
    remaining: Math.max(0, MAX_PAIRS - reserved),
    full: reserved >= MAX_PAIRS
  });
});

// --- בדיקת סטטוס הרשמה ---
app.get('/api/status/:id', (req, res) => {
  const db = loadDB();
  const r = db.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ ok: false, error: 'הרשמה לא נמצאה' });
  res.json({
    ok: true,
    id: r.id,
    status: r.status,
    fullName: r.fullName,
    hasPaymentProof: !!r.paymentProof
  });
});

// --- הרשמה חדשה ---
app.post('/api/register', (req, res) => {
  upload.single('healthFile')(req, res, async (err) => {
    if (err) return res.status(400).json({ ok: false, errors: [err.message] });

    const errors = [];
    const { fullName, phone, email, level, partnerName, partnerPhone,
            notes, consent, healthConsent, paymentAck } = req.body;

    if (!fullName || fullName.trim().length < 2) errors.push('שם מלא חסר.');
    if (!validPhone(phone)) errors.push('טלפון לא תקין.');
    if (!validEmail(email)) errors.push('מייל לא תקין.');
    if (!['2.5', '3'].includes(level)) errors.push('רמה לא תקינה.');
    if (!partnerName || partnerName.trim().length < 2) errors.push('שם שותף/ה חסר.');
    if (!validPhone(partnerPhone)) errors.push('טלפון שותף/ה לא תקין.');
    if (!['on','true',true].includes(consent)) errors.push('יש לאשר תנאי השתתפות.');
    if (!['on','true',true].includes(healthConsent)) errors.push('יש לאשר את הצהרת הבריאות.');
    if (!['on','true',true].includes(paymentAck)) errors.push('יש לאשר את מדיניות התשלום.');
    if (!req.file) errors.push('חובה להעלות הצהרת בריאות חתומה.');
    else if (req.file.size < 10 * 1024) errors.push('קובץ הצהרת בריאות קטן מדי.');

    if (errors.length) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ ok: false, errors });
    }

    const db = loadDB();
    const reserved = countReserved(db);
    const initialStatus = reserved >= MAX_PAIRS ? 'waitlist' : 'awaiting_payment';

    const id = 'HDR-' + Date.now().toString(36).toUpperCase()
      + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();

    const record = {
      id,
      createdAt: new Date().toISOString(),
      status: initialStatus,
      fullName, phone, email, level,
      partnerName, partnerPhone,
      notes: notes || '',
      healthFile: {
        original: req.file.originalname,
        stored: req.file.filename,
        size: req.file.size
      },
      paymentProof: null,
      history: [{ at: new Date().toISOString(), status: initialStatus, by: 'system' }]
    };
    db.push(record);
    saveDB(db);

    // מייל למארגן + משתתף (אם מוגדר)
    sendRegistrationEmails(record).catch(e => console.error('mail err', e.message));

    res.json({
      ok: true,
      id,
      status: initialStatus,
      waitlist: initialStatus === 'waitlist'
    });
  });
});

// --- העלאת אסמכתא תשלום bit ---
app.post('/api/payment-proof/:id', (req, res) => {
  upload.single('paymentFile')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, errors: [err.message] });

    const db = loadDB();
    const r = db.find(x => x.id === req.params.id);
    if (!r) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(404).json({ ok: false, errors: ['הרשמה לא נמצאה.'] });
    }
    if (!req.file) return res.status(400).json({ ok: false, errors: ['חובה לצרף צילום מסך של התשלום.'] });
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
    // אם היה ממתין לתשלום - עובר לבדיקה. ברשימת המתנה - נשאר (אבל נשמרת אסמכתא).
    if (r.status === 'awaiting_payment') {
      r.status = 'payment_under_review';
      r.history.push({ at: new Date().toISOString(), status: 'payment_under_review', by: 'user' });
    }
    saveDB(db);

    sendPaymentProofEmail(r).catch(e => console.error('mail err', e.message));

    res.json({ ok: true, status: r.status });
  });
});

// --- אדמין: צפייה ברשימה ---
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'אין הרשאה' });
  next();
}

app.get('/api/admin/list', adminAuth, (_req, res) => {
  const db = loadDB();
  res.json({
    ok: true,
    capacity: { max: MAX_PAIRS, reserved: countReserved(db), approved: countApproved(db) },
    registrations: db.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  });
});

// --- אדמין: שינוי סטטוס ---
app.post('/api/admin/status/:id', adminAuth, express.json(), (req, res) => {
  const { status, note } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'סטטוס לא חוקי' });

  const db = loadDB();
  const r = db.find(x => x.id === req.params.id);
  if (!r) return res.status(404).json({ ok: false, error: 'לא נמצא' });

  const prev = r.status;
  r.status = status;
  r.history.push({ at: new Date().toISOString(), status, by: 'admin', note: note || '' });

  // אם שוחרר מקום - קדם ממתין מרשימת המתנה לממתין לתשלום
  if (RESERVING.has(prev) && !RESERVING.has(status)) {
    const waiter = db.find(x => x.status === 'waitlist');
    if (waiter) {
      waiter.status = 'awaiting_payment';
      waiter.history.push({ at: new Date().toISOString(), status: 'awaiting_payment', by: 'system', note: 'קודם מרשימת המתנה' });
      notifyPromoted(waiter).catch(()=>{});
    }
  }
  saveDB(db);

  // מייל למשתתף על עדכון סטטוס (ליידע אישור/דחייה)
  if (['paid_confirmed','approved','waitlist','cancelled','refunded'].includes(status)) {
    notifyStatusChange(r).catch(()=>{});
  }

  res.json({ ok: true, status: r.status });
});

// --- אדמין: הורדת קובץ של הרשמה ---
app.get('/api/admin/file/:id/:kind', adminAuth, (req, res) => {
  const db = loadDB();
  const r = db.find(x => x.id === req.params.id);
  if (!r) return res.status(404).send('not found');
  const f = req.params.kind === 'health' ? r.healthFile : r.paymentProof;
  if (!f) return res.status(404).send('no file');
  res.download(path.join(UPLOAD_DIR, f.stored), f.original);
});

// --- מיילים ---
async function sendRegistrationEmails(r) {
  const t = buildTransport();
  const admin = process.env.ADMIN_EMAIL;
  if (!t || !admin || admin === 'to_be_provided_by_user') return;

  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif">
      <h2>הרשמה חדשה - טורניר פאדל חדרה</h2>
      <p><b>מזהה:</b> ${r.id} · <b>סטטוס:</b> ${statusHe(r.status)}</p>
      <p><b>שם:</b> ${escapeHtml(r.fullName)} · ${escapeHtml(r.phone)} · ${escapeHtml(r.email)}</p>
      <p><b>רמה:</b> ${r.level} · <b>שותף/ה:</b> ${escapeHtml(r.partnerName)} (${escapeHtml(r.partnerPhone)})</p>
      ${r.notes ? `<p><b>הערות:</b> ${escapeHtml(r.notes)}</p>` : ''}
      <p><b>הצהרת בריאות:</b> ${escapeHtml(r.healthFile.original)}</p>
    </div>`;
  await t.sendMail({
    from: `"טורניר פאדל חדרה" <${process.env.SMTP_USER}>`,
    to: admin, subject: `הרשמה חדשה - ${r.fullName} (רמה ${r.level})`, html,
    attachments: [{ filename: r.healthFile.original, path: path.join(UPLOAD_DIR, r.healthFile.stored) }]
  });
  await t.sendMail({
    from: `"טורניר פאדל חדרה" <${process.env.SMTP_USER}>`,
    to: r.email,
    subject: 'אישור קליטת הרשמה - טורניר פאדל חדרה',
    html: `<div dir="rtl" style="font-family:Arial,sans-serif">
      <h2>הרשמתך נקלטה! 🎾</h2>
      <p>מזהה: <b>${r.id}</b></p>
      <p>סטטוס: <b>${statusHe(r.status)}</b></p>
      ${r.status === 'awaiting_payment'
        ? '<p>המקום יישמר סופית רק לאחר ביצוע תשלום ב-bit והעלאת אסמכתא.</p>'
        : '<p>הטורניר מלא כרגע - את/ה ברשימת המתנה. נעדכן אם יתפנה מקום.</p>'}
    </div>`
  });
}

async function sendPaymentProofEmail(r) {
  const t = buildTransport();
  const admin = process.env.ADMIN_EMAIL;
  if (!t || !admin || admin === 'to_be_provided_by_user') return;
  await t.sendMail({
    from: `"טורניר פאדל חדרה" <${process.env.SMTP_USER}>`,
    to: admin,
    subject: `אסמכתת תשלום - ${r.fullName} (${r.id})`,
    html: `<div dir="rtl">
      <p>${escapeHtml(r.fullName)} העלה/תה אסמכתת תשלום bit.</p>
      <p>מזהה: ${r.id}</p>
      <p>יש לבדוק ולאשר במערכת האדמין.</p>
    </div>`,
    attachments: [{ filename: r.paymentProof.original, path: path.join(UPLOAD_DIR, r.paymentProof.stored) }]
  });
}

async function notifyStatusChange(r) {
  const t = buildTransport();
  if (!t) return;
  const msg = {
    paid_confirmed: 'התשלום אושר! מקומך בטורניר מאובטח.',
    approved: 'ההרשמה אושרה סופית. נתראה על המגרש 🎾',
    waitlist: 'כרגע הטורניר מלא - את/ה ברשימת המתנה.',
    cancelled: 'ההרשמה בוטלה. אם יש שאלה - צרו קשר עם הצוות.',
    refunded: 'ההחזר בוצע.'
  }[r.status] || 'עדכון בסטטוס ההרשמה.';
  await t.sendMail({
    from: `"טורניר פאדל חדרה" <${process.env.SMTP_USER}>`,
    to: r.email,
    subject: 'עדכון סטטוס - טורניר פאדל חדרה',
    html: `<div dir="rtl"><p>${msg}</p><p>מזהה: ${r.id}</p></div>`
  });
}

async function notifyPromoted(r) {
  const t = buildTransport();
  if (!t) return;
  await t.sendMail({
    from: `"טורניר פאדל חדרה" <${process.env.SMTP_USER}>`,
    to: r.email,
    subject: 'התפנה מקום! - טורניר פאדל חדרה',
    html: `<div dir="rtl"><p>היי ${escapeHtml(r.fullName)},</p>
      <p>התפנה מקום בטורניר. יש להשלים תשלום ב-bit כדי לאבטח את ההשתתפות.</p>
      <p>מזהה: ${r.id}</p></div>`
  });
}

function statusHe(s) {
  return ({
    submitted: 'נקלטה', awaiting_payment: 'ממתין לתשלום',
    payment_under_review: 'תשלום בבדיקה', paid_confirmed: 'תשלום אושר',
    approved: 'מאושר', waitlist: 'רשימת המתנה',
    cancelled: 'בוטל', refund_pending: 'החזר בתהליך', refunded: 'הוחזר'
  })[s] || s;
}

// --- שגיאות ---
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, errors: ['שגיאת שרת.'] });
});

app.listen(PORT, () => {
  console.log(`🎾 padel hadera on :${PORT}`);
  console.log(`   admin token: ${ADMIN_TOKEN}`);
});
