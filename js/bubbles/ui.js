/* =============================================================================
 * bubbles/ui.js — ממשק באבלס
 * -----------------------------------------------------------------------------
 * ציור על canvas, כיוון (מגע / עכבר / מקלדת), הנפשות ושמירה.
 *
 * המנוע הוא מקור האמת, אבל הוא מסיים את הירייה מיד — כולל פיצוצים, נפילות
 * ודחיפת שורה. ה-UI לכן מחזיק "view": עותק של הלוח כפי שהוא מוצג כרגע.
 * בזמן שהבועה עפה מציירים את ה-view הישן; כשהיא נוחתת מחליפים אותו במצב
 * של המנוע ומפעילים את אפקטי הפיצוץ והנפילה במיקומים הישנים.
 *
 * כל הבועות מצוירות מ"ספרייטים" — canvas קטן לכל צבע שמוכן מראש בגודל
 * הנוכחי. גרדיאנט רדיאלי לכל בועה בכל פריים יקר מדי לטלפון.
 * =========================================================================== */
(function () {
  'use strict';

  const Bubbles = window.Bubbles;
  const H = window.Haptics;
  const EMPTY = Bubbles.EMPTY;
  const ROW_H = Bubbles.ROW_H;

  const $ = (s) => document.querySelector(s);

  const PREFS_KEY = 'bubbles.v1.prefs';
  const SAVE_KEY = 'bubbles.v1.save';
  const STATS_KEY = 'bubbles.v1.stats';

  /* הצבעים הקלאסיים של המשחק — זהים באור ובחושך. הסדר קבוע כי הוא נשמר
     במשחק השמור */
  const COLORS = ['#1818d8', '#00d4dc', '#dc1adc', '#10c010', '#f0dc00', '#e01010'];
  const NAMES = ['כחולה', 'תכלת', 'ורודה', 'ירוקה', 'צהובה', 'אדומה'];
  /* בועות הכסף שסופרות את היריות עד שורה חדשה */
  const SILVER = '#b4b4bc';
  const SILVER_GAP = 1.3;

  const ARROW = '#8286ee';
  const ARROW_LEN = 3.3;
  /* שוליים סביב הלוח, ביחידות קוטר */
  const PAD = 0.4;

  /* מהירות הבועה ביחידות קוטר לשנייה */
  const SPEED = 26;
  const GRAVITY = 42;

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
    symbols: false,
    longGuide: false,
  };

  const state = {
    prefs: Object.assign({}, DEFAULT_PREFS, store.read(PREFS_KEY, {})),
    game: null,
    /** הלוח כפי שהוא מצויר כרגע: { grid, shift } */
    view: null,
    aim: { angle: Math.PI / 2, visible: false, dragging: false },
    /** הבועה שבאוויר: { color, path, seg, pos } */
    flyer: null,
    pops: [],
    drops: [],
    /** הנפשת ירידת שורה: { t0, dur, rows } */
    slide: null,
    busy: false,
  };

  const el = {
    board: $('#board'),
    canvas: $('#canvas'),
    statScore: $('#statScore'),
    statBest: $('#statBest'),
    statPopped: $('#statPopped'),
    footerInfo: $('#footerInfo'),
    toast: $('#toast'),
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

  /* מידות: S = פיקסלי מכשיר ליחידת קוטר */
  const dims = { S: 1, dpr: 1, world: null, ox: 0, oy: 0, W: 1, H: 1 };
  let sprites = [];

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

  const openModal = (n) => window.Modal.open(n);
  const closeModal = (n) => window.Modal.close(n);

  let confirmAction = null;
  function askConfirm(text, onOk) {
    el.confirmText.textContent = text;
    confirmAction = onOk;
    openModal(el.confirmModal);
  }

  function feel(name) { if (state.prefs.haptics && H) H.fire(name); }

  const savePrefs = () => store.write(PREFS_KEY, state.prefs);
  function saveGame() { if (state.game) store.write(SAVE_KEY, state.game.serialize()); }
  const stats = () => store.read(STATS_KEY, {});

  function applyTheme() {
    const pref = state.prefs.theme;
    const dark = pref === 'dark' ||
      (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    requestDraw();
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.prefs.theme === 'auto') applyTheme();
  });

  function snapshot() {
    return { grid: state.game.grid.map((r) => r.slice()), shift: state.game.shift };
  }

  /* --------------------------------------------------------------------- */
  /* מידות וספרייטים                                                        */
  /* --------------------------------------------------------------------- */

  function resize() {
    const w = state.game.world();
    dims.world = w;
    dims.dpr = Math.min(window.devicePixelRatio || 1, 3);
    // שוליים סביב הלוח, כדי שהמסגרת לא תחתוך את הבועות הקיצוניות
    dims.ox = PAD;
    dims.oy = PAD;
    dims.W = w.width + PAD * 2;
    dims.H = w.height + PAD;
    const cssW = el.board.clientWidth || 360;
    const cssH = cssW * (dims.H / dims.W);
    el.canvas.style.height = cssH + 'px';
    el.canvas.width = Math.round(cssW * dims.dpr);
    el.canvas.height = Math.round(cssH * dims.dpr);
    dims.S = el.canvas.width / dims.W;
    buildSprites();
    requestDraw();
  }

  /* מעולם המשחק לפיקסלים של ה-canvas */
  const X = (x) => (x + dims.ox) * dims.S;
  const Y = (y) => (y + dims.oy) * dims.S;

  function buildSprites() {
    const R = Math.max(4, Math.round(dims.S * 0.5));
    sprites = COLORS.concat([SILVER]).map((base, i) => {
      const c = document.createElement('canvas');
      c.width = c.height = R * 2 + 2;
      const g = c.getContext('2d');
      const cx = R + 1, cy = R + 1;

      /* גוף — כדור מבריק בסגנון הקלאסי: מרכז בהיר, שפה כהה */
      const grad = g.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R);
      grad.addColorStop(0, mix(base, '#ffffff', 0.45));
      grad.addColorStop(0.5, base);
      grad.addColorStop(0.9, mix(base, '#000000', 0.45));
      grad.addColorStop(1, mix(base, '#000000', 0.6));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
      g.fill();

      /* אור מוחזר בתחתית-ימין */
      g.save();
      g.beginPath();
      g.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
      g.clip();
      const back = g.createRadialGradient(cx + R * 0.45, cy + R * 0.5, 0, cx + R * 0.45, cy + R * 0.5, R * 0.6);
      back.addColorStop(0, 'rgba(255,255,255,.45)');
      back.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = back;
      g.fillRect(0, 0, c.width, c.height);
      g.restore();

      /* ברק — כתם לבן חד בשמאל-למעלה */
      const spec = g.createRadialGradient(cx - R * 0.38, cy - R * 0.42, 0, cx - R * 0.38, cy - R * 0.42, R * 0.34);
      spec.addColorStop(0, 'rgba(255,255,255,1)');
      spec.addColorStop(0.5, 'rgba(255,255,255,.75)');
      spec.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = spec;
      g.beginPath();
      g.ellipse(cx - R * 0.38, cy - R * 0.42, R * 0.34, R * 0.26, -0.7, 0, Math.PI * 2);
      g.fill();

      if (state.prefs.symbols && i < COLORS.length) drawSymbol(g, i, cx, cy, R * 0.32);
      return c;
    });
  }

  /** צורה לבנה לכל צבע, למי שמתקשה להבחין בין הצבעים. */
  function drawSymbol(g, i, x, y, s) {
    g.save();
    g.fillStyle = 'rgba(255,255,255,.9)';
    g.strokeStyle = 'rgba(0,0,0,.4)';
    g.lineWidth = Math.max(1, s * 0.12);
    g.beginPath();
    if (i === 0) g.arc(x, y, s * 0.8, 0, Math.PI * 2);
    else if (i === 1) { g.moveTo(x, y - s); g.lineTo(x + s, y + s * 0.8); g.lineTo(x - s, y + s * 0.8); g.closePath(); }
    else if (i === 2) g.rect(x - s * 0.75, y - s * 0.75, s * 1.5, s * 1.5);
    else if (i === 3) { g.moveTo(x, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x - s, y); g.closePath(); }
    else if (i === 4) {
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rr = k % 2 ? s * 0.45 : s;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.closePath();
    } else {
      const t = s * 0.32;
      g.rect(x - s, y - t, s * 2, t * 2);
      g.rect(x - t, y - s, t * 2, s * 2);
    }
    g.fill();
    g.stroke();
    g.restore();
  }

  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (p, s) => (p >> s) & 255;
    const m = (s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
    return 'rgb(' + m(16) + ',' + m(8) + ',' + m(0) + ')';
  }

  /* --------------------------------------------------------------------- */
  /* ציור                                                                   */
  /* --------------------------------------------------------------------- */

  let rafId = 0;
  let lastT = 0;

  function requestDraw() {
    if (rafId || !state.game || !dims.world) return;
    rafId = requestAnimationFrame(frame);
  }

  function inDanger() {
    const g = state.game;
    return !!g && !g.over && state.view.grid[g.rows - 2].some((v) => v !== EMPTY);
  }

  function animating() {
    return !!(state.flyer || state.pops.length || state.drops.length || state.slide || inDanger());
  }

  function frame(now) {
    rafId = 0;
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0.016;
    lastT = now;
    update(dt, now);
    draw(now);
    if (animating()) rafId = requestAnimationFrame(frame);
    else lastT = 0;
  }

  function bubble(color, x, y, scale, alpha) {
    const sp = sprites[color];
    if (!sp) return;
    const w = sp.width * (scale || 1);
    if (alpha != null) ctx.globalAlpha = alpha;
    ctx.drawImage(sp, X(x) - w / 2, Y(y) - w / 2, w, w);
    if (alpha != null) ctx.globalAlpha = 1;
  }

  function slideOffset(now) {
    if (!state.slide) return 0;
    const p = Math.min(1, (now - state.slide.t0) / state.slide.dur);
    const e = 1 - Math.pow(1 - p, 3);
    return -state.slide.rows * ROW_H * (1 - e);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** מסגרת הלוח — קו כהה ולצידו קו בהיר, כמו חריטה בפאנל. */
  function drawFrame(now, danger) {
    const S = dims.S;
    const w = dims.world;
    const m = 0.2;
    const x = X(-m), y = Y(-m);
    const fw = (w.width + m * 2) * S, fh = (w.lineY + m) * S;
    const r = S * 0.4;
    const lw = Math.max(1, S * 0.07);
    ctx.save();
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    roundRect(x + lw, y + lw, fw, fh, r);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(96,96,190,.6)';
    roundRect(x, y, fw, fh, r);
    ctx.stroke();
    if (danger) {
      /* הבועות שורה אחת מהתחתית — קו התחתית מהבהב באדום */
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 150);
      ctx.strokeStyle = '#e01010';
      ctx.lineWidth = Math.max(2, S * 0.1);
      ctx.beginPath();
      ctx.moveTo(x + r, y + fh);
      ctx.lineTo(x + fw - r, y + fh);
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw(now) {
    const g = state.game;
    ctx.clearRect(0, 0, el.canvas.width, el.canvas.height);

    drawFrame(now, inDanger());

    /* הלוח */
    const dy = slideOffset(now);
    const v = state.view;
    for (let r = 0; r < v.grid.length; r++) {
      const row = v.grid[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c] === EMPTY) continue;
        const p = Bubbles.center(r, c, v.shift);
        bubble(row[c], p.x, p.y + dy);
      }
    }

    /* מסלול מלא — רק אם הופעל בהגדרות */
    if (state.prefs.longGuide && state.aim.visible && !state.busy && !g.over) drawGuide();

    drawShooter();

    /* בועה באוויר */
    if (state.flyer) bubble(state.flyer.color, state.flyer.pos.x, state.flyer.pos.y);

    /* פיצוצים ונפילות */
    state.pops.forEach((p) => {
      const t = (now - p.t0) / 240;
      if (t < 0) { bubble(p.color, p.x, p.y); return; }
      bubble(p.color, p.x, p.y, 1 + t * 0.5, Math.max(0, 1 - t));
    });
    state.drops.forEach((d) => bubble(d.color, d.x, d.y, 1, d.alpha));
  }

  function drawGuide() {
    const g = state.game;
    const t = g.trace(state.aim.angle);
    const S = dims.S;
    const pts = t.path;
    const gap = 0.5;

    /* אורכים מצטברים, כדי למקם נקודה לפי מרחק לאורך המסלול כולו */
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    // מתחילים אחרי קצה החץ, ועוצרים לפני מרכז התא הסופי
    const total = cum[cum.length - 1] - 0.55;

    ctx.save();
    ctx.fillStyle = ARROW;
    ctx.globalAlpha = 0.7;
    let seg = 0;
    for (let d = ARROW_LEN + 0.3; d < total; d += gap) {
      while (seg < pts.length - 2 && cum[seg + 1] < d) seg++;
      const a = pts[seg], b = pts[seg + 1];
      const k = (d - cum[seg]) / ((cum[seg + 1] - cum[seg]) || 1);
      ctx.beginPath();
      ctx.arc(X(a.x + (b.x - a.x) * k), Y(a.y + (b.y - a.y) * k), S * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (t.cell) {
      const p = g.center(t.cell.r, t.cell.c);
      bubble(g.current, p.x, p.y, 1, 0.35);
    }
  }

  function drawShooter() {
    const g = state.game;
    const S = dims.S;
    const s = dims.world.shooter;

    /* החץ — קו עם ראש פתוח, מתחיל מעל הבועה שבתותח */
    if (!g.over) {
      ctx.save();
      ctx.translate(X(s.x), Y(s.y));
      ctx.rotate(-state.aim.angle);
      ctx.strokeStyle = ARROW;
      ctx.lineWidth = Math.max(1.5, S * 0.1);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(S * 0.55, 0);
      ctx.lineTo(S * ARROW_LEN, 0);
      ctx.moveTo(S * (ARROW_LEN - 0.42), -S * 0.3);
      ctx.lineTo(S * ARROW_LEN, 0);
      ctx.lineTo(S * (ARROW_LEN - 0.42), S * 0.3);
      ctx.stroke();
      ctx.restore();
    }

    /* הבועה בתותח, הבאה בשמאל, ובועות הכסף — כמה יריות עד שורה חדשה */
    const nx = nextPos();
    if (state.flyer) bubble(g.current, nx.x, nx.y); // הבאה ממתינה לתורה
    else {
      if (!g.over) bubble(g.current, s.x, s.y);
      bubble(g.next, nx.x, nx.y);
    }

    const left = g.over ? 0 : g.shotsLeft();
    for (let i = 0; i < left; i++) bubble(COLORS.length, nx.x + SILVER_GAP * (i + 1), s.y);
  }

  function nextPos() {
    return { x: 0.5, y: dims.world.shooter.y };
  }

  /* --------------------------------------------------------------------- */
  /* עדכון הנפשות                                                           */
  /* --------------------------------------------------------------------- */

  function update(dt, now) {
    const f = state.flyer;
    if (f) {
      let move = SPEED * dt;
      while (move > 0 && f.seg < f.path.length - 1) {
        const b = f.path[f.seg + 1];
        const d = Math.hypot(b.x - f.pos.x, b.y - f.pos.y);
        if (d <= move) {
          f.pos = { x: b.x, y: b.y };
          f.seg++;
          move -= d;
        } else {
          f.pos = { x: f.pos.x + ((b.x - f.pos.x) / d) * move, y: f.pos.y + ((b.y - f.pos.y) / d) * move };
          move = 0;
        }
      }
      if (f.seg >= f.path.length - 1) land(now);
    }

    state.pops = state.pops.filter((p) => now - p.t0 < 240);

    const h = dims.world.height;
    state.drops.forEach((d) => {
      d.vy += GRAVITY * dt;
      d.y += d.vy * dt;
      d.x += d.vx * dt;
      if (d.y > h - 1.5) d.alpha = Math.max(0, d.alpha - dt * 5);
    });
    state.drops = state.drops.filter((d) => d.alpha > 0 && d.y < h + 1);

    if (state.slide && now - state.slide.t0 >= state.slide.dur) state.slide = null;
  }

  /* --------------------------------------------------------------------- */
  /* ירייה                                                                  */
  /* --------------------------------------------------------------------- */

  let pending = null;

  function fire() {
    const g = state.game;
    if (!g || g.over || state.busy) return;
    if (window.Modal && window.Modal.top()) return;

    const before = snapshot();
    const res = g.shoot(state.aim.angle);
    if (!res) return;

    state.view = before;
    state.busy = true;
    pending = res;
    state.flyer = { color: res.color, path: res.path, seg: 0, pos: res.path[0] };
    feel('pick');
    saveGame();

    if (reducedMotion) { land(performance.now()); return; }
    requestDraw();

    /* requestAnimationFrame נעצר כשהדף מוסתר. בלי הגיבוי הזה ירייה שיצאה
       רגע לפני מעבר לשונית נשארת "באוויר" וחוסמת את הירייה הבאה */
    let len = 0;
    for (let i = 1; i < res.path.length; i++) {
      len += Math.hypot(res.path[i].x - res.path[i - 1].x, res.path[i].y - res.path[i - 1].y);
    }
    clearTimeout(landTimer);
    landTimer = setTimeout(() => {
      if (pending === res) { land(performance.now()); requestDraw(); }
    }, (len / SPEED) * 1000 + 250);
  }

  let landTimer = null;

  function land(now) {
    const res = pending;
    pending = null;
    clearTimeout(landTimer);
    state.flyer = null;
    if (!res) return;

    const shift = res.shift;
    res.popped.forEach((p, i) => {
      const c = Bubbles.center(p.r, p.c, shift);
      state.pops.push({ x: c.x, y: c.y, color: p.color, t0: now + i * 22 });
    });
    res.dropped.forEach((p) => {
      const c = Bubbles.center(p.r, p.c, shift);
      state.drops.push({
        x: c.x, y: c.y, color: p.color, alpha: 1,
        vx: (Math.random() - 0.5) * 3, vy: -2 - Math.random() * 3,
      });
    });

    state.view = snapshot();

    const slid = (res.pushed ? 1 : 0) + res.refilled;
    if (slid && !reducedMotion) state.slide = { t0: now, dur: 260 + 90 * (slid - 1), rows: slid };

    if (res.popped.length) {
      feel('lock');
      showGain(res);
      const n = res.popped.length + res.dropped.length;
      say(n + ' בועות' + (res.dropped.length ? ', ' + res.dropped.length + ' נפלו' : ''));
    } else {
      feel('move');
    }
    if (res.pushed) { feel('reject'); say('שורה חדשה ירדה'); }
    if (res.cleared) {
      feel('win');
      toast('הלוח נוקה! +' + Bubbles.CLEAR_BONUS);
    }

    state.busy = false;
    renderStatus();
    requestDraw();

    if (res.over) setTimeout(showOver, 650);
  }

  function showGain(res) {
    if (!res.gained) return;
    const rect = el.canvas.getBoundingClientRect();
    const k = rect.width / dims.W;
    const c = Bubbles.center(res.cell.r, res.cell.c, res.shift);
    c.x += dims.ox; c.y += dims.oy;
    const span = document.createElement('span');
    span.className = 'gain' + (res.gained >= 200 ? ' is-big' : '');
    span.textContent = '+' + res.gained;
    span.style.left = rect.left + c.x * k + 'px';
    span.style.top = rect.top + c.y * k - 10 + 'px';
    document.body.appendChild(span);
    setTimeout(() => span.remove(), 950);
  }

  function swap() {
    const g = state.game;
    if (!g || g.over || state.busy) return;
    if (g.current === g.next) return;
    g.swap();
    feel('pick');
    say('בתותח: ' + NAMES[g.current]);
    saveGame();
    requestDraw();
  }

  /* --------------------------------------------------------------------- */
  /* לוח מחוונים                                                            */
  /* --------------------------------------------------------------------- */

  function renderStatus() {
    const g = state.game;
    const s = stats();
    el.statScore.textContent = String(g.score);
    el.statBest.textContent = String(Math.max(g.score, s.best || 0));
    el.statPopped.textContent = String(g.popped);
    const left = g.shotsLeft();
    el.footerInfo.textContent = g.over ? g.shots + ' יריות'
      : (left === 1 ? 'שורה חדשה בירייה הבאה' : 'שורה חדשה בעוד ' + left + ' יריות');
    el.board.classList.toggle('is-over', g.over);
  }

  /* --------------------------------------------------------------------- */
  /* סיום                                                                   */
  /* --------------------------------------------------------------------- */

  function recordEnd() {
    const g = state.game;
    const s = stats();
    s.played = (s.played || 0) + 1;
    if (g.score > (s.best || 0)) s.best = g.score;
    if (g.popped > (s.bestPopped || 0)) s.bestPopped = g.popped;
    s.totalScore = (s.totalScore || 0) + g.score;
    s.totalPopped = (s.totalPopped || 0) + g.popped;
    store.write(STATS_KEY, s);
    return s;
  }

  function showOver() {
    const g = state.game;
    const isBest = g.score > 0 && g.score >= (stats().best || 0);
    const s = recordEnd();

    feel('reject');
    say((isBest ? 'שיא חדש! ' : 'הבועות הגיעו לקו. ') + 'ניקוד ' + g.score, true);

    el.overTitle.textContent = isBest ? 'שיא חדש!' : 'הבועות הגיעו לקו';
    el.overSub.textContent = isBest ? 'זה הניקוד הגבוה ביותר שלך' : 'בפעם הבאה — נסו לנתק ענפים שלמים';

    el.overStats.innerHTML =
      '<div class="win-stat' + (isBest ? ' is-best' : '') + '"><span class="k">ניקוד</span><span class="v">' + g.score + '</span></div>' +
      '<div class="win-stat"><span class="k">שיא</span><span class="v">' + (s.best || g.score) + '</span></div>' +
      '<div class="win-stat"><span class="k">בועות</span><span class="v">' + g.popped + '</span></div>' +
      '<div class="win-stat"><span class="k">יריות</span><span class="v">' + g.shots + '</span></div>';

    renderStatus();
    openModal(el.overModal);
  }

  /* --------------------------------------------------------------------- */
  /* משחק חדש                                                               */
  /* --------------------------------------------------------------------- */

  function newGame() {
    state.game = new Bubbles();
    state.view = snapshot();
    state.flyer = null;
    pending = null;
    state.pops = [];
    state.drops = [];
    state.busy = false;
    state.slide = null;
    closeModal(el.overModal);
    resize();
    // הלוח יורד פנימה מלמעלה
    if (!reducedMotion) state.slide = { t0: performance.now(), dur: 600, rows: state.game.startRows };
    renderStatus();
    saveGame();
  }

  /* --------------------------------------------------------------------- */
  /* קלט                                                                    */
  /* --------------------------------------------------------------------- */

  function toWorld(e) {
    const rect = el.canvas.getBoundingClientRect();
    const k = dims.W / rect.width;
    return { x: (e.clientX - rect.left) * k - dims.ox, y: (e.clientY - rect.top) * k - dims.oy };
  }

  const near = (p, q, d) => Math.hypot(p.x - q.x, p.y - q.y) < d;

  /** מעדכן את הזווית לפי נקודה. מחזיר false אם הנקודה מתחת לתותח. */
  function aimAt(p) {
    const s = dims.world.shooter;
    const dy = s.y - p.y;
    if (dy < 0.35) { state.aim.visible = false; requestDraw(); return false; }
    state.aim.angle = Bubbles.clampAngle(Math.atan2(dy, p.x - s.x));
    state.aim.visible = true;
    requestDraw();
    return true;
  }

  el.canvas.addEventListener('pointerdown', (e) => {
    if (!state.game || state.game.over) return;
    const p = toWorld(e);
    const s = dims.world.shooter;
    if (near(p, s, 0.75) || near(p, nextPos(), 0.7)) {
      swap();
      return;
    }
    state.aim.dragging = true;
    try { el.canvas.setPointerCapture(e.pointerId); } catch (err) {}
    aimAt(p);
  });

  el.canvas.addEventListener('pointermove', (e) => {
    if (!state.game) return;
    if (state.aim.dragging || e.pointerType === 'mouse') aimAt(toWorld(e));
  });

  el.canvas.addEventListener('pointerup', (e) => {
    if (!state.aim.dragging) return;
    state.aim.dragging = false;
    const ok = aimAt(toWorld(e));
    if (ok) fire();
    if (e.pointerType !== 'mouse') state.aim.visible = false;
    requestDraw();
  });

  el.canvas.addEventListener('pointercancel', () => {
    state.aim.dragging = false;
    state.aim.visible = false;
    requestDraw();
  });

  el.canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !state.aim.dragging) {
      state.aim.visible = false;
      requestDraw();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (window.Modal && window.Modal.top()) return;
    if (!state.game) return;
    const step = e.shiftKey ? 0.012 : 0.04;
    let handled = true;
    switch (e.key) {
      case 'ArrowLeft': state.aim.angle = Bubbles.clampAngle(state.aim.angle + step); break;
      case 'ArrowRight': state.aim.angle = Bubbles.clampAngle(state.aim.angle - step); break;
      case ' ': case 'Enter': case 'ArrowUp': fire(); break;
      case 'x': case 'X': case 'ArrowDown': swap(); break;
      default: handled = false;
    }
    if (!handled) return;
    e.preventDefault();
    state.aim.visible = true;
    requestDraw();
  });

  /* --------------------------------------------------------------------- */
  /* אירועים                                                                */
  /* --------------------------------------------------------------------- */

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
      ['הכי הרבה בועות במשחק', String(s.bestPopped || 0)],
      ['בועות שפוצצו', String(s.totalPopped || 0)],
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
      mode === 'vibrate' ? 'משוב מישושי על ירייה, פיצוץ וסיום'
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
    const key = input.dataset.pref;
    state.prefs[key] = input.checked;
    savePrefs();
    if (key === 'haptics' && H) H.setEnabled(input.checked);
    if (key === 'symbols') buildSprites();
    requestDraw();
  });

  el.btnNew.addEventListener('click', () => {
    if (state.game && !state.game.over && state.game.shots > 3) {
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
    resizeTimer = setTimeout(() => { if (state.game) resize(); }, 100);
  });

  window.addEventListener('pagehide', saveGame);
  window.addEventListener('beforeunload', saveGame);

  /* --------------------------------------------------------------------- */
  /* אתחול                                                                  */
  /* --------------------------------------------------------------------- */

  function init() {
    applyTheme();
    if (H) H.setEnabled(!!state.prefs.haptics);

    const saved = store.read(SAVE_KEY, null);
    // משחק שמור מגרסה עם מידות אחרות לא נטען — הוא לא יתאים לעיצוב
    if (saved && Array.isArray(saved.grid) && !saved.over &&
        saved.cols === Bubbles.DEFAULTS.cols && saved.rows === Bubbles.DEFAULTS.rows) {
      state.game = Bubbles.deserialize(saved);
      state.view = snapshot();
      resize();
      renderStatus();
    } else {
      newGame();
    }

    if (!store.ok) setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
  }

  init();
})();
