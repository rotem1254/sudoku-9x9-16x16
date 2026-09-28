/* =============================================================================
 * snake/ui.js — ממשק סנייק
 * -----------------------------------------------------------------------------
 * לולאה, ציור, קלט (החלקה / מקלדת / חצים) ושמירה.
 *
 * התנועה חלקה ולא קופצת מתא לתא: הלוגיקה מתקדמת בצעדים שלמים, אבל
 * הציור ממקם את הראש והזנב לפי ההתקדמות בתוך הצעד הנוכחי (p בין 0 ל-1).
 * הראש מתקרב מהתא הקודם לתא החדש, והזנב נמשך מהתא שעזב. כך הנחש זורם
 * בקצב אחיד בכל מהירות.
 *
 * ההחלקה במגע מזהה פנייה כבר באמצע האצבע (אחרי 22px) ולא רק בהרמה, ואפשר
 * להמשיך באותה נגיעה לפנייה נוספת — כך מבצעים פניית פרסה מהירה.
 * =========================================================================== */
(function () {
  'use strict';

  const Snake = window.Snake;
  const H = window.Haptics;

  const $ = (s) => document.querySelector(s);

  const PREFS_KEY = 'snake.v1.prefs';
  const SAVE_KEY = 'snake.v1.save';
  const STATS_KEY = 'snake.v1.stats';

  /* מילישניות לצעד */
  const SPEEDS = { slow: 170, normal: 125, fast: 85 };
  const SPEED_NAMES = { slow: 'איטי', normal: 'רגיל', fast: 'מהיר' };

  const SWIPE = 22;

  /* הצבעים הקלאסיים */
  const GRASS_A = '#aad751';
  const GRASS_B = '#a2d149';
  const SNAKE = '#4a75f0';
  const SNAKE_DARK = '#3659c9';
  const APPLE = '#e7471d';

  /* --------------------------------------------------------------------- */
  /* אחסון                                                                  */
  /* --------------------------------------------------------------------- */

  const store = {
    ok: (() => {
      try { localStorage.setItem('__p', '1'); localStorage.removeItem('__p'); return true; }
      catch (e) { return false; }
    })(),
    read(k, d) {
      if (!this.ok) return d;
      try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : d; }
      catch (e) { return d; }
    },
    write(k, v) {
      if (!this.ok) return;
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    },
    remove(k) { if (this.ok) { try { localStorage.removeItem(k); } catch (e) {} } },
  };

  const DEFAULT_PREFS = {
    theme: 'auto',
    haptics: true,
    wrap: false,
    pad: false,
    speed: 'normal',
  };

  const state = {
    prefs: Object.assign({}, DEFAULT_PREFS, store.read(PREFS_KEY, {})),
    game: null,
    /** המהירות של המשחק הנוכחי — נקבעת בפתיחה ולא משתנה באמצע */
    speed: 'normal',
    paused: true,
    starting: true,
    acc: 0,
    lastTail: null,
    /** הבהוב אחרי מוות */
    dying: 0,
    /** טבעת קטנה במקום שבו נאכל תפוח: { x, y, t0 } */
    burst: null,
    appleT0: 0,
    recorded: false,
  };

  const el = {
    field: $('#field'),
    canvas: $('#boardCanvas'),
    overlay: $('#overlay'),
    overlayTitle: $('#overlayTitle'),
    overlayHint: $('#overlayHint'),
    speeds: $('#speeds'),
    btnResume: $('#btnResume'),
    pad: $('#pad'),
    statScore: $('#statScore'),
    statBest: $('#statBest'),
    statLen: $('#statLen'),
    footerInfo: $('#footerInfo'),
    toast: $('#toast'),
    btnPause: $('#btnPause'),
    overModal: $('#overModal'),
    overTitle: $('#overTitle'),
    overSub: $('#overSub'),
    overStats: $('#overStats'),
    btnOverNew: $('#btnOverNew'),
    settingsModal: $('#settingsModal'),
    btnSettings: $('#btnSettings'),
    hapticsNote: $('#hapticsNote'),
    helpModal: $('#helpModal'),
    btnHelp: $('#btnHelp'),
    statsModal: $('#statsModal'),
    statsTable: $('#statsTable'),
    btnStats: $('#btnStats'),
    btnClearStats: $('#btnClearStats'),
    btnTheme: $('#btnTheme'),
    btnNew: $('#btnNew'),
    confirmModal: $('#confirmModal'),
    confirmText: $('#confirmText'),
    btnConfirmOk: $('#btnConfirmOk'),
  };

  const ctx = el.canvas.getContext('2d');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --------------------------------------------------------------------- */
  /* עזרים                                                                  */
  /* --------------------------------------------------------------------- */

  const say = (msg, loud) => { if (window.Announce) window.Announce.say(msg, loud); };

  let toastTimer = null;
  function toast(msg) {
    say(msg);
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2200);
  }

  const openModal = (n) => { pause(); window.Modal.open(n); };
  const closeModal = (n) => window.Modal.close(n);

  let confirmAction = null;
  function askConfirm(text, onOk) {
    el.confirmText.textContent = text;
    confirmAction = onOk;
    openModal(el.confirmModal);
  }

  function feel(name) { if (state.prefs.haptics && H) H.fire(name); }

  const savePrefs = () => store.write(PREFS_KEY, state.prefs);
  function saveGame() {
    const g = state.game;
    if (!g) return;
    if (g.over || state.starting) { store.remove(SAVE_KEY); return; }
    const d = g.serialize();
    d.speed = state.speed;
    store.write(SAVE_KEY, d);
  }
  const stats = () => store.read(STATS_KEY, {});
  const modeKey = () => state.speed + (state.game && state.game.wrap ? '-wrap' : '');
  const bestFor = (s) => (s.best && s.best[modeKey()]) || 0;

  function applyTheme() {
    const pref = state.prefs.theme;
    const dark = pref === 'dark' ||
      (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.prefs.theme === 'auto') applyTheme();
  });

  /* --------------------------------------------------------------------- */
  /* מידות                                                                  */
  /* --------------------------------------------------------------------- */

  const dims = { cell: 24, dpr: 1 };

  function resize() {
    const g = state.game;
    dims.dpr = Math.min(window.devicePixelRatio || 1, 3);
    el.pad.hidden = !state.prefs.pad;

    const border = 16;
    const availW = (el.field.parentElement.clientWidth || 360) - border;
    const top = el.field.getBoundingClientRect().top + window.scrollY;
    const padH = state.prefs.pad ? el.pad.offsetHeight + 12 : 0;
    const availH = window.innerHeight - top - border - padH - 56;
    const cell = Math.max(14, Math.min(40, Math.floor(Math.min(availW / g.cols, availH / g.rows))));
    dims.cell = cell;

    const w = g.cols * cell, h = g.rows * cell;
    el.canvas.style.width = w + 'px';
    el.canvas.style.height = h + 'px';
    el.canvas.width = Math.round(w * dims.dpr);
    el.canvas.height = Math.round(h * dims.dpr);
    draw(performance.now());
  }

  /* --------------------------------------------------------------------- */
  /* ציור                                                                   */
  /* --------------------------------------------------------------------- */

  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

  function draw(now) {
    const g = state.game;
    if (!g) return;
    const C = dims.cell * dims.dpr;
    const cw = el.canvas.width, ch = el.canvas.height;

    /* דשא משובץ */
    ctx.fillStyle = GRASS_A;
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = GRASS_B;
    for (let y = 0; y < g.rows; y++) {
      for (let x = (y % 2); x < g.cols; x += 2) ctx.fillRect(x * C, y * C, C, C);
    }

    const tick = SPEEDS[state.speed];
    const p = g.over || state.paused ? 1 : Math.min(1, state.acc / tick);

    drawApple(now, C);
    drawSnake(p, C, now);

    /* טבעת אכילה */
    if (state.burst) {
      const t = (now - state.burst.t0) / 320;
      if (t >= 1) state.burst = null;
      else {
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.8 * (1 - t)).toFixed(3) + ')';
        ctx.lineWidth = C * 0.1;
        ctx.beginPath();
        ctx.arc((state.burst.x + 0.5) * C, (state.burst.y + 0.5) * C, C * (0.35 + t * 0.6), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawApple(now, C) {
    const a = state.game.apple;
    if (!a) return;
    const t = reducedMotion ? 1 : Math.min(1, (now - state.appleT0) / 220);
    const s = t < 1 ? 1 - Math.pow(1 - t, 3) * 1 : 1;
    const cx = (a.x + 0.5) * C, cy = (a.y + 0.55) * C, r = C * 0.38 * s;
    if (r <= 0) return;
    // גוף
    ctx.fillStyle = APPLE;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // ברק
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.35, cy - r * 0.35, r * 0.28, r * 0.18, -0.7, 0, Math.PI * 2);
    ctx.fill();
    // עוקץ ועלה
    ctx.strokeStyle = '#6b3b12';
    ctx.lineWidth = Math.max(1, C * 0.06);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.85);
    ctx.lineTo(cx + r * 0.1, cy - r * 1.25);
    ctx.stroke();
    ctx.fillStyle = '#4c9a2a';
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.42, cy - r * 1.1, r * 0.34, r * 0.16, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSnake(p, C, now) {
    const g = state.game;
    const body = g.body;
    const n = body.length;

    /* נקודות המסלול מהראש לזנב, במרכזי תאים */
    const pts = [];
    const head = n > 1 && adjacent(body[1], body[0]) && !g.over ? lerp(body[1], body[0], p) : body[0];
    pts.push(head);
    for (let i = 1; i < n; i++) pts.push(body[i]);
    const lt = state.lastTail;
    if (lt && adjacent(lt, body[n - 1]) && !g.over) pts.push(lerp(lt, body[n - 1], p));

    let alpha = 1;
    if (state.dying) {
      // הבהוב אחרי התנגשות
      alpha = 0.35 + 0.65 * (Math.floor((now - state.dying) / 110) % 2);
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    /* המסלול נחתך בכל "קפיצה" (מעבר דרך קיר) — אחרת היה נמתח קו לרוחב הלוח */
    const strokePath = (width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      pts.forEach((pt, i) => {
        const X = (pt.x + 0.5) * C, Y = (pt.y + 0.5) * C;
        if (i === 0 || Math.abs(pt.x - pts[i - 1].x) + Math.abs(pt.y - pts[i - 1].y) > 1.01) ctx.moveTo(X, Y);
        else ctx.lineTo(X, Y);
      });
      if (pts.length === 1) ctx.lineTo((pts[0].x + 0.5) * C + 0.01, (pts[0].y + 0.5) * C);
      ctx.stroke();
    };
    strokePath(C * 0.74, SNAKE_DARK);
    strokePath(C * 0.62, SNAKE);

    /* עיניים — מסתכלות לכיוון התנועה */
    const d = Snake.DIRS[g.dir];
    const hx = (head.x + 0.5) * C, hy = (head.y + 0.5) * C;
    const px = -d.y, py = d.x; // ניצב לכיוון
    [-1, 1].forEach((side) => {
      const ex = hx + d.x * C * 0.1 + px * side * C * 0.18;
      const ey = hy + d.y * C * 0.1 + py * side * C * 0.18;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex, ey, C * 0.14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1b1f2a';
      ctx.beginPath();
      ctx.arc(ex + d.x * C * 0.05, ey + d.y * C * 0.05, C * 0.07, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  /* --------------------------------------------------------------------- */
  /* לולאה                                                                  */
  /* --------------------------------------------------------------------- */

  let raf = 0;
  let last = 0;

  function loop(now) {
    raf = 0;
    const g = state.game;
    if (!g) return;
    const dt = last ? Math.min(100, now - last) : 16;
    last = now;

    if (!state.paused && !g.over) {
      state.acc += dt;
      const tick = SPEEDS[state.speed];
      while (state.acc >= tick && !g.over) {
        state.acc -= tick;
        doStep(now);
      }
    }

    draw(now);
    const animating = state.burst || state.dying || (now - state.appleT0 < 250);
    if ((!state.paused && !g.over) || animating) raf = requestAnimationFrame(loop);
    else last = 0;
  }

  function startLoop() {
    if (!raf) { last = 0; raf = requestAnimationFrame(loop); }
  }

  function doStep(now) {
    const g = state.game;
    const r = g.step();
    if (r.died) {
      state.dying = now;
      feel('reject');
      renderStatus();
      setTimeout(() => { state.dying = 0; showOver(); }, reducedMotion ? 200 : 750);
      startLoop();
      return;
    }
    state.lastTail = r.lastTail;
    if (r.ate) {
      state.burst = reducedMotion ? null : { x: g.body[0].x, y: g.body[0].y, t0: now };
      state.appleT0 = now;
      feel('move');
      renderStatus();
      if (g.score % 10 === 0) say(g.score + ' תפוחים');
      saveGame();
    }
    if (r.won) {
      feel('win');
      setTimeout(showOver, 400);
    }
  }

  /* --------------------------------------------------------------------- */
  /* השהיה ופתיחה                                                           */
  /* --------------------------------------------------------------------- */

  function syncSpeeds() {
    el.speeds.querySelectorAll('.sn-speed').forEach((b) => {
      b.setAttribute('aria-checked', b.dataset.speed === state.prefs.speed ? 'true' : 'false');
    });
  }

  function showOverlay(kind) {
    const start = kind === 'start';
    el.overlayTitle.textContent = start ? 'סנייק' : 'מושהה';
    el.speeds.hidden = !start;
    el.btnResume.textContent = start ? 'מתחילים' : 'ממשיכים';
    el.overlayHint.textContent = start ? 'החלקה או חצים כדי לפנות' : 'מהירות: ' + SPEED_NAMES[state.speed];
    syncSpeeds();
    el.overlay.hidden = false;
  }

  function pause() {
    const g = state.game;
    if (!g || g.over || state.paused) return;
    state.paused = true;
    saveGame();
    showOverlay('pause');
    draw(performance.now());
  }

  function resume() {
    const g = state.game;
    if (!g || g.over) return;
    if (window.Modal && window.Modal.top()) return;
    if (state.starting) {
      // המהירות ננעלת ברגע ההתחלה
      state.speed = state.prefs.speed;
      state.starting = false;
      renderStatus();
    }
    state.paused = false;
    el.overlay.hidden = true;
    startLoop();
  }

  /* --------------------------------------------------------------------- */
  /* קלט                                                                    */
  /* --------------------------------------------------------------------- */

  function turn(dir) {
    const g = state.game;
    if (!g || g.over) return;
    // בפתיחה — חץ גם מתחיל את המשחק, ככה לא צריך לחפש את הכפתור
    if (state.paused && state.starting && !(window.Modal && window.Modal.top())) {
      resume();
    }
    if (state.paused) return;
    g.turn(dir);
  }

  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
  };

  document.addEventListener('keydown', (e) => {
    if (window.Modal && window.Modal.top()) return;
    const dir = KEYS[e.key];
    if (dir) { e.preventDefault(); turn(dir); return; }
    if (e.key === ' ' || e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      e.preventDefault();
      if (state.paused) resume(); else pause();
    } else if (e.key === 'Enter' && state.paused) {
      e.preventDefault();
      resume();
    }
  });

  /* החלקה על הלוח */
  let sw = null;
  el.field.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // כפתורי השכבה מטפלים בעצמם
    sw = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { el.field.setPointerCapture(e.pointerId); } catch (err) {}
  });
  el.field.addEventListener('pointermove', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE) return;
    turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    // נקודת מוצא חדשה — אפשר להמשיך לפנייה נוספת באותה נגיעה
    sw.x = e.clientX;
    sw.y = e.clientY;
  });
  const swEnd = () => { sw = null; };
  el.field.addEventListener('pointerup', swEnd);
  el.field.addEventListener('pointercancel', swEnd);

  /* חצים על המסך */
  el.pad.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.sn-key');
    if (!b) return;
    e.preventDefault();
    b.classList.add('is-down');
    turn(b.dataset.dir);
  });
  const padUp = (e) => {
    const b = e.target.closest && e.target.closest('.sn-key');
    if (b) b.classList.remove('is-down');
  };
  el.pad.addEventListener('pointerup', padUp);
  el.pad.addEventListener('pointercancel', padUp);
  el.pad.addEventListener('pointerleave', padUp, true);

  el.speeds.addEventListener('click', (e) => {
    const b = e.target.closest('.sn-speed');
    if (!b) return;
    state.prefs.speed = b.dataset.speed;
    savePrefs();
    syncSpeeds();
  });

  /* --------------------------------------------------------------------- */
  /* לוח מחוונים                                                            */
  /* --------------------------------------------------------------------- */

  function renderStatus() {
    const g = state.game;
    const best = Math.max(g.score, bestFor(stats()));
    el.statScore.textContent = String(g.score);
    el.statBest.textContent = String(best);
    el.statLen.textContent = String(g.length());
    el.footerInfo.textContent = 'מהירות: ' + SPEED_NAMES[state.starting ? state.prefs.speed : state.speed] +
      (g.wrap ? ' · דרך הקירות' : '');
  }

  /* --------------------------------------------------------------------- */
  /* סיום                                                                   */
  /* --------------------------------------------------------------------- */

  function recordEnd() {
    const g = state.game;
    const s = stats();
    if (state.recorded) return s;
    state.recorded = true;
    s.played = (s.played || 0) + 1;
    s.best = s.best || {};
    const k = modeKey();
    if (g.score > (s.best[k] || 0)) s.best[k] = g.score;
    s.totalApples = (s.totalApples || 0) + g.score;
    if (g.length() > (s.longest || 0)) s.longest = g.length();
    if (g.won) s.wins = (s.wins || 0) + 1;
    store.write(STATS_KEY, s);
    return s;
  }

  function showOver() {
    const g = state.game;
    const prevBest = bestFor(stats());
    const isBest = g.score > 0 && g.score > prevBest;
    const s = recordEnd();
    store.remove(SAVE_KEY);

    say((g.won ? 'ניצחון! ' : isBest ? 'שיא חדש! ' : '') + g.score + ' תפוחים', true);
    el.overTitle.textContent = g.won ? 'מילאת את כל הלוח!' : isBest ? 'שיא חדש!' : 'אאוץ׳!';
    el.overSub.textContent = g.won ? 'אין יותר מקום לתפוחים'
      : isBest ? 'השיא שלך במהירות ' + SPEED_NAMES[state.speed]
      : 'הנחש נתקע ' + (hitWall() ? 'בקיר' : 'בעצמו');
    el.overStats.innerHTML =
      '<div class="win-stat' + (isBest ? ' is-best' : '') + '"><span class="k">תפוחים</span><span class="v">' + g.score + '</span></div>' +
      '<div class="win-stat"><span class="k">שיא</span><span class="v">' + ((s.best && s.best[modeKey()]) || g.score) + '</span></div>' +
      '<div class="win-stat"><span class="k">אורך</span><span class="v">' + g.length() + '</span></div>' +
      '<div class="win-stat"><span class="k">מהירות</span><span class="v">' + SPEED_NAMES[state.speed] + '</span></div>';
    renderStatus();
    draw(performance.now());
    window.Modal.open(el.overModal);
  }

  /** האם המוות היה בקיר — הצעד הבא מהראש יוצא מהלוח */
  function hitWall() {
    const g = state.game;
    if (g.wrap) return false;
    const d = Snake.DIRS[g.dir], h = g.head();
    const x = h.x + d.x, y = h.y + d.y;
    return x < 0 || y < 0 || x >= g.cols || y >= g.rows;
  }

  /* --------------------------------------------------------------------- */
  /* משחק חדש                                                               */
  /* --------------------------------------------------------------------- */

  function newGame() {
    state.game = new Snake({ wrap: !!state.prefs.wrap });
    state.speed = state.prefs.speed;
    state.starting = true;
    state.paused = true;
    state.acc = 0;
    state.lastTail = null;
    state.dying = 0;
    state.burst = null;
    state.appleT0 = 0;
    state.recorded = false;
    closeModal(el.overModal);
    store.remove(SAVE_KEY);
    resize();
    renderStatus();
    showOverlay('start');
  }

  /* --------------------------------------------------------------------- */
  /* אירועים                                                                */
  /* --------------------------------------------------------------------- */

  el.btnResume.addEventListener('click', resume);
  el.btnPause.addEventListener('click', () => { if (state.paused) resume(); else pause(); });

  el.btnTheme.addEventListener('click', () => {
    const order = { auto: 'light', light: 'dark', dark: 'auto' };
    state.prefs.theme = order[state.prefs.theme] || 'light';
    savePrefs();
    applyTheme();
  });

  el.btnHelp.addEventListener('click', () => openModal(el.helpModal));

  function renderStats() {
    const s = stats();
    const b = s.best || {};
    const rows = [
      ['משחקים', String(s.played || 0)],
      ['שיא — איטי', String(b.slow || 0)],
      ['שיא — רגיל', String(b.normal || 0)],
      ['שיא — מהיר', String(b.fast || 0)],
      ['הנחש הארוך ביותר', String(s.longest || 0)],
      ['תפוחים בסך הכול', String(s.totalApples || 0)],
    ];
    el.statsTable.innerHTML = rows
      .map(([name, value]) =>
        '<div class="stats-row"><span class="name">' + name +
        '</span><span class="best">' + value + '</span></div>')
      .join('');
  }

  el.btnStats.addEventListener('click', () => {
    renderStats();
    openModal(el.statsModal);
  });

  el.btnClearStats.addEventListener('click', () => {
    askConfirm('לאפס את כל הסטטיסטיקות? אי אפשר לשחזר.', () => {
      store.remove(STATS_KEY);
      renderStats();
      renderStatus();
      toast('הנתונים אופסו');
    });
  });

  el.btnSettings.addEventListener('click', () => {
    el.settingsModal.querySelectorAll('[data-pref]').forEach((i) => {
      i.checked = !!state.prefs[i.dataset.pref];
    });
    const mode = H ? H.supported() : 'none';
    el.hapticsNote.textContent =
      mode === 'vibrate' ? 'משוב מישושי על אכילה וסיום'
      : mode === 'ios-switch'
        ? 'באייפון הרטט מוגבל לנקישה אחידה, ובגרסאות iOS חדשות הוא עשוי לא לעבוד'
        : 'הדפדפן הזה אינו מאפשר רטט לדף. המשוב החזותי פועל כרגיל';
    const swH = document.getElementById('optHaptics');
    if (swH) swH.disabled = mode === 'none';
    openModal(el.settingsModal);
  });

  el.settingsModal.addEventListener('change', (e) => {
    const input = e.target.closest && e.target.closest('[data-pref]');
    if (!input) return;
    const key = input.dataset.pref;
    state.prefs[key] = input.checked;
    savePrefs();
    if (key === 'haptics' && H) H.setEnabled(input.checked);
    if (key === 'pad') resize();
    // מעבר דרך קירות משנה את חוקי המשחק — אם עוד לא התחלנו, מחילים מיד
    if (key === 'wrap' && state.starting) { state.game.wrap = input.checked; renderStatus(); }
  });

  el.btnNew.addEventListener('click', () => {
    const g = state.game;
    if (g && !g.over && !state.starting && g.score > 0) {
      askConfirm('להתחיל משחק חדש? ההתקדמות תימחק.', newGame);
      return;
    }
    newGame();
  });

  el.btnConfirmOk.addEventListener('click', () => {
    closeModal(el.confirmModal);
    const fn = confirmAction;
    confirmAction = null;
    if (fn) fn();
  });

  el.btnOverNew.addEventListener('click', newGame);

  document.querySelectorAll('[data-close-modal]').forEach((b) => {
    b.addEventListener('click', () => closeModal(b.closest('.modal')));
  });
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.game) resize(); }, 120);
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('blur', () => pause());
  window.addEventListener('pagehide', saveGame);
  window.addEventListener('beforeunload', saveGame);

  /* --------------------------------------------------------------------- */
  /* אתחול                                                                  */
  /* --------------------------------------------------------------------- */

  function init() {
    applyTheme();
    if (H) H.setEnabled(!!state.prefs.haptics);

    const saved = store.read(SAVE_KEY, null);
    if (saved && Array.isArray(saved.body) && !saved.over) {
      state.game = Snake.deserialize(saved);
      state.speed = SPEEDS[saved.speed] ? saved.speed : 'normal';
      state.starting = false;
      state.paused = true;
      resize();
      renderStatus();
      showOverlay('pause');
    } else {
      newGame();
    }

    if (!store.ok) setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
  }

  init();
})();
