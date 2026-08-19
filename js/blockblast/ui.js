/* =============================================================================
 * blockblast/ui.js — ממשק בלוק בלאסט
 * -----------------------------------------------------------------------------
 * גרירה, ציור, שמירה.
 *
 * ההחלטה המרכזית כאן היא איך גוררים בטלפון. חלק שנצמד לאצבע מוסתר על
 * ידה בדיוק כשצריך למקם אותו, ולכן:
 *
 *   1. החלק מוצג **מעל** נקודת המגע, בגובה שנגזר מגודל התא
 *   2. המיקום נקבע לפי הפינה השמאלית-עליונה של החלק ולא לפי האצבע
 *   3. הלוח מסמן מראש בדיוק לאילו תאים הוא ייפול
 *
 * בלי שלושת אלה משחקים בעיוורון.
 * =========================================================================== */
(function () {
  'use strict';

  const C = window.BlockBlastCore;
  const BlockBlast = window.BlockBlast;
  const H = window.Haptics;

  const $ = (s) => document.querySelector(s);

  const PREFS_KEY = 'blockblast.v1.prefs';
  const SAVE_KEY = 'blockblast.v1.save';
  const STATS_KEY = 'blockblast.v1.stats';

  /*
   * המרווח בין תחתית החלק לאצבע, ביחידות של תא.
   *
   * הרמה בגובה *קבוע* לא מספיקה: חלק בן ארבעה תאים הוא כ-200 פיקסלים,
   * והרמה של תא אחד עדיין משאירה את חציו התחתון מתחת לאצבע. מדדתי —
   * התחתית יצאה 40 פיקסלים *מתחת* לנקודת המגע. לכן מה שקבוע הוא המרווח
   * מהתחתית, וההרמה נגזרת מגובה החלק עצמו
   */
  const CLEARANCE_CELLS = 0.55;
  /* תזוזה מינימלית שנחשבת גרירה ולא הקשה */
  const DRAG_THRESHOLD = 5;

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
    guaranteed: true,
    ghost: true,
    haptics: true,
  };

  const state = {
    prefs: Object.assign({}, DEFAULT_PREFS, store.read(PREFS_KEY, {})),
    game: null,
    /** צבע קבוע לכל תא שהונח, כדי שהלוח לא ייראה כמו גוש אחד */
    cellColor: new Array(C.CELLS).fill(null),
  };

  const el = {
    board: $('#board'),
    tray: $('#tray'),
    trayHint: $('#trayHint'),
    statScore: $('#statScore'),
    statBest: $('#statBest'),
    statLines: $('#statLines'),
    combo: $('#combo'),
    comboX: $('#comboX'),
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
    optGuaranteed: $('#optGuaranteed'),
    hapticsNote: $('#hapticsNote'),
    helpModal: $('#helpModal'),
    btnHelp: $('#btnHelp'),
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
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2200);
  }

  const openModal = (n) => { n.hidden = false; };
  const closeModal = (n) => { n.hidden = true; };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function feel(name) { if (state.prefs.haptics && H) H.fire(name); }

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
  const saveGame = () => {
    if (!state.game) return;
    const data = state.game.serialize();
    data.cellColor = state.cellColor;
    store.write(SAVE_KEY, data);
  };

  /** הצבע של חלק נגזר מגודלו — כך העין לומדת "גדול = מסוכן". */
  const pieceColor = (piece) => 'var(--bb-p' + Math.min(piece.size, 5) + ')';

  /* --------------------------------------------------------------------- */
  /* ציור                                                                   */
  /* --------------------------------------------------------------------- */

  function buildBoard() {
    el.board.textContent = '';
    for (let r = 0; r < C.SIZE; r++) {
      for (let c = 0; c < C.SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        el.board.appendChild(cell);
      }
    }
  }

  const cellAt = (r, c) => el.board.children[r * C.SIZE + c];

  function renderBoard() {
    const g = state.game;
    for (let r = 0; r < C.SIZE; r++) {
      for (let c = 0; c < C.SIZE; c++) {
        const node = cellAt(r, c);
        const on = C.getCell(g.board, r, c) === 1;
        node.classList.toggle('is-on', on);
        node.classList.remove('is-ghost', 'is-bad');
        const color = state.cellColor[r * C.SIZE + c];
        if (on && color) node.style.setProperty('--fill', color);
        else if (!on) node.style.removeProperty('--fill');
      }
    }
  }

  /** מצייר חלק כרשת קטנה. cellPx קובע את גודל התא. */
  function drawPiece(piece, cellPx, cls) {
    const box = document.createElement('div');
    box.className = cls || 'piece';
    box.style.gridTemplateColumns = 'repeat(' + piece.cols + ', ' + cellPx + 'px)';
    box.style.setProperty('--pc', cellPx + 'px');
    box.style.setProperty('--fill', pieceColor(piece));

    const filled = new Set(piece.cells.map(([r, c]) => r + ',' + c));
    for (let r = 0; r < piece.rows; r++) {
      for (let c = 0; c < piece.cols; c++) {
        const i = document.createElement('i');
        i.className = filled.has(r + ',' + c) ? 'on' : 'off';
        i.style.width = cellPx + 'px';
        i.style.height = cellPx + 'px';
        box.appendChild(i);
      }
    }
    return box;
  }

  /** גודל תא במגש — מתכווץ כדי שהחלק הרחב ביותר עדיין ייכנס. */
  function trayCellSize(piece) {
    const slotWidth = (el.tray.clientWidth - 16) / 3 - 16;
    const byWidth = slotWidth / Math.max(piece.cols, 1);
    const byHeight = 62 / Math.max(piece.rows, 1);
    return Math.max(8, Math.min(17, Math.floor(Math.min(byWidth, byHeight))));
  }

  function renderTray() {
    const g = state.game;
    el.tray.textContent = '';

    for (let i = 0; i < 3; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.index = String(i);

      const piece = g.tray[i];
      if (!piece) {
        slot.classList.add('is-empty');
      } else {
        if (!g.canPlace(piece)) slot.classList.add('is-stuck');
        slot.appendChild(drawPiece(piece, trayCellSize(piece)));
      }
      el.tray.appendChild(slot);
    }

    const stuck = g.tray.filter((p) => !g.canPlace(p)).length;
    el.trayHint.textContent = g.finished
      ? 'אין יותר מהלכים'
      : stuck
        ? (stuck === g.tray.length ? 'אף חלק לא נכנס' : 'חלק אחד כבר לא נכנס')
        : 'גררו חלק אל הלוח';
  }

  function renderStatus() {
    const g = state.game;
    el.statScore.textContent = String(g.score);
    el.statBest.textContent = String(bestScore());
    el.statLines.textContent = String(g.linesCleared);

    if (g.combo >= 2) {
      el.combo.hidden = false;
      el.comboX.textContent = '×' + g.combo;
    } else {
      el.combo.hidden = true;
    }

    el.footerInfo.textContent = g.finished
      ? 'המשחק נגמר'
      : state.prefs.guaranteed ? 'תמיד יש מהלך' : 'ללא הבטחה';
  }

  function render() {
    renderBoard();
    renderTray();
    renderStatus();
  }

  const stats = () => store.read(STATS_KEY, { played: 0, best: 0, bestLines: 0 });
  const bestScore = () => Math.max(stats().best || 0, state.game ? state.game.score : 0);

  /* --------------------------------------------------------------------- */
  /* גרירה                                                                  */
  /* --------------------------------------------------------------------- */

  let drag = null;

  /** גודל תא על הלוח, כולל המרווח בין תאים. */
  function boardMetrics() {
    const rect = el.board.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(el.board).gap) || 0;
    const pad = parseFloat(getComputedStyle(el.board).paddingLeft) || 0;
    const cell = (rect.width - pad * 2 - gap * (C.SIZE - 1)) / C.SIZE;
    return { rect, gap, pad, cell, step: cell + gap };
  }

  el.tray.addEventListener('pointerdown', (e) => {
    if (!state.game || state.game.finished) return;
    const slot = e.target.closest && e.target.closest('.slot');
    if (!slot) return;

    const index = Number(slot.dataset.index);
    const piece = state.game.tray[index];
    if (!piece) return;

    drag = {
      index,
      piece,
      slot,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      ghost: null,
      target: null,
      pointerId: e.pointerId,
    };

    /*
     * המאזינים יושבים על החלון ולא על המגש. הגרירה כולה מתרחשת *מעל
     * הלוח*, ולכן ברגע שהאצבע עוזבת את המגש הוא כבר אינו היעד של
     * האירועים — ובלי לכידת מצביע שעובדת, הגרירה פשוט מתה באוויר.
     * מאזין על החלון נכון בכל מקרה, ואינו תלוי בלכידה
     */
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  });

  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;

    if (!drag.moved) {
      const dx = Math.abs(e.clientX - drag.startX);
      const dy = Math.abs(e.clientY - drag.startY);
      if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
      beginDrag();
    }
    moveDrag(e.clientX, e.clientY);
    // מונע גלילה של הדף באמצע מהלך
    if (e.cancelable) e.preventDefault();
  }

  function beginDrag() {
    drag.moved = true;
    drag.slot.classList.add('is-dragging');
    feel('pick');

    const m = boardMetrics();
    drag.cell = m.cell;
    drag.ghost = drawPiece(drag.piece, m.cell, 'drag-piece');
    drag.ghost.style.gridTemplateColumns =
      'repeat(' + drag.piece.cols + ', ' + m.cell + 'px)';
    document.body.appendChild(drag.ghost);
  }

  function moveDrag(x, y) {
    if (!drag.ghost) return;

    const m = boardMetrics();

    const w = drag.piece.cols * m.step - m.gap;
    const h = drag.piece.rows * m.step - m.gap;

    /*
     * תחתית החלק יושבת תמיד CLEARANCE_CELLS מעל האצבע, יהיה גובהו אשר
     * יהיה. הטרנספורם ב-CSS ממרכז את האלמנט, ולכן מה שנקבע כאן הוא
     * המרכז — והמרכז הוא התחתית פחות חצי גובה
     */
    const clearance = m.step * CLEARANCE_CELLS;
    const centerY = y - clearance - h / 2;

    drag.ghost.style.left = x + 'px';
    drag.ghost.style.top = centerY + 'px';

    /*
     * היעד נקבע לפי הפינה השמאלית-עליונה של החלק ולא לפי האצבע —
     * זה מה שגורם לחלק "לשבת" איפה שרואים אותו
     */
    const left = x - w / 2;
    const top = centerY - h / 2;

    const col = Math.round((left - m.rect.left - m.pad) / m.step);
    const row = Math.round((top - m.rect.top - m.pad) / m.step);

    const inRange =
      row >= 0 && col >= 0 &&
      row + drag.piece.rows <= C.SIZE && col + drag.piece.cols <= C.SIZE;

    const spot = inRange
      ? drag.piece.placements.find((p) => p.row === row && p.col === col)
      : null;
    const legal = spot ? C.fits(state.game.board, spot.mask) : false;

    drag.target = legal ? { row, col } : null;
    paintGhost(inRange ? { row, col } : null, legal);
  }

  /** מסמן על הלוח לאן החלק ייפול. */
  function paintGhost(at, legal) {
    for (const node of el.board.children) node.classList.remove('is-ghost', 'is-bad');
    if (!at || !state.prefs.ghost) return;

    for (const [dr, dc] of drag.piece.cells) {
      const r = at.row + dr;
      const c = at.col + dc;
      if (r < 0 || c < 0 || r >= C.SIZE || c >= C.SIZE) continue;
      const node = cellAt(r, c);
      if (legal) node.classList.add('is-ghost');
      else if (!node.classList.contains('is-on')) node.classList.add('is-bad');
    }
  }

  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    const d = drag;
    drag = null;

    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);

    if (d.ghost) d.ghost.remove();
    d.slot.classList.remove('is-dragging');
    for (const node of el.board.children) node.classList.remove('is-ghost', 'is-bad');

    if (!d.moved) {
      // הקשה בלי גרירה — מזכירים איך משחקים במקום לא לעשות כלום
      toast('גררו את החלק אל הלוח');
      return;
    }
    if (!d.target) {
      feel('reject');
      return;
    }
    commitMove(d.index, d.piece, d.target.row, d.target.col);
  }

  /* --------------------------------------------------------------------- */
  /* מהלך                                                                   */
  /* --------------------------------------------------------------------- */

  function commitMove(index, piece, row, col) {
    const g = state.game;

    // צובעים את התאים לפני המהלך, כדי שהצבע יישאר על מה שהונח
    const color = pieceColor(piece);
    for (const [dr, dc] of piece.cells) {
      state.cellColor[(row + dr) * C.SIZE + (col + dc)] = color;
    }

    const res = g.playPiece(index, row, col);
    if (!res.ok) {
      feel('reject');
      return;
    }

    /*
     * הניקוי מצויר לפני שהלוח מתעדכן: מסמנים את התאים שנמחקים, נותנים
     * להבזק לרוץ, ורק אז מציירים מחדש. אחרת השורה פשוט נעלמת ואי אפשר
     * לראות מה קרה
     */
    if (res.cleared > 0) {
      flashCleared(res.rows, res.cols);
      feel(res.cleared >= 3 ? 'win' : 'lock');
      bumpCombo();
    } else {
      feel('move');
    }

    showGain(res.gained, row, col);

    const delay = res.cleared > 0 && !reducedMotion ? 260 : 0;
    setTimeout(() => {
      // תאים שנמחקו מאבדים את צבעם
      for (const r of res.rows) {
        for (let c = 0; c < C.SIZE; c++) state.cellColor[r * C.SIZE + c] = null;
      }
      for (const c of res.cols) {
        for (let r = 0; r < C.SIZE; r++) state.cellColor[r * C.SIZE + c] = null;
      }
      render();
      saveGame();
      if (res.finished) endGame();
    }, delay);

    if (res.boardCleared) toast('ניקית את כל הלוח! ‎+360');
  }

  function flashCleared(rows, cols) {
    const mark = (node) => {
      node.classList.add('is-clearing');
      setTimeout(() => node.classList.remove('is-clearing'), 300);
    };
    for (const r of rows) for (let c = 0; c < C.SIZE; c++) mark(cellAt(r, c));
    for (const c of cols) for (let r = 0; r < C.SIZE; r++) mark(cellAt(r, c));
  }

  function bumpCombo() {
    if (state.game.combo < 2) return;
    el.combo.hidden = false;
    el.comboX.textContent = '×' + state.game.combo;
    el.combo.classList.remove('is-bump');
    void el.combo.offsetWidth; // מאלץ הפעלה מחדש של האנימציה
    el.combo.classList.add('is-bump');
  }

  /** המספר עף מהמקום שבו הוא הורווח. */
  function showGain(amount, row, col) {
    if (reducedMotion || !amount) return;
    const node = cellAt(Math.min(row, C.SIZE - 1), Math.min(col, C.SIZE - 1));
    const rect = node.getBoundingClientRect();
    const tag = document.createElement('div');
    tag.className = 'gain';
    tag.textContent = '+' + amount;
    tag.style.left = (rect.left + rect.width / 2) + 'px';
    tag.style.top = rect.top + 'px';
    document.body.appendChild(tag);
    setTimeout(() => tag.remove(), 850);
  }

  /* --------------------------------------------------------------------- */
  /* סוף משחק                                                               */
  /* --------------------------------------------------------------------- */

  function endGame() {
    const g = state.game;
    const s = stats();
    s.played = (s.played || 0) + 1;
    const isBest = g.score > (s.best || 0);
    if (isBest) s.best = g.score;
    if (g.linesCleared > (s.bestLines || 0)) s.bestLines = g.linesCleared;
    store.write(STATS_KEY, s);

    feel('reject');

    el.overTitle.textContent = isBest ? 'שיא חדש!' : 'נגמרו המהלכים';
    el.overSub.textContent = isBest
      ? 'זה הניקוד הגבוה ביותר שלך'
      : 'אף אחד מהחלקים שנשארו לא נכנס';

    el.overStats.innerHTML = `
      <div class="win-stat${isBest ? ' is-best' : ''}">
        <span class="k">ניקוד</span><span class="v">${g.score}</span></div>
      <div class="win-stat"><span class="k">שיא</span><span class="v">${s.best}</span></div>
      <div class="win-stat"><span class="k">שורות</span><span class="v">${g.linesCleared}</span></div>
      <div class="win-stat"><span class="k">מהלכים</span><span class="v">${g.moves}</span></div>`;

    renderStatus();
    setTimeout(() => openModal(el.overModal), 420);
  }

  /* --------------------------------------------------------------------- */
  /* משחק חדש                                                               */
  /* --------------------------------------------------------------------- */

  function newGame() {
    state.game = new BlockBlast({ guaranteed: !!state.prefs.guaranteed });
    state.cellColor = new Array(C.CELLS).fill(null);
    closeModal(el.overModal);
    render();
    saveGame();
  }

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

  el.btnSettings.addEventListener('click', () => {
    el.settingsModal.querySelectorAll('[data-pref]').forEach((i) => {
      i.checked = !!state.prefs[i.dataset.pref];
    });

    const mode = H ? H.supported() : 'none';
    el.hapticsNote.textContent =
      mode === 'vibrate' ? 'משוב מישושי על הנחה, ניקוי וסיום'
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
    if (input.dataset.pref === 'guaranteed') {
      closeModal(el.settingsModal);
      newGame();
      toast(input.checked ? 'תמיד יהיה מהלך' : 'ללא הבטחה — כמו במקור');
      return;
    }
    render();
  });

  el.btnNew.addEventListener('click', () => {
    if (state.game && !state.game.finished && state.game.moves > 3) {
      if (!window.confirm('להתחיל משחק חדש? ההתקדמות תימחק.')) return;
    }
    newGame();
  });
  el.btnOverNew.addEventListener('click', newGame);

  document.querySelectorAll('[data-close-modal]').forEach((b) => {
    b.addEventListener('click', () => closeModal(b.closest('.modal')));
  });
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
  });

  /* המגש מתכווץ עם המסך, ולכן גודל החלקים מחושב מחדש */
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.game) renderTray(); }, 120);
  });

  window.addEventListener('pagehide', saveGame);
  window.addEventListener('beforeunload', saveGame);

  /* --------------------------------------------------------------------- */
  /* אתחול                                                                  */
  /* --------------------------------------------------------------------- */

  function init() {
    applyTheme();
    if (H) H.setEnabled(!!state.prefs.haptics);
    buildBoard();

    const saved = store.read(SAVE_KEY, null);
    if (saved && !saved.finished) {
      state.game = BlockBlast.deserialize(saved);
      state.cellColor = Array.isArray(saved.cellColor) && saved.cellColor.length === C.CELLS
        ? saved.cellColor
        : new Array(C.CELLS).fill(null);
      render();
    } else {
      newGame();
    }

    if (!store.ok) setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
  }

  init();
})();
