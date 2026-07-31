/* =============================================================================
 * ui.js — שכבת ממשק ואינטראקציה
 * -----------------------------------------------------------------------------
 * אחראית על: רינדור הלוח (גנרי לכל גודל), פאנל המספרים, הדגשות, אנימציות,
 * זום/הזזה בלוח 16x16, טיימר, מודלים, ושמירה אוטומטית.
 * =========================================================================== */
(function () {
  'use strict';

  const Core = window.SudokuCore;
  const Storage = window.SudokuStorage;
  const Game = window.SudokuGame;

  const $ = (sel) => document.querySelector(sel);

  const DIFF_LABELS = {
    easy: 'קל',
    medium: 'בינוני',
    hard: 'קשה',
    expert: 'מומחה',
  };

  /* --------------------------------------------------------------------- */
  /* מצב הממשק                                                              */
  /* --------------------------------------------------------------------- */

  const state = {
    prefs: Storage.loadPrefs(),
    game: null,
    size: 9,
    selected: -1, // אינדקס התא הנבחר
    notesMode: false,
    paused: false,
    generating: false,
    autoCompleting: false, // חוסם קלט בזמן ריצת ההשלמה האוטומטית
    cellEls: [], // מצביעים ישירים לאלמנטי התאים (מונע שאילתות DOM חוזרות)
    numEls: [],
    conflicts: null,
    confirmAction: null,
  };

  /* --------------------------------------------------------------------- */
  /* אלמנטים                                                                */
  /* --------------------------------------------------------------------- */

  const el = {
    tabs: $('.tabs'),
    pills: $('#difficultyPills'),
    btnNew: $('#btnNew'),
    btnTheme: $('#btnTheme'),
    btnStats: $('#btnStats'),
    btnSettings: $('#btnSettings'),
    settingsModal: $('#settingsModal'),
    btnPause: $('#btnPause'),
    btnResume: $('#btnResume'),
    btnRestart: $('#btnRestart'),
    statusbar: $('.statusbar'),
    statTime: $('#statTime'),
    statMistakes: $('#statMistakes'),
    statHints: $('#statHints'),
    statRemaining: $('#statRemaining'),
    board: $('#board'),
    boardStage: $('#boardStage'),
    boardViewport: $('#boardViewport'),
    zoomControls: $('#zoomControls'),
    pauseOverlay: $('#pauseOverlay'),
    tools: $('#tools'),
    notesBadge: $('#notesBadge'),
    hintBadge: $('#hintBadge'),
    numpad: $('#numpad'),
    footerInfo: $('#footerInfo'),
    loading: $('#loading'),
    loadingTitle: $('#loadingTitle'),
    loadingSub: $('#loadingSub'),
    loadingBar: $('#loadingBar'),
    winModal: $('#winModal'),
    winSub: $('#winSub'),
    winStats: $('#winStats'),
    confetti: $('#confetti'),
    btnWinNew: $('#btnWinNew'),
    statsModal: $('#statsModal'),
    statsTable: $('#statsTable'),
    btnClearStats: $('#btnClearStats'),
    confirmModal: $('#confirmModal'),
    confirmText: $('#confirmText'),
    btnConfirmOk: $('#btnConfirmOk'),
    toast: $('#toast'),
  };

  /* --------------------------------------------------------------------- */
  /* עזרים כלליים                                                           */
  /* --------------------------------------------------------------------- */

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }

  let toastTimer = null;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.hidden = true;
    }, 2200);
  }

  function openModal(node) {
    node.hidden = false;
  }
  function closeModal(node) {
    node.hidden = true;
  }

  /** מציג דיאלוג אישור לפעולה שלא ניתן לבטל. */
  function confirmAction(text, onOk) {
    el.confirmText.textContent = text;
    state.confirmAction = onOk;
    openModal(el.confirmModal);
  }

  /* --------------------------------------------------------------------- */
  /* ערכת נושא                                                              */
  /* --------------------------------------------------------------------- */

  function applyTheme() {
    const pref = state.prefs.theme;
    const dark =
      pref === 'dark' ||
      (pref === 'auto' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  function toggleTheme() {
    // auto -> light -> dark -> auto
    const order = { auto: 'light', light: 'dark', dark: 'auto' };
    state.prefs.theme = order[state.prefs.theme] || 'light';
    Storage.savePrefs(state.prefs);
    applyTheme();
    const names = { auto: 'אוטומטי', light: 'בהיר', dark: 'כהה' };
    toast('ערכת נושא: ' + names[state.prefs.theme]);
  }

  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (state.prefs.theme === 'auto') applyTheme();
    });

  /* --------------------------------------------------------------------- */
  /* בניית הלוח                                                             */
  /* --------------------------------------------------------------------- */

  /**
   * בונה מחדש את אלמנטי הלוח. נקרא רק כשמשתנה גודל הלוח או מתחיל משחק חדש —
   * לא בכל עדכון. כל שאר העדכונים נעשים על אלמנטים קיימים.
   */
  function buildBoard(size) {
    const spec = Core.specFor(size);

    // כל המידות נגזרות מהמפרט — אין כאן שום הנחה על 9x9
    el.board.style.setProperty('--n', String(spec.N));
    el.board.style.setProperty('--boxes-per-row', String(spec.boxesPerRow));
    el.board.style.setProperty('--boxes-per-col', String(spec.N / spec.boxH));
    el.board.style.setProperty('--box-w', String(spec.boxW));
    el.board.style.setProperty('--box-h', String(spec.boxH));
    // מספר עמודות בתצוגת הפתקים: 3 ל-9x9, 4 ל-16x16
    el.board.style.setProperty('--note-cols', String(spec.boxW));
    el.board.dataset.size = String(spec.N);
    el.board.setAttribute('aria-rowcount', spec.N);
    el.board.setAttribute('aria-colcount', spec.N);

    const frag = document.createDocumentFragment();
    // cellEls ממופה לפי אינדקס הלוח, לא לפי סדר ה-DOM —
    // ב-DOM התאים מקובצים בתוך תיבות, אבל שאר הקוד עובד באינדקסים
    const cells = new Array(spec.cells);

    for (let b = 0; b < spec.N; b++) {
      const box = document.createElement('div');
      box.className = 'box';

      // יחידת התיבה כבר בנויה בסדר שורה-אחר-שורה בתוך התיבה,
      // כלומר בדיוק הסדר שרשת ה-CSS מצפה לו
      const unit = spec.units[2 * spec.N + b];

      for (let k = 0; k < unit.length; k++) {
        const i = unit[k];

        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.i = i;
        cell.setAttribute('role', 'gridcell');

        const value = document.createElement('span');
        value.className = 'cell-value';
        cell.appendChild(value);

        const notes = document.createElement('div');
        notes.className = 'cell-notes';
        notes.hidden = true;
        cell.appendChild(notes);

        box.appendChild(cell);
        cells[i] = cell;
      }

      frag.appendChild(box);
    }

    el.board.textContent = '';
    el.board.appendChild(frag);
    state.cellEls = cells;
  }

  /** מעדכן תא בודד: ערך, פתקים ומחלקות מצב. */
  function renderCell(i) {
    const g = state.game;
    const cell = state.cellEls[i];
    if (!cell) return;

    const value = g.values[i];
    const valueEl = cell.firstChild;
    const notesEl = cell.lastChild;

    const label = value ? Core.labelFor(value) : '';
    if (valueEl.textContent !== label) valueEl.textContent = label;

    cell.classList.toggle('is-given', g.isGiven(i));
    cell.classList.toggle('is-hint', !g.isGiven(i) && !!g.hintCells[i]);

    // פתקים מוצגים רק בתא ריק
    const noteMask = value ? 0 : g.notes[i];
    if (noteMask) {
      const N = g.spec.N;
      let html = '';
      for (let v = 1; v <= N; v++) {
        const on = noteMask & (1 << (v - 1));
        html += `<span>${on ? Core.labelFor(v) : ''}</span>`;
      }
      notesEl.innerHTML = html;
      notesEl.hidden = false;
    } else if (!notesEl.hidden) {
      notesEl.hidden = true;
      notesEl.textContent = '';
    }

    cell.setAttribute(
      'aria-label',
      `שורה ${g.spec.rowOf[i] + 1}, עמודה ${g.spec.colOf[i] + 1}${
        value ? ', ' + label : ', ריק'
      }`
    );
  }

  /** מרנדר את כל התאים (בשימוש בטעינת משחק). */
  function renderAllCells() {
    for (let i = 0; i < state.game.cells; i++) renderCell(i);
  }

  /* --------------------------------------------------------------------- */
  /* הדגשות ושגיאות                                                         */
  /* --------------------------------------------------------------------- */

  /**
   * מעדכן את מחלקות ההדגשה של כל התאים.
   * גם ב-16x16 (256 תאים) זה מהיר — toggle של מחלקות בלבד, בלי בנייה מחדש.
   */
  function updateHighlights() {
    const g = state.game;
    if (!g) return;
    const spec = g.spec;
    const sel = state.selected;
    const prefs = state.prefs;

    state.conflicts = prefs.showErrors ? g.conflicts() : null;

    const selRow = sel >= 0 ? spec.rowOf[sel] : -1;
    const selCol = sel >= 0 ? spec.colOf[sel] : -1;
    const selBox = sel >= 0 ? spec.boxOf[sel] : -1;
    const selValue = sel >= 0 ? g.values[sel] : 0;
    const selBit = selValue ? 1 << (selValue - 1) : 0;

    for (let i = 0; i < spec.cells; i++) {
      const cell = state.cellEls[i];
      const isSel = i === sel;
      const isPeer =
        prefs.highlightPeers &&
        !isSel &&
        sel >= 0 &&
        (spec.rowOf[i] === selRow ||
          spec.colOf[i] === selCol ||
          spec.boxOf[i] === selBox);
      const isSame =
        prefs.highlightSame &&
        !isSel &&
        selValue !== 0 &&
        g.values[i] === selValue;

      cell.classList.toggle('is-selected', isSel);
      cell.classList.toggle('is-peer', isPeer);
      cell.classList.toggle('is-same', isSame);
      cell.classList.toggle('is-error', !!(state.conflicts && state.conflicts[i]));

      // הדגשת הפתק התואם לערך הנבחר
      if (selBit && !g.values[i] && g.notes[i] & selBit) {
        const notesEl = cell.lastChild;
        const span = notesEl.children[selValue - 1];
        if (span) span.classList.add('is-match');
        cell._matched = span || null;
      } else if (cell._matched) {
        cell._matched.classList.remove('is-match');
        cell._matched = null;
      }
    }
  }

  /* --------------------------------------------------------------------- */
  /* פאנל מספרים                                                            */
  /* --------------------------------------------------------------------- */

  function buildNumpad(size) {
    const N = Core.specFor(size).N;
    el.numpad.dataset.count = N;
    el.numpad.textContent = '';
    state.numEls = [];

    for (let v = 1; v <= N; v++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'num';
      b.dataset.value = v;
      b.setAttribute('aria-label', 'הזן ' + Core.labelFor(v));
      b.innerHTML =
        `<span class="num-label">${Core.labelFor(v)}</span>` +
        `<span class="num-count"></span>`;
      el.numpad.appendChild(b);
      state.numEls.push(b);
    }
  }

  /** מעדכן את מוני ה"נשארו" בפאנל ואת מצב הפתקים. */
  function updateNumpad() {
    const g = state.game;
    if (!g) return;
    const N = g.spec.N;
    for (let v = 1; v <= N; v++) {
      const btn = state.numEls[v - 1];
      const used = g.countOfValue(v);
      const left = N - used;
      btn.lastChild.textContent = left > 0 ? left : '✓';
      btn.classList.toggle('is-done', left <= 0);
      btn.classList.toggle('is-notes', state.notesMode);
    }
  }

  /* --------------------------------------------------------------------- */
  /* עדכון שורת סטטוס וכלים                                                 */
  /* --------------------------------------------------------------------- */

  function updateStatus() {
    const g = state.game;
    if (!g) return;

    el.statTime.textContent = formatTime(g.currentSeconds());
    el.statMistakes.textContent = g.mistakes;
    el.statMistakes.classList.toggle('is-warn', g.mistakes > 0);
    el.statHints.textContent = g.hintsLeft;
    el.statRemaining.textContent = g.remainingCells();

    el.hintBadge.textContent = g.hintsLeft;
    el.hintBadge.classList.toggle('is-empty', g.hintsLeft === 0);

    const undoBtn = el.tools.querySelector('[data-action="undo"]');
    const redoBtn = el.tools.querySelector('[data-action="redo"]');
    const hintBtn = el.tools.querySelector('[data-action="hint"]');
    undoBtn.disabled = !g.canUndo();
    redoBtn.disabled = !g.canRedo();
    hintBtn.disabled = g.hintsLeft === 0 || g.finished;

    el.footerInfo.textContent = `${g.size}×${g.size} · ${
      DIFF_LABELS[g.difficulty] || g.difficulty
    }`;
  }

  function updateNotesButton() {
    const btn = $('#btnNotes');
    btn.classList.toggle('is-on', state.notesMode);
    btn.setAttribute('aria-pressed', String(state.notesMode));
    el.notesBadge.textContent = state.notesMode ? 'פעיל' : 'כבוי';
  }

  /* --------------------------------------------------------------------- */
  /* טיימר                                                                  */
  /* --------------------------------------------------------------------- */

  let timerInterval = null;

  function startTimerLoop() {
    stopTimerLoop();
    timerInterval = setInterval(() => {
      if (state.game && state.game.isTimerRunning) {
        el.statTime.textContent = formatTime(state.game.currentSeconds());
      }
    }, 250);
  }

  function stopTimerLoop() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  function setPaused(paused) {
    const g = state.game;
    if (!g || g.finished) return;
    state.paused = paused;
    el.pauseOverlay.hidden = !paused;
    el.statusbar.classList.toggle('is-paused', paused);
    if (paused) {
      g.stopTimer();
      saveGame();
    } else {
      g.startTimer();
    }
  }

  // השהיה אוטומטית כשעוברים לטאב אחר / ממזערים — הזמן לא "רץ" סתם
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.game && state.game.isTimerRunning) {
        state.game.stopTimer();
        saveGame();
      }
    } else if (state.game && !state.paused && !state.game.finished) {
      state.game.startTimer();
    }
  });

  /* --------------------------------------------------------------------- */
  /* שמירה אוטומטית                                                         */
  /* --------------------------------------------------------------------- */

  let saveTimer = null;

  function saveGame() {
    if (!state.game) return;
    Storage.saveGame(state.game.size, state.game.serialize());
  }

  /** שמירה מושהית — מונעת כתיבות מיותרות בזמן הקלדה מהירה. */
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveGame, 400);
  }

  window.addEventListener('pagehide', saveGame);
  window.addEventListener('beforeunload', saveGame);

  /* --------------------------------------------------------------------- */
  /* זום והזזה בלוח (16x16)                                                 */
  /* --------------------------------------------------------------------- */

  /**
   * בקר zoom/pan מבוסס Pointer Events.
   * מיושם ידנית (ולא דרך זום של הדפדפן) כדי שהזום יחול רק על הלוח
   * ולא ישבור את פריסת שאר הדף.
   */
  const zoom = {
    scale: 1,
    tx: 0,
    ty: 0,
    min: 1,
    max: 4,
    enabled: false,
    pointers: new Map(),
    startDist: 0,
    startScale: 1,
    startMid: { x: 0, y: 0 },
    startTx: 0,
    startTy: 0,
    moved: false,
    suppressClick: false,
    lastTap: 0,
  };

  function zoomApply(animate) {
    el.boardStage.classList.toggle('is-animating', !!animate);
    el.boardStage.style.transform = `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`;
    if (animate) {
      setTimeout(() => el.boardStage.classList.remove('is-animating'), 240);
    }
  }

  /** מגביל את ההזזה כך שהלוח לעולם לא "יברח" מחוץ לחלון התצוגה. */
  function zoomClamp() {
    const rect = el.boardViewport.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const maxX = 0;
    const minX = w - w * zoom.scale;
    const maxY = 0;
    const minY = h - h * zoom.scale;
    zoom.tx = Math.min(maxX, Math.max(minX, zoom.tx));
    zoom.ty = Math.min(maxY, Math.max(minY, zoom.ty));
  }

  function zoomReset(animate) {
    zoom.scale = 1;
    zoom.tx = 0;
    zoom.ty = 0;
    zoomApply(animate);
  }

  /** מקרב/מרחיק סביב נקודה מסוימת (ברירת מחדל: מרכז חלון התצוגה). */
  function zoomTo(newScale, cx, cy, animate) {
    const rect = el.boardViewport.getBoundingClientRect();
    const px = cx == null ? rect.width / 2 : cx - rect.left;
    const py = cy == null ? rect.height / 2 : cy - rect.top;
    const clamped = Math.min(zoom.max, Math.max(zoom.min, newScale));
    const ratio = clamped / zoom.scale;
    // שומרים על הנקודה (px,py) במקומה על המסך
    zoom.tx = px - (px - zoom.tx) * ratio;
    zoom.ty = py - (py - zoom.ty) * ratio;
    zoom.scale = clamped;
    zoomClamp();
    zoomApply(animate);
  }

  function setZoomEnabled(enabled) {
    zoom.enabled = enabled;
    // מנקים מצב מגע שנותר ממשחק קודם, אחרת דגל suppressClick עלול
    // "להיתקע" ולחסום בחירת תאים אחרי מעבר בין גדלי לוח
    zoom.pointers.clear();
    zoom.suppressClick = false;
    zoom.moved = false;
    zoom.startDist = 0;
    el.boardViewport.classList.toggle('is-zoomable', enabled);
    el.zoomControls.hidden = !enabled;
    zoomReset(false);
  }

  function midpoint(points) {
    let x = 0;
    let y = 0;
    points.forEach((p) => {
      x += p.x;
      y += p.y;
    });
    return { x: x / points.size, y: y / points.size };
  }

  function distance(points) {
    const arr = Array.from(points.values());
    const dx = arr[0].x - arr[1].x;
    const dy = arr[0].y - arr[1].y;
    return Math.hypot(dx, dy);
  }

  el.boardViewport.addEventListener('pointerdown', (e) => {
    if (!zoom.enabled) return;
    zoom.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    zoom.moved = false;

    if (zoom.pointers.size === 2) {
      zoom.startDist = distance(zoom.pointers);
      zoom.startScale = zoom.scale;
      zoom.startMid = midpoint(zoom.pointers);
      zoom.startTx = zoom.tx;
      zoom.startTy = zoom.ty;
      zoom.suppressClick = true; // pinch לעולם אינו לחיצה על תא
    } else if (zoom.pointers.size === 1) {
      zoom.startTx = zoom.tx;
      zoom.startTy = zoom.ty;
      zoom.startMid = { x: e.clientX, y: e.clientY };
    }
  });

  el.boardViewport.addEventListener('pointermove', (e) => {
    if (!zoom.enabled || !zoom.pointers.has(e.pointerId)) return;
    zoom.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (zoom.pointers.size === 2) {
      // --- Pinch ---
      const dist = distance(zoom.pointers);
      if (zoom.startDist > 0) {
        const rect = el.boardViewport.getBoundingClientRect();
        const target = Math.min(
          zoom.max,
          Math.max(zoom.min, (zoom.startScale * dist) / zoom.startDist)
        );
        const mid = midpoint(zoom.pointers);
        const px = zoom.startMid.x - rect.left;
        const py = zoom.startMid.y - rect.top;
        const ratio = target / zoom.startScale;
        // זום סביב נקודת האמצע ההתחלתית + הזזה לפי תזוזת האמצע (pan תוך כדי pinch)
        zoom.tx = px - (px - zoom.startTx) * ratio + (mid.x - zoom.startMid.x);
        zoom.ty = py - (py - zoom.startTy) * ratio + (mid.y - zoom.startMid.y);
        zoom.scale = target;
        zoomClamp();
        zoomApply(false);
      }
      zoom.moved = true;
      e.preventDefault();
    } else if (zoom.pointers.size === 1 && zoom.scale > 1.01) {
      // --- Pan (רק כשמקורבים; אחרת מפריע ללחיצה על תא) ---
      const dx = e.clientX - zoom.startMid.x;
      const dy = e.clientY - zoom.startMid.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        zoom.moved = true;
        zoom.suppressClick = true;
      }
      zoom.tx = zoom.startTx + dx;
      zoom.ty = zoom.startTy + dy;
      zoomClamp();
      zoomApply(false);
      e.preventDefault();
    }
  });

  function endPointer(e) {
    if (!zoom.enabled) return;
    zoom.pointers.delete(e.pointerId);
    if (zoom.pointers.size < 2) zoom.startDist = 0;
    if (zoom.pointers.size === 0) {
      // מאפשרים ל-click לרוץ לפני איפוס הדגל
      setTimeout(() => {
        zoom.suppressClick = false;
      }, 0);
    }
  }
  el.boardViewport.addEventListener('pointerup', endPointer);
  el.boardViewport.addEventListener('pointercancel', endPointer);

  // גלגלת + Ctrl לזום בדסקטופ
  el.boardViewport.addEventListener(
    'wheel',
    (e) => {
      if (!zoom.enabled || !e.ctrlKey) return;
      e.preventDefault();
      zoomTo(zoom.scale * (e.deltaY < 0 ? 1.12 : 0.89), e.clientX, e.clientY, false);
    },
    { passive: false }
  );

  el.zoomControls.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-zoom]');
    if (!btn) return;
    // איפוס נעשה בלחיצה כפולה על הלוח, או פשוט בהתרחקות עד 100%
    // (הזום חסום ממילא ב-min=1)
    const mode = btn.dataset.zoom;
    if (mode === 'in') zoomTo(zoom.scale * 1.5, null, null, true);
    else if (mode === 'out') zoomTo(zoom.scale / 1.5, null, null, true);
  });

  /* --------------------------------------------------------------------- */
  /* בחירת תא והזנת ערכים                                                   */
  /* --------------------------------------------------------------------- */

  function selectCell(i) {
    if (state.selected === i) return;
    state.selected = i;
    updateHighlights();
  }

  el.board.addEventListener('click', (e) => {
    // לחיצה שנוצרה בסוף גרירה/pinch — לא נחשבת בחירה
    if (zoom.suppressClick) return;
    if (state.paused || state.generating) return;
    const cell = e.target.closest('.cell');
    if (!cell) return;

    // לחיצה כפולה מהירה על הלוח המורחב => איפוס זום
    const now = Date.now();
    if (zoom.enabled && now - zoom.lastTap < 300) {
      zoomReset(true);
    }
    zoom.lastTap = now;

    selectCell(Number(cell.dataset.i));
  });

  /** אנימציה קצרה על תא. */
  function animateCell(i, cls) {
    const cell = state.cellEls[i];
    if (!cell) return;
    cell.classList.remove(cls);
    // מאלץ reflow כדי שהאנימציה תרוץ שוב גם אם המחלקה כבר הייתה
    void cell.offsetWidth;
    cell.classList.add(cls);
    setTimeout(() => cell.classList.remove(cls), 500);
  }

  /** הזנת ערך לתא הנבחר (או פתק, לפי המצב). */
  function enterValue(v) {
    const g = state.game;
    if (!g || state.paused || g.finished || state.autoCompleting) return;

    const i = state.selected;
    if (i < 0) {
      toast('בחר תא קודם');
      return;
    }
    if (g.isGiven(i)) {
      toast('לא ניתן לשנות תא נתון');
      return;
    }

    let res;
    if (state.notesMode) {
      res = g.toggleNote(i, v);
      if (res.ok) renderCell(i);
    } else {
      res = g.setValue(i, v, { autoClearNotes: state.prefs.autoClearNotes });
      if (res.ok) {
        // ייתכן שנוקו פתקים אצל שכנים — מרנדרים את כל התאים שהשתנו
        const entry = g.undoStack[g.undoStack.length - 1];
        if (entry) entry.before.forEach((s) => renderCell(s.i));
        animateCell(i, 'is-pop');
        if (res.mistake && state.prefs.showErrors) animateCell(i, 'is-shake');
      }
    }

    if (!res.ok) return;

    afterMove();
  }

  function eraseSelected() {
    const g = state.game;
    if (!g || state.paused || g.finished || state.autoCompleting) return;
    const i = state.selected;
    if (i < 0) return;
    const res = g.erase(i);
    if (!res.ok) return;
    renderCell(i);
    updateHighlights();
    updateNumpad();
    updateStatus();
    scheduleSave();
  }

  /* פאנל המספרים */
  el.numpad.addEventListener('click', (e) => {
    const btn = e.target.closest('.num');
    if (!btn) return;
    btn.classList.add('is-pressed');
    setTimeout(() => btn.classList.remove('is-pressed'), 220);
    enterValue(Number(btn.dataset.value));
  });

  /* --------------------------------------------------------------------- */
  /* כלים                                                                   */
  /* --------------------------------------------------------------------- */

  el.tools.addEventListener('click', (e) => {
    const btn = e.target.closest('.tool');
    if (!btn) return;
    const g = state.game;
    if (!g) return;

    switch (btn.dataset.action) {
      case 'undo':
        if (g.undo()) {
          const entry = g.redoStack[g.redoStack.length - 1];
          if (entry) entry.before.forEach((s) => renderCell(s.i));
          afterHistoryChange();
        }
        break;

      case 'redo':
        if (g.redo()) {
          const entry = g.undoStack[g.undoStack.length - 1];
          if (entry) entry.after.forEach((s) => renderCell(s.i));
          afterHistoryChange();
        }
        break;

      case 'erase':
        eraseSelected();
        break;

      case 'notes':
        state.notesMode = !state.notesMode;
        updateNotesButton();
        updateNumpad();
        break;

      case 'hint':
        doHint();
        break;

      case 'solve':
        confirmAction(
          'הלוח ייפתר במלואו והמשחק יסתיים. להמשיך?',
          () => {
            g.solveAll();
            renderAllCells();
            updateHighlights();
            updateNumpad();
            updateStatus();
            stopTimerLoop();
            saveGame();
            toast('הלוח נפתר');
          }
        );
        break;
    }
  });

  function afterHistoryChange() {
    updateHighlights();
    updateNumpad();
    updateStatus();
    scheduleSave();
    // בכוונה בלי השלמה אוטומטית: ביטול/ביצוע-חוזר אינו מהלך של השחקן,
    // והפעלת השלמה כאן הייתה "נלחמת" בשחקן שמנסה לחזור אחורה
    checkWin();
  }

  function doHint() {
    const g = state.game;
    if (!g || state.paused || g.finished) return;
    const res = g.hint(state.selected);
    if (!res.ok) {
      if (res.reason === 'no-hints') toast('נגמרו הרמזים למשחק הזה');
      else if (res.reason === 'nothing-to-hint') toast('אין מה לרמוז — הלוח מלא');
      return;
    }
    const entry = g.undoStack[g.undoStack.length - 1];
    if (entry) entry.before.forEach((s) => renderCell(s.i));
    selectCell(res.index);
    animateCell(res.index, 'is-pop');
    afterMove();
  }

  /* --------------------------------------------------------------------- */
  /* השלמה אוטומטית                                                         */
  /* --------------------------------------------------------------------- */

  /** מספר התאים שמתחתיו הלוח מושלם אוטומטית. */
  const AUTO_COMPLETE_AT = 6;

  /**
   * בודק אם הגיע הרגע להשלים את הלוח לבד.
   *
   * מפעילים רק כשהלוח *נקי לחלוטין* — כל מה שמולא עד כה נכון. אחרת היינו
   * "מתקנים" לשחקן טעויות בלי שביקש, וזה כבר לא השלמה אלא פתרון.
   *
   * @returns {boolean} true אם הופעלה השלמה (ואז אין צורך לבדוק ניצחון)
   */
  function maybeAutoComplete() {
    const g = state.game;
    if (!g || g.finished || !state.prefs.autoComplete) return false;

    const remaining = g.remainingCells();
    if (remaining === 0 || remaining > AUTO_COMPLETE_AT) return false;

    for (let i = 0; i < g.cells; i++) {
      if (g.values[i] && g.values[i] !== g.solution[i]) return false;
    }

    runAutoComplete();
    return true;
  }

  /** ממלא את התאים שנותרו בזה אחר זה, עם אנימציה מדורגת. */
  function runAutoComplete() {
    const g = state.game;
    const empties = [];
    for (let i = 0; i < g.cells; i++) if (!g.values[i]) empties.push(i);
    if (!empties.length) return;

    state.autoCompleting = true;
    toast('השלמה אוטומטית · נשארו ' + empties.length);

    empties.forEach((idx, k) => {
      setTimeout(() => {
        // המשחק יכול היה להתאפס/להתחלף בזמן ההשלמה
        if (state.game !== g || g.finished) return;

        g.setValue(idx, g.solution[idx], {
          autoClearNotes: state.prefs.autoClearNotes,
        });
        renderCell(idx);
        animateCell(idx, 'is-auto');
        updateNumpad();
        updateStatus();

        if (k === empties.length - 1) {
          state.autoCompleting = false;
          updateHighlights();
          saveGame();
          checkWin();
        }
      }, k * 110);
    });
  }

  /** מרוכז: מה שצריך לקרות אחרי כל מהלך של השחקן. */
  function afterMove() {
    updateHighlights();
    updateNumpad();
    updateStatus();
    scheduleSave();
    if (!maybeAutoComplete()) checkWin();
  }

  /* --------------------------------------------------------------------- */
  /* ניצחון                                                                 */
  /* --------------------------------------------------------------------- */

  function checkWin() {
    const g = state.game;
    if (!g || g.finished || !g.isComplete()) return;

    g.finished = true;
    g.stopTimer();
    stopTimerLoop();
    saveGame();

    const seconds = g.currentSeconds();
    const rec = Storage.recordWin(g.size, g.difficulty, seconds);

    playWinAnimation();

    el.winSub.textContent = `${g.size}×${g.size} · ${DIFF_LABELS[g.difficulty]}`;
    el.winStats.innerHTML = [
      statCard('זמן', formatTime(seconds), rec.isNewBest),
      statCard('שיא אישי', rec.best != null ? formatTime(rec.best) : '—', false),
      statCard('שגיאות', String(g.mistakes), false),
      statCard('רמזים', `${g.hintsUsed}/${Game.MAX_HINTS}`, false),
    ].join('');

    setTimeout(() => openModal(el.winModal), 700);
  }

  function statCard(k, v, isBest) {
    return `<div class="win-stat${isBest ? ' is-best' : ''}">
      <span class="k">${k}${isBest ? ' 🏆' : ''}</span>
      <span class="v">${v}</span>
    </div>`;
  }

  /** גל אנימציה שמתפשט מהתא השמאלי-עליון החוצה. */
  function playWinAnimation() {
    const spec = state.game.spec;
    for (let i = 0; i < spec.cells; i++) {
      const delay = (spec.rowOf[i] + spec.colOf[i]) * (spec.N === 16 ? 12 : 22);
      const cell = state.cellEls[i];
      cell.style.setProperty('--wd', delay + 'ms');
      cell.classList.add('is-win');
      setTimeout(() => cell.classList.remove('is-win'), delay + 600);
    }
  }

  function spawnConfetti() {
    const colors = ['#4f6ef7', '#23996b', '#e9a94e', '#e14b52', '#7f9bff'];
    let html = '';
    for (let i = 0; i < 14; i++) {
      const left = Math.random() * 100;
      const delay = Math.random() * 400;
      const color = colors[(Math.random() * colors.length) | 0];
      html += `<i style="left:${left}%;background:${color};animation-delay:${delay}ms"></i>`;
    }
    el.confetti.innerHTML = html;
  }

  /* --------------------------------------------------------------------- */
  /* יצירת משחק חדש                                                         */
  /* --------------------------------------------------------------------- */

  function showLoading(show) {
    el.loading.hidden = !show;
    if (show) el.loadingBar.style.width = '0%';
  }

  async function newGame(size, difficulty) {
    if (state.generating) return;
    state.generating = true;
    showLoading(true);
    el.loadingTitle.textContent = 'יוצר פאזל…';
    el.loadingSub.textContent =
      size === 16 ? 'לוח 16×16 — זה לוקח רגע' : 'מוודא שיש פתרון יחיד';

    // נותנים לדפדפן לצייר את מסך הטעינה לפני שמתחילים לעבוד.
    // בכוונה setTimeout ולא requestAnimationFrame: בטאב שאינו מצויר
    // (רקע/ממוזער) rAF לא נקרא כלל, והיצירה הייתה נתקעת לנצח.
    await new Promise((r) => setTimeout(r, 30));

    try {
      const data = await Core.generatePuzzle(size, difficulty, {
        onProgress: (p, label) => {
          el.loadingBar.style.width = Math.round(p * 100) + '%';
          if (label) el.loadingSub.textContent = label;
        },
      });

      Storage.recordStart(size, difficulty);
      loadGameObject(new Game(data));
      toast(`לוח ${size}×${size} · ${DIFF_LABELS[difficulty]}`);
    } catch (err) {
      console.error(err);
      toast('שגיאה ביצירת הפאזל, נסה שוב');
    } finally {
      showLoading(false);
      state.generating = false;
    }
  }

  /** טוען אובייקט משחק לממשק (משחק חדש או שמור). */
  function loadGameObject(game) {
    state.game = game;
    state.size = game.size;
    state.selected = -1;
    state.notesMode = false;
    state.paused = false;
    state.autoCompleting = false;

    buildBoard(game.size);
    buildNumpad(game.size);
    renderAllCells();
    updateHighlights();
    updateNumpad();
    updateNotesButton();
    updateStatus();

    setZoomEnabled(game.size === 16);
    el.pauseOverlay.hidden = true;
    el.statusbar.classList.remove('is-paused');
    closeModal(el.winModal);

    if (!game.finished) {
      game.startTimer();
      startTimerLoop();
    } else {
      stopTimerLoop();
    }
    saveGame();
  }

  /* --------------------------------------------------------------------- */
  /* מעבר בין גדלים ורמות                                                   */
  /* --------------------------------------------------------------------- */

  function setActiveSize(size, { load = true } = {}) {
    state.size = size;
    state.prefs.size = size;
    Storage.savePrefs(state.prefs);

    el.tabs.dataset.active = size;
    el.tabs.querySelectorAll('.tab').forEach((t) => {
      const on = Number(t.dataset.size) === size;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });

    setActiveDifficulty(state.prefs.difficulty[size] || 'easy', { persist: false });

    if (!load) return;

    // כל גודל לוח שומר משחק משלו — אז מעבר בין טאבים לא מאבד התקדמות
    const saved = Storage.loadGame(size);
    const g = saved ? Game.deserialize(saved) : null;
    if (g) {
      loadGameObject(g);
    } else {
      newGame(size, state.prefs.difficulty[size] || 'easy');
    }
  }

  function setActiveDifficulty(difficulty, { persist = true } = {}) {
    el.pills.querySelectorAll('.pill').forEach((p) => {
      p.classList.toggle('is-active', p.dataset.difficulty === difficulty);
    });
    if (persist) {
      state.prefs.difficulty[state.size] = difficulty;
      Storage.savePrefs(state.prefs);
    }
  }

  el.tabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab || state.generating) return;
    const size = Number(tab.dataset.size);
    if (size === state.size) return;
    saveGame(); // שומרים את המשחק הנוכחי לפני המעבר
    setActiveSize(size);
  });

  el.pills.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill || state.generating) return;
    const difficulty = pill.dataset.difficulty;
    if (difficulty === state.prefs.difficulty[state.size]) return;
    setActiveDifficulty(difficulty);
    newGame(state.size, difficulty);
  });

  el.btnNew.addEventListener('click', () => {
    if (state.generating) return;
    const difficulty = state.prefs.difficulty[state.size] || 'easy';
    const g = state.game;
    // מזהירים רק אם באמת יש התקדמות להפסיד
    if (g && !g.finished && g.undoStack.length > 3) {
      confirmAction('להתחיל לוח חדש? ההתקדמות הנוכחית תימחק.', () =>
        newGame(state.size, difficulty)
      );
    } else {
      newGame(state.size, difficulty);
    }
  });

  el.btnRestart.addEventListener('click', () => {
    const g = state.game;
    if (!g) return;
    confirmAction('לנקות את כל מה שמילאת ולהתחיל את אותו לוח מחדש?', () => {
      g.restart();
      state.selected = -1;
      renderAllCells();
      updateHighlights();
      updateNumpad();
      updateStatus();
      g.startTimer();
      startTimerLoop();
      saveGame();
      toast('הלוח אופס');
    });
  });

  /* --------------------------------------------------------------------- */
  /* מודלים וכפתורים כלליים                                                 */
  /* --------------------------------------------------------------------- */

  el.btnTheme.addEventListener('click', toggleTheme);
  el.btnPause.addEventListener('click', () => setPaused(!state.paused));
  el.btnResume.addEventListener('click', () => setPaused(false));
  el.btnWinNew.addEventListener('click', () => {
    closeModal(el.winModal);
    newGame(state.size, state.prefs.difficulty[state.size] || 'easy');
  });

  el.btnConfirmOk.addEventListener('click', () => {
    const fn = state.confirmAction;
    state.confirmAction = null;
    closeModal(el.confirmModal);
    if (fn) fn();
  });

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.closest('.modal')));
  });

  // לחיצה על הרקע סוגרת מודל
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target === m) closeModal(m);
    });
  });

  el.btnStats.addEventListener('click', () => {
    renderStats();
    openModal(el.statsModal);
  });

  /* ------------------------------ הגדרות ------------------------------ */

  /** מסנכרן את מצב המתגים מתוך ההעדפות השמורות. */
  function syncSettingsUI() {
    el.settingsModal.querySelectorAll('[data-pref]').forEach((input) => {
      input.checked = !!state.prefs[input.dataset.pref];
    });
  }

  el.btnSettings.addEventListener('click', () => {
    syncSettingsUI();
    openModal(el.settingsModal);
  });

  el.settingsModal.addEventListener('change', (e) => {
    const input = e.target.closest('[data-pref]');
    if (!input) return;

    state.prefs[input.dataset.pref] = input.checked;
    Storage.savePrefs(state.prefs);

    // הדגשות ושגיאות משפיעות על הצביעה => מרעננים מיד
    updateHighlights();

    // הפעלת ההשלמה כשהלוח כבר קרוב לסיום צריכה לתפוס מיד
    if (input.dataset.pref === 'autoComplete' && input.checked) {
      if (maybeAutoComplete()) closeModal(el.settingsModal);
    }
  });

  el.btnClearStats.addEventListener('click', () => {
    confirmAction('לאפס את כל הסטטיסטיקות והשיאים?', () => {
      Storage.clearStats();
      renderStats();
      toast('הנתונים אופסו');
    });
  });

  function renderStats() {
    let html = '';
    [9, 16].forEach((size) => {
      html += `<div class="stats-group-title">לוח ${size}×${size}</div>`;
      Core.DIFFICULTY_ORDER.forEach((d) => {
        const rec = Storage.getStat(size, d);
        html += `<div class="stats-row">
          <span class="name">${DIFF_LABELS[d]}</span>
          <span class="meta">${rec.won} ניצחונות / ${rec.played} משחקים</span>
          <span class="best">${rec.best != null ? formatTime(rec.best) : '—'}</span>
        </div>`;
      });
    });
    el.statsTable.innerHTML = html;
  }

  /* --------------------------------------------------------------------- */
  /* מקלדת (דסקטופ)                                                         */
  /* --------------------------------------------------------------------- */

  document.addEventListener('keydown', (e) => {
    const g = state.game;
    if (!g || state.generating) return;
    // e.target עשוי להיות document (כשאין אלמנט ממוקד) — ואז אין closest
    const t = e.target;
    if (t && typeof t.closest === 'function' && t.closest('input, textarea')) return;
    if (state.paused) return;

    const N = g.spec.N;
    const spec = g.spec;

    // ניווט בחצים
    const moves = {
      ArrowUp: -N,
      ArrowDown: N,
      ArrowLeft: -1,
      ArrowRight: 1,
    };
    if (moves[e.key] !== undefined) {
      e.preventDefault();
      let i = state.selected < 0 ? 0 : state.selected;
      const r = spec.rowOf[i];
      const c = spec.colOf[i];
      if (e.key === 'ArrowLeft' && c === 0) return;
      if (e.key === 'ArrowRight' && c === N - 1) return;
      if (e.key === 'ArrowUp' && r === 0) return;
      if (e.key === 'ArrowDown' && r === N - 1) return;
      selectCell(state.selected < 0 ? 0 : i + moves[e.key]);
      return;
    }

    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      e.preventDefault();
      eraseSelected();
      return;
    }

    if (e.key === 'n' || e.key === 'N') {
      state.notesMode = !state.notesMode;
      updateNotesButton();
      updateNumpad();
      return;
    }

    if (e.key === 'h' || e.key === 'H') {
      doHint();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      const btn = el.tools.querySelector(
        e.shiftKey ? '[data-action="redo"]' : '[data-action="undo"]'
      );
      btn.click();
      return;
    }

    // ספרות 1-9
    if (/^[1-9]$/.test(e.key)) {
      enterValue(Number(e.key));
      return;
    }

    // אותיות A-G לערכים 10-16 (רק בלוח המורחב)
    if (N > 9 && /^[a-gA-G]$/.test(e.key)) {
      enterValue(e.key.toUpperCase().charCodeAt(0) - 65 + 10);
    }
  });

  /* --------------------------------------------------------------------- */
  /* אתחול                                                                  */
  /* --------------------------------------------------------------------- */

  function init() {
    applyTheme();
    spawnConfetti();

    const size = state.prefs.size === 16 ? 16 : 9;
    // setActiveSize יטען משחק שמור אם קיים, אחרת ייצור חדש
    setActiveSize(size);

    if (!Storage.isAvailable()) {
      setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
    }
  }

  init();
})();
