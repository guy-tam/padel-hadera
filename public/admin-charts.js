/* =========================================================
   admin-charts.js
   שכבת הויזואליזציה של דשבורד המנהל
   חושף window.AdminCharts = { render, animateCounter, observeEntries }
   ========================================================= */
(function () {
  'use strict';

  // ---------- פלטת צבעים ----------
  const COLORS = {
    bg:    '#062318',
    lime:  '#d4ff3a',
    teal:  '#7fe3a8',
    yellow:'#ffd968',
    red:   '#ff6b6b',
    text2: '#b5c8bf',
    grid:  'rgba(255,255,255,0.05)',
    // פלטה מורחבת לגרפים עם הרבה קטגוריות
    palette: [
      '#d4ff3a', '#7fe3a8', '#ffd968', '#ff6b6b',
      '#6bc5ff', '#c38bff', '#ff9f68', '#5effd4',
      '#b5c8bf'
    ]
  };

  // ---------- מפעלי Chart כלליים ----------
  const chartInstances = {}; // id -> Chart

  function destroyChart(id) {
    if (chartInstances[id]) {
      try { chartInstances[id].destroy(); } catch (_) {}
      delete chartInstances[id];
    }
  }

  function getCtx(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    // תמיכה ב-canvas או wrapper
    if (el.tagName === 'CANVAS') return el.getContext('2d');
    const c = el.querySelector('canvas');
    return c ? c.getContext('2d') : null;
  }

  // gradient fill לגרף line
  function makeGradient(ctx, color) {
    const g = ctx.createLinearGradient(0, 0, 0, 260);
    g.addColorStop(0, color + 'cc');
    g.addColorStop(1, color + '00');
    return g;
  }

  // ברירות-מחדל לכל הגרפים
  const BASE_OPTS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: COLORS.text2, font: { family: 'Rubik', size: 12 } }
      },
      tooltip: {
        backgroundColor: '#0a3d2a',
        borderColor: 'rgba(212,255,58,0.25)',
        borderWidth: 1,
        titleColor: '#fff',
        bodyColor: COLORS.text2,
        titleFont: { family: 'Rubik', weight: '700' },
        bodyFont: { family: 'Rubik' },
        padding: 10,
        cornerRadius: 10
      }
    }
  };

  function axisOpts() {
    return {
      ticks: { color: COLORS.text2, font: { family: 'Rubik', size: 11 } },
      grid:  { color: COLORS.grid, drawBorder: false }
    };
  }

  // ========================================================
  // Counter animation
  // ========================================================
  function parseFormat(el) {
    // נקרא מ-data-format או ניחוש לפי ה-id
    const fmt = (el && el.dataset && el.dataset.format) || 'number';
    return fmt; // 'number' | 'percent' | 'currency'
  }

  function formatValue(val, fmt) {
    if (fmt === 'percent')  return Math.round(val) + '%';
    if (fmt === 'currency') return '₪' + Math.round(val).toLocaleString('he-IL');
    return Math.round(val).toLocaleString('he-IL');
  }

  function animateCounter(id, from, to) {
    const el = document.getElementById(id);
    if (!el) return;
    const fmt = parseFormat(el);
    const duration = 900;
    const start = performance.now();
    const delta = to - from;
    // easeOutCubic
    const ease = (t) => 1 - Math.pow(1 - t, 3);

    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const v = from + delta * ease(t);
      el.textContent = formatValue(v, fmt);
      if (t < 1) requestAnimationFrame(frame);
      else el.textContent = formatValue(to, fmt);
    }
    requestAnimationFrame(frame);
  }

  // שומר ערכים קודמים כדי לאנפס מהם
  const prevKPI = {};
  function setKPI(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const from = prevKPI[id] || 0;
    prevKPI[id] = value;
    animateCounter(id, from, value);
  }

  // ========================================================
  // IntersectionObserver לאנימציות reveal
  // ========================================================
  let _io = null;
  function observeEntries() {
    const targets = document.querySelectorAll('.reveal-on-scroll:not(.revealed)');
    if (!targets.length) return;
    if (!_io) {
      _io = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('revealed');
            _io.unobserve(e.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    }
    targets.forEach((t) => _io.observe(t));
  }

  // ========================================================
  // עזרי נתונים
  // ========================================================
  function toArray(x) {
    if (!x) return [];
    if (Array.isArray(x)) return x;
    if (typeof x === 'object') return Object.values(x);
    return [];
  }

  function tsOf(x) {
    // מחזיר timestamp ms מכל שדה תאריך סביר
    if (!x) return 0;
    const cand = x.createdAt || x.created_at || x.created || x.date || x.timestamp || x.ts;
    if (!cand) return 0;
    if (typeof cand === 'number') return cand < 1e12 ? cand * 1000 : cand;
    const t = Date.parse(cand);
    return isNaN(t) ? 0 : t;
  }

  function dayKey(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function lastNDays(n) {
    const out = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      out.push(d.getTime());
    }
    return out;
  }

  function shortDate(ts) {
    const d = new Date(ts);
    return d.getDate() + '/' + (d.getMonth() + 1);
  }

  // ========================================================
  // הגרפים
  // ========================================================

  // 1) chartRegTrend — Line: מגמת הרשמות 30 יום
  function renderRegTrend(data) {
    const ctx = getCtx('chartRegTrend');
    if (!ctx) return;
    const regs = toArray(data.registrations);
    const days = lastNDays(30);
    const counts = days.map(() => 0);
    const dayIdx = new Map(days.map((d, i) => [d, i]));

    regs.forEach((r) => {
      const key = dayKey(tsOf(r));
      if (dayIdx.has(key)) counts[dayIdx.get(key)]++;
    });

    destroyChart('chartRegTrend');
    chartInstances.chartRegTrend = new Chart(ctx, {
      type: 'line',
      data: {
        labels: days.map(shortDate),
        datasets: [{
          label: 'הרשמות',
          data: counts,
          borderColor: COLORS.lime,
          backgroundColor: makeGradient(ctx, COLORS.lime),
          borderWidth: 2.5,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: COLORS.lime,
          pointHoverBorderColor: '#fff'
        }]
      },
      options: Object.assign({}, BASE_OPTS, {
        plugins: Object.assign({}, BASE_OPTS.plugins, {
          legend: { display: false }
        }),
        scales: { x: axisOpts(), y: Object.assign(axisOpts(), { beginAtZero: true, ticks: Object.assign(axisOpts().ticks, { precision: 0 }) }) }
      })
    });
  }

  // 2) chartRevenue — Doughnut: הכנסות לפי מגרש
  function renderRevenue(data) {
    const ctx = getCtx('chartRevenue');
    if (!ctx) return;
    const regs   = toArray(data.registrations);
    const tours  = toArray(data.tournaments);
    const clubs  = toArray(data.clubs);

    // מפות עזר
    const tourById = new Map(tours.map(t => [t.id || t._id, t]));
    const clubName = new Map(clubs.map(c => [c.id || c._id, c.name || c.title || 'מגרש']));

    // סיכום הכנסות לפי clubId
    const revByClub = new Map();
    regs.forEach((r) => {
      const paid = !!(r.paid || r.status === 'paid' || r.paymentStatus === 'paid');
      if (!paid) return;
      const t = tourById.get(r.tournamentId || r.tournament_id);
      if (!t) return;
      const price = (t.pricing && (t.pricing.perPair || t.pricing.price)) || t.price || 0;
      const clubId = t.clubId || t.club_id || 'unknown';
      revByClub.set(clubId, (revByClub.get(clubId) || 0) + price);
    });

    // top 8 + אחר
    const arr = Array.from(revByClub.entries())
      .sort((a, b) => b[1] - a[1]);
    const top = arr.slice(0, 8);
    const rest = arr.slice(8).reduce((s, x) => s + x[1], 0);

    const labels = top.map(([id]) => clubName.get(id) || 'מגרש');
    const values = top.map(([, v]) => v);
    if (rest > 0) { labels.push('אחר'); values.push(rest); }

    destroyChart('chartRevenue');
    chartInstances.chartRevenue = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: labels.map((_, i) => COLORS.palette[i % COLORS.palette.length]),
          borderColor: COLORS.bg,
          borderWidth: 2,
          hoverOffset: 8
        }]
      },
      options: Object.assign({}, BASE_OPTS, {
        cutout: '62%',
        plugins: Object.assign({}, BASE_OPTS.plugins, {
          legend: { position: 'bottom', labels: { color: COLORS.text2, font: { family: 'Rubik', size: 11 }, boxWidth: 12, padding: 10 } },
          tooltip: Object.assign({}, BASE_OPTS.plugins.tooltip, {
            callbacks: {
              label: (c) => c.label + ': ₪' + Number(c.parsed).toLocaleString('he-IL')
            }
          })
        })
      })
    });
  }

  // 3) chartFunnel — Horizontal bar: pending → approved → active
  function renderFunnel(data) {
    const ctx = getCtx('chartFunnel');
    if (!ctx) return;
    const apps = data.applications || {};
    const allApps = []
      .concat(toArray(apps.players))
      .concat(toArray(apps.clubs))
      .concat(toArray(apps.organizers));

    const count = (st) => allApps.filter(a => (a.status || '').toLowerCase() === st).length;
    const pending  = count('pending');
    const approved = count('approved');
    // "active" — מי שאושר ויש לו פעילות (רישום או התחברות), או סטטוס active
    const active   = allApps.filter(a => {
      const s = (a.status || '').toLowerCase();
      return s === 'active' || (s === 'approved' && (a.lastLogin || a.registrations || a.active));
    }).length;

    destroyChart('chartFunnel');
    chartInstances.chartFunnel = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['ממתין', 'אושר', 'פעיל'],
        datasets: [{
          label: 'בקשות',
          data: [pending, approved, active],
          backgroundColor: [COLORS.text2, COLORS.yellow, COLORS.lime],
          borderRadius: 8,
          borderSkipped: false,
          barThickness: 26
        }]
      },
      options: Object.assign({}, BASE_OPTS, {
        indexAxis: 'y',
        plugins: Object.assign({}, BASE_OPTS.plugins, { legend: { display: false } }),
        scales: {
          x: Object.assign(axisOpts(), { beginAtZero: true, ticks: Object.assign(axisOpts().ticks, { precision: 0 }) }),
          y: axisOpts()
        }
      })
    });
  }

  // 4) chartCityHeat — Bar אנכי: שחקנים לפי עיר (top 10)
  function renderCityHeat(data) {
    const ctx = getCtx('chartCityHeat');
    if (!ctx) return;
    const players = toArray((data.applications && data.applications.players) || []);
    const byCity = new Map();
    players.forEach((p) => {
      const city = (p.city || p.location || 'לא צוין').trim() || 'לא צוין';
      byCity.set(city, (byCity.get(city) || 0) + 1);
    });
    const top = Array.from(byCity.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);

    destroyChart('chartCityHeat');
    chartInstances.chartCityHeat = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: top.map(x => x[0]),
        datasets: [{
          label: 'שחקנים',
          data: top.map(x => x[1]),
          backgroundColor: top.map((_, i) => {
            // gradient של צפיפות — חם יותר = ליים, קר יותר = טורקיז
            const ratio = i / Math.max(1, top.length - 1);
            return ratio < 0.33 ? COLORS.lime : ratio < 0.66 ? COLORS.teal : '#5effd4';
          }),
          borderRadius: 8,
          borderSkipped: false
        }]
      },
      options: Object.assign({}, BASE_OPTS, {
        plugins: Object.assign({}, BASE_OPTS.plugins, { legend: { display: false } }),
        scales: {
          x: axisOpts(),
          y: Object.assign(axisOpts(), { beginAtZero: true, ticks: Object.assign(axisOpts().ticks, { precision: 0 }) })
        }
      })
    });
  }

  // 5) chartStatusPie — Pie של סטטוסי טורנירים
  function renderStatusPie(data) {
    const ctx = getCtx('chartStatusPie');
    if (!ctx) return;
    const tours = toArray(data.tournaments);
    const buckets = { published: 0, pending_review: 0, completed: 0, cancelled: 0, other: 0 };
    tours.forEach((t) => {
      const s = (t.status || t.state || '').toLowerCase();
      if (buckets[s] !== undefined) buckets[s]++;
      else if (t.visibility === 'public') buckets.published++;
      else buckets.other++;
    });

    const labels = ['מפורסם', 'ממתין לבדיקה', 'הסתיים', 'בוטל'];
    const values = [buckets.published, buckets.pending_review, buckets.completed, buckets.cancelled];
    const colors = [COLORS.lime, COLORS.yellow, COLORS.teal, COLORS.red];

    if (buckets.other) { labels.push('אחר'); values.push(buckets.other); colors.push(COLORS.text2); }

    destroyChart('chartStatusPie');
    chartInstances.chartStatusPie = new Chart(ctx, {
      type: 'pie',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: COLORS.bg,
          borderWidth: 2
        }]
      },
      options: Object.assign({}, BASE_OPTS, {
        plugins: Object.assign({}, BASE_OPTS.plugins, {
          legend: { position: 'bottom', labels: { color: COLORS.text2, font: { family: 'Rubik', size: 11 }, boxWidth: 12, padding: 10 } }
        })
      })
    });
  }

  // 6) chartTopClubs — top 5 מגרשים לפי מס' טורנירים
  function renderTopClubs(data) {
    const ctx = getCtx('chartTopClubs');
    if (!ctx) return;
    const tours = toArray(data.tournaments);
    const clubs = toArray(data.clubs);
    const clubName = new Map(clubs.map(c => [c.id || c._id, c.name || c.title || 'מגרש']));

    const byClub = new Map();
    tours.forEach((t) => {
      const cid = t.clubId || t.club_id;
      if (!cid) return;
      byClub.set(cid, (byClub.get(cid) || 0) + 1);
    });
    const top = Array.from(byClub.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

    destroyChart('chartTopClubs');
    chartInstances.chartTopClubs = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: top.map(x => clubName.get(x[0]) || 'מגרש'),
        datasets: [{
          label: 'טורנירים',
          data: top.map(x => x[1]),
          backgroundColor: top.map((_, i) => COLORS.palette[i % COLORS.palette.length]),
          borderRadius: 8,
          borderSkipped: false,
          barThickness: 22
        }]
      },
      options: Object.assign({}, BASE_OPTS, {
        indexAxis: 'y',
        plugins: Object.assign({}, BASE_OPTS.plugins, { legend: { display: false } }),
        scales: {
          x: Object.assign(axisOpts(), { beginAtZero: true, ticks: Object.assign(axisOpts().ticks, { precision: 0 }) }),
          y: axisOpts()
        }
      })
    });
  }

  // ========================================================
  // KPIs
  // ========================================================
  function renderKPIs(data) {
    const tours = toArray(data.tournaments);
    const regs  = toArray(data.registrations);
    const apps  = data.applications || {};
    const players = toArray(apps.players);
    const clubsApps = toArray(apps.clubs);
    const orgsApps  = toArray(apps.organizers);

    // kpiTournaments: פומביים
    const kT = tours.filter(t => t.visibility === 'public').length;
    setKPI('kpiTournaments', kT);

    // kpiRevenue: sum paid * perPair/2
    const tourById = new Map(tours.map(t => [t.id || t._id, t]));
    let revenue = 0;
    regs.forEach((r) => {
      const paid = !!(r.paid || r.status === 'paid' || r.paymentStatus === 'paid');
      if (!paid) return;
      const t = tourById.get(r.tournamentId || r.tournament_id);
      if (!t) return;
      const price = (t.pricing && (t.pricing.perPair || t.pricing.price)) || t.price || 0;
      revenue += price / 2; // לכל שחקן = חצי זוג
    });
    setKPI('kpiRevenue', revenue);

    // kpiNewPlayers: נרשמו ב-7 ימים אחרונים
    const weekAgo = Date.now() - 7 * 86400000;
    const kNew = players.filter(p => tsOf(p) >= weekAgo).length;
    setKPI('kpiNewPlayers', kNew);

    // kpiOccupancy: ממוצע reserved/max
    let occSum = 0, occCount = 0;
    tours.forEach((t) => {
      const reserved = t.reserved || t.registeredCount || (t.registrations ? t.registrations.length : 0);
      const max = t.maxPairs ? t.maxPairs * 2 : (t.maxPlayers || t.capacity || 0);
      if (max > 0) {
        occSum += Math.min(1, reserved / max);
        occCount++;
      }
    });
    const occPct = occCount ? (occSum / occCount) * 100 : 0;
    setKPI('kpiOccupancy', occPct);

    // kpiPending: organizers + clubs ב-pending
    const kP = clubsApps.filter(a => (a.status || '').toLowerCase() === 'pending').length
             + orgsApps.filter(a => (a.status || '').toLowerCase() === 'pending').length;
    setKPI('kpiPending', kP);
  }

  // ========================================================
  // render ראשי
  // ========================================================
  function render(data) {
    if (!data) return;
    // ודא RTL-קיד ונראות טובה
    if (window.Chart && Chart.defaults) {
      Chart.defaults.font.family = 'Rubik, system-ui, sans-serif';
      Chart.defaults.color = COLORS.text2;
    }

    // KPIs קודם — אנימציה מתחילה מיד
    try { renderKPIs(data); } catch (e) { console.warn('[AdminCharts] KPIs failed', e); }

    // אח"כ גרפים (דורש Chart.js)
    if (!window.Chart) {
      console.warn('[AdminCharts] Chart.js not loaded — skipping charts');
    } else {
      try { renderRegTrend(data); }  catch (e) { console.warn('[AdminCharts] regTrend', e); }
      try { renderRevenue(data); }   catch (e) { console.warn('[AdminCharts] revenue', e); }
      try { renderFunnel(data); }    catch (e) { console.warn('[AdminCharts] funnel', e); }
      try { renderCityHeat(data); }  catch (e) { console.warn('[AdminCharts] cityHeat', e); }
      try { renderStatusPie(data); } catch (e) { console.warn('[AdminCharts] statusPie', e); }
      try { renderTopClubs(data); }  catch (e) { console.warn('[AdminCharts] topClubs', e); }
    }

    // אנימציית entrance
    observeEntries();
  }

  // ========================================================
  // חשיפה גלובלית
  // ========================================================
  window.AdminCharts = {
    render: render,
    animateCounter: animateCounter,
    observeEntries: observeEntries
  };

  // הרץ observer ראשוני כאשר ה-DOM מוכן (גם בלי נתונים)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeEntries);
  } else {
    observeEntries();
  }
})();
