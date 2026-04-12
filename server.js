// שרת Express לאתר ההרשמה של טורניר פאדל חדרה
// אחראי על: הגשת דפי הסטטי, הפקת טופס הצהרת בריאות PDF,
// קבלת הרשמות עם העלאת קובץ הצהרת בריאות, ושליחת מייל אישור למארגן + למשתתף.

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// תיקיית העלאות (נוצרת אם לא קיימת)
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- הגדרת multer: שמירה לדיסק עם שם ייחודי + סינון סוגי קבצים ---
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safeBase = file.originalname
      .replace(/[^\w.\-א-ת ]/g, '_')
      .slice(0, 80);
    const unique = crypto.randomBytes(6).toString('hex');
    cb(null, `${Date.now()}-${unique}-${safeBase}`);
  }
});

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png'
]);

const upload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024, // עד 8MB
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      return cb(new Error('סוג קובץ לא חוקי. יש להעלות PDF / JPG / PNG בלבד.'));
    }
    cb(null, true);
  }
});

// --- Nodemailer: טרנספורטר Gmail SMTP ---
function buildTransport() {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- נקודת קצה: הורדת טופס הצהרת בריאות כ-PDF (מופק בזמן אמת) ---
app.get('/health-declaration.pdf', (_req, res) => {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="health-declaration-hadera-padel.pdf"'
  );

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);

  // PDFKit לא תומך בעברית מימין-לשמאל עם פונט ברירת מחדל.
  // נייצר טופס דו-לשוני: כותרת באנגלית + שדות באנגלית ברורים.
  doc.fontSize(22).text('Health Declaration', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(14).text('Tournament Padel Hadera', { align: 'center' });
  doc.moveDown(1.5);

  doc.fontSize(11).text(
    'Please fill in, sign, and upload this form during registration. ' +
      'Registration will not be completed without a signed declaration.',
    { align: 'left' }
  );
  doc.moveDown(1);

  const line = (label) => {
    doc.fontSize(11).text(label, { continued: false });
    doc.moveTo(doc.x, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);
  };

  line('Full Name / שם מלא:');
  line('ID Number / ת.ז:');
  line('Date of Birth / תאריך לידה:');
  line('Phone / טלפון:');
  line('Emergency Contact / איש קשר לחירום:');

  doc.moveDown(0.5);
  doc
    .fontSize(12)
    .text('Declaration / הצהרה:', { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(10).text(
    '1. I declare that I am in good health and have no medical condition that prevents me from participating in a competitive padel tournament.\n' +
      '2. I participate in the tournament at my own responsibility.\n' +
      '3. I confirm that I have consulted a physician if required.\n' +
      '4. I am aware of the physical effort involved in the event.',
    { align: 'left', lineGap: 4 }
  );

  doc.moveDown(2);
  line('Signature / חתימה:');
  line('Date / תאריך:');

  doc.moveDown(2);
  doc
    .fontSize(9)
    .fillColor('#666')
    .text(
      'Tournament Padel Hadera — Official Health Declaration',
      { align: 'center' }
    );

  doc.end();
});

// --- ולידציה צד-שרת להרשמה ---
function validateRegistration(body) {
  const errors = [];
  const {
    fullName,
    phone,
    email,
    category,
    partnerName,
    partnerPhone,
    consent,
    healthConsent
  } = body;

  if (!fullName || fullName.trim().length < 2)
    errors.push('שם מלא חסר או קצר מדי.');
  if (!/^0\d{1,2}-?\d{7}$|^0\d{8,9}$|^\+972\d{8,9}$/.test((phone || '').replace(/\s/g, '')))
    errors.push('מספר טלפון לא תקין.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || ''))
    errors.push('כתובת מייל לא תקינה.');
  if (!category) errors.push('יש לבחור קטגוריה.');
  if (!partnerName || partnerName.trim().length < 2)
    errors.push('שם השותף/ה חסר.');
  if (!partnerPhone) errors.push('טלפון השותף/ה חסר.');
  if (consent !== 'on' && consent !== 'true' && consent !== true)
    errors.push('יש לאשר את תנאי ההשתתפות.');
  if (healthConsent !== 'on' && healthConsent !== 'true' && healthConsent !== true)
    errors.push('יש לאשר את הצהרת הבריאות.');

  return errors;
}

// ולידציה נוספת על הקובץ שהועלה - שם קובץ הגיוני
function validateHealthFile(file) {
  const errors = [];
  if (!file) {
    errors.push('חובה לצרף קובץ הצהרת בריאות חתום.');
    return errors;
  }
  if (file.size < 10 * 1024) {
    errors.push('הקובץ קטן מדי - נראה שאינו הצהרה תקינה.');
  }
  if (file.size > 8 * 1024 * 1024) {
    errors.push('הקובץ גדול מדי (מעל 8MB).');
  }
  return errors;
}

// --- נקודת קצה: הרשמה ---
app.post('/api/register', (req, res) => {
  upload.single('healthFile')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res
        .status(400)
        .json({ ok: false, errors: [uploadErr.message] });
    }

    const fieldErrors = validateRegistration(req.body);
    const fileErrors = validateHealthFile(req.file);
    const allErrors = [...fieldErrors, ...fileErrors];

    if (allErrors.length) {
      // נקה קובץ שהועלה במידה וולידציה נכשלה
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ ok: false, errors: allErrors });
    }

    const {
      fullName,
      phone,
      email,
      category,
      partnerName,
      partnerPhone,
      notes
    } = req.body;

    const registrationId =
      'HDR-' + Date.now().toString(36).toUpperCase() +
      '-' + crypto.randomBytes(2).toString('hex').toUpperCase();

    // הכנת תוכן המייל למארגן
    const adminHtml = `
      <div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">
        <h2 style="color:#0a3d2a">הרשמה חדשה - טורניר פאדל חדרה</h2>
        <p><b>מזהה הרשמה:</b> ${registrationId}</p>
        <hr>
        <p><b>שם מלא:</b> ${escapeHtml(fullName)}</p>
        <p><b>טלפון:</b> ${escapeHtml(phone)}</p>
        <p><b>מייל:</b> ${escapeHtml(email)}</p>
        <p><b>קטגוריה:</b> ${escapeHtml(category)}</p>
        <p><b>שם שותף/ה:</b> ${escapeHtml(partnerName)}</p>
        <p><b>טלפון שותף/ה:</b> ${escapeHtml(partnerPhone)}</p>
        ${notes ? `<p><b>הערות:</b> ${escapeHtml(notes)}</p>` : ''}
        <hr>
        <p><b>קובץ הצהרת בריאות:</b> ${escapeHtml(req.file.originalname)} (${Math.round(req.file.size / 1024)}KB)</p>
        <p style="color:#666;font-size:12px">התקבל ב- ${new Date().toLocaleString('he-IL')}</p>
      </div>
    `;

    const userHtml = `
      <div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7">
        <h2 style="color:#0a3d2a">ההרשמה התקבלה! 🎾</h2>
        <p>היי ${escapeHtml(fullName)},</p>
        <p>קיבלנו את ההרשמה שלך לטורניר <b>פאדל חדרה</b>.</p>
        <p><b>מזהה הרשמה:</b> ${registrationId}</p>
        <p>הצוות שלנו יחזור אליך בימים הקרובים עם כל הפרטים הסופיים - שעות, מגרש, ולוח המשחקים.</p>
        <p>מחכים לראות אותך על המגרש!</p>
        <p style="color:#666;font-size:13px">במידה ולא נרשמת - אפשר להתעלם מהמייל.</p>
      </div>
    `;

    const transport = buildTransport();
    const adminEmail = process.env.ADMIN_EMAIL;
    const mailSkipped = !transport || !adminEmail || adminEmail === 'to_be_provided_by_user';

    if (!mailSkipped) {
      try {
        await transport.sendMail({
          from: `"טורניר פאדל חדרה" <${process.env.SMTP_USER}>`,
          to: adminEmail,
          subject: `הרשמה חדשה - ${fullName} (${category})`,
          html: adminHtml,
          attachments: [
            {
              filename: req.file.originalname,
              path: req.file.path
            }
          ]
        });

        await transport.sendMail({
          from: `"טורניר פאדל חדרה" <${process.env.SMTP_USER}>`,
          to: email,
          subject: 'אישור הרשמה - טורניר פאדל חדרה',
          html: userHtml
        });
      } catch (mailErr) {
        console.error('שגיאת שליחת מייל:', mailErr.message);
        // ההרשמה נשמרה אך המייל נכשל - נודיע ללקוח בהצלחה חלקית
        return res.json({
          ok: true,
          registrationId,
          warning: 'ההרשמה נקלטה אך לא נשלח מייל אישור. הצוות יצור איתך קשר.'
        });
      }
    } else {
      console.log('[MAIL SKIPPED] SMTP/ADMIN_EMAIL לא מוגדר. הרשמה נשמרה:', registrationId);
    }

    // שומר לוג פשוט כגיבוי לוקאלי
    const logLine = JSON.stringify({
      id: registrationId,
      at: new Date().toISOString(),
      fullName, phone, email, category, partnerName, partnerPhone,
      file: req.file.filename
    }) + '\n';
    fs.appendFile(path.join(__dirname, 'registrations.log'), logLine, () => {});

    res.json({ ok: true, registrationId });
  });
});

// --- עוזר: הגנה מפני הזרקת HTML במיילים ---
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- טיפול בשגיאות כלליות ---
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, errors: ['שגיאת שרת. נסה שוב מאוחר יותר.'] });
});

app.listen(PORT, () => {
  console.log(`🎾 טורניר פאדל חדרה — השרת רץ על http://localhost:${PORT}`);
  if (!process.env.ADMIN_EMAIL || process.env.ADMIN_EMAIL === 'to_be_provided_by_user') {
    console.log('⚠️  ADMIN_EMAIL לא הוגדר ב-.env - הרשמות יישמרו אך לא יישלח מייל.');
  }
});
