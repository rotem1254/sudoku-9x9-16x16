/* =============================================================================
 * backgammon/ui.js — ממשק השש-בש
 * -----------------------------------------------------------------------------
 * הלוח: מסגרת, 24 נקודות, בר ומגש, וכל אחת מ-30 האבנים היא אלמנט קבוע עם
 * זהות משלו. אחרי כל שינוי בעמדה, reconcile() משייך אבנים למקומות החדשים
 * ומזיז רק את מה שצריך — כך כל מהלך, הכאה, ביטול או טעינה הוא אנימציה
 * חלקה של אבנים אמיתיות, ולא ציור מחדש.
 *
 * הזזה: נגיעה באבן ואז ביעד, גרירה, או הקשה אחת כשיש יעד יחיד. יעד שדורש
 * את שתי הקוביות באותה אבן מסומן בגוון חלש יותר, ונגיעה בו משחקת את שתיהן.
 * חוקיות כל מהלך בודד נבדקת מול רשימת התורות החוקיים המלאה
 * (Backgammon.partial), ולכן אי אפשר "להיתקע" באמצע תור.
 *
 * המחשב חושב באותו thread. כל פעולה שעלולה להתנגש בתור שלו (משחק חדש,
 * טעינה) מקדמת את token, ותשובה עם token ישן נזרקת.
 * =========================================================================== */
(function () {
  'use strict';

  const BG = window.Backgammon;
  const AI = window.BackgammonAI;
  const H = window.Haptics;
  const S = window.Sound;

  const $ = (s) => document.querySelector(s);

  const PREFS_KEY = 'backgammon.v1.prefs';
  const SAVE_KEY = 'backgammon.v1.save';
  const STATS_KEY = 'backgammon.v1.stats';

  const LEVEL_NAMES = { 1: 'מתחיל', 2: 'קל', 3: 'בינוני', 4: 'קשה', 5: 'אלוף' };
  const LEVEL_DESC = {
    1: 'טועה הרבה — מתאים ללמידת החוקים.',
    2: 'משחק סביר, עם טעויות מדי פעם.',
    3: 'הרשת בוחרת את המהלך הטוב ביותר שהיא רואה.',
    4: 'בודקת גם את התשובה של היריב לכל אחת מ-21 ההטלות.',
    5: 'חיפוש רחב ועמוק יותר, והחלטות קובייה מדויקות.',
  };

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
    sound: true,
    skin: 'soft',
    mirror: false,
    numbers: true,
    pips: true,
    meter: false,
    showMoves: true,
    quickMove: true,
    autoRoll: true,
    autoConfirm: false,
    autoForced: true,
    fast: false,
    // אפשרויות המשחק החדש האחרון
    mode: 'ai',
    level: '3',
    match: '0',
    cube: '0',
  };

  const state = {
    prefs: Object.assign({}, DEFAULT_PREFS, store.read(PREFS_KEY, {})),
    mode: 'ai',
    level: 3,
    matchTo: 0,
    cubeOn: true,
    score: [0, 0],
    crawford: false,
    crawfordUsed: false,
    gameNo: 1,
    pos: BG.initial(),
    turn: 0,
    phase: 'idle', // opening | preroll | move | cube | over
    dice: null,
    opening: null, // [קובייה של 0, קובייה של 1] בהטלת הפתיחה
    startPos: null,
    legal: [],
    played: [],
    part: null,
    cube: { value: 1, owner: -1 },
    offer: -1, // מי הציע הכפלה שממתינה לתשובה
    selected: null, // אינדקס מוצא, מנקודת המבט של מי שמשחק
    targets: new Map(),
    hint: null,
    lastTurn: null,
    result: null,
    busy: false,
    token: 0,
    turnId: 0, // מתקדם בכל החלפת תור — המתנות של תור קודם לא נוגעות בחדש
    hints: 0,
  };

  /*
   * גרסה 2 של ההעדפות: לוח "רך" וקוביית הכפלה כבויה כברירת מחדל. מי ששמר
   * העדפות לפני כן קיבל את ברירות המחדל הישנות בלי שבחר בהן — ולכן הן
   * מוחלפות פעם אחת. אחר כך כל בחירה שלו נשמרת כרגיל
   */
  if (!state.prefs.v2) {
    state.prefs.skin = 'soft';
    state.prefs.cube = '0';
    state.prefs.v2 = true;
    store.write(PREFS_KEY, state.prefs);
  }

  const el = {
    stage: $('.bg-stage'),
    actions: $('.bg-actions'),
    optCube: $('#optCube'),
    board: $('#board'),
    frame: $('#frame'),
    points: $('#points'),
    labels: $('#labels'),
    checkers: $('#checkers'),
    cube: $('#cube'),
    dice: $('#dice'),
    zones: $('#zones'),
    banner: $('#banner'),
    playerTop: $('#playerTop'),
    playerBottom: $('#playerBottom'),
    chipTop: $('#chipTop'),
    chipBottom: $('#chipBottom'),
    nameTop: $('#nameTop'),
    nameBottom: $('#nameBottom'),
    pipsTop: $('#pipsTop'),
    pipsBottom: $('#pipsBottom'),
    scoreTop: $('#scoreTop'),
    scoreBottom: $('#scoreBottom'),
    meter: $('#meter'),
    meterFill: $('#meterFill'),
    meterText: $('#meterText'),
    statusLine: $('#statusLine'),
    moveLog: $('#moveLog'),
    btnNew: $('#btnNew'),
    btnUndo: $('#btnUndo'),
    btnMain: $('#btnMain'),
    mainLabel: $('#mainLabel'),
    btnHint: $('#btnHint'),
    btnDouble: $('#btnDouble'),
    footerInfo: $('#footerInfo'),
    toast: $('#toast'),
    newModal: $('#newModal'),
    aiOnly: $('#aiOnly'),
    levelDesc: $('#levelDesc'),
    matchDesc: $('#matchDesc'),
    btnStart: $('#btnStart'),
    cubeModal: $('#cubeModal'),
    cubeBig: $('#cubeBig'),
    cubeTitle: $('#cubeTitle'),
    cubeSub: $('#cubeSub'),
    btnTake: $('#btnTake'),
    btnPass: $('#btnPass'),
    overModal: $('#overModal'),
    overBadge: $('#overBadge'),
    overTitle: $('#overTitle'),
    overSub: $('#overSub'),
    overStats: $('#overStats'),
    confetti: $('#confetti'),
    btnOverNext: $('#btnOverNext'),
    btnOverLook: $('#btnOverLook'),
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
    confirmModal: $('#confirmModal'),
    confirmText: $('#confirmText'),
    btnConfirmOk: $('#btnConfirmOk'),
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --------------------------------------------------------------------- */
  /* עזרים                                                                  */
  /* --------------------------------------------------------------------- */

  const say = (msg, loud) => { if (window.Announce) window.Announce.say(msg, loud); };

  let toastTimer = null;
  function toast(msg, ms) {
    say(msg);
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms || 2300);
  }

  function banner(msg) {
    el.banner.hidden = true;
    void el.banner.offsetWidth;
    el.banner.textContent = msg;
    el.banner.hidden = false;
    clearTimeout(banner.t);
    banner.t = setTimeout(() => { el.banner.hidden = true; }, 1400);
  }

  const openModal = (n) => window.Modal.open(n);
  const closeModal = (n) => window.Modal.close(n);

  let confirmAction = null;
  function askConfirm(text, onOk) {
    el.confirmText.textContent = text;
    confirmAction = onOk;
    openModal(el.confirmModal);
  }

  const feel = (name) => { if (state.prefs.haptics && H) H.fire(name); };
  const sound = (name) => { if (state.prefs.sound && S) S.play(name); };

  const savePrefs = () => store.write(PREFS_KEY, state.prefs);
  const stats = () => store.read(STATS_KEY, {});
  const wait = (ms) => new Promise((r) => setTimeout(r, reducedMotion ? Math.min(ms, 60) : ms));
  const speed = (ms) => (state.prefs.fast ? Math.round(ms * 0.45) : ms);

  const isAI = (side) => state.mode === 'ai' && side === 1;
  const humanTurn = () => !isAI(state.turn);
  const sideName = (side) => {
    if (state.mode === 'pvp') return side === 0 ? 'לבן' : 'שחור';
    return side === 0 ? 'את/ה' : 'מחשב';
  };

  function cubeState() {
    return {
      value: state.cube.value, owner: state.cube.owner,
      matchTo: state.matchTo, score: state.score.slice(),
      crawford: state.crawford, disabled: !state.cubeOn,
    };
  }

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
  /* שמירה                                                                  */
  /* --------------------------------------------------------------------- */

  function saveGame() {
    if (state.phase === 'idle') return;
    if (state.phase === 'over' && state.result && state.result.matchOver) { store.remove(SAVE_KEY); return; }
    store.write(SAVE_KEY, {
      v: 1,
      mode: state.mode, level: state.level, matchTo: state.matchTo, cubeOn: state.cubeOn,
      score: state.score, crawford: state.crawford, crawfordUsed: state.crawfordUsed,
      gameNo: state.gameNo, pos: Array.from(state.pos), turn: state.turn, phase: state.phase,
      dice: state.dice, startPos: state.startPos ? Array.from(state.startPos) : null,
      played: state.played, cube: state.cube, offer: state.offer,
      lastTurn: state.lastTurn, result: state.result, hints: state.hints,
    });
  }

  /* --------------------------------------------------------------------- */
  /* גאומטריה                                                               */
  /* --------------------------------------------------------------------- */

  /*
   * יחידה אחת: u = רוחב נקודה. מימין לשמאל (בלי שיקוף):
   *   מסגרת .3 | 6 נקודות | בר 1 | 6 נקודות | מסגרת .3 | מגש 1 | מסגרת .3
   * = 14.9 יחידות רוחב. גובה: מסגרת .62 + שדה 11.7 + מסגרת .62.
   */
  const G = { u: 24, W: 0, H: 0, x0: 0, trayX: 0, ft: 0, fb: 0, mid: 0, c: 0 };
  const WU = 14.9, HU = 12.94;

  function measure() {
    const availW = Math.min(el.stage.clientWidth || 360, 820);
    const top = el.board.getBoundingClientRect().top + window.scrollY;
    // מתחת ללוח: שחקן, מד, שורת מצב, כפתורים, רישום ופוטר
    const below = 232 + (state.prefs.meter ? 22 : 0);
    const availH = window.innerHeight - top - below;
    let u = Math.min(availW / WU, Math.max(availH, 250) / HU, 50);
    u = Math.max(17, Math.floor(u * 4) / 4);
    G.u = u;
    G.W = Math.round(u * WU);
    G.H = Math.round(u * HU);
    const mirror = !!state.prefs.mirror;
    G.x0 = (mirror ? 1.6 : 0.3) * u;
    G.trayX = (mirror ? 0.3 : 13.6) * u;
    G.ft = 0.62 * u;
    G.fb = G.H - 0.62 * u;
    G.mid = G.H / 2;
    G.c = 0.96 * u;
    G.ptH = 4.85 * u;
    el.board.style.width = G.W + 'px';
    el.board.style.height = G.H + 'px';
    el.board.style.setProperty('--u', u + 'px');
    el.stage.style.setProperty('--board-w', G.W + 'px');
  }

  /** עמודה (0..11 משמאל לימין) ושורה של נקודה, לפי האינדקס של צד 0 */
  function ptCol(i) {
    const top = i >= 12;
    if (!state.prefs.mirror) return { k: top ? i - 12 : 11 - i, top };
    return { k: top ? 23 - i : i, top };
  }
  const colX = (k) => G.x0 + k * G.u + (k >= 6 ? G.u : 0);
  const barX = () => G.x0 + 6 * G.u;

  /** המקום בלוח (מפתח) של אינדקס מנקודת המבט של side */
  function locOf(side, idx) {
    if (idx === BG.BAR) return 'b' + side;
    if (idx === BG.OFF) return 'f' + side;
    return 'p' + (side === 0 ? idx : 23 - idx);
  }
  /** ההפך: מפתח של אזור מגע → אינדקס מנקודת המבט של side */
  function idxOf(side, zone) {
    if (zone === 'bar') return BG.BAR;
    if (zone === 'off') return BG.OFF;
    const i = parseInt(zone.slice(1), 10);
    return side === 0 ? i : 23 - i;
  }

  /* --------------------------------------------------------------------- */
  /* בניית הלוח                                                             */
  /* --------------------------------------------------------------------- */

  const ptEls = [];
  let trayEl = null;
  const zoneEls = new Map();
  const numEls = [];

  function build() {
    measure();
    const u = G.u;
    el.board.dataset.skin = state.prefs.skin;
    el.board.classList.toggle('no-numbers', !state.prefs.numbers);
    el.board.classList.toggle('is-fast', !!state.prefs.fast);

    // מסגרת: שדה, בר, מגש
    el.frame.textContent = '';
    const field = document.createElement('div');
    field.className = 'bg-field';
    Object.assign(field.style, {
      left: G.x0 + 'px', top: G.ft + 'px', width: 13 * u + 'px', height: G.fb - G.ft + 'px',
    });
    const bar = document.createElement('div');
    bar.className = 'bg-barstrip';
    Object.assign(bar.style, {
      left: barX() + 'px', top: G.ft - 0.62 * u + 'px', width: u + 'px', height: G.H + 'px',
    });
    trayEl = document.createElement('div');
    trayEl.className = 'bg-tray';
    Object.assign(trayEl.style, {
      left: G.trayX + 'px', top: G.ft + 'px', width: u + 'px', height: G.fb - G.ft + 'px',
    });
    el.frame.append(field, bar, trayEl);

    // נקודות ומספרים
    el.points.textContent = '';
    el.labels.textContent = '';
    ptEls.length = 0;
    numEls.length = 0;
    for (let i = 0; i < 24; i++) {
      const { k, top } = ptCol(i);
      const p = document.createElement('div');
      p.className = 'bg-pt' + (top ? '' : ' is-bottom') + ((k + (top ? 0 : 1)) % 2 ? ' is-b' : '');
      p.style.left = colX(k) + 'px';
      p.style.top = (top ? G.ft : G.fb - G.ptH) + 'px';
      el.points.appendChild(p);
      ptEls[i] = p;

      const n = document.createElement('span');
      n.className = 'bg-num';
      n.style.left = colX(k) + 'px';
      n.style.top = (top ? 0.14 * u : G.fb + 0.14 * u) + 'px';
      el.labels.appendChild(n);
      numEls[i] = n;
    }

    // אזורי מגע — כפתורים אמיתיים, כדי שאפשר יהיה לשחק גם במקלדת
    el.zones.textContent = '';
    zoneEls.clear();
    const addZone = (key, x, y, w, h) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bg-zone';
      b.dataset.zone = key;
      Object.assign(b.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
      el.zones.appendChild(b);
      zoneEls.set(key, b);
    };
    // סדר הטאב: מנקודה 24 של מי שמשחק אל 1, ואז הבר והמגש
    for (let i = 23; i >= 0; i--) {
      const { k, top } = ptCol(i);
      addZone('p' + i, colX(k), top ? G.ft : G.mid, u, G.mid - G.ft);
    }
    addZone('bar', barX(), G.ft, u, G.fb - G.ft);
    addZone('off', G.trayX, G.ft, u, G.fb - G.ft);

    buildCheckers();
    renderAll();
  }

  /* --------------------------------------------------------------------- */
  /* אבנים                                                                  */
  /* --------------------------------------------------------------------- */

  const checkers = []; // {id, side, el}
  const slots = new Map(); // loc → [id, ...] מלמטה למעלה

  function buildCheckers() {
    if (checkers.length) return;
    for (let id = 0; id < 30; id++) {
      const side = id < 15 ? 0 : 1;
      const d = document.createElement('div');
      d.className = 'bg-ck s' + side;
      el.checkers.appendChild(d);
      checkers.push({ id, side, el: d, loc: null });
    }
  }

  function desired(pos) {
    const want = new Map();
    for (let i = 0; i < 24; i++) {
      const a = pos[i], b = pos[25 + 23 - i];
      if (a) want.set('p' + i, [0, a]);
      else if (b) want.set('p' + i, [1, b]);
    }
    if (pos[24]) want.set('b0', [0, pos[24]]);
    if (pos[49]) want.set('b1', [1, pos[49]]);
    const f0 = BG.offCount(pos, 0), f1 = BG.offCount(pos, 1);
    if (f0) want.set('f0', [0, f0]);
    if (f1) want.set('f1', [1, f1]);
    return want;
  }

  /**
   * משייך אבנים למקומות כך שיתאימו ל-pos, ומזיז רק את מה שהשתנה.
   * עודפים יוצאים מראש הערימה, וחוסרים מתמלאים מהעודפים של אותו צד.
   */
  function reconcile(pos, instant) {
    const want = desired(pos);
    const pool = [[], []];
    if (!slots.size) checkers.forEach((c) => pool[c.side].push(c.id));
    slots.forEach((ids, loc) => {
      const w = want.get(loc);
      while (ids.length && (!w || checkers[ids[0]].side !== w[0] || ids.length > w[1])) {
        const id = ids.pop();
        pool[checkers[id].side].push(id);
      }
      if (!ids.length) slots.delete(loc);
    });
    const moved = new Set();
    want.forEach(([side, n], loc) => {
      if (!slots.has(loc)) slots.set(loc, []);
      const ids = slots.get(loc);
      while (ids.length < n && pool[side].length) {
        const id = pool[side].pop();
        ids.push(id);
        moved.add(id);
      }
    });
    position(moved, instant);
    return moved;
  }

  /** מיקום הפיקסלים של האבן ה-j בערימה של n במקום loc */
  function spot(loc, j, n) {
    const u = G.u, c = G.c;
    const inset = (u - c) / 2;
    if (loc[0] === 'p') {
      const i = parseInt(loc.slice(1), 10);
      const { k, top } = ptCol(i);
      const step = n <= 5 ? c : Math.min(c, (G.ptH - c) / (n - 1));
      const x = colX(k) + inset;
      return { x, y: top ? G.ft + j * step : G.fb - c - j * step };
    }
    if (loc[0] === 'b') {
      const side = +loc[1];
      const step = n <= 4 ? c : Math.min(c, (G.mid - G.ft - 0.62 * u - c) / (n - 1));
      const x = barX() + inset;
      return { x, y: side === 0 ? G.mid - 0.62 * u - c - j * step : G.mid + 0.62 * u + j * step };
    }
    // מגש: צד 0 בתחתית (הבית שלו למטה), צד 1 למעלה
    const side = +loc[1];
    const h = 0.27 * u, st = 0.305 * u;
    const x = G.trayX + inset;
    return { x, y: side === 0 ? G.fb - 0.06 * u - h - j * st : G.ft + 0.06 * u + j * st };
  }

  function position(moved, instant) {
    slots.forEach((ids, loc) => {
      const n = ids.length;
      ids.forEach((id, j) => {
        const ck = checkers[id];
        const { x, y } = spot(loc, j, n);
        const d = ck.el;
        if (instant) d.style.transition = 'none';
        d.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
        d.style.zIndex = String(2 + j);
        d.classList.toggle('is-off', loc[0] === 'f');
        let nEl = d.querySelector('.n');
        const showN = j === n - 1 && n > 5 && loc[0] !== 'f';
        if (showN) {
          if (!nEl) { nEl = document.createElement('span'); nEl.className = 'n'; d.appendChild(nEl); }
          nEl.textContent = String(n);
        } else if (nEl) nEl.remove();
        if (moved && moved.has(id) && !instant) {
          d.classList.add('is-moving');
          clearTimeout(ck.t);
          ck.t = setTimeout(() => d.classList.remove('is-moving'), 420);
        }
        ck.loc = loc;
      });
    });
    if (instant) {
      void el.checkers.offsetWidth;
      checkers.forEach((c) => { c.el.style.transition = ''; });
    }
  }

  const topChecker = (loc) => {
    const ids = slots.get(loc);
    return ids && ids.length ? checkers[ids[ids.length - 1]] : null;
  };

  /* --------------------------------------------------------------------- */
  /* קוביות                                                                 */
  /* --------------------------------------------------------------------- */

  const PIPS = {
    1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
  };

  function dieEl(v, side, small) {
    const d = document.createElement('div');
    d.className = 'bg-die s' + side + (small ? ' is-small' : '');
    for (let k = 0; k < 9; k++) d.appendChild(document.createElement('i'));
    setFace(d, v);
    return d;
  }
  function setFace(d, v) {
    const on = PIPS[v] || [];
    Array.prototype.forEach.call(d.children, (p, k) => { p.style.visibility = on.includes(k) ? 'visible' : 'hidden'; });
    d.dataset.v = v;
  }

  /** מרכז החצי של side — צד 0 מטיל בחצי הימני, צד 1 בשמאלי */
  const halfCenter = (side) => G.x0 + (side === 0 ? 10 : 3) * G.u;

  /**
   * מצייר את הקוביות. rolling = הנפשת הטלה (עם החלפת פנים אקראית בזמן
   * הגלגול). בדאבל — ארבע קוביות קטנות, אחת לכל מהלך.
   */
  function renderDice(rolling) {
    el.dice.textContent = '';
    el.dice.classList.remove('is-action');
    const u = G.u;
    const put = (d, cx, size) => {
      d.style.transform = 'translate(' + (cx - size / 2) + 'px,' + (G.mid - size / 2) + 'px)';
      el.dice.appendChild(d);
    };

    if (state.phase === 'opening' && state.opening) {
      [0, 1].forEach((side) => {
        const v = state.opening[side];
        if (!v) return;
        const d = dieEl(v, side);
        put(d, halfCenter(side), 1.32 * u);
        if (rolling) spinDie(d);
      });
      return;
    }

    if (!state.dice) {
      // תור אנושי לפני הטלה — כפתור "הטלה" על הלוח
      if (state.phase === 'preroll' && humanTurn() && !state.busy) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'bg-rollcta';
        b.textContent = 'הטלה';
        b.addEventListener('click', mainAction);
        el.dice.appendChild(b);
        const w = b.offsetWidth || 3 * u;
        b.style.transform = 'translate(' + (halfCenter(state.turn) - w / 2) + 'px,' + (G.mid - 0.65 * u) + 'px)';
      }
      return;
    }

    const side = state.turn;
    const dbl = state.dice[0] === state.dice[1];
    const vals = dbl ? [state.dice[0], state.dice[0], state.dice[0], state.dice[0]] : state.dice.slice();
    // אילו קוביות כבר שוחקו
    const left = state.part ? state.part.left.slice() : vals.slice();
    const used = vals.map((v) => {
      const i = left.indexOf(v);
      if (i >= 0) { left.splice(i, 1); return false; }
      return true;
    });
    const size = (dbl ? 1.08 : 1.32) * u;
    const gap = (dbl ? 0.18 : 0.34) * u;
    const total = vals.length * size + (vals.length - 1) * gap;
    const c0 = halfCenter(side) - total / 2 + size / 2;
    vals.forEach((v, k) => {
      const d = dieEl(v, side, dbl);
      d.classList.toggle('is-used', used[k] && state.phase === 'move');
      put(d, c0 + k * (size + gap), size);
      if (rolling) spinDie(d);
    });
    if (humanTurn() && state.phase === 'move' && state.part && state.part.done && !state.busy) {
      el.dice.classList.add('is-action');
    }
  }

  function spinDie(d) {
    if (reducedMotion) return;
    const final = +d.dataset.v;
    d.classList.add('is-rolling');
    let n = 0;
    const iv = setInterval(() => {
      if (++n > 6) { clearInterval(iv); setFace(d, final); return; }
      setFace(d, 1 + Math.floor(Math.random() * 6));
    }, 55);
    setTimeout(() => d.classList.remove('is-rolling'), 520);
  }

  el.dice.addEventListener('click', (e) => {
    if (e.target.closest('.bg-die')) mainAction();
  });

  /* --------------------------------------------------------------------- */
  /* ציור                                                                   */
  /* --------------------------------------------------------------------- */

  function renderAll(instant) {
    reconcile(state.pos, instant);
    renderCube();
    renderDice(false);
    renderMarks();
    renderInfo();
  }

  function renderCube() {
    const c = el.cube;
    c.hidden = !state.cubeOn;
    if (!state.cubeOn) return;
    const u = G.u, s = 0.9 * u;
    const v = state.offer >= 0 ? state.cube.value * 2 : state.cube.value;
    c.textContent = String(v === 1 ? 64 : v);
    let x, y;
    if (state.cube.owner === -1 && state.offer < 0) {
      x = barX() + (u - s) / 2;
      y = G.mid - s / 2;
    } else {
      // הקובייה במגש, בצד של מי שמחזיק בה (או של מי שהוצעה לו)
      const owner = state.offer >= 0 ? 1 - state.offer : state.cube.owner;
      x = G.trayX + (u - s) / 2;
      y = owner === 0 ? G.mid + 0.2 * u : G.mid - 0.2 * u - s;
    }
    c.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    c.classList.toggle('is-offer', state.offer >= 0);
    c.title = state.crawford ? 'משחק קרופורד — אין הכפלות' : 'קוביית ההכפלה';
    c.style.opacity = state.crawford ? '.35' : '';
  }

  /** סימונים: יעדים, אבנים שאפשר להזיז, המהלך האחרון, רמז */
  function renderMarks() {
    ptEls.forEach((p) => p.classList.remove('is-target', 'is-far', 'is-hint', 'is-last'));
    trayEl.classList.remove('is-target', 'is-hint');
    checkers.forEach((c) => c.el.classList.remove('is-sel', 'is-movable', 'is-hintsrc'));
    const side = state.turn;
    const markPt = (loc, cls) => {
      if (loc[0] === 'p') ptEls[+loc.slice(1)].classList.add(...cls);
      else if (loc[0] === 'f') trayEl.classList.add(cls[0]);
    };

    const moving = state.phase === 'move' && humanTurn() && state.part && !state.busy;

    // המהלך האחרון של היריב — עד שמתחילים לשחק
    if (state.lastTurn && state.lastTurn.moves.length && !state.played.length && !state.hint &&
        state.lastTurn.side !== side && (state.phase === 'preroll' || moving)) {
      state.lastTurn.moves.forEach((m) => {
        [m[0], m[1]].forEach((x) => {
          const loc = locOf(state.lastTurn.side, x);
          if (loc[0] === 'p') ptEls[+loc.slice(1)].classList.add('is-last');
        });
      });
    }

    if (state.hint && moving) {
      state.hint.forEach((m) => {
        markPt(locOf(side, m[1]), ['is-hint']);
        const t = topChecker(locOf(side, m[0]));
        if (t) t.el.classList.add('is-hintsrc');
      });
    }

    if (!moving) return;
    if (state.selected !== null) {
      const t = topChecker(locOf(side, state.selected));
      if (t) t.el.classList.add('is-sel');
      if (state.prefs.showMoves) {
        state.targets.forEach((tg, to) => markPt(locOf(side, to), tg.far ? ['is-target', 'is-far'] : ['is-target']));
      }
    } else if (state.prefs.showMoves) {
      new Set(state.part.moves.map((m) => m[0])).forEach((from) => {
        const t = topChecker(locOf(side, from));
        if (t) t.el.classList.add('is-movable');
      });
    }
  }

  function renderInfo() {
    // השחקן למטה הוא תמיד צד 0
    const bottom = 0, top = 1;
    const name = (s) => {
      if (state.mode === 'pvp') return s === 0 ? 'לבן' : 'שחור';
      return s === 0 ? 'את/ה' : 'מחשב · ' + LEVEL_NAMES[state.level];
    };
    el.nameTop.textContent = name(top);
    el.nameBottom.textContent = name(bottom);
    el.chipTop.className = 'bg-chip s' + top;
    el.chipBottom.className = 'bg-chip s' + bottom;
    const live = state.phase !== 'over' && state.phase !== 'opening' && state.phase !== 'idle';
    el.playerTop.classList.toggle('is-turn', live && state.turn === top);
    el.playerBottom.classList.toggle('is-turn', live && state.turn === bottom);
    const pip = (s) => (state.prefs.pips ? 'פיפס ' + BG.pips(state.pos, s) : '');
    el.pipsTop.textContent = pip(top);
    el.pipsBottom.textContent = pip(bottom);
    const sc = (s) => (state.matchTo ? state.score[s] + '/' + state.matchTo
      : (state.score[0] || state.score[1] ? String(state.score[s]) : ''));
    el.scoreTop.textContent = sc(top);
    el.scoreBottom.textContent = sc(bottom);

    // מספרי הנקודות — מנקודת המבט של מי שמשחק (בשני שחקנים) או של צד 0
    const view = state.mode === 'pvp' ? state.turn : 0;
    numEls.forEach((n, i) => {
      const num = view === 0 ? i + 1 : 24 - i;
      n.textContent = String(num);
      n.classList.toggle('is-home', num <= 6);
    });

    // תוויות לקורא מסך — כל אזור מגע אומר מה יש בו
    zoneEls.forEach((b, key) => {
      let text;
      if (key === 'bar') text = 'בר: ' + state.pos[24] + ' ' + sideName(0) + ', ' + state.pos[49] + ' ' + sideName(1);
      else if (key === 'off') text = 'הוצאה: ' + BG.offCount(state.pos, 0) + ' ' + sideName(0) + ', ' + BG.offCount(state.pos, 1) + ' ' + sideName(1);
      else {
        const i = +key.slice(1);
        const a = state.pos[i], c = state.pos[25 + 23 - i];
        const num = view === 0 ? i + 1 : 24 - i;
        text = 'נקודה ' + num + (a ? ': ' + a + ' ' + sideName(0) : c ? ': ' + c + ' ' + sideName(1) : ', ריקה');
      }
      b.setAttribute('aria-label', text);
    });

    // כפתורים
    const moving = state.phase === 'move' && humanTurn() && !state.busy;
    const pre = state.phase === 'preroll' && humanTurn() && !state.busy;
    el.btnUndo.disabled = !(moving && state.played.length);
    el.btnHint.disabled = !moving;
    const canDbl = pre && AI.canDouble(cubeState(), state.turn);
    el.btnDouble.disabled = !canDbl;
    el.actions.classList.toggle('no-cube', !state.cubeOn);

    let label = 'הטלה', done = false, enabled = false;
    if (pre) { enabled = true; }
    else if (moving && state.part && state.part.done) { label = 'סיום תור'; done = true; enabled = true; }
    else if (moving) { label = 'שחק/י'; }
    else if (state.phase === 'over') {
      label = state.result && state.result.matchOver ? 'משחק חדש' : 'המשחק הבא';
      done = true; enabled = true;
    } else if (isAI(state.turn)) label = 'תור המחשב';
    el.mainLabel.textContent = label;
    el.btnMain.classList.toggle('is-done', done);
    el.btnMain.disabled = !enabled;

    renderStatus();
    renderMeter();

    const mode = state.mode === 'ai' ? 'מול המחשב · ' + LEVEL_NAMES[state.level] : 'שני שחקנים';
    const len = state.matchTo ? 'משחקון עד ' + state.matchTo : 'משחק חופשי';
    el.footerInfo.textContent = mode + ' · ' + len + ' · משחק ' + state.gameNo +
      (state.crawford ? ' · קרופורד' : '');
  }

  function renderStatus() {
    const line = el.statusLine;
    line.classList.remove('is-thinking');
    let t = '';
    const who = sideName(state.turn);
    if (state.phase === 'opening') t = 'הטלת פתיחה — הגבוה מתחיל';
    else if (state.phase === 'cube') {
      t = isAI(state.offer) ? 'המחשב מכפיל!' : isAI(1 - state.offer) ? 'המחשב שוקל את ההכפלה' : who + ' מכפיל';
      if (isAI(1 - state.offer)) line.classList.add('is-thinking');
    } else if (state.phase === 'over') {
      t = state.result ? state.result.text : 'המשחק הסתיים';
    } else if (isAI(state.turn)) {
      t = state.dice ? 'המחשב משחק' : 'המחשב חושב';
      line.classList.add('is-thinking');
    } else if (state.phase === 'preroll') {
      t = state.mode === 'pvp' ? 'תור ' + who + ' — הטלה' : 'תורך — הטלה';
      if (AI.canDouble(cubeState(), state.turn)) t += ' או הכפלה';
    } else if (state.phase === 'move' && state.part) {
      const pre = state.mode === 'pvp' ? who + ': ' : '';
      if (state.part.done) t = pre + (state.legal[0].moves.length ? 'סיום התור, או ביטול' : 'אין מהלך חוקי');
      else {
        const n = state.part.left.length;
        t = pre + (n === 1 ? 'נשארה קובייה אחת' : 'נשארו ' + n + ' מהלכים');
      }
    }
    line.textContent = t;
  }

  function renderMeter() {
    const on = !!state.prefs.meter && state.phase !== 'idle';
    el.meter.hidden = !on;
    if (!on) return;
    let p;
    if (state.phase === 'over' && state.result) p = state.result.winner === 0 ? [1, 0, 0, 0, 0] : [0, 0, 0, 0, 0];
    else if (state.phase === 'move' || state.phase === 'cube' || state.phase === 'preroll') {
      // לפני הטלה — הערכה רגילה; אחרי הטלה — לפי העמדה בתחילת התור
      const base = state.startPos && state.phase === 'move' ? state.startPos : state.pos;
      p = AI.evaluate(base, state.turn);
      if (state.turn !== 0) p = AI.flip(p);
    } else return;
    const pct = Math.round(p[0] * 100);
    el.meterFill.style.width = pct + '%';
    const g = Math.round(p[1] * 100);
    el.meterText.textContent = (state.mode === 'pvp' ? 'לבן ' : 'סיכוי ') + pct + '%' + (g >= 3 ? ' · גמון ' + g + '%' : '');
  }

  function logLine() {
    const lt = state.lastTurn;
    if (!lt) { el.moveLog.textContent = ''; return; }
    const who = state.mode === 'pvp' ? (lt.side === 0 ? 'W' : 'B') : (lt.side === 0 ? 'You' : 'CPU');
    el.moveLog.textContent = who + ' ' + lt.dice[0] + '-' + lt.dice[1] + ':  ' +
      (lt.moves.length ? BG.notation(lt.moves) : 'no move');
  }

  /* --------------------------------------------------------------------- */
  /* מהלך התור                                                              */
  /* --------------------------------------------------------------------- */

  function refreshPart() {
    state.part = state.dice
      ? BG.partial(state.startPos, state.turn, state.dice, state.played, state.legal)
      : null;
  }

  /** יעדים לאבן ב-from: מהלך בודד, או שרשרת של אותה אבן (יעד "רחוק") */
  function targetsFrom(from) {
    const res = new Map();
    const side = state.turn;
    const hitsMid = (p) => p.slice(0, -1).some((m) => m[2]);
    // עדיפות: פחות שלבים; אחר כך בלי הכאה בדרך; ובמהלך בודד — הקובייה הקטנה
    const better = (p, cur) => {
      if (!cur) return true;
      if (p.length !== cur.length) return p.length < cur.length;
      if (hitsMid(p) !== hitsMid(cur)) return !hitsMid(p);
      return p.length === 1 && p[0][3] < cur[0][3];
    };
    const walk = (played, at, path, depth) => {
      const part = BG.partial(state.startPos, side, state.dice, played, state.legal);
      part.moves.forEach((m) => {
        if (m[0] !== at) return;
        const p = path.concat([m]);
        const cur = res.get(m[1]);
        if (better(p, cur && cur.path)) res.set(m[1], { path: p, far: p.length > 1 });
        if (m[1] !== BG.OFF && depth < 3) walk(played.concat([m]), m[1], p, depth + 1);
      });
    };
    walk(state.played, from, [], 0);
    return res;
  }

  function select(from) {
    state.selected = from;
    state.targets = from === null ? new Map() : targetsFrom(from);
    renderMarks();
  }

  /** משחק רצף מהלכים (אחד או יותר), עם הנפשה בין שלב לשלב */
  async function playPath(path, opts) {
    const o = opts || {};
    const tok = state.token, tid = state.turnId;
    state.busy = true;
    state.selected = null;
    state.targets = new Map();
    for (let k = 0; k < path.length; k++) {
      const m = path[k];
      const hit = BG.apply(state.pos, state.turn, m[0], m[1]);
      state.played.push([m[0], m[1], hit, m[3]]);
      refreshPart();
      reconcile(state.pos);
      renderDice(false);
      renderInfo();
      sound(hit ? 'hit' : m[1] === BG.OFF ? 'bearoff' : 'checker');
      feel(hit ? 'lock' : 'move');
      if (hit && !o.quiet) say(isAI(state.turn) ? 'המחשב הכה אבן שלך' : 'הכאה!');
      if (k < path.length - 1 || o.gap) await wait(o.gap || speed(230));
      if (tok !== state.token || tid !== state.turnId) return false;
    }
    state.busy = false;
    state.hint = null;
    renderAll();
    if (humanTurn() && state.part && state.part.done && state.prefs.autoConfirm && !o.noAuto) {
      await wait(speed(380));
      if (tok === state.token && tid === state.turnId && state.phase === 'move' && state.part.done) endTurn();
    }
    return true;
  }

  function undo() {
    if (state.phase !== 'move' || !humanTurn() || state.busy || !state.played.length) return;
    state.played.pop();
    state.pos = new Int8Array(state.startPos);
    state.played.forEach((m) => BG.apply(state.pos, state.turn, m[0], m[1]));
    state.selected = null;
    state.targets = new Map();
    refreshPart();
    feel('pick');
    renderAll();
    saveGame();
  }

  /* --------------------------------------------------------------------- */
  /* זרימת המשחק                                                            */
  /* --------------------------------------------------------------------- */

  function mainAction() {
    if (window.Modal.top()) return;
    if (state.busy) return;
    if (state.phase === 'preroll' && humanTurn()) roll();
    else if (state.phase === 'move' && humanTurn() && state.part && state.part.done) endTurn();
    else if (state.phase === 'over') nextFromOver();
  }

  async function roll() {
    if (state.phase !== 'preroll') return;
    const tok = state.token, tid = state.turnId;
    state.dice = BG.roll();
    state.startPos = new Int8Array(state.pos);
    state.legal = BG.turns(state.startPos, state.turn, state.dice[0], state.dice[1]);
    state.played = [];
    state.phase = 'move';
    state.hint = null;
    state.busy = true;
    refreshPart();
    sound('dice');
    feel('pick');
    renderInfo();
    renderDice(true);
    renderMarks();
    const d = state.dice;
    say(sideName(state.turn) + ' הטיל ' + d[0] + ' ו-' + d[1]);
    await wait(speed(560));
    if (tok !== state.token || tid !== state.turnId) return;
    state.busy = false;
    saveGame();
    afterRoll();
  }

  async function afterRoll() {
    const tok = state.token, tid = state.turnId;
    const alive = () => tok === state.token && tid === state.turnId;
    if (!state.legal.length || !state.legal[0].moves.length) {
      // נעולים בזמן ההודעה, ומסיימים רק את התור הזה — לא תור שבא אחריו
      state.busy = true;
      renderAll();
      banner(isAI(state.turn) ? 'למחשב אין מהלך' : 'אין מהלך חוקי');
      say('אין מהלך חוקי');
      await wait(speed(1400));
      if (!alive()) return;
      state.busy = false;
      endTurn();
      return;
    }
    if (isAI(state.turn)) { aiMove(); return; }
    renderAll();
    if (state.prefs.autoForced && state.legal.length === 1 && !state.played.length) {
      // נעילה כבר מעכשיו: הקשה על רמז/אבן בזמן ההמתנה הייתה מריצה שני רצפים במקביל
      state.busy = true;
      renderInfo();
      await wait(speed(350));
      if (!alive()) return;
      toast('מהלך כפוי', 1200);
      const ok = await playPath(state.legal[0].moves, { noAuto: true, gap: speed(260) });
      if (!ok || !alive()) return;
      await wait(speed(450));
      if (alive() && state.phase === 'move') endTurn();
    }
  }

  function endTurn() {
    if (state.phase !== 'move') return;
    state.lastTurn = { side: state.turn, moves: state.played.map((m) => m.slice()), dice: state.dice.slice() };
    logLine();
    const w = BG.winner(state.pos);
    if (w !== -1) {
      const v = BG.resultValue(state.pos, w);
      gameOver(w, v * state.cube.value, v === 3 ? 'backgammon' : v === 2 ? 'gammon' : 'single');
      return;
    }
    state.turn = 1 - state.turn;
    state.turnId++;
    state.dice = null;
    state.startPos = null;
    state.legal = [];
    state.played = [];
    state.part = null;
    state.selected = null;
    state.targets = new Map();
    state.hint = null;
    state.phase = 'preroll';
    renderAll();
    saveGame();
    startTurn();
  }

  async function startTurn() {
    const tok = state.token, tid = state.turnId;
    if (isAI(state.turn)) { aiPreroll(); return; }
    renderAll();
    if (state.mode === 'ai') feel('opponent');
    if (state.prefs.autoRoll && !AI.canDouble(cubeState(), state.turn)) {
      await wait(speed(420));
      if (tok === state.token && tid === state.turnId && state.phase === 'preroll' && !window.Modal.top()) roll();
    }
  }

  /* ----------------------------- הטלת פתיחה ---------------------------- */

  async function opening() {
    const tok = state.token;
    state.phase = 'opening';
    state.dice = null;
    for (let tries = 0; tries < 20; tries++) {
      const a = 1 + Math.floor(Math.random() * 6);
      const b = 1 + Math.floor(Math.random() * 6);
      state.opening = [a, b];
      renderInfo();
      renderDice(true);
      sound('dice');
      await wait(speed(900));
      if (tok !== state.token) return;
      if (a !== b) break;
      banner('שוויון — שוב');
      await wait(speed(900));
      if (tok !== state.token) return;
    }
    const [a, b] = state.opening;
    state.turn = a > b ? 0 : 1;
    banner(state.mode === 'pvp' ? sideName(state.turn) + ' מתחיל' : state.turn === 0 ? 'את/ה מתחיל/ה' : 'המחשב מתחיל');
    await wait(speed(700));
    if (tok !== state.token) return;
    state.opening = null;
    state.dice = state.turn === 0 ? [a, b] : [b, a];
    state.startPos = new Int8Array(state.pos);
    state.legal = BG.turns(state.startPos, state.turn, state.dice[0], state.dice[1]);
    state.played = [];
    state.phase = 'move';
    refreshPart();
    saveGame();
    renderAll();
    afterRoll();
  }

  /* ------------------------------- המחשב ------------------------------- */

  async function aiPreroll() {
    const tok = state.token, tid = state.turnId;
    state.busy = true;
    renderAll();
    await wait(speed(450));
    if (tok !== state.token || tid !== state.turnId) return;
    if (state.cubeOn && AI.shouldDouble(state.pos, state.turn, cubeState(), state.level)) {
      state.busy = false;
      offerDouble(state.turn);
      return;
    }
    state.busy = false;
    roll();
  }

  async function aiMove() {
    const tok = state.token, tid = state.turnId;
    state.busy = true;
    renderInfo();
    // נותנים לדפדפן לצייר את הקוביות לפני החישוב
    await wait(40);
    if (tok !== state.token) return;
    const t0 = performance.now();
    const turn = AI.choose(state.startPos, state.turn, state.dice, state.level);
    const spent = performance.now() - t0;
    await wait(Math.max(0, speed(420) - spent));
    if (tok !== state.token) return;
    const ok = await playPath(turn.moves, { gap: speed(460), quiet: false });
    if (!ok || tok !== state.token || tid !== state.turnId) return;
    state.busy = false;
    await wait(speed(300));
    if (tok !== state.token || tid !== state.turnId) return;
    endTurn();
  }

  /* ------------------------------ הכפלה ------------------------------- */

  function offerDouble(side) {
    state.offer = side;
    state.phase = 'cube';
    sound('cube');
    feel('lock');
    renderAll();
    saveGame();
    const responder = 1 - side;
    if (isAI(responder)) {
      const tok = state.token;
      setTimeout(() => {
        if (tok !== state.token || state.phase !== 'cube') return;
        const take = AI.shouldTake(state.pos, responder, cubeState(), state.level);
        resolveDouble(take);
      }, speed(1100));
      return;
    }
    showCubeModal();
  }

  function showCubeModal() {
    const side = state.offer;
    const v = state.cube.value * 2;
    el.cubeBig.textContent = String(v);
    el.cubeTitle.textContent = isAI(side) ? 'המחשב מכפיל!' : sideName(side) + ' מכפיל!';
    const lose = state.cube.value;
    el.cubeSub.textContent = 'ערך המשחק יעלה ל-' + v + '. ויתור עכשיו = הפסד של ' +
      (lose === 1 ? 'נקודה אחת' : lose + ' נקודות') + '.' +
      (state.mode === 'pvp' ? ' (' + sideName(1 - side) + ' מחליט)' : '');
    openModal(el.cubeModal);
  }

  async function resolveDouble(take) {
    const side = state.offer;
    closeModal(el.cubeModal);
    state.offer = -1;
    if (!take) {
      toast(isAI(1 - side) ? 'המחשב ויתר' : sideName(1 - side) + ' ויתר');
      gameOver(side, state.cube.value, 'pass');
      return;
    }
    state.cube.value *= 2;
    state.cube.owner = 1 - side;
    state.phase = 'preroll';
    sound('cube');
    toast(isAI(1 - side) ? 'המחשב קיבל — המשחק שווה ' + state.cube.value
      : 'ההכפלה התקבלה — המשחק שווה ' + state.cube.value);
    renderAll();
    saveGame();
    const tok = state.token, tid = state.turnId;
    await wait(speed(700));
    if (tok !== state.token || tid !== state.turnId || state.phase !== 'preroll') return;
    roll();
  }

  el.btnTake.addEventListener('click', () => { if (state.phase === 'cube') resolveDouble(true); });
  el.btnPass.addEventListener('click', () => { if (state.phase === 'cube') resolveDouble(false); });

  /* ----------------------------- סוף משחק ------------------------------ */

  function gameOver(w, pts, kind) {
    state.phase = 'over';
    state.busy = false;
    state.score[w] += pts;
    const matchOver = state.matchTo > 0 && state.score[w] >= state.matchTo;
    const kindName = { single: '', gammon: 'גמון! ', backgammon: 'בקגמון! ', pass: '' }[kind];
    const ptsText = pts === 1 ? 'נקודה אחת' : pts + ' נקודות';
    let text;
    if (state.mode === 'pvp') text = sideName(w) + ' ניצח · ' + kindName + ptsText;
    else text = (w === 0 ? 'ניצחת · ' : 'המחשב ניצח · ') + kindName + ptsText;
    state.result = { winner: w, pts, kind, text, matchOver };

    // קרופורד: המשחק שאחרי שמישהו הגיע לראשונה לנקודה אחת מהניצחון
    const wasCrawford = state.crawford;
    state.crawford = false;
    if (state.matchTo && !matchOver && !state.crawfordUsed && !wasCrawford &&
        state.score[w] === state.matchTo - 1 && state.score[1 - w] < state.matchTo - 1) {
      state.crawford = true;
      state.crawfordUsed = true;
    }
    state.result.nextCrawford = state.crawford;

    recordStats(w, pts, kind, matchOver);
    sound(w === 0 || state.mode === 'pvp' ? 'win' : 'lose');
    feel(w === 0 || state.mode === 'pvp' ? 'win' : 'reject');
    say(text, true);
    renderAll();
    saveGame();
    setTimeout(showOver, speed(650));
  }

  function showOver() {
    if (state.phase !== 'over' || !state.result) return;
    const r = state.result;
    const won = state.mode === 'pvp' || r.winner === 0;
    el.overBadge.className = won ? 'win-badge' : 'stuck-badge';
    el.overBadge.innerHTML = won
      ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>';
    let title;
    if (r.matchOver) {
      title = state.mode === 'pvp' ? sideName(r.winner) + ' ניצח במשחקון!' : r.winner === 0 ? 'ניצחת במשחקון!' : 'המחשב ניצח במשחקון';
    } else if (state.mode === 'pvp') title = sideName(r.winner) + ' ניצח';
    else title = r.winner === 0 ? 'ניצחת!' : 'הפסדת';
    el.overTitle.textContent = title;
    const kindLine = {
      single: 'ניצחון רגיל', gammon: 'גמון — היריב לא הוציא אף אבן',
      backgammon: 'בקגמון — נשארה ליריב אבן בבית או על הבר', pass: 'ויתור על הכפלה',
    }[r.kind];
    el.overSub.textContent = kindLine + (state.cube.value > 1 && r.kind !== 'pass' ? ' · קובייה ×' + state.cube.value : '') +
      (r.nextCrawford ? ' · המשחק הבא: קרופורד, בלי הכפלות' : '');
    const n0 = state.mode === 'pvp' ? 'לבן' : 'את/ה';
    const n1 = state.mode === 'pvp' ? 'שחור' : 'מחשב';
    el.overStats.innerHTML =
      '<div class="win-stat' + (r.winner === 0 ? ' is-best' : '') + '"><span class="k">' + n0 + '</span><span class="v">' +
      state.score[0] + (state.matchTo ? ' / ' + state.matchTo : '') + '</span></div>' +
      '<div class="win-stat' + (r.winner === 1 ? ' is-best' : '') + '"><span class="k">' + n1 + '</span><span class="v">' +
      state.score[1] + (state.matchTo ? ' / ' + state.matchTo : '') + '</span></div>';
    el.btnOverNext.textContent = r.matchOver ? 'משחקון חדש' : 'המשחק הבא';
    el.confetti.textContent = '';
    if (won && !reducedMotion) confetti();
    openModal(el.overModal);
  }

  function confetti() {
    const colors = ['#ffd257', '#e14b52', '#2f6bff', '#23996b', '#f39c3d', '#b45be0'];
    for (let i = 0; i < 18; i++) {
      const c = document.createElement('i');
      c.style.left = (5 + Math.random() * 90) + '%';
      c.style.background = colors[i % colors.length];
      c.style.animationDelay = (Math.random() * 0.4) + 's';
      el.confetti.appendChild(c);
    }
  }

  function nextFromOver() {
    closeModal(el.overModal);
    if (!state.result || state.result.matchOver) {
      newMatch({ mode: state.mode, level: state.level, match: state.matchTo, cube: state.cubeOn ? '1' : '0' });
      return;
    }
    state.gameNo++;
    startGame();
  }

  el.btnOverNext.addEventListener('click', nextFromOver);
  el.btnOverLook.addEventListener('click', () => closeModal(el.overModal));

  /* ------------------------------ התחלה -------------------------------- */

  function startGame() {
    state.token++;
    state.turnId++;
    state.pos = BG.initial();
    state.cube = { value: 1, owner: -1 };
    state.offer = -1;
    state.dice = null;
    state.startPos = null;
    state.legal = [];
    state.played = [];
    state.part = null;
    state.selected = null;
    state.targets = new Map();
    state.hint = null;
    state.lastTurn = null;
    state.result = null;
    state.busy = false;
    state.phase = 'opening';
    logLine();
    renderAll();
    opening();
  }

  function newMatch(opts) {
    state.token++;
    state.mode = opts.mode === 'pvp' ? 'pvp' : 'ai';
    state.level = parseInt(opts.level, 10) || 3;
    state.matchTo = parseInt(opts.match, 10) || 0;
    state.cubeOn = String(opts.cube) !== '0';
    state.score = [0, 0];
    state.crawford = false;
    state.crawfordUsed = false;
    state.gameNo = 1;
    state.hints = 0;
    closeModal(el.overModal);
    startGame();
  }

  /* --------------------------------------------------------------------- */
  /* רמז                                                                    */
  /* --------------------------------------------------------------------- */

  async function hint() {
    if (state.phase !== 'move' || !humanTurn() || state.busy) return;
    if (state.hint) {
      // לחיצה שנייה: משחקים את הרמז מתחילת התור
      const moves = state.hint;
      const tid = state.turnId;
      state.played = [];
      state.pos = new Int8Array(state.startPos);
      state.busy = true;
      refreshPart();
      renderAll();
      await wait(120);
      if (tid !== state.turnId) return;
      playPath(moves, { gap: speed(260) });
      return;
    }
    const tid = state.turnId;
    state.busy = true;
    renderInfo();
    await wait(20);
    state.busy = false;
    if (tid !== state.turnId || state.phase !== 'move' || !state.dice) { renderInfo(); return; }
    const list = AI.rank(state.startPos, state.turn, state.dice, { plies: 2, top: 6, margin: 0.14 });
    if (!list.length) { renderInfo(); return; }
    state.hint = list[0].turn.moves;
    state.hints++;
    renderAll();
    toast('רמז: ' + BG.notation(state.hint) + ' — לחיצה נוספת משחקת', 3200);
  }

  /* --------------------------------------------------------------------- */
  /* קלט                                                                    */
  /* --------------------------------------------------------------------- */

  const canTouch = () => state.phase === 'move' && humanTurn() && !state.busy && state.part && !window.Modal.top();

  /** מקורות שאפשר להזיז מהם עכשיו (אינדקסים של מי שמשחק) */
  const sources = () => new Set(state.part.moves.map((m) => m[0]));

  function zoneAt(x, y) {
    const t = document.elementFromPoint(x, y);
    const z = t && t.closest && t.closest('.bg-zone');
    return z ? z.dataset.zone : null;
  }

  /** נגיעה באזור (נקודה / בר / מגש) */
  function tapZone(zone) {
    if (!canTouch()) {
      if (state.phase === 'preroll' && humanTurn() && !state.busy) roll();
      else if (state.phase === 'move' && humanTurn() && state.part && state.part.done) toast('הקוביות שוחקו — "סיום תור" או ביטול');
      return;
    }
    if (state.part.done) { toast('הקוביות שוחקו — "סיום תור" או ביטול'); return; }
    const side = state.turn;
    const idx = idxOf(side, zone);
    const src = sources();

    // יעד של האבן הנבחרת
    if (state.selected !== null && idx !== state.selected) {
      const tg = state.targets.get(idx);
      if (tg) { playPath(tg.path); return; }
    }

    if (src.has(idx)) {
      if (state.selected === idx) {
        // הקשה שנייה על אותה אבן — הקובייה הגבוהה, אם אפשר
        if (state.prefs.quickMove) {
          const singles = [...state.targets.values()].filter((t) => !t.far);
          singles.sort((a, b) => b.path[0][3] - a.path[0][3]);
          if (singles.length) { playPath(singles[0].path); return; }
        }
        select(null);
        return;
      }
      select(idx);
      feel('pick');
      if (state.prefs.quickMove) {
        const singles = [...state.targets.values()].filter((t) => !t.far);
        if (singles.length === 1 && state.targets.size === 1) { playPath(singles[0].path); return; }
      }
      return;
    }

    // נגיעה ביעד בלי בחירה — אם רק אבן אחת יכולה להגיע לשם במהלך בודד
    if (state.selected === null) {
      const cands = state.part.moves.filter((m) => m[1] === idx);
      const froms = new Set(cands.map((m) => m[0]));
      if (froms.size === 1) {
        cands.sort((a, b) => a[3] - b[3]);
        playPath([cands[0]]);
        return;
      }
      if (froms.size > 1) { toast('כמה אבנים יכולות להגיע לשם — בחר/י אבן קודם'); return; }
    }
    if (state.selected !== null) { select(null); feel('reject'); }
  }

  /* גרירה — האבן העליונה עוקבת אחרי האצבע */
  let press = null;

  el.zones.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const z = e.target.closest('.bg-zone');
    if (!z) return;
    e.preventDefault();
    const zone = z.dataset.zone;
    if (!canTouch() || state.part.done) { tapZone(zone); return; }
    const idx = idxOf(state.turn, zone);
    if (!sources().has(idx)) { tapZone(zone); return; }
    const ck = topChecker(locOf(state.turn, idx));
    press = { zone, idx, x: e.clientX, y: e.clientY, id: e.pointerId, dragging: false, ck };
    try { el.zones.setPointerCapture(e.pointerId); } catch (err) {}
  });

  el.zones.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.dragging) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 7) return;
      press.dragging = true;
      if (state.selected !== press.idx) select(press.idx);
      press.ck.el.classList.add('is-drag');
    }
    const r = el.board.getBoundingClientRect();
    const c = G.c;
    press.ck.el.style.transform = 'translate(' + (e.clientX - r.left - c / 2) + 'px,' + (e.clientY - r.top - c * 0.75) + 'px) scale(1.12)';
  });

  function endPress(e, cancel) {
    if (!press || (e && e.pointerId !== press.id)) return;
    const p = press;
    press = null;
    if (p.dragging) {
      p.ck.el.classList.remove('is-drag');
      if (!cancel) {
        const to = zoneAt(e.clientX, e.clientY);
        if (to) {
          const tg = state.targets.get(idxOf(state.turn, to));
          if (tg) { playPath(tg.path); return; }
        }
      }
      position(null);
      renderMarks();
      return;
    }
    if (!cancel) tapZone(p.zone);
  }
  el.zones.addEventListener('pointerup', (e) => endPress(e, false));
  el.zones.addEventListener('pointercancel', (e) => endPress(e, true));

  /* מקלדת: Enter/רווח על אזור = נגיעה */
  el.zones.addEventListener('click', (e) => {
    if (e.detail !== 0) return; // עכבר/מגע כבר טופלו ב-pointerdown
    const z = e.target.closest('.bg-zone');
    if (z) tapZone(z.dataset.zone);
  });

  document.addEventListener('keydown', (e) => {
    if (window.Modal && window.Modal.top()) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
    if (e.key === 'Escape' && state.selected !== null) { select(null); return; }
    const onButton = e.target && e.target.closest && e.target.closest('button, a, input');
    if ((e.key === ' ' || e.key === 'Enter') && !onButton) { e.preventDefault(); mainAction(); }
    else if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey) hint();
  });

  /* --------------------------------------------------------------------- */
  /* חלון משחק חדש                                                          */
  /* --------------------------------------------------------------------- */

  const pick = { mode: 'ai', level: '3', match: '0', cube: '1' };

  function syncNewModal() {
    el.newModal.querySelectorAll('.bg-seg').forEach((seg) => {
      const opt = seg.dataset.opt;
      seg.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', b.dataset.val === pick[opt] ? 'true' : 'false');
      });
    });
    el.aiOnly.hidden = pick.mode !== 'ai';
    el.levelDesc.textContent = LEVEL_DESC[pick.level] || '';
    el.matchDesc.textContent = pick.match === '0'
      ? 'משחק אחרי משחק, והנקודות מצטברות.'
      : 'הראשון שמגיע ל-' + pick.match + ' נקודות. כולל חוק קרופורד.';
  }

  function openNew() {
    pick.mode = state.prefs.mode;
    pick.level = String(state.prefs.level);
    pick.match = String(state.prefs.match);
    pick.cube = String(state.prefs.cube);
    syncNewModal();
    openModal(el.newModal);
  }

  el.newModal.addEventListener('click', (e) => {
    const b = e.target.closest('.bg-seg button');
    if (!b) return;
    pick[b.closest('.bg-seg').dataset.opt] = b.dataset.val;
    syncNewModal();
  });

  el.btnStart.addEventListener('click', () => {
    closeModal(el.newModal);
    Object.assign(state.prefs, { mode: pick.mode, level: pick.level, match: pick.match, cube: pick.cube });
    savePrefs();
    newMatch(pick);
  });

  /* --------------------------------------------------------------------- */
  /* סטטיסטיקות                                                             */
  /* --------------------------------------------------------------------- */

  function recordStats(w, pts, kind, matchOver) {
    const s = stats();
    if (state.mode === 'pvp') {
      s.pvp = (s.pvp || 0) + 1;
    } else {
      s.ai = s.ai || {};
      const r = s.ai[state.level] || { g: 0, w: 0, pts: 0, gw: 0, gl: 0, mw: 0, ml: 0 };
      r.g++;
      if (w === 0) { r.w++; r.pts += pts; if (kind === 'gammon' || kind === 'backgammon') r.gw++; }
      else { r.pts -= pts; if (kind === 'gammon' || kind === 'backgammon') r.gl++; }
      if (matchOver) { if (w === 0) r.mw = (r.mw || 0) + 1; else r.ml = (r.ml || 0) + 1; }
      s.ai[state.level] = r;
    }
    store.write(STATS_KEY, s);
  }

  function renderStats() {
    const s = stats();
    const ai = s.ai || {};
    let html = '<p class="stats-group-title">מול המחשב</p>';
    let any = false;
    [1, 2, 3, 4, 5].forEach((lv) => {
      const r = ai[lv];
      if (!r || !r.g) return;
      any = true;
      const pct = Math.round((r.w / r.g) * 100);
      const meta = r.g + ' משחקים · ' + (r.pts >= 0 ? '+' : '') + r.pts + ' נק׳' +
        (r.gw ? ' · ' + r.gw + ' גמונים' : '') +
        ((r.mw || r.ml) ? ' · משחקונים ' + (r.mw || 0) + '–' + (r.ml || 0) : '');
      html += '<div class="stats-row"><span class="name">' + LEVEL_NAMES[lv] +
        '<br><span class="meta">' + meta + '</span></span><span></span><span class="best">' + pct + '%</span></div>';
    });
    if (!any) html += '<div class="stats-row"><span class="name">עוד לא שוחקו משחקים</span><span></span><span></span></div>';
    html += '<p class="stats-group-title">שני שחקנים</p><div class="stats-row"><span class="name">משחקים</span><span></span><span class="best">' +
      (s.pvp || 0) + '</span></div>';
    el.statsTable.innerHTML = html;
  }

  el.btnStats.addEventListener('click', () => { renderStats(); openModal(el.statsModal); });
  el.btnClearStats.addEventListener('click', () => {
    askConfirm('לאפס את כל הסטטיסטיקות? אי אפשר לשחזר.', () => {
      store.remove(STATS_KEY);
      renderStats();
      toast('הנתונים אופסו');
    });
  });

  /* --------------------------------------------------------------------- */
  /* הגדרות                                                                 */
  /* --------------------------------------------------------------------- */

  function syncSettings() {
    el.settingsModal.querySelectorAll('[data-pref]').forEach((i) => { i.checked = !!state.prefs[i.dataset.pref]; });
    el.optCube.checked = state.cubeOn;
    el.settingsModal.querySelectorAll('[data-pref-seg]').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', b.dataset.val === state.prefs[seg.dataset.prefSeg] ? 'true' : 'false');
      });
    });
  }

  el.btnSettings.addEventListener('click', () => {
    syncSettings();
    const mode = H ? H.supported() : 'none';
    el.hapticsNote.textContent =
      mode === 'vibrate' ? 'משוב מישושי על מהלך והכאה'
      : mode === 'ios-switch'
        ? 'באייפון הרטט מוגבל לנקישה אחידה, ובגרסאות iOS חדשות הוא עשוי לא לעבוד'
        : 'הדפדפן הזה אינו מאפשר רטט לדף. המשוב החזותי פועל כרגיל';
    const sw = document.getElementById('optHaptics');
    if (sw) sw.disabled = mode === 'none';
    openModal(el.settingsModal);
  });

  /*
   * הקובייה — חלה מיד על המשחק הנוכחי, ונשמרת למשחקים הבאים. אם כבר
   * הוכפל, הערך שנקבע נשאר (כך הוסכם), רק שאין יותר הכפלות
   */
  el.optCube.addEventListener('change', () => {
    const on = el.optCube.checked;
    state.prefs.cube = on ? '1' : '0';
    savePrefs();
    if (state.phase !== 'cube') state.cubeOn = on;
    renderAll();
    saveGame();
    toast(on ? 'קוביית ההכפלה פעילה' : 'בלי הכפלות — משחקים רגיל');
  });

  el.settingsModal.addEventListener('change', (e) => {
    const input = e.target.closest && e.target.closest('[data-pref]');
    if (!input) return;
    const key = input.dataset.pref;
    state.prefs[key] = input.checked;
    savePrefs();
    if (key === 'haptics' && H) H.setEnabled(input.checked);
    if (key === 'sound' && S) S.setEnabled(input.checked);
    if (key === 'mirror' || key === 'numbers' || key === 'fast' || key === 'meter') { build(); return; }
    renderAll();
  });

  el.settingsModal.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pref-seg] button');
    if (!b) return;
    state.prefs[b.closest('[data-pref-seg]').dataset.prefSeg] = b.dataset.val;
    savePrefs();
    syncSettings();
    build();
  });

  /* --------------------------------------------------------------------- */
  /* כפתורים                                                                */
  /* --------------------------------------------------------------------- */

  el.btnMain.addEventListener('click', mainAction);
  el.btnUndo.addEventListener('click', undo);
  el.btnHint.addEventListener('click', hint);
  el.btnDouble.addEventListener('click', () => {
    if (state.phase !== 'preroll' || !humanTurn() || state.busy) return;
    if (!AI.canDouble(cubeState(), state.turn)) return;
    offerDouble(state.turn);
  });
  el.btnNew.addEventListener('click', () => {
    const inProgress = state.phase !== 'over' && state.phase !== 'idle' &&
      (state.gameNo > 1 || BG.pips(state.pos, 0) + BG.pips(state.pos, 1) < 320);
    if (inProgress) {
      askConfirm(state.matchTo ? 'להתחיל משחק חדש? המשחקון הנוכחי יימחק.' : 'להתחיל משחק חדש? המשחק הנוכחי יימחק.', openNew);
      return;
    }
    openNew();
  });

  el.btnTheme.addEventListener('click', () => {
    const order = { auto: 'light', light: 'dark', dark: 'auto' };
    state.prefs.theme = order[state.prefs.theme] || 'light';
    savePrefs();
    applyTheme();
  });

  el.btnHelp.addEventListener('click', () => openModal(el.helpModal));

  el.btnConfirmOk.addEventListener('click', () => {
    closeModal(el.confirmModal);
    const fn = confirmAction;
    confirmAction = null;
    if (fn) fn();
  });

  document.querySelectorAll('[data-close-modal]').forEach((b) => {
    b.addEventListener('click', () => closeModal(b.closest('.modal')));
  });
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target !== m || m === el.cubeModal) return;
      closeModal(m);
    });
  });
  // Esc על חלון ההכפלה לא "מעלים" את ההחלטה — מחזירים אותו
  new MutationObserver(() => {
    if (el.cubeModal.hidden && state.phase === 'cube' && state.offer >= 0 && !isAI(1 - state.offer)) {
      setTimeout(() => { if (state.phase === 'cube' && el.cubeModal.hidden) showCubeModal(); }, 50);
    }
  }).observe(el.cubeModal, { attributes: true, attributeFilter: ['hidden'] });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 120);
  });

  window.addEventListener('pagehide', saveGame);

  /* --------------------------------------------------------------------- */
  /* אתחול                                                                  */
  /* --------------------------------------------------------------------- */

  function restore(saved) {
    if (!saved || saved.v !== 1 || !Array.isArray(saved.pos) || saved.pos.length !== 50) return false;
    const pos = Int8Array.from(saved.pos);
    for (let s = 0; s < 2; s++) if (BG.onBoard(pos, s) + BG.offCount(pos, s) !== 15 || BG.offCount(pos, s) < 0) return false;
    state.mode = saved.mode === 'pvp' ? 'pvp' : 'ai';
    state.level = saved.level || 3;
    state.matchTo = saved.matchTo || 0;
    state.cubeOn = saved.cubeOn !== false;
    state.score = Array.isArray(saved.score) ? saved.score.slice(0, 2) : [0, 0];
    state.crawford = !!saved.crawford;
    state.crawfordUsed = !!saved.crawfordUsed;
    state.gameNo = saved.gameNo || 1;
    state.turn = saved.turn === 1 ? 1 : 0;
    state.cube = saved.cube && saved.cube.value ? saved.cube : { value: 1, owner: -1 };
    state.lastTurn = saved.lastTurn || null;
    state.hints = saved.hints || 0;
    state.result = saved.result || null;
    state.offer = typeof saved.offer === 'number' ? saved.offer : -1;
    // ההגדרה כבויה ועוד לא הוכפל במשחק הזה — מכבים גם בו
    if (state.prefs.cube === '0' && state.cube.value === 1 && state.offer < 0) state.cubeOn = false;
    state.pos = pos;
    state.phase = saved.phase;
    logLine();

    if (state.phase === 'move' && saved.dice && saved.startPos) {
      state.dice = saved.dice;
      state.startPos = Int8Array.from(saved.startPos);
      state.legal = BG.turns(state.startPos, state.turn, state.dice[0], state.dice[1]);
      // המחשב מתחיל את התור מחדש; אדם ממשיך מאיפה שעצר
      state.played = isAI(state.turn) ? [] : (saved.played || []);
      state.pos = new Int8Array(state.startPos);
      state.played.forEach((m) => BG.apply(state.pos, state.turn, m[0], m[1]));
      refreshPart();
      renderAll(true);
      afterRoll();
      return true;
    }
    if (state.phase === 'cube' && state.offer >= 0) {
      renderAll(true);
      offerDouble(state.offer);
      return true;
    }
    if (state.phase === 'opening') {
      // הטלת הפתיחה לא נשמרת באמצע — פשוט מטילים שוב, בלי לאבד את התוצאה
      startGame();
      return true;
    }
    if (state.phase === 'over' && state.result) {
      renderAll(true);
      setTimeout(showOver, 300);
      return true;
    }
    if (state.phase === 'preroll') {
      state.dice = null;
      renderAll(true);
      startTurn();
      return true;
    }
    return false;
  }

  function init() {
    applyTheme();
    if (H) H.setEnabled(!!state.prefs.haptics);
    if (S) S.setEnabled(!!state.prefs.sound);
    build();
    if (!restore(store.read(SAVE_KEY, null))) {
      newMatch({ mode: state.prefs.mode, level: state.prefs.level, match: state.prefs.match, cube: state.prefs.cube });
    }
    if (!store.ok) setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
  }

  init();
})();
