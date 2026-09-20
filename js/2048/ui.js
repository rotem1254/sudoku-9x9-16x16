/* =============================================================================
 * 2048/ui.js — ממשק 2048
 * -----------------------------------------------------------------------------
 * הנפשה, קלט (מקלדת + החלקה), שמירה.
 *
 * ההחלטה המרכזית היא ההנפשה. המנוע הוא מקור האמת: הוא מחזיר לכל מהלך
 * transitions (מאיפה לאן זז כל אריח, והאם התמזג). ה-UI מזיז את אלמנטי
 * ה-DOM הקיימים לפי המידע הזה — כך ההחלקה אמיתית ולא ציור מחדש שמהבהב.
 *
 * אריחים ממוקמים לפי offsetLeft/offsetTop של תאי הרקע, כך שהיישור מדויק
 * לפיקסל בכל גודל מסך ואין חישוב כפול של רוחב תא.
 * =========================================================================== */
(function () {
  'use strict';

  const Game2048 = window.Game2048;
  const H = window.Haptics;

  const $ = (s) => document.querySelector(s);

  const PREFS_KEY = 'g2048.v1.prefs';
  const SAVE_KEY = 'g2048.v1.save';
  const STATS_KEY = 'g2048.v1.stats';

  /* תזוזה מינימלית בפיקסלים שנחשבת החלקה ולא נגיעה */
  const SWIPE_MIN = 24;

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
  };

  const state = {
    prefs: Object.assign({}, DEFAULT_PREFS, store.read(PREFS_KEY, {})),
    game: null,
    /** האריחים המוצגים כרגע: [{ id, value, index, el }] */
    tiles: [],
    /** תאי הרקע, כדי למקם אריחים ביחס אליהם */
    bgCells: [],
    tileLayer: null,
    nextId: 1,
    busy: false,
    /** האם כבר הראינו את מסך הניצחון (כדי לא לחזור עליו) */
    winShown: false,
  };

  const el = {
    board: $('#board'),
    statScore: $('#statScore'),
    statBest: $('#statBest'),
    statTop: $('#statTop'),
    footerInfo: $('#footerInfo'),
    toast: $('#toast'),
    overModal: $('#overModal'),
    overTitle: $('#overTitle'),
    overSub: $('#overSub'),
    overStats: $('#overStats'),
    confetti: $('#confetti'),
    btnOverNew: $('#btnOverNew'),
    winModal: $('#winModal'),
    winStats: $('#winStats'),
    btnWinContinue: $('#btnWinContinue'),
    btnWinNew: $('#btnWinNew'),
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

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ANIM = reducedMotion ? 0 : 100;

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
  function saveGame() {
    if (!state.game) return;
    const data = state.game.serialize();
    data.winShown = state.winShown;
    store.write(SAVE_KEY, data);
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

  const stats = () => store.read(STATS_KEY, {});

  /* --------------------------------------------------------------------- */
  /* בניית הלוח                                                             */
  /* --------------------------------------------------------------------- */

  function buildBoard() {
    el.board.textContent = '';

    const bg = document.createElement('div');
    bg.className = 'grid-bg';
    state.bgCells = [];
    for (let i = 0; i < state.game.grid.length; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      bg.appendChild(cell);
      state.bgCells.push(cell);
    }
    el.board.appendChild(bg);

    const layer = document.createElement('div');
    layer.className = 'tiles';
    el.tileLayer = layer;
    el.board.appendChild(layer);
  }

  /* --------------------------------------------------------------------- */
  /* אריחים                                                                 */
  /* --------------------------------------------------------------------- */

  /** ממקם אריח לפי תא הרקע שבאינדקס שלו. */
  function positionTile(t) {
    const bg = state.bgCells[t.index];
    if (!bg) return;
    const x = bg.offsetLeft;
    const y = bg.offsetTop;
    const w = bg.offsetWidth;
    t.el.style.width = w + 'px';
    t.el.style.height = w + 'px';
    t.el.style.setProperty('--tx', x + 'px');
    t.el.style.setProperty('--ty', y + 'px');
    t.el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    fitFont(t, w);
  }

  /** גודל הגופן קטן ככל שיש יותר ספרות, כדי שמספר גדול לא יגלוש. */
  function fitFont(t, w) {
    const len = String(t.value).length;
    const factor = len >= 4 ? 0.30 : len === 3 ? 0.38 : 0.46;
    t.el.style.fontSize = Math.round(w * factor) + 'px';
  }

  function applyValue(t) {
    t.el.dataset.val = String(t.value);
    t.el.classList.toggle('is-super', t.value > 2048);
    t.el.firstChild.textContent = String(t.value);
  }

  /** יוצר אריח חדש, ממקם אותו מיד (בלי החלקה מהפינה) ומחזיר את האובייקט. */
  function createTile(value, index, cls) {
    const div = document.createElement('div');
    div.className = 'tile' + (cls ? ' ' + cls : '');
    const span = document.createElement('span');
    span.className = 'tile-val';
    div.appendChild(span);

    const t = { id: state.nextId++, value, index, el: div };
    applyValue(t);
    el.tileLayer.appendChild(div);
    positionTile(t);
    return t;
  }

  /** מנקה ובונה מחדש את כל שכבת האריחים מהלוח (טעינה / משחק חדש). */
  function renderAll() {
    state.tiles.forEach((t) => { if (t.el.parentNode) t.el.remove(); });
    state.tiles = [];
    el.board.classList.add('no-anim');
    const g = state.game.grid;
    for (let i = 0; i < g.length; i++) {
      if (g[i] !== 0) state.tiles.push(createTile(g[i], i));
    }
    // מחזירים את ההנפשה אחרי שהמיקום הראשוני נצבע
    requestAnimationFrame(() => el.board.classList.remove('no-anim'));
  }

  /* --------------------------------------------------------------------- */
  /* מהלך                                                                   */
  /* --------------------------------------------------------------------- */

  function tryMove(dir) {
    if (!state.game || state.busy) return;
    const res = state.game.move(dir);
    if (!res.moved) { feel('reject'); return; }

    feel('move');
    animateMove(res);
    renderStatus();
    saveGame();
  }

  function animateMove(res) {
    state.busy = true;

    const byIndex = new Map(state.tiles.map((t) => [t.index, t]));

    /* קבוצה לפי תא היעד — כדי לזהות מיזוגים (שני מקורות לאותו יעד) */
    const groups = new Map();
    res.transitions.forEach((tr) => {
      if (!groups.has(tr.to)) groups.set(tr.to, []);
      groups.get(tr.to).push(tr);
    });

    const survivors = [];
    const toRemove = [];

    groups.forEach((trs, to) => {
      if (trs.length === 1) {
        const t = byIndex.get(trs[0].from);
        t.index = to;
        positionTile(t);
        survivors.push(t);
      } else {
        /* מיזוג: שני האריחים מחליקים לאותו תא, האחד נעלם והשני מוכפל */
        const keep = byIndex.get(trs[0].from);
        const gone = byIndex.get(trs[1].from);
        keep.index = to;
        gone.index = to;
        positionTile(keep);
        positionTile(gone);
        keep._mergeTo = trs[0].value * 2;
        survivors.push(keep);
        toRemove.push(gone);
      }
    });

    const finish = () => {
      toRemove.forEach((t) => { if (t.el.parentNode) t.el.remove(); });

      survivors.forEach((t) => {
        if (t._mergeTo) {
          t.value = t._mergeTo;
          delete t._mergeTo;
          applyValue(t);
          positionTile(t);
          pop(t, 'is-merged');
        }
      });

      state.tiles = survivors;

      if (res.spawn) {
        const nt = createTile(res.spawn.value, res.spawn.index, reducedMotion ? '' : 'is-new');
        state.tiles.push(nt);
      }

      state.busy = false;

      /* מצבי סיום נבדקים רק אחרי שההנפשה נחה */
      if (res.won && !state.winShown) {
        state.winShown = true;
        saveGame();
        showWin();
      } else if (state.game.isOver()) {
        showOver();
      }
    };

    if (ANIM) setTimeout(finish, ANIM);
    else finish();
  }

  /** מפעיל אנימציית מחלקה חד-פעמית (pop / appear). */
  function pop(t, cls) {
    if (reducedMotion) return;
    t.el.classList.remove(cls);
    void t.el.offsetWidth; // reflow כדי שהאנימציה תרוץ שוב
    t.el.classList.add(cls);
    setTimeout(() => t.el.classList.remove(cls), 200);
  }

  /* --------------------------------------------------------------------- */
  /* לוח מחוונים                                                            */
  /* --------------------------------------------------------------------- */

  function renderStatus() {
    const g = state.game;
    const s = stats();
    el.statScore.textContent = String(g.score);
    el.statBest.textContent = String(Math.max(g.score, s.best || 0));
    el.statTop.textContent = String(g.bestTile());
    el.footerInfo.textContent = g.moves + ' מהלכים';
  }

  /* --------------------------------------------------------------------- */
  /* סיום וניצחון                                                           */
  /* --------------------------------------------------------------------- */

  function recordEnd() {
    const g = state.game;
    const s = stats();
    s.played = (s.played || 0) + 1;
    if (g.score > (s.best || 0)) s.best = g.score;
    if (g.bestTile() > (s.bestTile || 0)) s.bestTile = g.bestTile();
    if (g.won) s.wins = (s.wins || 0) + 1;
    s.totalScore = (s.totalScore || 0) + g.score;
    store.write(STATS_KEY, s);
    return s;
  }

  function showWin() {
    feel('win');
    say('הגעת ל-2048! ניקוד ' + state.game.score, true);
    el.winStats.innerHTML =
      '<div class="win-stat is-best"><span class="k">אריח</span><span class="v">2048</span></div>' +
      '<div class="win-stat"><span class="k">ניקוד</span><span class="v">' + state.game.score + '</span></div>' +
      '<div class="win-stat"><span class="k">מהלכים</span><span class="v">' + state.game.moves + '</span></div>';
    setTimeout(() => openModal(el.winModal), 300);
  }

  function showOver() {
    const g = state.game;
    const isBest = g.score >= (stats().best || 0);
    const s = recordEnd();

    feel('reject');
    say((isBest ? 'שיא חדש! ' : 'נגמרו המהלכים. ') + 'ניקוד ' + g.score, true);

    el.overTitle.textContent = isBest ? 'שיא חדש!' : 'נגמרו המהלכים';
    el.overSub.textContent = isBest
      ? 'זה הניקוד הגבוה ביותר שלך'
      : 'הלוח מלא ואין עוד מהלך';

    el.overStats.innerHTML =
      '<div class="win-stat' + (isBest ? ' is-best' : '') + '"><span class="k">ניקוד</span><span class="v">' + g.score + '</span></div>' +
      '<div class="win-stat"><span class="k">שיא</span><span class="v">' + (s.best || g.score) + '</span></div>' +
      '<div class="win-stat"><span class="k">אריח גבוה</span><span class="v">' + g.bestTile() + '</span></div>' +
      '<div class="win-stat"><span class="k">מהלכים</span><span class="v">' + g.moves + '</span></div>';

    renderStatus();
    setTimeout(() => openModal(el.overModal), 360);
  }

  /* --------------------------------------------------------------------- */
  /* משחק חדש                                                               */
  /* --------------------------------------------------------------------- */

  function newGame() {
    state.game = new Game2048();
    state.winShown = false;
    closeModal(el.overModal);
    closeModal(el.winModal);
    buildBoard();
    renderAll();
    renderStatus();
    saveGame();
  }

  /* --------------------------------------------------------------------- */
  /* קלט                                                                    */
  /* --------------------------------------------------------------------- */

  const KEYMAP = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
    W: 'up', S: 'down', A: 'left', D: 'right',
  };

  document.addEventListener('keydown', (e) => {
    if (window.Modal && window.Modal.top()) return; // חלון פתוח — לא משחקים
    const dir = KEYMAP[e.key];
    if (!dir) return;
    e.preventDefault();
    tryMove(dir);
  });

  /* החלקה במגע / עכבר */
  let sx = 0, sy = 0, tracking = false;
  el.board.addEventListener('pointerdown', (e) => {
    tracking = true;
    sx = e.clientX;
    sy = e.clientY;
  });
  el.board.addEventListener('pointerup', (e) => {
    if (!tracking) return;
    tracking = false;
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
    if (Math.abs(dx) > Math.abs(dy)) tryMove(dx > 0 ? 'right' : 'left');
    else tryMove(dy > 0 ? 'down' : 'up');
  });
  el.board.addEventListener('pointercancel', () => { tracking = false; });

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
      ['האריח הגבוה ביותר', String(s.bestTile || 0)],
      ['הגעות ל-2048', String(s.wins || 0)],
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
      mode === 'vibrate' ? 'משוב מישושי על מהלך, מיזוג וסיום'
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
  });

  el.btnNew.addEventListener('click', () => {
    if (state.game && !state.game.isOver() && state.game.moves > 3) {
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
  el.btnWinNew.addEventListener('click', newGame);
  el.btnWinContinue.addEventListener('click', () => closeModal(el.winModal));

  document.querySelectorAll('[data-close-modal]').forEach((b) => {
    b.addEventListener('click', () => closeModal(b.closest('.modal')));
  });
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
  });

  /* בשינוי גודל מסך האריחים ממוקמים מחדש, בלי החלקה */
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!state.game) return;
      el.board.classList.add('no-anim');
      state.tiles.forEach(positionTile);
      requestAnimationFrame(() => el.board.classList.remove('no-anim'));
    }, 120);
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
    if (saved && Array.isArray(saved.grid)) {
      state.game = Game2048.deserialize(saved);
      state.winShown = !!saved.winShown;
      buildBoard();
      renderAll();
      renderStatus();
      if (state.game.isOver()) setTimeout(showOver, 400);
    } else {
      newGame();
    }

    if (!store.ok) setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
  }

  init();
})();
