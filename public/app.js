// לוגיקת הלקוח: הצגת קיבולת, הרשמה, זרימת תשלום ב-bit, העלאת אסמכתא, הצגת סטטוס.

document.getElementById('yr').textContent = new Date().getFullYear();

// ==== reveal on scroll ====
(function setupReveal() {
  const targets = document.querySelectorAll('.section, .reveal, .card, .cat, .steps li, .health-step, .price-card, .gphoto, .contact-card');
  targets.forEach(t => { if (!t.classList.contains('reveal')) t.classList.add('reveal'); });
  if (!('IntersectionObserver' in window)) {
    targets.forEach(t => t.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  targets.forEach(t => io.observe(t));
})();

// ==== parallax קטן על hero ====
(function setupParallax() {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (y < window.innerHeight) {
          hero.style.backgroundPosition = `center ${y * 0.3}px`;
        }
        ticking = false;
      });
      ticking = true;
    }
  });
})();

const cfg = window.PADEL_CONFIG || {};

// קישורים להצהרת הבריאות
for (const id of ['healthFormLink', 'healthFormLink2']) {
  const el = document.getElementById(id);
  if (el && cfg.HEALTH_FORM_URL) el.href = cfg.HEALTH_FORM_URL;
}

// --- מצב קיבולת ---
(async function loadCapacity() {
  try {
    const r = await fetch('/api/capacity');
    const j = await r.json();
    const badge = document.getElementById('capacityBadge');
    const text = document.getElementById('capacityText');
    if (!badge || !text) return;
    badge.hidden = false;
    if (j.full) {
      text.textContent = `הטורניר מלא · נרשמים נכנסים לרשימת המתנה (${j.reserved}/${j.maxPairs})`;
      badge.classList.add('cap-full');
    } else {
      text.textContent = `נותרו ${j.remaining} מקומות מתוך ${j.maxPairs} זוגות`;
    }
  } catch {}
})();

// --- טופס הרשמה ---
const form = document.getElementById('regForm');
const fileInput = document.getElementById('healthFile');
const dropZone = document.getElementById('dropZone');
const dropFile = document.getElementById('dropFile');
const dropText = dropZone.querySelector('.drop-text');
const errorsBox = document.getElementById('formErrors');
const submitBtn = document.getElementById('submitBtn');
const thankyou = document.getElementById('thankyou');

const ALLOWED_EXT = ['pdf','jpg','jpeg','png'];
const MAX_SIZE = 8 * 1024 * 1024;

['dragenter','dragover'].forEach(ev =>
  dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.add('drag'); })
);
['dragleave','drop'].forEach(ev =>
  dropZone.addEventListener(ev, e => { e.preventDefault(); dropZone.classList.remove('drag'); })
);
dropZone.addEventListener('drop', e => {
  if (e.dataTransfer.files.length) {
    fileInput.files = e.dataTransfer.files;
    handleHealthSelected();
  }
});
fileInput.addEventListener('change', handleHealthSelected);

function handleHealthSelected() {
  const f = fileInput.files[0];
  if (!f) return;
  const err = validateFile(f);
  if (err) { showErrors(errorsBox, [err]); fileInput.value = ''; return; }
  errorsBox.hidden = true;
  dropText.style.display = 'none';
  dropFile.hidden = false;
  dropFile.textContent = `✓ ${f.name} (${Math.round(f.size/1024)}KB)`;
}

function validateFile(f) {
  const ext = f.name.split('.').pop().toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return 'סוג קובץ לא חוקי. PDF / JPG / PNG בלבד.';
  if (f.size > MAX_SIZE) return `הקובץ גדול מדי (${Math.round(f.size/1024/1024)}MB). מקסימום 8MB.`;
  if (f.size < 10 * 1024) return 'הקובץ קטן מדי — לא נראה תקין.';
  return null;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const errs = clientValidate();
  if (errs.length) return showErrors(errorsBox, errs);

  submitBtn.disabled = true;
  submitBtn.textContent = 'שולח הרשמה...';
  errorsBox.hidden = true;

  const data = new FormData(form);
  // צ'קבוקסים — לוודא ערך "on" לשרת
  ['healthConsent','consent','paymentAck'].forEach(n => {
    if (form.elements[n]?.checked) data.set(n, 'on');
  });

  try {
    const res = await fetch('/api/register', { method: 'POST', body: data });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      showErrors(errorsBox, json.errors || ['שגיאה בשליחה. נסה/י שוב.']);
      submitBtn.disabled = false;
      submitBtn.textContent = 'שליחת הרשמה';
      return;
    }
    form.hidden = true;
    openThankYou(json, Object.fromEntries(data.entries()));
  } catch {
    showErrors(errorsBox, ['שגיאת רשת. בדוק/י חיבור ונסה/י שוב.']);
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
  if (!['2.5','3'].includes(v('level'))) errs.push('יש לבחור רמה.');
  if (v('partnerName').length < 2) errs.push('שם שותף/ה חסר.');
  const pPhone = v('partnerPhone').replace(/[\s-]/g,'');
  if (!/^(0\d{8,9}|\+972\d{8,9})$/.test(pPhone)) errs.push('טלפון שותף/ה לא תקין.');
  if (!fileInput.files.length) errs.push('חובה להעלות הצהרת בריאות חתומה.');
  if (!form.elements['healthConsent'].checked) errs.push('יש לאשר שהצהרת הבריאות חתומה.');
  if (!form.elements['consent'].checked) errs.push('יש לאשר את תנאי ההשתתפות.');
  if (!form.elements['paymentAck'].checked) errs.push('יש לאשר את מדיניות התשלום.');
  return errs;
}

// --- מסך תודה + זרימת תשלום ---
const STATUS_HE = {
  submitted: 'נקלטה',
  awaiting_payment: 'ממתין לתשלום',
  payment_under_review: 'תשלום בבדיקה',
  paid_confirmed: 'תשלום אושר',
  approved: 'ההרשמה אושרה',
  waitlist: 'רשימת המתנה',
  cancelled: 'בוטל',
  refund_pending: 'ממתין להחזר',
  refunded: 'החזר הושלם'
};

function openThankYou(json, formData) {
  thankyou.hidden = false;
  document.getElementById('regId').textContent = json.id;
  document.getElementById('tyStatus').textContent = STATUS_HE[json.status] || json.status;

  // אם ברשימת המתנה — להסתיר את אזור התשלום
  const payBox = document.getElementById('payBox');
  if (json.status === 'waitlist') {
    payBox.hidden = true;
    document.getElementById('tyHeading').textContent = 'נכנסת לרשימת המתנה';
  } else {
    fillBitDetails(json.id, formData);
    wirePaymentUpload(json.id);
  }

  wireContactButtons(json.id, formData);
  thankyou.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function fillBitDetails(regId, d) {
  document.getElementById('payName').textContent  = cfg.BIT_RECIPIENT_NAME  || 'צוות הטורניר';
  document.getElementById('payPhone').textContent = cfg.BIT_RECIPIENT_PHONE || '—';
  document.getElementById('payRef').textContent   = `${regId} · ${d.fullName || ''}`;

  if (cfg.BIT_GROUP_LINK) {
    const gb = document.getElementById('bitGroupBtn');
    gb.href = cfg.BIT_GROUP_LINK;
    gb.hidden = false;
  }

  document.getElementById('copyPayBtn').addEventListener('click', async () => {
    const msg =
      `תשלום טורניר פאדל חדרה\n` +
      `נמען: ${cfg.BIT_RECIPIENT_NAME || ''}\n` +
      `bit: ${cfg.BIT_RECIPIENT_PHONE || ''}\n` +
      `סכום: 500 ש"ח לזוג\n` +
      `הערה בתשלום: ${regId} · ${d.fullName || ''}`;
    try { await navigator.clipboard.writeText(msg); }
    catch { fallbackCopy(msg); }
    const b = document.getElementById('copyPayBtn');
    b.textContent = '✓ הועתק!';
    setTimeout(() => b.textContent = '📋 העתקת פרטי התשלום', 2200);
  });
}

function wirePaymentUpload(regId) {
  const payForm = document.getElementById('payForm');
  const payFile = document.getElementById('payFile');
  const payFileLbl = document.getElementById('payFileLbl');
  const payDrop = document.getElementById('payDrop');
  const payErrors = document.getElementById('payErrors');
  const payBtn = document.getElementById('payBtn');

  payFile.addEventListener('change', () => {
    const f = payFile.files[0];
    if (!f) return;
    const err = validateFile(f);
    if (err) { showErrors(payErrors, [err]); payFile.value = ''; return; }
    payErrors.hidden = true;
    payDrop.querySelector('.drop-text').style.display = 'none';
    payFileLbl.hidden = false;
    payFileLbl.textContent = `✓ ${f.name}`;
  });

  payForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!payFile.files.length) return showErrors(payErrors, ['יש לצרף צילום מסך של התשלום.']);
    payBtn.disabled = true;
    payBtn.textContent = 'שולח...';
    const fd = new FormData();
    fd.append('paymentFile', payFile.files[0]);
    try {
      const res = await fetch('/api/payment-proof/' + encodeURIComponent(regId), { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        showErrors(payErrors, json.errors || ['שליחה נכשלה.']);
        payBtn.disabled = false;
        payBtn.textContent = 'שליחת אסמכתא';
        return;
      }
      payForm.innerHTML =
        '<div class="pay-ok">✓ האסמכתא התקבלה. הסטטוס עודכן ל"תשלום בבדיקה".<br/>' +
        'נעדכן אותך במייל ברגע שהתשלום יאושר סופית.</div>';
      document.getElementById('tyStatus').textContent = STATUS_HE[json.status] || json.status;
    } catch {
      showErrors(payErrors, ['שגיאת רשת. נסה/י שוב.']);
      payBtn.disabled = false;
      payBtn.textContent = 'שליחת אסמכתא';
    }
  });
}

function wireContactButtons(regId, d) {
  const message =
    'שלום, נרשמתי לטורניר פאדל חדרה 🎾\n\n' +
    'שם מלא: ' + (d.fullName || '') + '\n' +
    'טלפון: ' + (d.phone || '') + '\n' +
    'רמה: ' + (d.level || '') + '\n' +
    'שותף/ה: ' + (d.partnerName || '') + ' · ' + (d.partnerPhone || '') + '\n' +
    'מזהה הרשמה: ' + regId + '\n\n' +
    'העליתי הצהרת בריאות חתומה דרך האתר. אשמח לאישור ופרטי תשלום.';
  const encoded = encodeURIComponent(message);
  const waBtn = document.getElementById('waBtn');
  if (cfg.ORGANIZER_WHATSAPP) {
    const num = String(cfg.ORGANIZER_WHATSAPP).replace(/[^\d]/g, '');
    waBtn.href = `https://wa.me/${num}?text=${encoded}`;
  } else {
    waBtn.href = `https://wa.me/?text=${encoded}`;
  }
  const gb = document.getElementById('waGroupBtn');
  if (cfg.GROUP_INVITE_LINK) { gb.href = cfg.GROUP_INVITE_LINK; gb.hidden = false; }
}

function showErrors(box, list) {
  box.innerHTML = '<b>בדקו את הפרטים הבאים:</b><ul>' +
    list.map(x => `<li>${x}</li>`).join('') + '</ul>';
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch {}
  ta.remove();
}
