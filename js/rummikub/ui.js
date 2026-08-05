/* =============================================================================
 * rummikub/ui.js — ממשק רמי קוב
 * -----------------------------------------------------------------------------
 * אינטראקציה בהקשה, כמו בסוליטר: מקישים על אבן ואז על היעד.
 *
 * מבנה התור: המנוע מקבל את מצב הסיום בלבד. במהלך התור הממשק עובד על
 * *עותק עבודה* של השולחן והמגש, וכל עוד לא נלחץ "סיים תור" אפשר לסדר
 * מחדש כרצוננו — כולל לשבור צירופים קיימים. רק בסיום המנוע מאמת הכול.
 * זה בדיוק מה שמאפשר manipulation בלי לכתוב חוקי ביניים.
 * =========================================================================== */
(function () {
  'use strict';

  const Rummikub = window.Rummikub;
  const T = window.RummikubTiles;
  const AI = window.RummikubAI;

  const $ = (s) => document.querySelector(s);

  const PREFS_KEY = 'rummikub.v1.prefs';
  const SAVE_KEY = 'rummikub.v1.save';
  const STATS_KEY = 'rummikub.v1.stats';

  const AI_DELAY = 750; // כדי שאפשר יהיה לעקוב אחרי מהלכי היריבים

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
    players: 2,
    markInvalid: true,
    autoSort: true,
  };

  /* --------------------------------------------------------------------- */
  /* מצב                                                                    */
  /* --------------------------------------------------------------------- */

  const state = {
    prefs: Object.assign({}, DEFAULT_PREFS, store.read(PREFS_KEY, {})),
    game: null,
    /** עותק עבודה של השולחן במהלך התור */
    workTable: [],
    /** עותק עבודה של המגש */
    workRack: [],
    /** אבנים שהועברו מהמגש לשולחן בתור הנוכחי */
    freshTiles: [],
    /** { from:'rack'|'table', setIndex, tileIndex, tile } */
    selection: null,
    aiRunning: false,
    confirmAction: null,
  };

  const el = {
    opponents: $('#opponents'),
    table: $('#table'),
    rack: $('#rack'),
    actions: $('#actions'),
    statPool: $('#statPool'),
    statRack: $('#statRack'),
    statPlaced: $('#statPlaced'),
    statMeld: $('#statMeld'),
    footerInfo: $('#footerInfo'),
    toast: $('#toast'),
    overModal: $('#overModal'),
    overTitle: $('#overTitle'),
    overSub: $('#overSub'),
    overStats: $('#overStats'),
    confetti: $('#confetti'),
    btnOverNew: $('#btnOverNew'),
    settingsModal: $('#settingsModal'),
    btnSettings: $('#btnSettings'),
    optPlayers: $('#optPlayers'),
    helpModal: $('#helpModal'),
    btnHelp: $('#btnHelp'),
    confirmModal: $('#confirmModal'),
    confirmText: $('#confirmText'),
    btnConfirmOk: $('#btnConfirmOk'),
    btnTheme: $('#btnTheme'),
    btnNew: $('#btnNew'),
  };

  /* --------------------------------------------------------------------- */
  /* עזרים                                                                  */
  /* --------------------------------------------------------------------- */

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2400);
  }

  const openModal = (n) => { n.hidden = false; };
  const closeModal = (n) => { n.hidden = true; };

  function confirmAction(text, onOk) {
    el.confirmText.textContent = text;
    state.confirmAction = onOk;
    openModal(el.confirmModal);
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

  const savePrefs = () => store.write(PREFS_KEY, state.prefs);
  const saveGame = () => { if (state.game) store.write(SAVE_KEY, state.game.serialize()); };

  /** האם השחקן האנושי (0) הוא בתור. */
  const myTurn = () => state.game && state.game.turn === 0 && !state.game.finished;

  /* --------------------------------------------------------------------- */
  /* רינדור                                                                 */
  /* --------------------------------------------------------------------- */

  function makeTileEl(tile, cls) {
    const d = document.createElement('div');
    const color = T.tileColor(tile);
    d.className = 'tile ' + (T.isJoker(tile) ? 'is-joker' : 'c-' + color) + (cls ? ' ' + cls : '');
    d.textContent = T.tileLabel(tile);
    d.dataset.tile = String(tile);
    d.setAttribute('aria-label',
      T.isJoker(tile) ? "ג'וקר" : T.tileNumber(tile) + ' ' + T.COLOR_LABEL[color]);
    return d;
  }

  function render() {
    renderOpponents();
    renderTable();
    renderRack();
    updateStatus();
  }

  function renderOpponents() {
    const g = state.game;
    el.opponents.textContent = '';
    for (let p = 1; p < g.playerCount; p++) {
      const d = document.createElement('div');
      d.className = 'opp' + (g.turn === p ? ' is-turn' : '');
      const name = document.createElement('span');
      name.className = 'opp-name';
      name.textContent = 'יריב ' + p;
      const right = document.createElement('span');
      right.className = 'opp-count';
      right.textContent = g.racks[p].length + ' אבנים';
      d.appendChild(name);
      if (g.melded[p]) {
        const badge = document.createElement('span');
        badge.className = 'opp-melded';
        badge.textContent = 'פתח';
        d.appendChild(badge);
      }
      d.appendChild(right);
      el.opponents.appendChild(d);
    }
  }

  function renderTable() {
    el.table.textContent = '';
    const mark = state.prefs.markInvalid;

    state.workTable.forEach((set, si) => {
      const box = document.createElement('div');
      box.className = 'set';
      if (mark && !T.isValidSet(set)) box.classList.add('is-invalid');
      box.dataset.set = String(si);

      set.forEach((tile, ti) => {
        const fresh = state.freshTiles.includes(tile);
        const t = makeTileEl(tile, fresh ? 'is-fresh' : '');
        t.dataset.set = String(si);
        t.dataset.index = String(ti);
        if (isSelected('table', si, ti)) t.classList.add('is-selected');
        box.appendChild(t);
      });
      el.table.appendChild(box);
    });

    // מקום לצירוף חדש — מוצג רק כשיש אבן נבחרת שאפשר להניח
    if (state.selection) {
      const slot = document.createElement('div');
      slot.className = 'set-new';
      slot.dataset.newSet = '1';
      slot.textContent = 'צירוף חדש';
      el.table.appendChild(slot);
    }
  }

  function renderRack() {
    el.rack.textContent = '';
    state.workRack.forEach((tile, i) => {
      const t = makeTileEl(tile);
      t.dataset.rack = String(i);
      if (isSelected('rack', -1, i)) t.classList.add('is-selected');
      el.rack.appendChild(t);
    });
  }

  function updateStatus() {
    const g = state.game;
    el.statPool.textContent = String(g.poolCount());
    el.statRack.textContent = String(state.workRack.length);
    el.statPlaced.textContent = String(state.freshTiles.length);

    if (g.melded[0]) {
      el.statMeld.textContent = '✓';
      el.statMeld.classList.remove('is-warn');
    } else {
      // כמה שווה מה שהנחתי עד כה — רק צירופים חדשים לגמרי נספרים
      const value = newSetsValue();
      el.statMeld.textContent = value + '/30';
      el.statMeld.classList.toggle('is-warn', value > 0 && value < Rummikub.INITIAL_MELD);
    }

    const commit = el.actions.querySelector('[data-action="commit"]');
    const undo = el.actions.querySelector('[data-action="undo"]');
    const draw = el.actions.querySelector('[data-action="draw"]');
    const busy = !myTurn() || state.aiRunning;
    commit.disabled = busy || !state.freshTiles.length;
    undo.disabled = busy || !state.freshTiles.length;
    draw.disabled = busy;

    el.footerInfo.textContent = state.aiRunning
      ? 'תור היריב…'
      : myTurn() ? 'התור שלך' : 'ממתין';
  }

  /** ערך הצירופים שנוצרו בתור הזה מאבני המגש בלבד. */
  function newSetsValue() {
    const original = state.game.table;
    let value = 0;
    for (const set of state.workTable) {
      if (original.some((s) => T.sameMultiset(s, set))) continue;
      value += T.setValue(set);
    }
    return value;
  }

  /* --------------------------------------------------------------------- */
  /* בחירה והזזה                                                            */
  /* --------------------------------------------------------------------- */

  function isSelected(from, setIndex, tileIndex) {
    const s = state.selection;
    return !!s && s.from === from && s.setIndex === setIndex && s.tileIndex === tileIndex;
  }

  const clearSelection = () => { state.selection = null; };

  /**
   * מסיר את האבן הנבחרת ממקומה.
   * @returns {{tile:number, removedSet:number}|null} removedSet הוא אינדקס
   *   הצירוף שהתרוקן ונמחק, או -1. הקורא חייב לתקן אינדקסים בהתאם.
   */
  function takeSelected() {
    const s = state.selection;
    if (!s) return null;
    if (s.from === 'rack') {
      return { tile: state.workRack.splice(s.tileIndex, 1)[0], removedSet: -1 };
    }

    const set = state.workTable[s.setIndex];
    const tile = set.splice(s.tileIndex, 1)[0];
    let removedSet = -1;
    if (!set.length) {
      state.workTable.splice(s.setIndex, 1);
      removedSet = s.setIndex;
    }
    return { tile, removedSet };
  }

  /** האם מותר להחזיר את האבן הזו למגש — רק אם היא הונחה בתור הנוכחי. */
  const canReturn = (tile) => state.freshTiles.includes(tile);

  el.table.addEventListener('click', (e) => {
    if (!myTurn() || state.aiRunning) return;

    const tileEl = e.target.closest('.tile');
    const setEl = e.target.closest('.set');
    const newSlot = e.target.closest('.set-new');

    /* --- הנחה בצירוף חדש --- */
    if (newSlot && state.selection) {
      const fromRack = state.selection.from === 'rack';
      const taken = takeSelected();
      if (taken) {
        if (fromRack) state.freshTiles.push(taken.tile);
        state.workTable.push([taken.tile]);
        clearSelection();
        render();
        saveDraft();
      }
      return;
    }

    /* --- הקשה על אבן --- */
    if (tileEl) {
      const si = Number(tileEl.dataset.set);
      const ti = Number(tileEl.dataset.index);
      const tile = Number(tileEl.dataset.tile);

      // ביטול בחירה
      if (isSelected('table', si, ti)) { clearSelection(); render(); return; }

      // יש בחירה ואנחנו מקישים על צירוף אחר => מוסיפים אליו
      if (state.selection && state.selection.setIndex !== si) {
        placeIntoSet(si);
        return;
      }

      state.selection = { from: 'table', setIndex: si, tileIndex: ti, tile };
      render();
      return;
    }

    /* --- הקשה על צירוף (לא על אבן) => הנחה בסופו --- */
    if (setEl && state.selection) {
      placeIntoSet(Number(setEl.dataset.set));
      return;
    }

    if (state.selection) { clearSelection(); render(); }
  });

  function placeIntoSet(targetIndex) {
    const s = state.selection;
    if (!s) return;
    const fromRack = s.from === 'rack';

    const taken = takeSelected();
    if (!taken) return;

    /*
     * אם צירוף המקור התרוקן הוא נמחק מהמערך, וכל מה שאחריו הוזז מקום
     * אחד אחורה. יעד שהיה *אחרי* הצירוף שנמחק צריך לרדת באחד.
     */
    let idx = targetIndex;
    if (taken.removedSet >= 0 && taken.removedSet < targetIndex) idx--;

    const set = state.workTable[idx];
    if (set) set.push(taken.tile);
    else state.workTable.push([taken.tile]); // היעד עצמו נעלם — פותחים חדש

    if (fromRack) state.freshTiles.push(taken.tile);
    clearSelection();
    render();
    saveDraft();
  }

  el.rack.addEventListener('click', (e) => {
    if (!myTurn() || state.aiRunning) return;

    const tileEl = e.target.closest('.tile');

    /* --- החזרת אבן מהשולחן למגש --- */
    if (state.selection && state.selection.from === 'table') {
      const tile = state.selection.tile;
      if (!canReturn(tile)) {
        toast('אפשר להחזיר רק אבנים שהנחת בתור הזה');
        clearSelection();
        render();
        return;
      }
      takeSelected();
      state.workRack.push(tile);
      state.freshTiles.splice(state.freshTiles.indexOf(tile), 1);
      clearSelection();
      render();
      saveDraft();
      return;
    }

    if (tileEl) {
      const i = Number(tileEl.dataset.rack);
      if (isSelected('rack', -1, i)) { clearSelection(); render(); return; }
      state.selection = { from: 'rack', setIndex: -1, tileIndex: i, tile: Number(tileEl.dataset.tile) };
      render();
      return;
    }

    if (state.selection) { clearSelection(); render(); }
  });

  /* --------------------------------------------------------------------- */
  /* מיון המגש                                                              */
  /* --------------------------------------------------------------------- */

  function sortRack(by) {
    const key = (t) => {
      if (T.isJoker(t)) return [99, 99];
      return by === 'color'
        ? [T.tileColorIndex(t), T.tileNumber(t)]
        : [T.tileNumber(t), T.tileColorIndex(t)];
    };
    state.workRack.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
    clearSelection();
    render();
  }

  document.querySelector('.rack-sorts').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sort]');
    if (btn) sortRack(btn.dataset.sort);
  });

  /* --------------------------------------------------------------------- */
  /* תורות                                                                  */
  /* --------------------------------------------------------------------- */

  /** מתחיל תור אנושי: עותק עבודה נקי. */
  function beginTurn() {
    state.workTable = state.game.snapshotTable();
    state.workRack = state.game.currentRack.slice();
    state.freshTiles = [];
    clearSelection();
    render();
  }

  function resetTurn() {
    beginTurn();
    saveDraft();
  }

  function commitTurn() {
    const g = state.game;
    const res = g.commitTurn(state.workTable, state.workRack);

    if (!res.ok) {
      toast(commitError(res));
      // מסמנים את הצירוף הבעייתי
      if (res.reason === 'invalid-set' && res.badIndex >= 0) {
        const box = el.table.children[res.badIndex];
        if (box) box.classList.add('is-invalid');
      }
      return;
    }

    state.freshTiles = [];
    clearSelection();
    saveGame();
    render();

    if (res.won) return endGame();
    runOpponents();
  }

  function commitError(res) {
    switch (res.reason) {
      case 'nothing-placed': return 'לא הנחת שום אבן. משוך אבן או הנח משהו';
      case 'invalid-set': return 'יש צירוף שאינו חוקי על השולחן';
      case 'meld-too-low':
        return 'הפתיחה חייבת להיות 30 לפחות — יש לך ' + (res.meldValue || 0);
      case 'meld-touches-table':
        return 'בפתיחה אסור להיעזר באבנים שכבר על השולחן';
      case 'tiles-mismatch': return 'משהו השתבש בספירת האבנים';
      default: return 'לא ניתן לסיים את התור';
    }
  }

  function drawAndPass() {
    const g = state.game;
    if (state.freshTiles.length) {
      confirmAction('משיכה תחזיר את כל מה שהנחת בתור הזה. להמשיך?', () => {
        resetTurn();
        doDraw();
      });
      return;
    }
    doDraw();

    function doDraw() {
      const d = g.drawTile();
      if (d.stalemate) { saveGame(); return endGame(); }
      if (d.empty) toast('הבריכה ריקה — התור עובר');
      if (state.prefs.autoSort) {
        g.racks[0].sort((a, b) => {
          const na = T.isJoker(a) ? 99 : T.tileNumber(a);
          const nb = T.isJoker(b) ? 99 : T.tileNumber(b);
          return na - nb || T.tileColorIndex(a) - T.tileColorIndex(b);
        });
      }
      saveGame();
      render();
      runOpponents();
    }
  }

  /** מריץ את תורות היריבים אחד אחרי השני, עם השהיה. */
  function runOpponents() {
    const g = state.game;
    if (g.finished) return endGame();
    if (g.turn === 0) { beginTurn(); return; }

    state.aiRunning = true;
    updateStatus();
    renderOpponents();

    setTimeout(() => {
      if (!state.game || state.game !== g) return;
      const who = g.turn;
      const result = AI.playTurn(g);

      state.workTable = g.snapshotTable();
      render();
      saveGame();

      if (result.action === 'meld') {
        toast('יריב ' + who + ' הניח ' + result.placed.length + ' אבנים');
      }

      if (g.finished) { state.aiRunning = false; return endGame(); }
      if (g.turn === 0) {
        state.aiRunning = false;
        beginTurn();
        toast('התור שלך');
      } else {
        runOpponents();
      }
    }, AI_DELAY);
  }

  /* --------------------------------------------------------------------- */
  /* סוף משחק                                                               */
  /* --------------------------------------------------------------------- */

  function endGame() {
    const g = state.game;
    state.aiRunning = false;
    const scores = g.finalScores();
    const iWon = g.winner === 0;

    const stats = store.read(STATS_KEY, { played: 0, won: 0, best: 0 });
    stats.played += 1;
    if (iWon) stats.won += 1;
    if (scores[0] > (stats.best || 0)) stats.best = scores[0];
    store.write(STATS_KEY, stats);

    el.overTitle.textContent = iWon ? 'ניצחת!' : 'המשחק נגמר';
    el.overSub.textContent = iWon
      ? 'רוקנת את המגש'
      : 'יריב ' + g.winner + ' סיים ראשון';

    el.overStats.innerHTML = scores.map((sc, i) => `
      <div class="win-stat${i === g.winner ? ' is-best' : ''}">
        <span class="k">${i === 0 ? 'אתה' : 'יריב ' + i}${i === g.winner ? ' 🏆' : ''}</span>
        <span class="v">${sc}</span>
      </div>`).join('');

    render();
    setTimeout(() => openModal(el.overModal), 600);
  }

  function spawnConfetti() {
    const colors = ['#4f6ef7', '#23996b', '#e9a94e', '#e14b52', '#7f9bff'];
    let html = '';
    for (let i = 0; i < 14; i++) {
      html += `<i style="left:${Math.random() * 100}%;background:${
        colors[(Math.random() * colors.length) | 0]};animation-delay:${Math.random() * 400}ms"></i>`;
    }
    el.confetti.innerHTML = html;
  }

  /* --------------------------------------------------------------------- */
  /* רמז                                                                    */
  /* --------------------------------------------------------------------- */

  function showHint() {
    const g = state.game;
    const rack = state.workRack;

    const packing = g.melded[0]
      ? AI.bestPacking(rack)
      : AI.bestPacking(rack, { minValue: Rummikub.INITIAL_MELD });

    if (!packing.sets.length) {
      const ext = AI.extendTable(state.workTable, rack);
      if (ext.placed.length && g.melded[0]) {
        toast('אפשר להוסיף ' + ext.placed.length + ' אבנים לצירופים שעל השולחן');
        return;
      }
      toast(g.melded[0] ? 'אין מהלך — כדאי למשוך' : 'אין עדיין 30 נקודות לפתיחה');
      return;
    }

    // מסמנים את האבנים של הצירוף הראשון שנמצא
    const first = packing.sets[0].map((i) => rack[i]);
    [...el.rack.children].forEach((node) => {
      if (first.includes(Number(node.dataset.tile))) node.classList.add('is-selected');
    });
    toast(g.melded[0]
      ? 'אפשר להניח את הצירוף המסומן'
      : 'פתיחה אפשרית בשווי ' + packing.value);
  }

  /* --------------------------------------------------------------------- */
  /* פעולות                                                                 */
  /* --------------------------------------------------------------------- */

  el.actions.addEventListener('click', (e) => {
    const btn = e.target.closest('.tool');
    if (!btn || !state.game) return;
    switch (btn.dataset.action) {
      case 'undo': resetTurn(); toast('התור אופס'); break;
      case 'hint': showHint(); break;
      case 'draw': drawAndPass(); break;
      case 'commit': commitTurn(); break;
    }
  });

  /* --------------------------------------------------------------------- */
  /* משחק חדש / טעינה                                                       */
  /* --------------------------------------------------------------------- */

  function newGame() {
    closeModal(el.overModal);
    state.game = new Rummikub({ players: Number(state.prefs.players) || 2 });
    state.aiRunning = false;
    store.remove(SAVE_KEY + '.draft');
    beginTurn();
    saveGame();
    toast('משחק חדש');
  }

  /** טיוטת התור נשמרת בנפרד, כדי שרענון באמצע תור לא יאבד סידור. */
  function saveDraft() {
    store.write(SAVE_KEY + '.draft', {
      table: state.workTable,
      rack: state.workRack,
      fresh: state.freshTiles,
      turn: state.game.turn,
      moves: state.game.moves,
    });
  }

  function loadDraft() {
    const d = store.read(SAVE_KEY + '.draft', null);
    if (!d || d.turn !== 0 || d.moves !== state.game.moves) return false;
    // כל האבנים חייבות להסתדר עם המצב השמור, אחרת מתעלמים מהטיוטה
    const expect = [].concat(...state.game.table, state.game.racks[0]);
    const got = [].concat(...d.table, d.rack);
    if (!T.sameMultiset(expect, got)) return false;
    state.workTable = d.table.map((s) => s.slice());
    state.workRack = d.rack.slice();
    state.freshTiles = d.fresh.slice();
    return true;
  }

  /* --------------------------------------------------------------------- */
  /* מודלים והגדרות                                                         */
  /* --------------------------------------------------------------------- */

  el.btnTheme.addEventListener('click', () => {
    const order = { auto: 'light', light: 'dark', dark: 'auto' };
    state.prefs.theme = order[state.prefs.theme] || 'light';
    savePrefs();
    applyTheme();
  });

  el.btnHelp.addEventListener('click', () => openModal(el.helpModal));

  el.btnSettings.addEventListener('click', () => {
    el.settingsModal.querySelectorAll('[data-pref]').forEach((i) => {
      i.checked = !!state.prefs[i.dataset.pref];
    });
    el.optPlayers.value = String(state.prefs.players);
    openModal(el.settingsModal);
  });

  el.settingsModal.addEventListener('change', (e) => {
    const input = e.target.closest('[data-pref]');
    if (input) {
      state.prefs[input.dataset.pref] = input.checked;
      savePrefs();
      render();
      return;
    }
    if (e.target === el.optPlayers) {
      state.prefs.players = Number(el.optPlayers.value);
      savePrefs();
      closeModal(el.settingsModal);
      newGame();
    }
  });

  el.btnNew.addEventListener('click', () => {
    if (state.game && !state.game.finished && state.game.moves > 2) {
      confirmAction('להתחיל משחק חדש? ההתקדמות תימחק.', newGame);
    } else {
      newGame();
    }
  });
  el.btnOverNew.addEventListener('click', newGame);

  el.btnConfirmOk.addEventListener('click', () => {
    const fn = state.confirmAction;
    state.confirmAction = null;
    closeModal(el.confirmModal);
    if (fn) fn();
  });

  document.querySelectorAll('[data-close-modal]').forEach((b) => {
    b.addEventListener('click', () => closeModal(b.closest('.modal')));
  });
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
  });

  window.addEventListener('pagehide', () => { saveGame(); saveDraft(); });
  window.addEventListener('beforeunload', () => { saveGame(); saveDraft(); });

  /* --------------------------------------------------------------------- */
  /* אתחול                                                                  */
  /* --------------------------------------------------------------------- */

  function init() {
    applyTheme();
    spawnConfetti();

    const saved = store.read(SAVE_KEY, null);
    const g = saved ? Rummikub.deserialize(saved) : null;

    if (g && !g.finished) {
      state.game = g;
      state.prefs.players = g.playerCount;
      if (!loadDraft()) beginTurn();
      render();
      if (g.turn !== 0) runOpponents();
    } else {
      newGame();
    }

    if (!store.ok) setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
  }

  init();
})();
