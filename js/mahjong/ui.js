/* =============================================================================
 * mahjong/ui.js — ממשק מהג'ונג סוליטר
 * -----------------------------------------------------------------------------
 * ציור הלוח, בחירה, רמז, ביטול, ערבוב, שעון ושמירה.
 *
 * כל אבן היא <button> שממוקם אבסולוטית. שכבה גבוהה זזה מעט שמאלה ולמעלה,
 * וצד האבן נראה מימין-למטה — זו ההמחשה התלת-ממדית הקלאסית. סדר הציור
 * (z-index) הוא שכבה, אחר כך שורה, אחר כך עמודה: אבן שמימין או מתחת
 * לשכנתה מכסה את הצד של השכנה, בדיוק כמו אבנים אמיתיות שנוגעות זו בזו.
 *
 * רק אבנים חופשיות מקבלות פוקוס מקלדת (tabindex), כך ש-Tab עובר רק על
 * מה שאפשר לשחק.
 * =========================================================================== */
(function () {
  'use strict';

  const Mahjong = window.Mahjong;
  const Faces = window.MahjongFaces;
  const H = window.Haptics;

  const $ = (s) => document.querySelector(s);

  const PREFS_KEY = 'mahjong.v1.prefs';
  const SAVE_KEY = 'mahjong.v1.save';
  const STATS_KEY = 'mahjong.v1.stats';

  /* יחס גובה/רוחב של אבן, ועובי הצד כחלק מהרוחב */
  const RATIO = 1.32;
  const DEPTH = 0.12;
  const MAX_TW = 58;

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
    dimBlocked: false,
    timer: true,
  };

  const state = {
    prefs: Object.assign({}, DEFAULT_PREFS, store.read(PREFS_KEY, {})),
    game: null,
    /** id -> אלמנט האבן */
    els: new Map(),
    selected: -1,
    hint: null,
    /** האם המשחק הזה כבר נספר בסטטיסטיקות (בזוג הראשון) */
    counted: false,
    finished: false,
    timerId: null,
  };

  const el = {
    felt: $('#felt'),
    board: $('#board'),
    statLeft: $('#statLeft'),
    statPairs: $('#statPairs'),
    statTime: $('#statTime'),
    footerInfo: $('#footerInfo'),
    toast: $('#toast'),
    btnUndo: $('#btnUndo'),
    btnHint: $('#btnHint'),
    btnShuffle: $('#btnShuffle'),
    btnNew: $('#btnNew'),
    winModal: $('#winModal'),
    winSub: $('#winSub'),
    winStats: $('#winStats'),
    btnWinNew: $('#btnWinNew'),
    stuckModal: $('#stuckModal'),
    btnStuckUndo: $('#btnStuckUndo'),
    btnStuckShuffle: $('#btnStuckShuffle'),
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
  function saveGame() {
    if (!state.game) return;
    const d = state.game.serialize();
    d.counted = state.counted;
    d.finished = state.finished;
    store.write(SAVE_KEY, d);
  }
  const stats = () => store.read(STATS_KEY, {});

  function fmt(sec) {
    sec = Math.floor(sec || 0);
    const m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
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
  /* מידות                                                                  */
  /* --------------------------------------------------------------------- */

  const dims = { tw: 40, th: 53, d: 5, maxZ: 4 };

  function measure() {
    const b = state.game.bounds();
    const cs = getComputedStyle(el.felt);
    const avail = el.felt.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const cols = b.w / 2;
    // רוחב כולל = עמודות × רוחב אבן + הזזת השכבות + עובי הצד
    let tw = avail / (cols + DEPTH * (b.layers + 1));
    tw = Math.max(16, Math.min(MAX_TW, Math.floor(tw)));
    dims.tw = tw;
    dims.th = Math.round(tw * RATIO);
    dims.d = Math.max(2, Math.round(tw * DEPTH));
    dims.maxZ = b.layers - 1;

    const w = cols * tw + dims.d * (b.layers + 1);
    const h = (b.h / 2) * dims.th + dims.d * (b.layers + 1);
    el.board.style.width = w + 'px';
    el.board.style.height = h + 'px';
    el.board.style.fontSize = (dims.d / 3.2) + 'px'; // הצללים ב-em — ראו ה-CSS
    el.board.style.setProperty('--tw', tw + 'px');
    el.board.style.setProperty('--th', dims.th + 'px');
  }

  function place(t, node) {
    const shift = (dims.maxZ - t.z) * dims.d; // שכבה גבוהה זזה שמאלה ולמעלה
    node.style.left = (t.x / 2) * dims.tw + shift + 'px';
    node.style.top = (t.y / 2) * dims.th + shift + 'px';
    node.style.zIndex = String(t.z * 1000 + t.y * 31 + t.x);
  }

  /* --------------------------------------------------------------------- */
  /* ציור                                                                   */
  /* --------------------------------------------------------------------- */

  function render() {
    measure();
    el.board.textContent = '';
    state.els.clear();
    const frag = document.createDocumentFragment();
    state.game.tiles.forEach((t) => {
      if (!t.alive) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mj-tile';
      b.dataset.id = String(t.id);
      b.innerHTML = Faces.svg(t.face);
      place(t, b);
      state.els.set(t.id, b);
      frag.appendChild(b);
    });
    el.board.appendChild(frag);
    refresh();
  }

  /** מעדכן חסימה, בחירה ורמז — בלי לבנות מחדש. */
  function refresh() {
    const g = state.game;
    const free = new Set(g.freeTiles());
    el.board.classList.toggle('dim-blocked', !!state.prefs.dimBlocked);
    state.els.forEach((node, id) => {
      const isFree = free.has(id);
      node.classList.toggle('is-blocked', !isFree);
      node.classList.toggle('is-selected', id === state.selected);
      node.classList.toggle('is-hint', !!state.hint && state.hint.indexOf(id) >= 0);
      node.tabIndex = isFree ? 0 : -1;
      node.setAttribute('aria-label', Faces.name(g.tiles[id].face) + (isFree ? '' : ', חסומה'));
      node.setAttribute('aria-pressed', id === state.selected ? 'true' : 'false');
    });
    renderStatus();
  }

  function renderStatus() {
    const g = state.game;
    const left = g.remaining();
    const pairs = g.availablePairs().length;
    el.statLeft.textContent = String(left);
    el.statPairs.textContent = String(pairs);
    el.statPairs.classList.toggle('is-low', left > 0 && pairs <= 1);
    el.statTime.textContent = state.prefs.timer ? fmt(g.elapsed) : '—';
    el.btnUndo.disabled = g.history.length === 0 || state.finished;
    el.btnHint.disabled = state.finished;
    el.btnShuffle.disabled = state.finished || left < 4;
    el.footerInfo.textContent = (72 - left / 2) + ' זוגות מתוך 72' +
      (g.hints ? ' · ' + g.hints + ' רמזים' : '') +
      (g.shuffles ? ' · ' + g.shuffles + ' ערבובים' : '');
  }

  /* --------------------------------------------------------------------- */
  /* שעון                                                                   */
  /* --------------------------------------------------------------------- */

  function startTimer() {
    if (state.timerId || state.finished) return;
    state.timerId = setInterval(() => {
      if (document.hidden || (window.Modal && window.Modal.top())) return;
      state.game.elapsed++;
      if (state.prefs.timer) el.statTime.textContent = fmt(state.game.elapsed);
      if (state.game.elapsed % 10 === 0) saveGame();
    }, 1000);
  }

  function stopTimer() {
    clearInterval(state.timerId);
    state.timerId = null;
  }

  /* --------------------------------------------------------------------- */
  /* מהלכים                                                                 */
  /* --------------------------------------------------------------------- */

  function clearHint() { state.hint = null; }

  function shake(node) {
    if (reducedMotion) return;
    node.classList.remove('is-shake');
    void node.offsetWidth;
    node.classList.add('is-shake');
    setTimeout(() => node.classList.remove('is-shake'), 320);
  }

  let blockedTips = 0;

  function tap(id) {
    const g = state.game;
    if (state.finished) return;
    const node = state.els.get(id);
    if (!node) return;
    startTimer();

    if (!g.isFree(id)) {
      feel('reject');
      shake(node);
      // מסבירים את החוק פעמיים, לא יותר — אחר כך זה רק מעצבן
      if (blockedTips < 2) { blockedTips++; toast('האבן חסומה — צריך צד פנוי ושום דבר מעליה'); }
      return;
    }

    if (state.selected === id) {
      state.selected = -1;
      feel('pick');
      refresh();
      return;
    }

    if (state.selected >= 0 && g.matches(state.selected, id)) {
      removePair(state.selected, id);
      return;
    }

    if (state.selected >= 0) feel('reject');
    else feel('pick');
    state.selected = id;
    say(Faces.name(g.tiles[id].face));
    refresh();
  }

  function removePair(a, b) {
    const g = state.game;
    if (!g.remove(a, b)) return;
    state.selected = -1;
    clearHint();
    feel('lock');

    if (!state.counted) {
      state.counted = true;
      const s = stats();
      s.played = (s.played || 0) + 1;
      store.write(STATS_KEY, s);
    }

    [a, b].forEach((id) => {
      const node = state.els.get(id);
      state.els.delete(id);
      if (!node) return;
      if (reducedMotion) { node.remove(); return; }
      node.classList.remove('is-selected', 'is-hint');
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 280);
    });

    refresh();
    saveGame();

    if (g.isWon()) {
      win();
    } else if (g.isStuck()) {
      say('אין עוד זוגות פנויים', true);
      setTimeout(() => { if (!state.finished && state.game === g && g.isStuck()) openModal(el.stuckModal); }, 450);
    }
  }

  function undo() {
    const g = state.game;
    if (state.finished) return;
    const last = g.undo();
    if (!last) return;
    state.selected = -1;
    clearHint();
    feel('move');
    render();
    last.forEach((id) => {
      const node = state.els.get(id);
      if (node && !reducedMotion) node.classList.add('is-back');
    });
    saveGame();
  }

  function hint() {
    const g = state.game;
    if (state.finished) return;
    startTimer();
    const h = g.hint();
    if (!h) { openModal(el.stuckModal); return; }
    state.hint = h;
    state.selected = -1;
    feel('pick');
    say('רמז: ' + Faces.name(g.tiles[h[0]].face));
    refresh();
    saveGame();
  }

  function shuffleTiles() {
    const g = state.game;
    if (state.finished || g.remaining() < 4) return;
    closeModal(el.stuckModal);
    g.shuffle();
    state.selected = -1;
    clearHint();
    feel('draw');
    render();
    if (!reducedMotion) state.els.forEach((n) => n.classList.add('is-back'));
    toast('האבנים עורבבו');
    saveGame();
  }

  /* --------------------------------------------------------------------- */
  /* ניצחון                                                                 */
  /* --------------------------------------------------------------------- */

  function win() {
    const g = state.game;
    state.finished = true;
    stopTimer();

    const s = stats();
    const isBest = !s.bestTime || g.elapsed < s.bestTime;
    s.wins = (s.wins || 0) + 1;
    s.totalTime = (s.totalTime || 0) + g.elapsed;
    if (isBest) s.bestTime = g.elapsed;
    store.write(STATS_KEY, s);
    saveGame();

    feel('win');
    say('הלוח נוקה! זמן ' + fmt(g.elapsed), true);

    el.winSub.textContent = isBest ? 'הזמן הטוב ביותר שלך!' : 'כל 144 האבנים פונו';
    el.winStats.innerHTML =
      '<div class="win-stat' + (isBest ? ' is-best' : '') + '"><span class="k">זמן</span><span class="v">' + fmt(g.elapsed) + '</span></div>' +
      '<div class="win-stat"><span class="k">שיא</span><span class="v">' + fmt(s.bestTime) + '</span></div>' +
      '<div class="win-stat"><span class="k">רמזים</span><span class="v">' + g.hints + '</span></div>' +
      '<div class="win-stat"><span class="k">ערבובים</span><span class="v">' + g.shuffles + '</span></div>';
    renderStatus();
    setTimeout(() => openModal(el.winModal), 420);
  }

  /* --------------------------------------------------------------------- */
  /* משחק חדש                                                               */
  /* --------------------------------------------------------------------- */

  function newGame() {
    stopTimer();
    state.game = new Mahjong();
    state.selected = -1;
    state.hint = null;
    state.counted = false;
    state.finished = false;
    closeModal(el.winModal);
    closeModal(el.stuckModal);
    render();
    saveGame();
  }

  /* --------------------------------------------------------------------- */
  /* קלט                                                                    */
  /* --------------------------------------------------------------------- */

  el.board.addEventListener('click', (e) => {
    const node = e.target.closest && e.target.closest('.mj-tile');
    if (!node || node.classList.contains('is-leaving')) return;
    tap(Number(node.dataset.id));
  });

  // לחיצה על הלבד (לא על אבן) מבטלת בחירה
  el.felt.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.mj-tile')) return;
    if (state.selected >= 0) { state.selected = -1; refresh(); }
  });

  el.btnUndo.addEventListener('click', undo);
  el.btnHint.addEventListener('click', hint);
  el.btnShuffle.addEventListener('click', () => {
    if (state.game.isStuck()) { shuffleTiles(); return; }
    askConfirm('לערבב את האבנים שנשארו? הביטול מתאפס אחרי ערבוב.', shuffleTiles);
  });
  el.btnStuckShuffle.addEventListener('click', shuffleTiles);
  el.btnStuckUndo.addEventListener('click', () => { closeModal(el.stuckModal); undo(); });

  document.addEventListener('keydown', (e) => {
    if (window.Modal && window.Modal.top()) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'h' || e.key === 'H') { e.preventDefault(); hint(); }
    else if (e.key === 'u' || e.key === 'U') { e.preventDefault(); undo(); }
    else if (e.key === 'Escape' && state.selected >= 0) { state.selected = -1; refresh(); }
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
    const rate = s.played ? Math.round(((s.wins || 0) / s.played) * 100) + '%' : '—';
    const avg = s.wins ? fmt((s.totalTime || 0) / s.wins) : '—';
    const rows = [
      ['משחקים', String(s.played || 0)],
      ['ניצחונות', String(s.wins || 0)],
      ['אחוז הצלחה', rate],
      ['הזמן הטוב ביותר', s.bestTime ? fmt(s.bestTime) : '—'],
      ['זמן ממוצע לניצחון', avg],
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
      toast('הנתונים אופסו');
    });
  });

  el.btnSettings.addEventListener('click', () => {
    el.settingsModal.querySelectorAll('[data-pref]').forEach((i) => {
      i.checked = !!state.prefs[i.dataset.pref];
    });
    const mode = H ? H.supported() : 'none';
    el.hapticsNote.textContent =
      mode === 'vibrate' ? 'משוב מישושי על בחירה, זוג וסיום'
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
    refresh();
  });

  el.btnNew.addEventListener('click', () => {
    const g = state.game;
    if (g && !state.finished && g.history.length > 3) {
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

  el.btnWinNew.addEventListener('click', newGame);

  document.querySelectorAll('[data-close-modal]').forEach((b) => {
    b.addEventListener('click', () => closeModal(b.closest('.modal')));
  });
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
  });

  let resizeTimer = null;
  let lastWidth = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // בטלפון שורת הכתובת משנה גובה בגלילה — רק שינוי רוחב מצריך ציור מחדש
      if (!state.game || el.felt.clientWidth === lastWidth) return;
      lastWidth = el.felt.clientWidth;
      measure();
      state.els.forEach((node, id) => place(state.game.tiles[id], node));
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
    if (saved && Array.isArray(saved.tiles) && saved.tiles.length === 144 && !saved.finished) {
      state.game = Mahjong.deserialize(saved);
      state.counted = !!saved.counted;
      render();
      if (state.game.isStuck()) setTimeout(() => openModal(el.stuckModal), 500);
    } else {
      newGame();
    }
    lastWidth = el.felt.clientWidth;

    if (!store.ok) setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
  }

  init();
})();
