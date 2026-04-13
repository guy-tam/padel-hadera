// Padel Platform — Magic layer: Lenis + GSAP + Tilt + cursor glow + magnetic buttons
// טעינה עצלה של פלאגינים מ-CDN (חינמיים, open source)

(function () {
  if (window.__magicLoaded) return;
  window.__magicLoaded = true;

  // Nav scroll elevation — עובד גם ב-reduce-motion (לא מפריע)
  const navEl = document.querySelector('.pnav, .nav');
  if (navEl) {
    const onScroll = () => {
      navEl.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Keyboard user detection — מוסיף class ל-body כשיש ניווט במקלדת (Tab)
  function onFirstTab(e) {
    if (e.key === 'Tab') {
      document.body.classList.add('user-is-tabbing');
      window.removeEventListener('keydown', onFirstTab);
      window.addEventListener('mousedown', () => {
        document.body.classList.remove('user-is-tabbing');
        window.addEventListener('keydown', onFirstTab, { once: false });
      }, { once: true });
    }
  }
  window.addEventListener('keydown', onFirstTab);

  // ============================================================
  // שכבת מובייל: התמצאות + פעולה צפה + סרגל התקדמות
  // רצה בכל המכשירים, גם ב-reduce-motion
  // ============================================================
  const isMobile = () => window.matchMedia('(max-width: 720px)').matches;

  // --- סרגל התקדמות עליון ---
  function initScrollProgress() {
    if (document.querySelector('.scroll-progress')) return;
    const bar = document.createElement('div');
    bar.className = 'scroll-progress';
    bar.setAttribute('aria-hidden', 'true');
    document.body.appendChild(bar);
    let ticking = false;
    const update = () => {
      const h = document.documentElement;
      const max = (h.scrollHeight - h.clientHeight) || 1;
      const pct = Math.min(100, Math.max(0, (h.scrollTop / max) * 100));
      bar.style.setProperty('--sp', pct + '%');
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }
  initScrollProgress();

  // --- Chip nav אוטומטי לעמודים ארוכים במובייל ---
  function initSectionChips() {
    if (!isMobile()) return;
    if (document.querySelector('.section-chips')) return;

    // אתר סקשנים ראויים: <section id="..."> עם h2, לפחות 3 מהם
    const sections = Array.from(document.querySelectorAll('main section[id], section[id]'))
      .filter(s => {
        const h = s.querySelector('h2, h1');
        return h && s.id && s.id !== 'top' && s.id !== 'main';
      });
    if (sections.length < 3) return;

    // מיפוי שם קצר לכל סקשן (מועדף: data-nav-label, אח"כ h2 קצר)
    const LABEL_OVERRIDES = {
      about: 'על הטורניר',
      how: 'איך נרשמים',
      format: 'פורמט',
      levels: 'רמות',
      prices: 'מחיר',
      health: 'בריאות',
      bring: 'מה להביא',
      register: 'הרשמה',
      contact: 'צור קשר',
      refund: 'ביטול',
    };
    const items = sections.map(s => {
      const id = s.id;
      let label = s.dataset.navLabel || LABEL_OVERRIDES[id];
      if (!label) {
        const h = s.querySelector('h2, h1');
        label = (h?.textContent || id).trim();
        if (label.length > 16) label = label.split(/\s|·|\||–|—/)[0];
      }
      return { id, label, el: s };
    });
    if (items.length < 3) return;

    const nav = document.createElement('nav');
    nav.className = 'section-chips';
    nav.setAttribute('aria-label', 'ניווט בין מקטעי העמוד');
    items.forEach(it => {
      const a = document.createElement('a');
      a.href = '#' + it.id;
      a.textContent = it.label;
      a.dataset.target = it.id;
      nav.appendChild(a);
    });

    // הזרק אחרי ה-nav (sticky yoke) או בתחילת main
    const header = document.querySelector('.pnav, .nav');
    if (header && header.parentNode) {
      header.insertAdjacentElement('afterend', nav);
    } else {
      document.body.insertBefore(nav, document.body.firstChild);
    }

    document.body.classList.add('has-section-chips');
    requestAnimationFrame(() => nav.classList.add('is-ready'));

    // מעקב סקשן פעיל
    const chipMap = new Map();
    nav.querySelectorAll('a').forEach(a => chipMap.set(a.dataset.target, a));
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const chip = chipMap.get(e.target.id);
          if (!chip) return;
          nav.querySelectorAll('a.is-active').forEach(x => x.classList.remove('is-active'));
          chip.classList.add('is-active');
          // גלול את הצ'יפ למרכז הסרגל
          const left = chip.offsetLeft - nav.clientWidth / 2 + chip.clientWidth / 2;
          nav.scrollTo({ left, behavior: 'smooth' });
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
    items.forEach(it => io.observe(it.el));

    // חלק לחיצה על צ'יפ (ידנית כדי להתחשב בגובה ה-chips עצמו)
    nav.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-target]');
      if (!a) return;
      e.preventDefault();
      const target = document.getElementById(a.dataset.target);
      if (!target) return;
      const headerH = (document.querySelector('.pnav, .nav')?.offsetHeight || 0) + nav.offsetHeight + 6;
      const top = target.getBoundingClientRect().top + window.scrollY - headerH;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  }

  // --- Mobile action bar: מוצג בעמודי טופס/הרשמה עם CTA ראשי ---
  function initMobileActionBar() {
    if (!isMobile()) return;
    if (document.querySelector('.mobile-action-bar')) return;

    // בחר CTA ראשי: a/button עם href=#register או class מרכזי
    const cta = document.querySelector('.hero-ctas .btn-primary, .p-hero-ctas .btn-primary, .phero-ctas .btn-primary');
    const formTarget = document.querySelector('#register, #regForm, .form-card, form');
    if (!cta && !formTarget) return;
    // אל תציג אם אנחנו בעמוד dashboard/admin (שם יש UI ייחודי)
    if (document.body.matches('.dashboard, [data-no-mab]')) return;
    if (/dashboard|admin/.test(location.pathname)) return;

    const bar = document.createElement('div');
    bar.className = 'mobile-action-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'פעולה מהירה');

    // metadata (סיכום חי) — משיכה מ-capacity badge אם קיים
    const cap = document.getElementById('capacityText');
    const meta = document.createElement('div');
    meta.className = 'mab-meta';
    meta.innerHTML = cap
      ? `<b>טורניר פעיל</b><br><span id="mab-cap">${cap.textContent || ''}</span>`
      : '<b>מוכנים להתחיל?</b><br>הרשמה מהירה ב-2 דקות';

    // הכפתור עצמו
    const btnText = (cta?.textContent?.trim()) || 'התחל עכשיו';
    let btnHref = cta?.getAttribute('href');
    if (!btnHref && formTarget) {
      btnHref = formTarget.id ? '#' + formTarget.id : '#';
      // הוסף id זמני אם אין
      if (!formTarget.id) { formTarget.id = 'mab-target'; btnHref = '#mab-target'; }
    }
    const btn = document.createElement('a');
    btn.className = 'btn btn-primary';
    btn.href = btnHref || '#';
    btn.textContent = btnText;
    btn.addEventListener('click', (e) => {
      const id = (btnHref || '').replace(/^#/, '');
      const t = id && document.getElementById(id);
      if (!t) return;
      e.preventDefault();
      const headerH = (document.querySelector('.pnav, .nav')?.offsetHeight || 0)
                    + (document.querySelector('.section-chips')?.offsetHeight || 0) + 10;
      const top = t.getBoundingClientRect().top + window.scrollY - headerH;
      window.scrollTo({ top, behavior: 'smooth' });
      // פוקוס לשדה הראשון של הטופס
      setTimeout(() => {
        const firstField = t.querySelector('input:not([type="hidden"]), select, textarea');
        firstField?.focus({ preventScroll: true });
      }, 500);
    });

    bar.appendChild(meta);
    bar.appendChild(btn);
    document.body.appendChild(bar);
    document.body.classList.add('has-mobile-action-bar');

    // הצג רק אחרי גלילה מעבר ל-hero (מונע כפילות עם כפתור ה-hero)
    const hero = document.querySelector('.hero, .p-hero, .phero');
    const showAfter = hero ? hero.offsetHeight * 0.75 : 200;
    let shown = false;
    const toggle = () => {
      const should = window.scrollY > showAfter;
      if (should !== shown) {
        bar.classList.toggle('is-ready', should);
        shown = should;
      }
      // עדכון capacity חי
      const capLive = document.getElementById('capacityText');
      const capMab = document.getElementById('mab-cap');
      if (capLive && capMab && capLive.textContent) capMab.textContent = capLive.textContent;
    };
    window.addEventListener('scroll', toggle, { passive: true });
    toggle();
  }

  // --- Back to top כפתור ---
  function initBackToTop() {
    if (document.querySelector('.to-top')) return;
    const btn = document.createElement('button');
    btn.className = 'to-top';
    btn.setAttribute('aria-label', 'חזרה לראש העמוד');
    btn.innerHTML = '↑';
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    document.body.appendChild(btn);
    const toggle = () => {
      btn.classList.toggle('is-visible', window.scrollY > 600);
    };
    window.addEventListener('scroll', toggle, { passive: true });
    toggle();
  }

  // --- סימון קישור nav פעיל לפי הנתיב ---
  function initActiveNavLink() {
    const path = location.pathname.replace(/\/$/, '') || '/';
    document.querySelectorAll('.pnav-links a, .nav-links a').forEach(a => {
      const href = a.getAttribute('href') || '';
      const clean = href.split('#')[0].split('?')[0].replace(/\/$/, '') || '/';
      if (clean === path) a.classList.add('is-active');
    });
  }

  // הפעל
  const runMobileLayer = () => {
    initSectionChips();
    initMobileActionBar();
    initBackToTop();
    initActiveNavLink();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runMobileLayer);
  } else {
    runMobileLayer();
  }

  // רענון ברוטציית מסך/שינוי breakpoint
  let lastMobile = isMobile();
  window.addEventListener('resize', () => {
    const now = isMobile();
    if (now !== lastMobile) {
      lastMobile = now;
      // הסר וביאור chips/mab כשעוברים לדסקטופ
      if (!now) {
        document.querySelector('.section-chips')?.remove();
        document.querySelector('.mobile-action-bar')?.remove();
        document.body.classList.remove('has-section-chips', 'has-mobile-action-bar');
      } else {
        runMobileLayer();
      }
    }
  }, { passive: true });

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  // טעינת סקריפטים עצלה
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.defer = true;
      s.onload = () => resolve();
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Cursor glow הוסר לפי בקשה

  // ============ Magnetic buttons ============
  function magnetize(el, strength = 0.35) {
    let rect = null;
    el.addEventListener('mouseenter', () => { rect = el.getBoundingClientRect(); });
    el.addEventListener('mousemove', e => {
      if (!rect) rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left - rect.width / 2;
      const my = e.clientY - rect.top - rect.height / 2;
      el.style.transform = `translate(${mx * strength}px, ${my * strength}px)`;
    });
    el.addEventListener('mouseleave', () => { el.style.transform = ''; rect = null; });
  }
  // דלג על מגנטיות במובייל/מגע — לא רלוונטי ומכביד
  if (!isMobile() && !matchMedia('(pointer: coarse)').matches) {
    document.querySelectorAll('.btn-primary, .pnav-cta, .four-card').forEach(b => magnetize(b, 0.15));
  }

  // ============ טעינה עצלה ממש של GSAP + Tilt + Lenis ============
  (async () => {
    try {
      // 1. Lenis smooth scroll — דסקטופ בלבד (במובייל פוגע ב-scroll-snap ובתחושת מגע)
      const skipLenis = isMobile() || matchMedia('(pointer: coarse)').matches;
      if (!skipLenis) await loadScript('https://cdn.jsdelivr.net/npm/lenis@1.1.20/dist/lenis.min.js');
      if (window.Lenis && !skipLenis) {
        const lenis = new window.Lenis({
          duration: 1.1,
          easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
          smoothWheel: true,
          wheelMultiplier: 1,
          touchMultiplier: 1.5
        });
        function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
        requestAnimationFrame(raf);
        document.documentElement.classList.add('lenis');
        window.__lenis = lenis;
      }

      // 2. GSAP + ScrollTrigger
      await loadScript('https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js');
      await loadScript('https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js');
      if (window.gsap && window.ScrollTrigger) {
        const gsap = window.gsap, ST = window.ScrollTrigger;
        gsap.registerPlugin(ST);

        // reveal for sections & cards
        gsap.utils.toArray('section h2, .eyebrow, .lead').forEach(el => {
          gsap.from(el, {
            y: 40, opacity: 0, duration: 0.9, ease: 'power3.out',
            scrollTrigger: { trigger: el, start: 'top 85%' }
          });
        });
        gsap.utils.toArray('.four-card, .aud, .t-card, .club-card, .bring-item, .stat, .pd-stat').forEach((el, i) => {
          gsap.from(el, {
            y: 50, opacity: 0, duration: 0.7, ease: 'power2.out',
            delay: (i % 4) * 0.05,
            scrollTrigger: { trigger: el, start: 'top 88%' }
          });
        });

        // counters (numbers animate when visible)
        gsap.utils.toArray('.pd-stat .n, .stat .n').forEach(el => {
          const target = parseInt(el.textContent, 10);
          if (!target || isNaN(target)) return;
          const prefix = el.textContent.match(/^[🥇🥈🥉]/)?.[0] ? el.textContent.match(/^[🥇🥈🥉]\s?/)[0] : '';
          ST.create({
            trigger: el, start: 'top 90%',
            onEnter: () => {
              const o = { v: 0 };
              gsap.to(o, {
                v: target, duration: 1.4, ease: 'power2.out',
                onUpdate: () => { el.textContent = prefix + Math.round(o.v); },
                onComplete: () => { el.classList.add('count-flash'); setTimeout(() => el.classList.remove('count-flash'), 600); }
              });
            }
          });
        });

        // לופט לכותרת hero
        const h1 = document.querySelector('.p-hero h1, .hero h1');
        if (h1) gsap.from(h1, { scale: 0.96, opacity: 0, duration: 1.2, ease: 'power3.out' });
      }

      // 3. Vanilla-Tilt — 3D על כרטיסים (רק דסקטופ; פוגע בחוויית המגע)
      if (!isMobile() && !matchMedia('(pointer: coarse)').matches) {
        await loadScript('https://cdn.jsdelivr.net/npm/vanilla-tilt@1.8.1/dist/vanilla-tilt.min.js');
        if (window.VanillaTilt) {
          window.VanillaTilt.init(document.querySelectorAll('.four-card, .t-card, .club-card, .aud, .card, .bring-item, .stat, .pd-stat'), {
            max: 8, speed: 500, glare: true, 'max-glare': 0.15, scale: 1.02,
            perspective: 1000, reverse: false
          });
        }
      }
    } catch (e) {
      console.warn('[magic] CDN load failed', e.message);
    }
  })();
})();
