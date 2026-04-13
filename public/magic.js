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
  document.querySelectorAll('.btn-primary, .pnav-cta, .four-card').forEach(b => magnetize(b, 0.15));

  // ============ טעינה עצלה ממש של GSAP + Tilt + Lenis ============
  (async () => {
    try {
      // 1. Lenis smooth scroll
      await loadScript('https://cdn.jsdelivr.net/npm/lenis@1.1.20/dist/lenis.min.js');
      if (window.Lenis) {
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

      // 3. Vanilla-Tilt — 3D על כרטיסים
      await loadScript('https://cdn.jsdelivr.net/npm/vanilla-tilt@1.8.1/dist/vanilla-tilt.min.js');
      if (window.VanillaTilt) {
        window.VanillaTilt.init(document.querySelectorAll('.four-card, .t-card, .club-card, .aud, .card, .bring-item, .stat, .pd-stat'), {
          max: 8, speed: 500, glare: true, 'max-glare': 0.15, scale: 1.02,
          perspective: 1000, reverse: false
        });
      }
    } catch (e) {
      console.warn('[magic] CDN load failed', e.message);
    }
  })();
})();
