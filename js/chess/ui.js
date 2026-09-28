/* =============================================================================
 * chess/ui.js — ממשק השחמט
 * -----------------------------------------------------------------------------
 * לוח, בחירה והזזה (נגיעה או גרירה), הכתרה, תור המחשב, ביטול/רמז/הפיכה,
 * רישום מהלכים, שמירה וסטטיסטיקות.
 *
 * המחשב חושב באותו thread, עם מגבלת זמן (עד ~2 שניות ברמה הקשה). לפני
 * החיפוש יש השהיה קצרה, כדי שהדפדפן יספיק לצייר את המהלך של השחקן — אחרת
 * הלוח "קופא" בדיוק ברגע שהשחקן מצפה לראות את הכלי שלו זז.
 *
 * כל פעולה שעלולה להתנגש בתשובת מחשב שעוד לא הגיעה (ביטול, משחק חדש)
 * מקדמת את token — ותשובה עם token ישן פשוט נזרקת.
 * =========================================================================== */
(function () {
  'use strict';

  const Chess = window.Chess;
  const AI = window.ChessAI;
  const H = window.Haptics;

  const $ = (s) => document.querySelector(s);

  const PREFS_KEY = 'chess.v1.prefs';
  const SAVE_KEY = 'chess.v1.save';
  const STATS_KEY = 'chess.v1.stats';

  const FILES = 'abcdefgh';
  /* תמיד התווים המלאים; U+FE0E מבקש גרסת טקסט ולא אמוג'י */
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const VS = '︎';
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const LEVEL_NAMES = { 1: 'מתחיל', 2: 'קל', 3: 'בינוני', 4: 'קשה' };
  const PIECE_NAMES = { k: 'מלך', q: 'מלכה', r: 'צריח', b: 'רץ', n: 'פרש', p: 'רגלי' };
  const REASONS = {
    mate: 'מט',
    stalemate: 'פט — אין מהלך חוקי, אבל גם אין שח',
    fifty: '50 מהלכים בלי הכאה ובלי תזוזת רגלי',
    repetition: 'אותה עמדה חזרה שלוש פעמים',
    material: 'לא נשארו מספיק כלים למט',
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
    showMoves: true,
    coords: true,
    autoFlip: false,
    // אפשרויות המשחק החדש האחרון
    mode: 'ai',
    level: '2',
    color: 'w',
  };

  const state = {
    prefs: Object.assign({}, DEFAULT_PREFS, store.read(PREFS_KEY, {})),
    game: null,
    mode: 'ai',
    human: 'w',
    level: 2,
    orient: 'w',
    selected: null,
    targets: [],
    lastMove: null,
    hint: null,
    thinking: false,
    token: 0,
    over: null,
    hints: 0,
    recorded: false,
    /** משבצות לפי שם — נבנות מחדש רק בהפיכת הלוח */
    squares: new Map(),
  };

  const el = {
    stage: $('.ch-stage'),
    board: $('#board'),
    playerTop: $('#playerTop'),
    playerBottom: $('#playerBottom'),
    dotTop: $('#dotTop'),
    dotBottom: $('#dotBottom'),
    nameTop: $('#nameTop'),
    nameBottom: $('#nameBottom'),
    capTop: $('#capTop'),
    capBottom: $('#capBottom'),
    statusLine: $('#statusLine'),
    moveList: $('#moveList'),
    btnUndo: $('#btnUndo'),
    btnHint: $('#btnHint'),
    btnFlip: $('#btnFlip'),
    btnNew: $('#btnNew'),
    footerInfo: $('#footerInfo'),
    toast: $('#toast'),
    newModal: $('#newModal'),
    aiOnly: $('#aiOnly'),
    btnStart: $('#btnStart'),
    promoModal: $('#promoModal'),
    promoChoices: $('#promoChoices'),
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
  const stats = () => store.read(STATS_KEY, {});
  const other = (c) => (c === 'w' ? 'b' : 'w');

  function saveGame() {
    const g = state.game;
    if (!g) return;
    if (state.over) { store.remove(SAVE_KEY); return; }
    store.write(SAVE_KEY, {
      mode: state.mode, human: state.human, level: state.level, orient: state.orient,
      moves: g.history.map((m) => m.san), hints: state.hints,
    });
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

  function pieceSpan(piece) {
    const s = document.createElement('span');
    s.className = 'ch-pc ' + Chess.colorOf(piece);
    s.textContent = GLYPH[Chess.typeOf(piece)] + VS;
    return s;
  }

  /** האם השחקן האנושי רשאי להזיז עכשיו כלי בצבע הזה */
  function humanTurn() {
    const g = state.game;
    if (state.over || state.thinking) return false;
    return state.mode === 'pvp' || g.turn === state.human;
  }

  /* --------------------------------------------------------------------- */
  /* מידות                                                                  */
  /* --------------------------------------------------------------------- */

  function resize() {
    const availW = el.stage.clientWidth || 360;
    const top = el.board.getBoundingClientRect().top + window.scrollY;
    // מתחת ללוח: שחקן, שורת מצב, כלים, רשימת מהלכים ופוטר
    const below = 250;
    const availH = window.innerHeight - top - below;
    const sq = Math.max(32, Math.min(72, Math.floor(Math.min(availW, Math.max(availH, 280)) / 8)));
    el.stage.style.setProperty('--sq', sq + 'px');
  }

  /* --------------------------------------------------------------------- */
  /* הלוח                                                                   */
  /* --------------------------------------------------------------------- */

  function buildBoard() {
    el.board.textContent = '';
    state.squares.clear();
    const flip = state.orient === 'b';
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const rank = flip ? i + 1 : 8 - i;
        const f = flip ? 7 - j : j;
        const name = FILES[f] + rank;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ch-sq' + ((f + rank) % 2 === 1 ? ' is-dark' : '');
        b.dataset.sq = name;
        b.setAttribute('role', 'gridcell');
        if (i === 7) {
          const c = document.createElement('span');
          c.className = 'ch-coord file';
          c.textContent = FILES[f];
          b.appendChild(c);
        }
        if (j === 0) {
          const c = document.createElement('span');
          c.className = 'ch-coord rank';
          c.textContent = String(rank);
          b.appendChild(c);
        }
        el.board.appendChild(b);
        state.squares.set(name, b);
      }
    }
  }

  function render() {
    const g = state.game;
    const board = new Map(g.pieces().map((p) => [p.square, p.piece]));
    const check = g.checkSquare();
    const targetSet = new Map(state.targets.map((m) => [m.to, m]));
    el.board.classList.toggle('no-coords', !state.prefs.coords);

    state.squares.forEach((sqEl, name) => {
      const piece = board.get(name) || null;
      const cur = sqEl.querySelector('.ch-pc');
      const curPiece = cur ? cur.dataset.p : null;
      if (curPiece !== piece) {
        if (cur) cur.remove();
        if (piece) {
          const s = pieceSpan(piece);
          s.dataset.p = piece;
          sqEl.appendChild(s);
        }
      }
      const t = targetSet.get(name);
      sqEl.classList.toggle('is-sel', state.selected === name);
      sqEl.classList.toggle('is-target', !!t && state.prefs.showMoves);
      sqEl.classList.toggle('is-capture', !!t && !!t.captured);
      sqEl.classList.toggle('is-last', !!state.lastMove && (state.lastMove.from === name || state.lastMove.to === name));
      sqEl.classList.toggle('is-check', check === name);
      sqEl.classList.toggle('is-hint', !!state.hint && (state.hint.from === name || state.hint.to === name));

      const label = (piece ? (piece === piece.toUpperCase() ? 'לבן ' : 'שחור ') + PIECE_NAMES[piece.toLowerCase()] + ' ב-' : '') + name;
      sqEl.setAttribute('aria-label', label);
    });

    renderPlayers();
    renderStatus();
    renderMoves();
  }

  /** אנימציית תזוזה: הכלי "נולד" במשבצת המקור ומחליק ליעד */
  function animate(from, to) {
    if (reducedMotion) return;
    const a = state.squares.get(from), b = state.squares.get(to);
    const pc = b && b.querySelector('.ch-pc');
    if (!a || !pc) return;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    pc.style.transform = 'translate(' + (ra.left - rb.left) + 'px,' + (ra.top - rb.top) + 'px)';
    void pc.offsetWidth;
    pc.classList.add('is-moving');
    pc.style.transform = '';
    setTimeout(() => pc.classList.remove('is-moving'), 220);
  }

  function renderPlayers() {
    const g = state.game;
    const bottom = state.orient, top = other(bottom);
    const name = (c) => {
      if (state.mode === 'pvp') return c === 'w' ? 'לבן' : 'שחור';
      return c === state.human ? 'את/ה' : 'מחשב · ' + LEVEL_NAMES[state.level];
    };
    el.nameTop.textContent = name(top);
    el.nameBottom.textContent = name(bottom);
    el.dotTop.className = 'ch-dot is-' + top;
    el.dotBottom.className = 'ch-dot is-' + bottom;
    el.playerTop.classList.toggle('is-turn', !state.over && g.turn === top);
    el.playerBottom.classList.toggle('is-turn', !state.over && g.turn === bottom);

    // כלים שנלקחו: מה שחסר ליריב לעומת ההתחלה
    const count = { w: {}, b: {} };
    g.pieces().forEach(({ piece }) => {
      const c = Chess.colorOf(piece), t = Chess.typeOf(piece);
      count[c][t] = (count[c][t] || 0) + 1;
    });
    let material = 0; // חיובי = יתרון ללבן
    g.pieces().forEach(({ piece }) => {
      const v = VALUE[Chess.typeOf(piece)];
      material += Chess.colorOf(piece) === 'w' ? v : -v;
    });
    const captured = (by) => {
      const victim = other(by);
      let html = '';
      ['q', 'r', 'b', 'n', 'p'].forEach((t) => {
        const miss = Math.max(0, START_COUNT[t] - (count[victim][t] || 0));
        for (let i = 0; i < miss; i++) html += GLYPH[t] + VS;
      });
      const adv = by === 'w' ? material : -material;
      if (adv > 0) html += '<span class="adv">+' + adv + '</span>';
      return html;
    };
    el.capTop.innerHTML = captured(top);
    el.capBottom.innerHTML = captured(bottom);
  }

  function renderStatus() {
    const g = state.game;
    const line = el.statusLine;
    line.classList.remove('is-check', 'is-thinking');
    const side = (c) => (c === 'w' ? 'הלבן' : 'השחור');
    if (state.over) {
      const st = state.over;
      if (st.reason === 'mate') {
        if (state.mode === 'ai') line.textContent = st.winner === state.human ? 'מט — ניצחת!' : 'מט — המחשב ניצח';
        else line.textContent = 'מט — ' + side(st.winner) + ' ניצח';
      } else {
        line.textContent = 'תיקו';
      }
    } else if (state.thinking) {
      line.textContent = 'המחשב חושב';
      line.classList.add('is-thinking');
    } else {
      const inCheck = g.inCheck();
      let text;
      if (state.mode === 'ai') text = g.turn === state.human ? 'תורך' : 'תור המחשב';
      else text = 'תור ' + side(g.turn);
      if (inCheck) { text = 'שח! ' + text; line.classList.add('is-check'); }
      line.textContent = text;
    }
    el.btnUndo.disabled = !g.history.length;
    el.btnHint.disabled = !humanTurn();
    const n = g.history.length;
    el.footerInfo.textContent = (state.mode === 'ai' ? 'מול המחשב · ' + LEVEL_NAMES[state.level] : 'שני שחקנים') +
      ' · מהלך ' + (Math.floor(n / 2) + 1);
  }

  function renderMoves() {
    const h = state.game.history;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < h.length; i += 2) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="n">' + (i / 2 + 1) + '.</span>' +
        '<span class="m' + (i === h.length - 1 ? ' is-last' : '') + '">' + h[i].san + '</span>' +
        (h[i + 1] ? '<span class="m' + (i + 1 === h.length - 1 ? ' is-last' : '') + '">' + h[i + 1].san + '</span>' : '');
      frag.appendChild(li);
    }
    el.moveList.textContent = '';
    el.moveList.appendChild(frag);
    el.moveList.scrollLeft = el.moveList.scrollWidth;
  }

  /* --------------------------------------------------------------------- */
  /* בחירה ומהלך                                                            */
  /* --------------------------------------------------------------------- */

  function select(name) {
    state.selected = name;
    state.targets = name ? state.game.legal({ square: name }) : [];
    render();
  }

  function ownPiece(name) {
    const p = state.game.get(name);
    return !!p && Chess.colorOf(p) === state.game.turn;
  }

  /** ניסיון להזיז מהמשבצת הנבחרת אל name. מחזיר true אם זה היה מהלך. */
  function tryMove(to, animated) {
    const t = state.targets.filter((m) => m.to === to);
    if (!t.length) return false;
    const from = state.selected;
    if (t.some((m) => m.promotion)) {
      askPromotion(from, to, animated);
      return true;
    }
    play({ from, to }, animated);
    return true;
  }

  function askPromotion(from, to, animated) {
    const color = state.game.turn;
    el.promoChoices.textContent = '';
    ['q', 'r', 'b', 'n'].forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', PIECE_NAMES[t]);
      b.appendChild(pieceSpan(color === 'w' ? t.toUpperCase() : t));
      b.addEventListener('click', () => {
        closeModal(el.promoModal);
        play({ from, to, promotion: t }, animated);
      });
      el.promoChoices.appendChild(b);
    });
    openModal(el.promoModal);
  }

  /** מבצע מהלך (של אדם או של המחשב) ומטפל בכל מה שאחריו. */
  function play(input, animated) {
    const g = state.game;
    const m = g.move(input);
    if (!m) return false;
    state.selected = null;
    state.targets = [];
    state.hint = null;
    state.lastMove = { from: m.from, to: m.to };

    if (g.inCheck()) feel('warn');
    else if (m.captured) feel('lock');
    else feel('move');

    // בשני שחקנים עם הפיכה אוטומטית — הלוח מסתובב לצד שתורו
    if (state.mode === 'pvp' && state.prefs.autoFlip && state.orient !== g.turn) {
      state.orient = g.turn;
      buildBoard();
      render();
    } else {
      render();
      if (animated !== false) {
        animate(m.from, m.to);
        if (m.flag === 'k' || m.flag === 'q') {
          const rank = m.to[1];
          animate((m.flag === 'k' ? 'h' : 'a') + rank, (m.flag === 'k' ? 'f' : 'd') + rank);
        }
      }
    }
    say(m.san);
    saveGame();
    afterMove();
    return true;
  }

  function afterMove() {
    const g = state.game;
    const st = g.status();
    if (st.over) { finish(st); return; }
    if (state.mode === 'ai' && g.turn !== state.human) computerTurn();
  }

  function computerTurn() {
    const token = ++state.token;
    state.thinking = true;
    renderStatus();
    // השהיה כדי שהדפדפן יצייר את המהלך האחרון לפני שהחיפוש תופס את ה-thread
    setTimeout(() => {
      if (token !== state.token) return;
      const t0 = performance.now();
      const m = AI.bestMove(state.game, { level: state.level });
      const wait = Math.max(0, 450 - (performance.now() - t0));
      setTimeout(() => {
        if (token !== state.token) return;
        state.thinking = false;
        if (m) play(m, true);
        else renderStatus();
      }, wait);
    }, 60);
  }

  /* --------------------------------------------------------------------- */
  /* סיום                                                                   */
  /* --------------------------------------------------------------------- */

  function finish(st) {
    state.over = st;
    state.thinking = false;
    render();
    store.remove(SAVE_KEY);

    let title, sub = REASONS[st.reason] || '';
    let outcome = 'd';
    if (st.reason === 'mate') {
      if (state.mode === 'ai') {
        outcome = st.winner === state.human ? 'w' : 'l';
        title = outcome === 'w' ? 'ניצחת!' : 'המחשב ניצח';
      } else {
        title = (st.winner === 'w' ? 'הלבן' : 'השחור') + ' ניצח!';
      }
    } else {
      title = 'תיקו';
    }

    if (!state.recorded) {
      state.recorded = true;
      const s = stats();
      if (state.mode === 'ai') {
        s.ai = s.ai || {};
        const k = String(state.level);
        s.ai[k] = s.ai[k] || { w: 0, l: 0, d: 0 };
        s.ai[k][outcome]++;
      } else {
        s.pvp = (s.pvp || 0) + 1;
      }
      store.write(STATS_KEY, s);
    }

    feel(outcome === 'w' ? 'win' : outcome === 'l' ? 'reject' : 'move');
    say(title + '. ' + sub, true);

    el.overTitle.textContent = title;
    el.overSub.textContent = sub;
    const g = state.game;
    el.overStats.innerHTML =
      '<div class="win-stat' + (outcome === 'w' ? ' is-best' : '') + '"><span class="k">תוצאה</span><span class="v">' + st.result + '</span></div>' +
      '<div class="win-stat"><span class="k">מהלכים</span><span class="v">' + Math.ceil(g.history.length / 2) + '</span></div>' +
      (state.mode === 'ai'
        ? '<div class="win-stat"><span class="k">רמה</span><span class="v">' + LEVEL_NAMES[state.level] + '</span></div>' +
          '<div class="win-stat"><span class="k">רמזים</span><span class="v">' + state.hints + '</span></div>'
        : '');
    setTimeout(() => openModal(el.overModal), 500);
  }

  /* --------------------------------------------------------------------- */
  /* פעולות                                                                 */
  /* --------------------------------------------------------------------- */

  function undo() {
    const g = state.game;
    if (!g.history.length) return;
    state.token++; // מבטל תשובת מחשב שבדרך
    state.thinking = false;
    if (state.mode === 'ai') {
      // מחזירים עד שתור האדם — ולפחות מהלך אחד שלו
      g.undo();
      while (g.history.length && g.turn !== state.human) g.undo();
    } else {
      g.undo();
    }
    state.over = null;
    state.selected = null;
    state.targets = [];
    state.hint = null;
    const last = g.history[g.history.length - 1];
    state.lastMove = last ? { from: last.from, to: last.to } : null;
    if (state.mode === 'pvp' && state.prefs.autoFlip && state.orient !== g.turn) {
      state.orient = g.turn;
      buildBoard();
    }
    feel('move');
    render();
    saveGame();
    // אם אחרי הביטול תור המחשב (למשל, האדם משחק בשחור ובוטל הכול)
    if (state.mode === 'ai' && g.turn !== state.human) computerTurn();
  }

  function hint() {
    if (!humanTurn()) return;
    const m = AI.bestMove(state.game, { level: 3, time: 700 });
    if (!m) return;
    state.hint = { from: m.from, to: m.to };
    state.hints++;
    state.selected = null;
    state.targets = [];
    render();
    say('רמז: מ-' + m.from + ' ל-' + m.to);
    saveGame();
  }

  function flip() {
    state.orient = other(state.orient);
    buildBoard();
    render();
    saveGame();
  }

  function newGame(opts) {
    state.token++;
    state.game = new Chess();
    state.mode = opts.mode;
    state.level = parseInt(opts.level, 10) || 2;
    state.human = opts.color === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : opts.color;
    if (state.mode === 'pvp') state.human = 'w';
    state.orient = state.human;
    state.selected = null;
    state.targets = [];
    state.lastMove = null;
    state.hint = null;
    state.thinking = false;
    state.over = null;
    state.hints = 0;
    state.recorded = false;
    closeModal(el.overModal);
    buildBoard();
    resize();
    render();
    saveGame();
    if (state.mode === 'ai' && state.human === 'b') computerTurn();
  }

  /* --------------------------------------------------------------------- */
  /* קלט — נגיעה וגרירה                                                     */
  /* --------------------------------------------------------------------- */

  let press = null;
  let ghost = null;

  function squareAt(x, y) {
    const t = document.elementFromPoint(x, y);
    const s = t && t.closest && t.closest('.ch-sq');
    return s && el.board.contains(s) ? s.dataset.sq : null;
  }

  el.board.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const sqEl = e.target.closest('.ch-sq');
    if (!sqEl) return;
    const name = sqEl.dataset.sq;
    e.preventDefault();

    if (!humanTurn()) {
      if (state.thinking) toast('המחשב עדיין חושב');
      return;
    }
    // נגיעה ביעד חוקי של הכלי הנבחר — מהלך
    if (state.selected && name !== state.selected && tryMove(name, true)) return;

    if (ownPiece(name)) {
      const again = state.selected === name;
      if (!again) select(name);
      press = { name, x: e.clientX, y: e.clientY, id: e.pointerId, again, dragging: false };
      try { el.board.setPointerCapture(e.pointerId); } catch (err) {}
      return;
    }
    if (state.selected) select(null);
  });

  el.board.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.dragging) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6) return;
      press.dragging = true;
      const src = state.squares.get(press.name).querySelector('.ch-pc');
      if (src) src.classList.add('is-lifted');
      ghost = document.createElement('div');
      ghost.className = 'ch-drag';
      ghost.style.setProperty('--sq', getComputedStyle(el.stage).getPropertyValue('--sq'));
      ghost.appendChild(pieceSpan(state.game.get(press.name)));
      document.body.appendChild(ghost);
    }
    ghost.style.left = e.clientX + 'px';
    ghost.style.top = e.clientY + 'px';
    const over = squareAt(e.clientX, e.clientY);
    state.squares.forEach((s, n) => s.classList.toggle('is-over', n === over && state.targets.some((m) => m.to === n)));
  });

  function endPress(e, cancel) {
    if (!press || (e && e.pointerId !== press.id)) return;
    const p = press;
    press = null;
    state.squares.forEach((s) => s.classList.remove('is-over'));
    if (ghost) { ghost.remove(); ghost = null; }
    const src = state.squares.get(p.name) && state.squares.get(p.name).querySelector('.ch-pc');
    if (src) src.classList.remove('is-lifted');
    if (cancel) return;

    if (p.dragging) {
      const to = squareAt(e.clientX, e.clientY);
      if (to && to !== p.name && tryMove(to, false)) return;
      render();
      return;
    }
    // נגיעה שנייה באותו כלי — מבטלת את הבחירה
    if (p.again) select(null);
  }
  el.board.addEventListener('pointerup', (e) => endPress(e, false));
  el.board.addEventListener('pointercancel', (e) => endPress(e, true));

  /* מקלדת: Enter/רווח על משבצת = נגיעה */
  el.board.addEventListener('click', (e) => {
    if (e.detail !== 0) return; // לחיצת עכבר/מגע כבר טופלה ב-pointerdown
    const sqEl = e.target.closest('.ch-sq');
    if (!sqEl || !humanTurn()) return;
    const name = sqEl.dataset.sq;
    if (state.selected && name !== state.selected && tryMove(name, true)) return;
    if (ownPiece(name)) select(state.selected === name ? null : name);
    else select(null);
    const again = state.squares.get(name);
    if (again) again.focus();
  });

  document.addEventListener('keydown', (e) => {
    if (window.Modal && window.Modal.top()) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); }
    else if (e.key === 'Escape' && state.selected) select(null);
  });

  /* --------------------------------------------------------------------- */
  /* חלון משחק חדש                                                          */
  /* --------------------------------------------------------------------- */

  const pick = { mode: 'ai', level: '2', color: 'w' };

  function syncNewModal() {
    el.newModal.querySelectorAll('.ch-seg').forEach((seg) => {
      const opt = seg.dataset.opt;
      seg.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', b.dataset.val === pick[opt] ? 'true' : 'false');
      });
    });
    el.aiOnly.hidden = pick.mode !== 'ai';
  }

  function openNew() {
    pick.mode = state.prefs.mode;
    pick.level = String(state.prefs.level);
    pick.color = state.prefs.color;
    syncNewModal();
    openModal(el.newModal);
  }

  el.newModal.addEventListener('click', (e) => {
    const b = e.target.closest('.ch-seg button');
    if (!b) return;
    pick[b.closest('.ch-seg').dataset.opt] = b.dataset.val;
    syncNewModal();
  });

  el.btnStart.addEventListener('click', () => {
    closeModal(el.newModal);
    state.prefs.mode = pick.mode;
    state.prefs.level = pick.level;
    state.prefs.color = pick.color;
    savePrefs();
    newGame(pick);
  });

  /* --------------------------------------------------------------------- */
  /* אירועים                                                                */
  /* --------------------------------------------------------------------- */

  el.btnUndo.addEventListener('click', undo);
  el.btnHint.addEventListener('click', hint);
  el.btnFlip.addEventListener('click', flip);
  el.btnNew.addEventListener('click', () => {
    if (!state.over && state.game.history.length > 2) {
      askConfirm('להתחיל משחק חדש? המשחק הנוכחי יימחק.', openNew);
      return;
    }
    openNew();
  });
  el.btnOverNew.addEventListener('click', () => { closeModal(el.overModal); openNew(); });

  el.btnTheme.addEventListener('click', () => {
    const order = { auto: 'light', light: 'dark', dark: 'auto' };
    state.prefs.theme = order[state.prefs.theme] || 'light';
    savePrefs();
    applyTheme();
  });

  el.btnHelp.addEventListener('click', () => openModal(el.helpModal));

  function renderStats() {
    const s = stats();
    const ai = s.ai || {};
    const rows = [];
    [1, 2, 3, 4].forEach((lv) => {
      const r = ai[lv] || { w: 0, l: 0, d: 0 };
      rows.push(['מול מחשב ' + LEVEL_NAMES[lv], r.w + ' נצ׳ · ' + r.l + ' הפ׳ · ' + r.d + ' תיקו']);
    });
    rows.push(['משחקי שני שחקנים', String(s.pvp || 0)]);
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
      toast('הנתונים אופסו');
    });
  });

  el.btnSettings.addEventListener('click', () => {
    el.settingsModal.querySelectorAll('[data-pref]').forEach((i) => {
      i.checked = !!state.prefs[i.dataset.pref];
    });
    const mode = H ? H.supported() : 'none';
    el.hapticsNote.textContent =
      mode === 'vibrate' ? 'משוב מישושי על מהלך, הכאה ושח'
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
    if (key === 'autoFlip' && state.mode === 'pvp' && input.checked && state.orient !== state.game.turn) {
      state.orient = state.game.turn;
      buildBoard();
    }
    render();
  });

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
    m.addEventListener('click', (e) => { if (e.target === m && m !== el.promoModal) closeModal(m); });
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });

  window.addEventListener('pagehide', saveGame);

  /* --------------------------------------------------------------------- */
  /* אתחול                                                                  */
  /* --------------------------------------------------------------------- */

  function init() {
    applyTheme();
    if (H) H.setEnabled(!!state.prefs.haptics);

    const saved = store.read(SAVE_KEY, null);
    if (saved && Array.isArray(saved.moves)) {
      const g = new Chess();
      const ok = saved.moves.every((san) => g.move(san));
      if (ok && !g.status().over) {
        state.game = g;
        state.mode = saved.mode === 'pvp' ? 'pvp' : 'ai';
        state.human = saved.human === 'b' ? 'b' : 'w';
        state.level = saved.level || 2;
        state.orient = saved.orient === 'b' ? 'b' : 'w';
        state.hints = saved.hints || 0;
        const last = g.history[g.history.length - 1];
        state.lastMove = last ? { from: last.from, to: last.to } : null;
        buildBoard();
        resize();
        render();
        if (state.mode === 'ai' && g.turn !== state.human) computerTurn();
        return;
      }
    }
    newGame({ mode: state.prefs.mode, level: state.prefs.level, color: state.prefs.color });

    if (!store.ok) setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
  }

  init();
})();
