/* =============================================================================
 * tetris/ui.js — ממשק טטריס
 * -----------------------------------------------------------------------------
 * לולאת משחק, ציור על canvas, קלט (מקלדת / מחוות / כפתורים) ושמירה.
 *
 * הזמן מגיע מ-requestAnimationFrame ומוזרק למנוע ב-tick(dt). תזוזה
 * מתמשכת (החזקת חץ או כפתור) מנוהלת כאן ולא ע"י חזרת המקלדת של מערכת
 * ההפעלה: השהיה ראשונה (DAS) ואחריה קצב קבוע (ARR), כמו במשחקים
 * המודרניים. חזרת המקלדת של המערכת איטית ושונה בכל מכשיר.
 *
 * כל ריבוע מצויר מ"ספרייט" מוכן מראש — קנבס קטן לכל צבע בגודל הנוכחי.
 * =========================================================================== */
(function () {
  'use strict';

  const Tetris = window.Tetris;
  const H = window.Haptics;
  const { W, HIDDEN } = Tetris;
  const ROWS = Tetris.H - HIDDEN;

  const $ = (s) => document.querySelector(s);

  const PREFS_KEY = 'tetris.v1.prefs';
  const SAVE_KEY = 'tetris.v1.save';
  const STATS_KEY = 'tetris.v1.stats';

  /* צבעי החלקים — לפי המוסכמה של המשחק, מעט רכים יותר */
  const COLORS = {
    I: '#22d3ee', O: '#facc15', T: '#a855f7', S: '#22c55e',
    Z: '#ef4444', J: '#3b82f6', L: '#f97316',
  };

  /* תזוזה מתמשכת: השהיה ראשונה וקצב חזרה, במילישניות */
  const DAS = 160;
  const ARR = 45;

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

  const coarse = window.matchMedia('(pointer: coarse)').matches;

  const DEFAULT_PREFS = {
    theme: 'auto',
    haptics: true,
    ghost: true,
    // בטלפון הכפתורים מופעלים כברירת מחדל; במחשב יש מקלדת
    controls: coarse,
  };

  const state = {
    prefs: Object.assign({}, DEFAULT_PREFS, store.read(PREFS_KEY, {})),
    game: null,
    paused: true,
    /** תזוזה מתמשכת: הכיוון המוחזק והטיימרים */
    held: { dir: 0, das: 0, arr: 0, soft: false, keys: new Set() },
    /** הבהוב של ריבועים שננעלו: { cells, t0 } */
    lockFlash: null,
    /** רעידה קטנה אחרי הפלה */
    shake: 0,
    recorded: false,
  };

  const el = {
    play: $('#play'),
    well: $('#well'),
    board: $('#boardCanvas'),
    hold: $('#holdCanvas'),
    next: $('#nextCanvas'),
    overlay: $('#overlay'),
    overlayTitle: $('#overlayTitle'),
    btnResume: $('#btnResume'),
    controls: $('#controls'),
    statScore: $('#statScore'),
    statBest: $('#statBest'),
    statLines: $('#statLines'),
    statLevel: $('#statLevel'),
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

  const ctx = el.board.getContext('2d');
  const hctx = el.hold.getContext('2d');
  const nctx = el.next.getContext('2d');
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
    if (!state.game) return;
    if (state.game.over) { store.remove(SAVE_KEY); return; }
    store.write(SAVE_KEY, state.game.serialize());
  }
  const stats = () => store.read(STATS_KEY, {});

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
  /* מידות וספרייטים                                                        */
  /* --------------------------------------------------------------------- */

  const dims = { cell: 24, mini: 14, dpr: 1 };
  let sprites = {};
  let miniSprites = {};

  /*
   * גודל הריבוע נקבע גם לפי הרוחב וגם לפי הגובה הפנוי: בטלפון הגובה הוא
   * לרוב המגבלה, ולוח שגולש מתחת לכפתורים לא שמיש.
   */
  function resize() {
    dims.dpr = Math.min(window.devicePixelRatio || 1, 3);
    el.controls.hidden = !state.prefs.controls;

    const playW = el.play.clientWidth || 360;
    // לוח 10 + שתי עמודות צד (חלק בחצי גודל = ~2.4 ריבועים) + רווחים
    const byW = (playW - 16) / (10 + 2 * 2.4);
    const top = el.play.getBoundingClientRect().top + window.scrollY;
    const ctrlH = state.prefs.controls ? el.controls.offsetHeight + 12 : 0;
    const footer = 44;
    const byH = (window.innerHeight - top - ctrlH - footer - 12) / ROWS;
    const cell = Math.max(12, Math.min(36, Math.floor(Math.min(byW, byH))));
    dims.cell = cell;
    dims.mini = Math.max(7, Math.round(cell * 0.5));

    sizeCanvas(el.board, W * cell, ROWS * cell);
    const sideW = Math.round(dims.mini * 4.6);
    sizeCanvas(el.hold, sideW, Math.round(dims.mini * 3.2));
    sizeCanvas(el.next, sideW, Math.round(dims.mini * (0.6 + 5 * 2.7)));

    sprites = buildSprites(Math.round(cell * dims.dpr));
    miniSprites = buildSprites(Math.round(dims.mini * dims.dpr));
    draw(performance.now());
  }

  function sizeCanvas(c, w, h) {
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    c.width = Math.round(w * dims.dpr);
    c.height = Math.round(h * dims.dpr);
  }

  function shade(hex, t) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (s) => (n >> s) & 255;
    const to = t > 0 ? 255 : 0;
    const k = Math.abs(t);
    const m = (s) => Math.round(ch(s) + (to - ch(s)) * k);
    return 'rgb(' + m(16) + ',' + m(8) + ',' + m(0) + ')';
  }

  /** ריבוע עם שוליים משופעים — בהיר למעלה/שמאל, כהה למטה/ימין. */
  function buildSprites(s) {
    const out = {};
    Object.keys(COLORS).forEach((k) => {
      const base = COLORS[k];
      const c = document.createElement('canvas');
      c.width = c.height = s;
      const g = c.getContext('2d');
      const b = Math.max(2, Math.round(s * 0.14));
      g.fillStyle = base;
      g.fillRect(0, 0, s, s);
      // שיפוע עליון ושמאלי
      g.fillStyle = shade(base, 0.45);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(s, 0); g.lineTo(s - b, b); g.lineTo(b, b); g.lineTo(b, s - b); g.lineTo(0, s); g.closePath(); g.fill();
      // שיפוע תחתון וימני
      g.fillStyle = shade(base, -0.35);
      g.beginPath(); g.moveTo(s, s); g.lineTo(0, s); g.lineTo(b, s - b); g.lineTo(s - b, s - b); g.lineTo(s - b, b); g.lineTo(s, 0); g.closePath(); g.fill();
      // פנים עם ברק עדין
      const grad = g.createLinearGradient(0, b, 0, s - b);
      grad.addColorStop(0, shade(base, 0.12));
      grad.addColorStop(1, base);
      g.fillStyle = grad;
      g.fillRect(b, b, s - 2 * b, s - 2 * b);
      // קו מפריד דק
      g.strokeStyle = 'rgba(0,0,0,.35)';
      g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, s - 1, s - 1);
      out[k] = c;
    });
    return out;
  }

  /* --------------------------------------------------------------------- */
  /* ציור                                                                   */
  /* --------------------------------------------------------------------- */

  function draw(now) {
    const g = state.game;
    if (!g) return;
    const S = Math.round(dims.cell * dims.dpr);
    const cw = el.board.width, ch = el.board.height;
    ctx.clearRect(0, 0, cw, ch);

    ctx.save();
    if (state.shake > 0) ctx.translate(0, Math.round(state.shake * dims.dpr));

    /* רשת עדינה */
    ctx.strokeStyle = 'rgba(255,255,255,.045)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < W; x++) { ctx.moveTo(x * S + 0.5, 0); ctx.lineTo(x * S + 0.5, ch); }
    for (let y = 1; y < ROWS; y++) { ctx.moveTo(0, y * S + 0.5); ctx.lineTo(cw, y * S + 0.5); }
    ctx.stroke();

    /* הלוח */
    for (let y = HIDDEN; y < Tetris.H; y++) {
      for (let x = 0; x < W; x++) {
        const t = g.board[y][x];
        if (t) ctx.drawImage(sprites[t], x * S, (y - HIDDEN) * S, S, S);
      }
    }

    /* שורות שמתנקות — מהבהבות ללבן ונעלמות */
    if (g.clearing) {
      const p = 1 - Math.max(0, g.clearing.t) / Tetris.CLEAR_DELAY;
      g.clearing.rows.forEach((y) => {
        const yy = (y - HIDDEN) * S;
        ctx.fillStyle = 'rgba(255,255,255,' + (0.85 * (1 - p) + 0.15).toFixed(3) + ')';
        const w = cw * (1 - p * 0.9);
        ctx.fillRect((cw - w) / 2, yy, w, S);
      });
    }

    /* חלק רפאים */
    if (g.active && state.prefs.ghost) {
      const gh = g.ghost();
      if (gh.y !== g.active.y) {
        const col = COLORS[gh.type];
        ctx.fillStyle = col + '26';
        ctx.strokeStyle = col + 'aa';
        ctx.lineWidth = Math.max(1, Math.round(S * 0.07));
        g.cells(gh).forEach(([x, y]) => {
          if (y < HIDDEN) return;
          const px = x * S, py = (y - HIDDEN) * S, i = ctx.lineWidth / 2;
          ctx.fillRect(px, py, S, S);
          ctx.strokeRect(px + i, py + i, S - 2 * i, S - 2 * i);
        });
      }
    }

    /* החלק הפעיל */
    if (g.active) {
      // לקראת נעילה החלק "מתעמעם" מעט — רמז לכמה זמן נשאר להחליק אותו
      const fade = g.grounded() ? 1 - Math.min(1, g.lockTimer / Tetris.LOCK_DELAY) * 0.35 : 1;
      ctx.globalAlpha = fade;
      g.cells().forEach(([x, y]) => {
        if (y >= HIDDEN) ctx.drawImage(sprites[g.active.type], x * S, (y - HIDDEN) * S, S, S);
      });
      ctx.globalAlpha = 1;
    }

    /* הבהוב נעילה */
    if (state.lockFlash) {
      const t = (now - state.lockFlash.t0) / 140;
      if (t >= 1) state.lockFlash = null;
      else {
        ctx.fillStyle = 'rgba(255,255,255,' + (0.5 * (1 - t)).toFixed(3) + ')';
        state.lockFlash.cells.forEach(([x, y]) => {
          if (y >= HIDDEN) ctx.fillRect(x * S, (y - HIDDEN) * S, S, S);
        });
      }
    }
    ctx.restore();

    drawHold();
    drawNext();
  }

  /** מצייר חלק ממורכז בתוך מלבן, בגודל ריבוע m. */
  function drawPiece(c, type, cx, cy, m, alpha) {
    const cells = Tetris.SHAPES[type][0];
    const xs = cells.map((p) => p[0]), ys = cells.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = (maxX - minX + 1) * m, h = (maxY - minY + 1) * m;
    const ox = Math.round(cx - w / 2), oy = Math.round(cy - h / 2);
    c.globalAlpha = alpha == null ? 1 : alpha;
    cells.forEach(([x, y]) => {
      c.drawImage(miniSprites[type], ox + (x - minX) * m, oy + (y - minY) * m, m, m);
    });
    c.globalAlpha = 1;
  }

  function drawHold() {
    const g = state.game;
    const m = Math.round(dims.mini * dims.dpr);
    hctx.clearRect(0, 0, el.hold.width, el.hold.height);
    if (g.hold) drawPiece(hctx, g.hold, el.hold.width / 2, el.hold.height / 2, m, g.canHold ? 1 : 0.35);
  }

  function drawNext() {
    const g = state.game;
    const m = Math.round(dims.mini * dims.dpr);
    nctx.clearRect(0, 0, el.next.width, el.next.height);
    const slot = m * 2.7;
    g.queue.slice(0, 5).forEach((t, i) => {
      // הבא בתור בגודל מלא, השאר קטנים מעט — העין הולכת אליו קודם
      const k = i === 0 ? 1 : 0.8;
      drawPiece(nctx, t, el.next.width / 2, m * 0.3 + slot * i + slot / 2, Math.round(m * k), i === 0 ? 1 : 0.8);
    });
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
    const dt = last ? Math.min(50, now - last) : 16;
    last = now;

    if (!state.paused && !g.over) {
      autoShift(dt);
      g.tick(dt, state.held.soft);
      handleEvents(now);
    }
    if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 0.05);

    draw(now);
    renderStatus();

    if (!state.paused && !g.over) raf = requestAnimationFrame(loop);
    else last = 0;
  }

  function startLoop() {
    if (!raf) { last = 0; raf = requestAnimationFrame(loop); }
  }

  /** תזוזה מתמשכת — DAS ואחריו ARR. */
  function autoShift(dt) {
    const h = state.held;
    if (!h.dir) return;
    h.das += dt;
    if (h.das < DAS) return;
    h.arr += dt;
    while (h.arr >= ARR) {
      h.arr -= ARR;
      if (!state.game.move(h.dir)) { h.arr = 0; break; }
    }
  }

  function handleEvents(now) {
    const g = state.game;
    g.drain().forEach((e) => {
      if (e.type === 'lock') {
        state.lockFlash = reducedMotion ? null : { cells: e.cells, t0: now };
        if (e.rows.length) {
          feel(e.rows.length === 4 ? 'win' : 'lock');
          const name = ['', 'שורה', 'שתי שורות', 'שלוש שורות', 'טטריס!'][e.rows.length];
          let label = name + ' +' + e.points;
          if (e.b2b) label = 'טטריס כפול! +' + e.points;
          else if (e.combo > 0) label += ' · קומבו ' + e.combo;
          showGain(label, e.rows.length === 4, e.rows);
          say(label);
        } else {
          feel('move');
        }
        saveGame();
      } else if (e.type === 'hardDrop') {
        if (!reducedMotion && e.rows > 0) state.shake = Math.min(5, 2 + e.rows * 0.2);
      } else if (e.type === 'hold') {
        feel('pick');
      } else if (e.type === 'level') {
        toast('שלב ' + e.level);
      } else if (e.type === 'over') {
        setTimeout(showOver, 350);
      }
    });
  }

  function showGain(text, big, rows) {
    const rect = el.board.getBoundingClientRect();
    const y = rows.length ? (Math.min(...rows) - HIDDEN) * dims.cell : rect.height / 2;
    const span = document.createElement('span');
    span.className = 'gain' + (big ? ' is-big' : '');
    span.textContent = text;
    span.style.left = rect.left + rect.width / 2 + 'px';
    span.style.top = rect.top + y + 'px';
    document.body.appendChild(span);
    setTimeout(() => span.remove(), 1050);
  }

  /* --------------------------------------------------------------------- */
  /* השהיה                                                                  */
  /* --------------------------------------------------------------------- */

  function pause(title) {
    const g = state.game;
    if (!g || g.over) return;
    releaseAll();
    if (!state.paused) saveGame();
    state.paused = true;
    el.overlayTitle.textContent = title || 'מושהה';
    el.btnResume.textContent = 'ממשיכים';
    el.overlay.hidden = false;
  }

  function resume() {
    const g = state.game;
    if (!g || g.over) return;
    if (window.Modal && window.Modal.top()) return;
    state.paused = false;
    el.overlay.hidden = true;
    startLoop();
  }

  /* --------------------------------------------------------------------- */
  /* פעולות                                                                 */
  /* --------------------------------------------------------------------- */

  function act(name) {
    const g = state.game;
    if (!g || g.over) return;
    if (state.paused) return;
    switch (name) {
      case 'left': g.left(); break;
      case 'right': g.right(); break;
      case 'cw': g.rotate(1); break;
      case 'ccw': g.rotate(-1); break;
      case 'hard': g.hardDrop(); break;
      case 'soft': g.softDrop(); break;
      case 'hold': g.holdPiece(); break;
    }
    handleEvents(performance.now());
    draw(performance.now());
    renderStatus();
  }

  /** לחיצה על כיוון: תזוזה אחת מיד, ואם מחזיקים — DAS/ARR בלולאה. */
  function pressDir(dir) {
    const h = state.held;
    h.dir = dir;
    h.das = 0;
    h.arr = 0;
    act(dir < 0 ? 'left' : 'right');
  }

  function releaseDir(dir) {
    const h = state.held;
    if (h.dir === dir) {
      h.dir = 0;
      // אם הכיוון השני עדיין מוחזק — ממשיכים אליו
      if (h.keys.has(dir < 0 ? 'right' : 'left')) pressDir(-dir);
    }
  }

  function releaseAll() {
    const h = state.held;
    h.dir = 0;
    h.soft = false;
    h.keys.clear();
    el.controls.querySelectorAll('.is-down').forEach((b) => b.classList.remove('is-down'));
  }

  /* --------------------------------------------------------------------- */
  /* מקלדת                                                                  */
  /* --------------------------------------------------------------------- */

  const KEYS = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'soft',
    ArrowUp: 'cw', x: 'cw', X: 'cw', z: 'ccw', Z: 'ccw', Control: 'ccw',
    ' ': 'hard', c: 'hold', C: 'hold', Shift: 'hold',
    a: 'ccw', A: 'ccw',
  };

  document.addEventListener('keydown', (e) => {
    if (window.Modal && window.Modal.top()) return;
    if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      e.preventDefault();
      if (state.paused) resume(); else pause();
      return;
    }
    const a = KEYS[e.key];
    if (!a) {
      if (e.key === 'Enter' && state.paused) { e.preventDefault(); resume(); }
      return;
    }
    e.preventDefault();
    if (state.paused) return;
    if (e.repeat) return; // החזרה מנוהלת אצלנו
    const h = state.held;
    if (a === 'left' || a === 'right') {
      h.keys.add(a);
      pressDir(a === 'left' ? -1 : 1);
    } else if (a === 'soft') {
      h.soft = true;
      act('soft');
    } else {
      act(a);
    }
  });

  document.addEventListener('keyup', (e) => {
    const a = KEYS[e.key];
    const h = state.held;
    if (a === 'left' || a === 'right') {
      h.keys.delete(a);
      releaseDir(a === 'left' ? -1 : 1);
    } else if (a === 'soft') {
      h.soft = false;
    }
  });

  /* --------------------------------------------------------------------- */
  /* כפתורים                                                                */
  /* --------------------------------------------------------------------- */

  el.controls.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.tt-btn');
    if (!b) return;
    e.preventDefault();
    try { b.setPointerCapture(e.pointerId); } catch (err) {}
    b.classList.add('is-down');
    const a = b.dataset.act;
    if (a === 'left' || a === 'right') { state.held.keys.add(a); pressDir(a === 'left' ? -1 : 1); }
    else if (a === 'soft') { state.held.soft = true; act('soft'); }
    else act(a);
  });

  function btnUp(e) {
    const b = e.target.closest && e.target.closest('.tt-btn');
    if (!b) return;
    b.classList.remove('is-down');
    const a = b.dataset.act;
    if (a === 'left' || a === 'right') { state.held.keys.delete(a); releaseDir(a === 'left' ? -1 : 1); }
    else if (a === 'soft') state.held.soft = false;
  }
  el.controls.addEventListener('pointerup', btnUp);
  el.controls.addEventListener('pointercancel', btnUp);
  el.controls.addEventListener('contextmenu', (e) => e.preventDefault());

  /* --------------------------------------------------------------------- */
  /* מחוות על הלוח                                                          */
  /* --------------------------------------------------------------------- */

  /*
   * גרירה אופקית מזיזה ריבוע לכל רוחב ריבוע שעבר. גרירה למטה — ירידה רכה.
   * הצלפה מהירה למטה (מהירות ב-80ms האחרונים) — הפלה; למעלה — שמירה.
   * נגיעה קצרה בלי תזוזה — סיבוב, לפי הצד שבו נגעו.
   */
  let gest = null;

  el.well.addEventListener('pointerdown', (e) => {
    if (state.paused || !state.game || state.game.over) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { el.well.setPointerCapture(e.pointerId); } catch (err) {}
    const now = performance.now();
    gest = {
      id: e.pointerId, x0: e.clientX, y0: e.clientY, ax: e.clientX, ay: e.clientY,
      t0: now, moved: false, samples: [{ y: e.clientY, t: now }],
    };
  });

  el.well.addEventListener('pointermove', (e) => {
    if (!gest || e.pointerId !== gest.id || state.paused) return;
    const step = dims.cell * 0.9;
    const now = performance.now();
    gest.samples.push({ y: e.clientY, t: now });
    while (gest.samples.length > 2 && now - gest.samples[0].t > 80) gest.samples.shift();

    let dx = e.clientX - gest.ax;
    while (Math.abs(dx) >= step) {
      const dir = dx > 0 ? 1 : -1;
      state.game.move(dir);
      gest.ax += dir * step;
      dx = e.clientX - gest.ax;
      gest.moved = true;
    }
    // ירידה רכה רק כשהגרירה בעיקר אנכית — כדי שתזוזה אופקית לא תוריד בטעות
    const dy = e.clientY - gest.ay;
    if (dy >= step && Math.abs(e.clientY - gest.y0) > Math.abs(e.clientX - gest.x0)) {
      const n = Math.floor(dy / step);
      for (let i = 0; i < n; i++) state.game.softDrop();
      gest.ay += n * step;
      gest.moved = true;
    }
    draw(performance.now());
  });

  function gestureEnd(e) {
    if (!gest || e.pointerId !== gest.id) return;
    const g = gest;
    gest = null;
    if (state.paused || !state.game || state.game.over) return;

    const now = performance.now();
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    const first = g.samples[0];
    const vy = (e.clientY - first.y) / Math.max(1, now - first.t); // px/ms

    if (!g.moved && Math.abs(dx) < 12 && Math.abs(dy) < 12 && now - g.t0 < 350) {
      const rect = el.well.getBoundingClientRect();
      act(e.clientX - rect.left > rect.width / 2 ? 'cw' : 'ccw');
      return;
    }
    if (vy > 0.9 && dy > dims.cell * 1.2) { act('hard'); return; }
    if (dy < -dims.cell * 2 && Math.abs(dy) > Math.abs(dx) * 1.5 && vy < -0.4) act('hold');
  }
  el.well.addEventListener('pointerup', gestureEnd);
  el.well.addEventListener('pointercancel', () => { gest = null; });

  /* --------------------------------------------------------------------- */
  /* לוח מחוונים                                                            */
  /* --------------------------------------------------------------------- */

  let lastStatus = '';
  function renderStatus() {
    const g = state.game;
    const best = Math.max(g.score, stats().best || 0);
    const key = g.score + '|' + g.lines + '|' + g.level + '|' + best;
    if (key === lastStatus) return;
    lastStatus = key;
    el.statScore.textContent = String(g.score);
    el.statBest.textContent = String(best);
    el.statLines.textContent = String(g.lines);
    el.statLevel.textContent = String(g.level);
    el.footerInfo.textContent = g.tetrises ? g.tetrises + ' טטריסים' : 'עוד ' + (10 - (g.lines % 10)) + ' שורות לשלב הבא';
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
    if (g.score > (s.best || 0)) s.best = g.score;
    if (g.lines > (s.bestLines || 0)) s.bestLines = g.lines;
    if (g.level > (s.bestLevel || 0)) s.bestLevel = g.level;
    s.totalLines = (s.totalLines || 0) + g.lines;
    s.tetrises = (s.tetrises || 0) + g.tetrises;
    s.totalScore = (s.totalScore || 0) + g.score;
    store.write(STATS_KEY, s);
    return s;
  }

  function showOver() {
    const g = state.game;
    const isBest = g.score > 0 && g.score >= (stats().best || 0);
    const s = recordEnd();
    store.remove(SAVE_KEY);
    releaseAll();

    feel('reject');
    say((isBest ? 'שיא חדש! ' : 'המשחק נגמר. ') + 'ניקוד ' + g.score, true);

    el.overTitle.textContent = isBest ? 'שיא חדש!' : 'המשחק נגמר';
    el.overSub.textContent = isBest ? 'זה הניקוד הגבוה ביותר שלך' : 'אין מקום לחלק הבא';
    el.overStats.innerHTML =
      '<div class="win-stat' + (isBest ? ' is-best' : '') + '"><span class="k">ניקוד</span><span class="v">' + g.score + '</span></div>' +
      '<div class="win-stat"><span class="k">שיא</span><span class="v">' + (s.best || g.score) + '</span></div>' +
      '<div class="win-stat"><span class="k">שורות</span><span class="v">' + g.lines + '</span></div>' +
      '<div class="win-stat"><span class="k">שלב</span><span class="v">' + g.level + '</span></div>';
    renderStatus();
    window.Modal.open(el.overModal);
  }

  /* --------------------------------------------------------------------- */
  /* משחק חדש                                                               */
  /* --------------------------------------------------------------------- */

  function newGame(autostart) {
    state.game = new Tetris();
    state.recorded = false;
    state.lockFlash = null;
    lastStatus = '';
    releaseAll();
    closeModal(el.overModal);
    resize();
    renderStatus();
    saveGame();
    if (autostart) { state.paused = true; resume(); }
    else {
      pause('מוכנים?');
      el.btnResume.textContent = 'מתחילים';
    }
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
    const avg = s.played ? Math.round((s.totalScore || 0) / s.played) : 0;
    const rows = [
      ['משחקים', String(s.played || 0)],
      ['הניקוד הגבוה ביותר', String(s.best || 0)],
      ['ניקוד ממוצע', s.played ? String(avg) : '—'],
      ['הכי הרבה שורות', String(s.bestLines || 0)],
      ['השלב הגבוה ביותר', String(s.bestLevel || 0)],
      ['טטריסים', String(s.tetrises || 0)],
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
      lastStatus = '';
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
      mode === 'vibrate' ? 'משוב מישושי על נעילה, שורות וסיום'
      : mode === 'ios-switch'
        ? 'באייפון הרטט מוגבל לנקישה אחידה, ובגרסאות iOS חדשות הוא עשוי לא לעבוד'
        : 'הדפדפן הזה אינו מאפשר רטט לדף. המשוב החזותי פועל כרגיל';
    const sw = document.getElementById('optHaptics');
    if (sw) sw.disabled = mode === 'none';
    openModal(el.settingsModal);
  });

  el.settingsModal.addEventListener('change', (e) => {
    const input = e.target.closest && e.target.closest('[data-pref]');
    if (!input) return;
    state.prefs[input.dataset.pref] = input.checked;
    savePrefs();
    if (input.dataset.pref === 'haptics' && H) H.setEnabled(input.checked);
    if (input.dataset.pref === 'controls') resize();
    else draw(performance.now());
  });

  el.btnNew.addEventListener('click', () => {
    const g = state.game;
    if (g && !g.over && g.score > 0) {
      askConfirm('להתחיל משחק חדש? ההתקדמות תימחק.', () => newGame(true));
      return;
    }
    newGame(true);
  });

  el.btnConfirmOk.addEventListener('click', () => {
    closeModal(el.confirmModal);
    const fn = confirmAction;
    confirmAction = null;
    if (fn) fn();
  });

  el.btnOverNew.addEventListener('click', () => newGame(true));

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

  // יציאה מהלשונית משהה — אחרת החלקים ממשיכים ליפול בלי אף אחד
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
    if (saved && Array.isArray(saved.board) && !saved.over) {
      state.game = Tetris.deserialize(saved);
      resize();
      renderStatus();
      pause('מושהה');
    } else {
      newGame(false);
    }

    if (!store.ok) setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
  }

  init();
})();
