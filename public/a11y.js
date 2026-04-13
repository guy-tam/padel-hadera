// Padel Platform — Widget נגישות (תואם לדרישות חוק הנגישות הישראלי / WCAG 2.1 AA)
// אפשרויות: הגדלת טקסט, ניגודיות, גווני אפור, הדגשת קישורים, פונט קריא,
// עצירת אנימציות, סמן מוגדל, הקראה, איפוס.

(function () {
  if (window.__a11yLoaded) return;
  window.__a11yLoaded = true;

  // v2: איפוס חד-פעמי — משתמשים שנתקעו על "גווני אפור" יחזרו למצב רגיל
  const STATE_KEY = 'a11y_state_v2';
  try { localStorage.removeItem('a11y_state_v1'); } catch {}
  const DEFAULT = {
    fontSize: 100,    // 100/115/130/150
    contrast: 'none', // none/high/reverse
    grayscale: false,
    linkUnderline: false,
    readable: false,
    stopAnim: false,
    bigCursor: false,
    focusHighlight: false,
    speech: false
  };
  const state = Object.assign({}, DEFAULT, loadState());

  // ---- יצירת הכפתור הצף והפאנל ----
  const btn = document.createElement('button');
  btn.id = 'a11y-fab';
  btn.setAttribute('aria-label', 'פתיחת תפריט נגישות');
  btn.setAttribute('aria-haspopup', 'dialog');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = '<span aria-hidden="true">♿</span>';
  document.body.appendChild(btn);

  const panel = document.createElement('div');
  panel.id = 'a11y-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'תפריט נגישות');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('hidden', '');
  panel.innerHTML = `
    <div class="a11y-head">
      <h2>נגישות</h2>
      <button type="button" class="a11y-close" aria-label="סגירה">✕</button>
    </div>
    <div class="a11y-body">
      <div class="a11y-row">
        <label>גודל טקסט</label>
        <div class="a11y-seg">
          <button data-act="font" data-val="100">רגיל</button>
          <button data-act="font" data-val="115">גדול</button>
          <button data-act="font" data-val="130">גדול יותר</button>
          <button data-act="font" data-val="150">ענקי</button>
        </div>
      </div>
      <div class="a11y-row">
        <label>ניגודיות</label>
        <div class="a11y-seg">
          <button data-act="contrast" data-val="none">רגילה</button>
          <button data-act="contrast" data-val="high">גבוהה</button>
          <button data-act="contrast" data-val="reverse">הפוכה</button>
        </div>
      </div>
      <div class="a11y-toggles">
        <button data-act="grayscale">גווני אפור</button>
        <button data-act="linkUnderline">הדגשת קישורים</button>
        <button data-act="readable">פונט קריא</button>
        <button data-act="stopAnim">עצירת אנימציות</button>
        <button data-act="bigCursor">סמן מוגדל</button>
        <button data-act="focusHighlight">הדגשת מוקד</button>
        <button data-act="speech">הקראה בלחיצה</button>
      </div>
      <div class="a11y-foot">
        <button type="button" class="a11y-reset">איפוס הגדרות</button>
        <a class="a11y-statement" href="/accessibility">הצהרת נגישות</a>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // ---- Skip-to-content ----
  if (!document.querySelector('.skip-to-main')) {
    const skip = document.createElement('a');
    skip.href = '#main';
    skip.className = 'skip-to-main';
    skip.textContent = 'דלג/י לתוכן המרכזי';
    document.body.insertBefore(skip, document.body.firstChild);
  }

  // ---- ארגומנטים ----
  btn.addEventListener('click', togglePanel);
  panel.querySelector('.a11y-close').addEventListener('click', closePanel);
  panel.querySelector('.a11y-reset').addEventListener('click', resetAll);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) closePanel();
  });

  panel.querySelectorAll('button[data-act]').forEach(b => {
    b.addEventListener('click', () => onAction(b.dataset.act, b.dataset.val));
  });

  // ---- הקראה בלחיצה ----
  let speakHandler = null;
  function wireSpeech(on) {
    if (on && !speakHandler) {
      speakHandler = (e) => {
        if (e.target.closest('#a11y-panel') || e.target.closest('#a11y-fab')) return;
        const text = e.target.innerText || e.target.textContent;
        if (!text || text.length < 2) return;
        speak(text.slice(0, 600));
      };
      document.addEventListener('click', speakHandler, { capture: true });
    } else if (!on && speakHandler) {
      document.removeEventListener('click', speakHandler, { capture: true });
      speakHandler = null;
      speechSynthesis.cancel();
    }
  }
  function speak(text) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'he-IL';
      u.rate = 1;
      speechSynthesis.speak(u);
    } catch {}
  }

  function onAction(act, val) {
    if (act === 'font') state.fontSize = parseInt(val, 10);
    else if (act === 'contrast') state.contrast = val;
    else state[act] = !state[act];
    apply();
    saveState();
  }

  function apply() {
    const root = document.documentElement;
    root.style.setProperty('--a11y-font-scale', (state.fontSize / 100).toString());
    root.classList.toggle('a11y-c-high', state.contrast === 'high');
    root.classList.toggle('a11y-c-reverse', state.contrast === 'reverse');
    root.classList.toggle('a11y-grayscale', !!state.grayscale);
    root.classList.toggle('a11y-link-underline', !!state.linkUnderline);
    root.classList.toggle('a11y-readable', !!state.readable);
    root.classList.toggle('a11y-stop-anim', !!state.stopAnim);
    root.classList.toggle('a11y-big-cursor', !!state.bigCursor);
    root.classList.toggle('a11y-focus-highlight', !!state.focusHighlight);
    wireSpeech(state.speech);

    // סימון כפתורים פעילים
    panel.querySelectorAll('button[data-act]').forEach(b => {
      const act = b.dataset.act;
      const val = b.dataset.val;
      let active = false;
      if (act === 'font') active = parseInt(val,10) === state.fontSize;
      else if (act === 'contrast') active = val === state.contrast;
      else active = !!state[act];
      b.classList.toggle('on', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function togglePanel() {
    if (panel.hidden) openPanel(); else closePanel();
  }
  function openPanel() {
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    panel.querySelector('.a11y-close').focus();
  }
  function closePanel() {
    panel.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.focus();
  }
  function resetAll() {
    Object.assign(state, DEFAULT);
    apply();
    saveState();
  }

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; }
    catch { return {}; }
  }
  function saveState() {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {}
  }

  apply();

  // ---- כפתור "חזרה לתפריט ראשי" (בכל דף שאינו הבית) ----
  (function addBackHome() {
    if (location.pathname === '/' || location.pathname === '') return;
    if (document.getElementById('back-home-fab')) return;
    const a = document.createElement('a');
    a.id = 'back-home-fab';
    a.href = '/';
    a.setAttribute('aria-label', 'חזרה לתפריט הראשי');
    a.innerHTML = '<span aria-hidden="true">🏠</span> תפריט ראשי';
    document.body.appendChild(a);
  })();
})();
