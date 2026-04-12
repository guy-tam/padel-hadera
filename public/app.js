// לוגיקת הלקוח: העלאת קובץ, ולידציה, שליחת טופס ההרשמה.

document.getElementById('yr').textContent = new Date().getFullYear();

const form = document.getElementById('regForm');
const fileInput = document.getElementById('healthFile');
const dropZone = document.getElementById('dropZone');
const dropFile = document.getElementById('dropFile');
const dropText = dropZone.querySelector('.drop-text');
const errorsBox = document.getElementById('formErrors');
const submitBtn = document.getElementById('submitBtn');
const thankyou = document.getElementById('thankyou');
const regIdOut = document.getElementById('regId');

const ALLOWED_EXT = ['pdf','jpg','jpeg','png'];
const MAX_SIZE = 8 * 1024 * 1024;

// ====== העלאת קובץ: drag & drop + ולידציה מיידית ======
['dragenter','dragover'].forEach(ev =>
  dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag'); })
);
['dragleave','drop'].forEach(ev =>
  dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('drag'); })
);
dropZone.addEventListener('drop', e => {
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    handleFileSelected();
  }
});
fileInput.addEventListener('change', handleFileSelected);

function handleFileSelected() {
  const f = fileInput.files[0];
  if (!f) return;
  const ext = f.name.split('.').pop().toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    showErrors(['סוג קובץ לא חוקי. יש להעלות PDF / JPG / PNG בלבד.']);
    fileInput.value = '';
    return;
  }
  if (f.size > MAX_SIZE) {
    showErrors([`הקובץ גדול מדי (${Math.round(f.size/1024/1024)}MB). מקסימום 8MB.`]);
    fileInput.value = '';
    return;
  }
  if (f.size < 10 * 1024) {
    showErrors(['הקובץ קטן מדי - לא נראה כמו הצהרה תקינה.']);
    fileInput.value = '';
    return;
  }
  errorsBox.hidden = true;
  dropText.style.display = 'none';
  dropFile.hidden = false;
  dropFile.textContent = `✓ ${f.name} (${Math.round(f.size/1024)}KB)`;
}

// ====== שליחת הטופס ======
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const errs = clientValidate();
  if (errs.length) return showErrors(errs);

  submitBtn.disabled = true;
  submitBtn.textContent = 'שולח הרשמה...';
  errorsBox.hidden = true;

  const data = new FormData(form);

  try {
    const res = await fetch('/api/register', { method: 'POST', body: data });
    const json = await res.json();

    if (!res.ok || !json.ok) {
      showErrors(json.errors || ['שגיאה בשליחה. נסה שוב.']);
      submitBtn.disabled = false;
      submitBtn.textContent = 'שליחת הרשמה';
      return;
    }

    form.hidden = true;
    thankyou.hidden = false;
    regIdOut.textContent = json.registrationId;
    wireWhatsApp(json.registrationId, Object.fromEntries(data.entries()));
    thankyou.scrollIntoView({ behavior: 'smooth', block: 'start' });

    if (json.warning) {
      const w = document.createElement('p');
      w.style.cssText = 'background:rgba(255,200,0,0.15);padding:10px;border-radius:8px;color:#ffd34d';
      w.textContent = json.warning;
      thankyou.appendChild(w);
    }
  } catch (err) {
    showErrors(['שגיאת רשת. בדוק חיבור ונסה שוב.']);
    submitBtn.disabled = false;
    submitBtn.textContent = 'שליחת הרשמה';
  }
});

function clientValidate() {
  const errs = [];
  const v = (n) => (form.elements[n]?.value || '').trim();
  if (v('fullName').length < 2) errs.push('שם מלא חסר.');
  const phone = v('phone').replace(/[\s-]/g,'');
  if (!/^(0\d{8,9}|\+972\d{8,9})$/.test(phone)) errs.push('טלפון לא תקין (לדוגמה 050-1234567).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) errs.push('מייל לא תקין.');
  if (!v('category')) errs.push('יש לבחור קטגוריה.');
  if (v('partnerName').length < 2) errs.push('שם שותף/ה חסר.');
  if (v('partnerPhone').length < 8) errs.push('טלפון שותף/ה חסר.');
  if (!fileInput.files.length) errs.push('חובה להעלות הצהרת בריאות חתומה.');
  if (!form.elements['healthConsent'].checked) errs.push('יש לאשר שהצהרת הבריאות חתומה.');
  if (!form.elements['consent'].checked) errs.push('יש לאשר את תנאי ההשתתפות.');
  return errs;
}

// ====== זרימת WhatsApp: בניית הודעה, פתיחת wa.me, העתקה, קישור לקבוצה ======
function buildWhatsAppMessage(regId, d) {
  return (
    'שלום, נרשמתי לטורניר פאדל חדרה 🎾\n\n' +
    'שם מלא: ' + (d.fullName || '') + '\n' +
    'טלפון: ' + (d.phone || '') + '\n' +
    'אימייל: ' + (d.email || '') + '\n' +
    'קטגוריה: ' + (d.category || '') + '\n' +
    'שותף/ה: ' + (d.partnerName || '') + ' · ' + (d.partnerPhone || '') + '\n' +
    (d.notes ? 'הערות: ' + d.notes + '\n' : '') +
    'הצהרת בריאות הועלתה דרך האתר ✔\n' +
    'מזהה הרשמה: ' + regId + '\n\n' +
    'אשמח לאישור הרשמה ופרטי תשלום. תודה!'
  );
}

function wireWhatsApp(regId, formData) {
  const cfg = window.PADEL_CONFIG || {};
  const message = buildWhatsAppMessage(regId, formData);
  const encoded = encodeURIComponent(message);

  const waBtn = document.getElementById('waBtn');
  const waGroupBtn = document.getElementById('waGroupBtn');
  const copyBtn = document.getElementById('copyBtn');

  // כפתור WhatsApp ראשי
  if (cfg.ORGANIZER_WHATSAPP) {
    const num = String(cfg.ORGANIZER_WHATSAPP).replace(/[^\d]/g, '');
    waBtn.href = `https://wa.me/${num}?text=${encoded}`;
  } else {
    // ללא מספר — נפתח WhatsApp עם ההודעה מוכנה, המשתמש בוחר נמען
    waBtn.href = `https://wa.me/?text=${encoded}`;
  }

  // כפתור הצטרפות לקבוצה
  if (cfg.GROUP_INVITE_LINK) {
    waGroupBtn.href = cfg.GROUP_INVITE_LINK;
    waGroupBtn.hidden = false;
  }

  // כפתור העתקה לקליפבורד
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(message);
      copyBtn.textContent = '✓ הועתק!';
      setTimeout(() => copyBtn.textContent = '📋 העתקת פרטי ההרשמה', 2200);
    } catch {
      // fallback ידני
      const ta = document.createElement('textarea');
      ta.value = message;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      copyBtn.textContent = '✓ הועתק!';
      setTimeout(() => copyBtn.textContent = '📋 העתקת פרטי ההרשמה', 2200);
    }
  }, { once: false });
}

function showErrors(list) {
  errorsBox.innerHTML = '<b>בדקו את הפרטים הבאים:</b><ul>' +
    list.map(x => `<li>${x}</li>`).join('') + '</ul>';
  errorsBox.hidden = false;
  errorsBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
