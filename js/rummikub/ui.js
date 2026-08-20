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
  const H = window.Haptics;
  const M = window.UIMath;

  const $ = (s) => document.querySelector(s);

  const PREFS_KEY = 'rummikub.v1.prefs';
  const SAVE_KEY = 'rummikub.v1.save';
  const STATS_KEY = 'rummikub.v1.stats';

  // מספיק זמן כדי לראות שהיריב "חושב" ואז לקרוא מה הוא עשה. קצר מדי
  // והמהלך פשוט קורה בלי שמבחינים בו — זו בדיוק הייתה התחושה שאין יריב
  const AI_THINK = 900;
  const AI_READ = 550; // שהות אחרי המהלך, כדי להספיק לראות את האבנים שהונחו

  /*
   * ליריבים יש שם וצבע קבועים לפי המושב. שם אמיתי הופך את השורה שלמעלה
   * ממונה אבנים למישהו שיושב מולך.
   *
   * f מסמן לשון נקבה. בעברית אין דרך לכתוב "הניח" בלי להתחייב למגדר,
   * ולכן כל ניסוח שמדבר על יריב עובר דרך verbs() ולא נכתב ישירות
   */
  const OPPONENTS = [
    null,
    { name: 'דנה', color: '#e05f6a', f: true },
    { name: 'יוסי', color: '#4a90d9', f: false },
    { name: 'מיכל', color: '#3fa66c', f: true },
  ];
  const oppInfo = (p) => OPPONENTS[p] || { name: 'יריב ' + p, color: '#888', f: false };

  /** צורות הפועל המתאימות ליריב מסוים. */
  function verbs(p) {
    const f = oppInfo(p).f;
    return {
      thinking: f ? 'חושבת' : 'חושב',
      placed: f ? 'הניחה' : 'הניח',
      drew: f ? 'משכה אבן' : 'משך אבן',
      leftHim: f ? 'נשארו לה' : 'נשארו לו',
      cannot: f ? 'לא יכולה לשחק' : 'לא יכול לשחק',
      finishedFirst: f ? 'סיימה ראשונה' : 'סיים ראשון',
    };
  }

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
    aiLevel: 'normal',
    tidySets: true,
    jokerHints: true,
    haptics: true,
    /*
     * חוק בית. ברירת המחדל של המנוע היא החוק הרשמי, אבל ברירת המחדל
     * *כאן* היא כבוי — כך משחקים בבית הזה. מי שרוצה את החוק הרשמי
     * מדליק אותו בהגדרות
     */
    jokerLock: false,
    turnTimer: 0, // שניות; 0 = ללא
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
    optAiLevel: $('#optAiLevel'),
    optTurnTimer: $('#optTurnTimer'),
    statTimerBox: $('#statTimerBox'),
    statTimer: $('#statTimer'),
    logModal: $('#logModal'),
    logList: $('#logList'),
    btnLog: $('#btnLog'),
    logDot: $('#logDot'),
    jokerTip: $('#jokerTip'),
    optHaptics: $('#optHaptics'),
    optJokerLock: $('#optJokerLock'),
    hapticsNote: $('#hapticsNote'),
    helpModal: $('#helpModal'),
    btnHelp: $('#btnHelp'),
    statsModal: $('#statsModal'),
    statsTable: $('#statsTable'),
    btnStats: $('#btnStats'),
    btnClearStats: $('#btnClearStats'),
    confirmModal: $('#confirmModal'),
    confirmText: $('#confirmText'),
    btnConfirmOk: $('#btnConfirmOk'),
    btnTheme: $('#btnTheme'),
    btnNew: $('#btnNew'),
  };

  /* --------------------------------------------------------------------- */
  /* עזרים                                                                  */
  /* --------------------------------------------------------------------- */

  // מה כל יריב עשה בתורו האחרון — נשאר על המסך עד התור הבא שלו
  const lastMove = [];
  let thinkingFor = -1; // מושב היריב שכרגע "חושב", או 1-
  let lastActor = -1; // מי שיחק אחרון, כדי להציג מה קרה גם אחרי החשיבה
  let justPlayed = []; // אבנים שיריב הרגע הניח, לצורך הבהוב על השולחן

  /* יומן המהלכים — החדש ביותר בסוף המערך */
  let moveLog = [];
  let logUnread = 0;
  const LOG_MAX = 60;

  /* טיימר התור */
  let timerLeft = 0;
  let timerId = null;


  /*
   * כל טוסט נאמר גם לקורא מסך. הטוסט עצמו hidden כשאין מה להציג, ולכן
   * אינו בעץ הנגישות — ההכרזה עוברת באזור חי נפרד. ראו js/announce.js
   */
  const say = (msg, loud) => { if (window.Announce) window.Announce.say(msg, loud); };

  let toastTimer = null;
  function toast(msg) {
    say(msg);
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2400);
  }

  /* ------------------------- סידור צירופים ------------------------------ */

  /*
   * מסדר כל צירוף חוקי על השולחן לסדר הטבעי שלו. צירוף שעדיין לא חוקי
   * נשאר בדיוק כמו שהוא — באמצע התור השחקן בונה משהו, ואסור לקפוץ לו
   * על הידיים באמצע.
   */
  function tidy(table) {
    return state.prefs.tidySets ? T.orderTable(table) : table;
  }

  /* --------------------------- לקיחת ג'וקר -------------------------------- */

  /*
   * המהלך הכי חזק ברמי קוב, וגם זה שהכי קל לפספס: אם יש לך ביד בדיוק את
   * האבן שג'וקר על השולחן מייצג, מותר להחליף ולקחת את הג'וקר — ובלבד
   * שתשלב אותו מיד בצירוף אחר.
   *
   * אף אחד לא סורק את השולחן ידנית כדי לגלות את זה, ולכן הממשק מסמן.
   *
   * @returns {Array<{setIndex:number, jokerAt:number, rackIndex:number, tile:number}>}
   */
  function jokerChances() {
    const out = [];
    state.workTable.forEach((set, si) => {
      if (!set.some(T.isJoker)) return;
      const options = T.jokerSubstitutes(set);
      if (!options.length) return;

      // options[n] מתאר את הג'וקר ה-n בצירוף, לפי סדר הופעתו
      const jokerPositions = [];
      set.forEach((t, i) => { if (T.isJoker(t)) jokerPositions.push(i); });

      const taken = new Set();
      options.forEach((choices, nth) => {
        for (const want of choices) {
          const ri = state.workRack.findIndex((t, i) =>
            !taken.has(i) && !T.isJoker(t) &&
            T.tileColorIndex(t) === want.color && T.tileNumber(t) === want.number);
          if (ri < 0) continue;
          taken.add(ri);
          out.push({
            setIndex: si,
            jokerAt: jokerPositions[nth],
            rackIndex: ri,
            tile: state.workRack[ri],
          });
          break;
        }
      });
    });
    return out;
  }

  function renderJokerTip() {
    if (!chances.length) {
      el.jokerTip.hidden = true;
      return;
    }
    const c = chances[0];
    el.jokerTip.hidden = false;
    el.jokerTip.textContent = chances.length > 1
      ? 'יש לך אבנים שמחליפות ' + chances.length + " ג'וקרים על השולחן — החלף וקח אותם"
      : 'יש לך ' + tileText(c.tile) + " — אפשר להחליף בו את הג'וקר ולקחת אותו";
  }

  /* ---------------------------- יומן ------------------------------------ */

  /** "אבן אחת" ולא "1 אבן" — זה ההבדל בין טקסט מתורגם לטקסט כתוב. */
  const tileCount = (n) => (n === 1 ? 'אבן אחת' : n + ' אבנים');

  /** תיאור אבן בעברית, לצורך היומן. */
  function tileText(tile) {
    return T.isJoker(tile)
      ? "ג'וקר"
      : T.tileNumber(tile) + ' ' + T.COLOR_LABEL[T.tileColor(tile)];
  }

  /**
   * מוסיף שורה ליומן.
   * @param {number} p מושב השחקן, 0 = אני
   * @param {string} text מה קרה
   * @param {number[]} [tiles] אבנים לפירוט
   */
  function logMove(p, text, tiles) {
    moveLog.push({
      p,
      text,
      tiles: tiles && tiles.length ? tiles.slice() : null,
      turn: state.game ? state.game.moves : 0,
    });
    if (moveLog.length > LOG_MAX) moveLog.splice(0, moveLog.length - LOG_MAX);
    if (p !== 0) {
      logUnread++;
      el.logDot.hidden = false;
    }
    saveLog();
  }

  const saveLog = () =>
    store.write(SAVE_KEY + '.log', { entries: moveLog, unread: logUnread });

  function loadLog() {
    const d = store.read(SAVE_KEY + '.log', null);
    if (!d || !Array.isArray(d.entries)) return;
    moveLog = d.entries;
    logUnread = d.unread || 0;
    el.logDot.hidden = !logUnread;
  }

  function renderLog() {
    el.logList.textContent = '';
    if (!moveLog.length) {
      const li = document.createElement('li');
      li.className = 'log-empty';
      li.textContent = 'עוד לא קרה כלום. התחל לשחק.';
      el.logList.appendChild(li);
      return;
    }
    // מהאחרון לראשון — מה שקרה עכשיו הוא מה שמעניין
    for (let i = moveLog.length - 1; i >= 0; i--) {
      const entry = moveLog[i];
      const who = entry.p === 0 ? { name: 'אני', color: 'var(--accent)' } : oppInfo(entry.p);

      const li = document.createElement('li');
      li.className = 'log-row' + (entry.p === 0 ? ' is-me' : '');
      li.style.setProperty('--opp-color', who.color);

      const av = document.createElement('span');
      av.className = 'log-av';
      av.textContent = who.name.charAt(0);

      const body = document.createElement('span');
      body.className = 'log-body';

      const head = document.createElement('span');
      head.className = 'log-head';
      head.textContent = who.name + ' ' + entry.text;
      body.appendChild(head);

      if (entry.tiles) {
        const tiles = document.createElement('span');
        tiles.className = 'log-tiles';
        // האבנים עצמן לעין, ותיאור מילולי אחד לקורא מסך במקום 5 תוויות
        tiles.setAttribute('aria-label', entry.tiles.map(tileText).join(', '));
        entry.tiles.forEach((t) => {
          const chip = makeTileEl(t, 'is-mini');
          chip.setAttribute('aria-hidden', 'true');
          chip.removeAttribute('aria-label');
          tiles.appendChild(chip);
        });
        body.appendChild(tiles);
      }

      li.appendChild(av);
      li.appendChild(body);
      el.logList.appendChild(li);
    }
  }

  /* --------------------------- טיימר התור -------------------------------- */

  /*
   * הטיימר רץ רק בתור שלי. היריבים משחקים בתוך שנייה וחצי ממילא, ושעון
   * שרץ עליהם היה רק רעש על המסך.
   */
  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
    el.statTimerBox.hidden = !state.prefs.turnTimer;
    if (!state.prefs.turnTimer) el.statTimer.textContent = '—';
  }

  function startTimer() {
    stopTimer();
    const total = Number(state.prefs.turnTimer) || 0;
    if (!total || !myTurn()) return;

    timerLeft = total;
    el.statTimerBox.hidden = false;
    paintTimer();
    let warned = false;
    timerId = setInterval(() => {
      timerLeft--;
      paintTimer();
      // פעם אחת בלבד, ברגע המעבר — לא בכל שנייה מכאן ואילך
      if (!warned && timerLeft === 10) { warned = true; feel('warn'); }
      if (timerLeft <= 0) {
        stopTimer();
        timeUp();
      }
    }, 1000);
  }

  function paintTimer() {
    const m = Math.floor(timerLeft / 60);
    const sec = timerLeft % 60;
    el.statTimer.textContent = m > 0
      ? m + ':' + String(sec).padStart(2, '0')
      : String(Math.max(0, timerLeft));
    el.statTimerBox.classList.toggle('is-warn', timerLeft <= 10 && timerLeft > 0);
  }

  /*
   * נגמר הזמן. החוק הרשמי: מחזירים את השולחן למצב שהיה, לוקחים בחזרה את
   * האבנים שהונחו, ומושכים שלוש אבנים כקנס. זה חמור בכוונה — בלי קנס
   * אמיתי הטיימר הוא רק קישוט
   */
  const TIME_PENALTY = 3;

  function timeUp() {
    if (!myTurn()) return;
    const had = state.freshTiles.length;
    if (had) resetTurn();

    const g = state.game;

    /*
     * הקנס הוא שלוש אבנים, אבל drawTile מושך אחת *ומעביר את התור*. לכן
     * שתי אבני הקנס הראשונות נלקחות ישירות, והשלישית עוברת דרך forceDraw
     * שגם מסיים את התור וגם מטפל בבריכה ריקה
     */
    const drawn = [];
    while (drawn.length < TIME_PENALTY - 1 && g.poolCount() > 1) {
      const tile = g.pool.pop();
      g.racks[0].push(tile);
      drawn.push(tile);
    }

    toast(had
      ? 'נגמר הזמן — האבנים חזרו למגש, וקנס של ' + tileCount(TIME_PENALTY)
      : 'נגמר הזמן — קנס של ' + tileCount(TIME_PENALTY));

    // שורת יומן אחת לכל הקנס, כולל האבן שנמשכת בסיום התור
    // ביומן השם מופיע לפני הטקסט, ולכן זו חייבת להיות צורת פועל
    forceDraw({ text: 'חרגתי מהזמן — קנס של ' + tileCount(TIME_PENALTY), tiles: drawn });
  }

  /* ניהול הפוקוס יושב ב-js/modal.js — ראו שם למה זה לא רק hidden */
  const openModal = (n) => window.Modal.open(n);
  const closeModal = (n) => window.Modal.close(n);

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

  /* ההזדמנויות מחושבות פעם אחת לציור ומשותפות לשולחן ולמגש */
  let chances = [];

  /* --------------------------- תנועת אבנים ------------------------------ */

  /*
   * הציור בונה את השולחן והמגש מחדש בכל פעם, ולכן אבן שזזה פשוט נעלמת
   * ממקום אחד ומופיעה באחר. הטכניקה כאן היא FLIP: מודדים איפה כל אבן
   * הייתה *לפני* הציור, מודדים איפה היא נמצאת *אחרי*, ומנפישים מההפרש
   * לאפס. האבן אף פעם לא באמת זזה — היא רק מתחילה מוסטת ומיישרת את
   * עצמה, וזה זול מספיק גם לשולחן מלא.
   *
   * המפתח כולל מונה הופעה, כי שני הג'וקרים חולקים אותו מזהה אבן.
   */
  const reducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const MOVE_MS = 240;

  function tileKeys() {
    const seen = Object.create(null);
    const out = [];
    collect(el.table, 'table');
    collect(el.rack, 'rack');
    function collect(zone, name) {
      const box = zone.getBoundingClientRect();
      zone.querySelectorAll('.tile').forEach((node) => {
        const id = node.dataset.tile;
        seen[id] = (seen[id] || 0) + 1;
        const r = node.getBoundingClientRect();
        out.push({
          node,
          key: id + '#' + seen[id],
          zone: name,
          // מיקום ביחס ל*תוכן* האזור: גם לא מול המסך וגם לא מושפע מגלילה
          x: r.left - box.left + zone.scrollLeft,
          y: r.top - box.top + zone.scrollTop,
          // ובנוסף המיקום המוחלט, למעבר בין אזורים
          sx: r.left,
          sy: r.top,
        });
      });
    }
    return out;
  }

  /** איפה כל אבן יושבת עכשיו, לפני שהציור מוחק אותה. */
  function captureTiles() {
    if (reducedMotion) return null;
    const map = new Map();
    for (const item of tileKeys()) map.set(item.key, item);
    return map;
  }

  /**
   * מנפיש כל אבן מהמקום שבו הייתה למקום שבו היא עכשיו.
   *
   * המדידה היא ביחס לאזור (השולחן או המגש) ולא ביחס למסך, וזה לא פרט
   * טכני: כשגובה המגש משתנה כל השולחן זז כמה פיקסלים, ובמדידה מול המסך
   * *כל* אבן על השולחן הייתה מונפשת בלי שזזה באמת. מדדתי — 15 אבנים
   * שולחן שכולן זזות בדיוק אותו הפרש. זה רעש, לא תנועה.
   *
   * אבן שעברה בין אזורים היא המקרה ההפוך: שם דווקא ההפרש על המסך הוא
   * הנכון, כי שני האזורים שונים.
   */
  function glideTiles(before) {
    if (!before) return;
    const fresh = before.size > 0;

    for (const item of tileKeys()) {
      const prev = before.get(item.key);

      if (!prev) {
        // אבן חדשה על המסך — נכנסת בהתרחבות קצרה במקום להופיע פתאום
        if (fresh) {
          item.node.animate(
            [{ opacity: 0, transform: 'scale(.72)' }, { opacity: 1, transform: 'none' }],
            { duration: 180, easing: 'cubic-bezier(.2,.9,.3,1)' }
          );
        }
        continue;
      }

      const d = M.flipDelta(prev, item);
      if (!d.moved) continue;

      item.node.animate(
        [{ transform: 'translate(' + d.dx + 'px,' + d.dy + 'px)' }, { transform: 'none' }],
        { duration: MOVE_MS, easing: 'cubic-bezier(.2,.8,.25,1)' }
      );
    }
  }

  function render() {
    const before = captureTiles();
    /*
     * הסימון מדבר על החלפת ג'וקר, וזה מהלך שקיים רק כשחוק הנעילה דלוק.
     * כשהוא כבוי הג'וקר זז חופשי ואין מה "לנצל"
     */
    chances = state.prefs.jokerHints && state.prefs.jokerLock && myTurn()
      ? jokerChances() : [];
    renderOpponents();
    renderTable();
    renderRack();
    renderJokerTip();
    updateStatus();
    glideTiles(before);
    if (typeof paintCursor === 'function') paintCursor();
  }

  function renderOpponents() {
    const g = state.game;
    el.opponents.textContent = '';
    for (let p = 1; p < g.playerCount; p++) {
      const info = oppInfo(p);
      const thinking = thinkingFor === p;

      const d = document.createElement('div');
      d.className = 'opp'
        + (g.turn === p ? ' is-turn' : '')
        + (thinking ? ' is-thinking' : '');
      d.style.setProperty('--opp-color', info.color);

      const av = document.createElement('span');
      av.className = 'opp-av';
      av.textContent = info.name.charAt(0);
      d.appendChild(av);

      const main = document.createElement('span');
      main.className = 'opp-main';

      const name = document.createElement('span');
      name.className = 'opp-name';
      name.textContent = info.name;
      if (g.melded[p]) {
        const badge = document.createElement('span');
        badge.className = 'opp-melded';
        badge.textContent = 'פתח';
        name.appendChild(badge);
      }
      main.appendChild(name);

      const move = document.createElement('span');
      move.className = 'opp-move';
      if (thinking) {
        move.classList.add('is-dots');
        move.setAttribute('aria-label', 'חושב');
        for (let i = 0; i < 3; i++) move.appendChild(document.createElement('i'));
      } else {
        move.textContent = lastMove[p] || '';
      }
      main.appendChild(move);
      d.appendChild(main);

      const right = document.createElement('span');
      right.className = 'opp-count';
      right.textContent = g.racks[p].length;
      const unit = document.createElement('small');
      unit.textContent = 'אבנים';
      right.appendChild(unit);
      d.appendChild(right);

      el.opponents.appendChild(d);
    }
  }

  function renderTable() {
    el.table.textContent = '';
    const mark = state.prefs.markInvalid;
    const hotJoker = new Set(chances.map((c) => c.setIndex + ':' + c.jokerAt));

    state.workTable.forEach((set, si) => {
      const box = document.createElement('div');
      box.className = 'set';
      if (mark && !T.isValidSet(set)) box.classList.add('is-invalid');
      box.dataset.set = String(si);

      set.forEach((tile, ti) => {
        const fresh = state.freshTiles.includes(tile);
        let cls = fresh ? 'is-fresh' : '';
        if (justPlayed.includes(tile)) cls += ' is-played';
        if (hotJoker.has(si + ':' + ti)) cls += ' can-take';
        const t = makeTileEl(tile, cls);
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
    const swap = new Set(chances.map((c) => c.rackIndex));
    state.workRack.forEach((tile, i) => {
      const t = makeTileEl(tile, swap.has(i) ? 'can-swap' : '');
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
    undo.disabled = busy || !undoStack.length;
    draw.disabled = busy;

    el.footerInfo.textContent = state.aiRunning
      ? (thinkingFor > 0
          ? oppInfo(thinkingFor).name + ' ' + verbs(thinkingFor).thinking + '…'
          : lastActor > 0
            ? oppInfo(lastActor).name + ': ' + (lastMove[lastActor] || '')
            : 'תור היריב…')
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
  /* הזזת אבנים — מקור, יעד, וביטול צעד                                     */
  /* --------------------------------------------------------------------- */

  /*
   * מחסנית ביטול בתוך התור. כל שינוי דוחף צילום, וכך "בטל" מחזיר צעד
   * אחד אחורה במקום לאפס את כל התור — זה ההבדל בין ממשק שנוח לתקן בו
   * טעות לבין ממשק שמעניש עליה.
   */
  const undoStack = [];

  function pushUndo() {
    undoStack.push({
      table: state.workTable.map((x) => x.slice()),
      rack: state.workRack.slice(),
      fresh: state.freshTiles.slice(),
    });
    if (undoStack.length > 120) undoStack.shift();
  }

  function popUndo() {
    const snap = undoStack.pop();
    if (!snap) return false;
    state.workTable = snap.table;
    state.workRack = snap.rack;
    state.freshTiles = snap.fresh;
    clearSelection();
    return true;
  }

  function isSelected(from, setIndex, tileIndex) {
    const sel = state.selection;
    return !!sel && sel.from === from && sel.setIndex === setIndex && sel.tileIndex === tileIndex;
  }

  const clearSelection = () => { state.selection = null; };

  /** רטט קצר — המשוב שגורם להנחה להרגיש פיזית. */
  /** רעידה קצרה על אלמנט — משוב דחייה שלא תלוי ברטט. */
  function shake(node) {
    if (!node || reducedMotion) return;
    node.animate(
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-6px)' },
        { transform: 'translateX(5px)' },
        { transform: 'translateX(-3px)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 260, easing: 'ease-out' }
    );
  }

  /** משוב מישושי. עובר דרך המודול המשותף, ומכבד את ההגדרה. */
  function feel(name) {
    if (state.prefs.haptics) H.fire(name);
  }

  /**
   * מבצע העברת אבן ממקור ליעד. זו הנקודה היחידה שמשנה את מצב העבודה,
   * ולכן הקשה וגרירה מתנהגות בדיוק אותו הדבר.
   *
   * @param {{from:string,setIndex:number,tileIndex:number,tile:number}} src
   * @param {{kind:string,setIndex:number,insertAt:number}} dst
   * @returns {boolean}
   */
  function applyMove(src, dst) {
    if (!src || !dst) return false;

    // החזרה למגש מותרת רק לאבנים שהנחנו בתור הזה
    if (dst.kind === 'rack' && src.from === 'table' && !state.freshTiles.includes(src.tile)) {
      toast('אפשר להחזיר רק אבנים שהנחת בתור הזה');
      return false;
    }
    // הזזה בדיוק למקום שממנו באנו אינה שינוי
    if (dst.kind === 'set' && src.from === 'table' && dst.setIndex === src.setIndex) {
      const at = dst.insertAt;
      if (at === src.tileIndex || at === src.tileIndex + 1) return false;
    }

    pushUndo();

    /* --- הסרה מהמקור --- */
    let removedSet = -1;
    if (src.from === 'rack') {
      state.workRack.splice(src.tileIndex, 1);
    } else {
      const set = state.workTable[src.setIndex];
      set.splice(src.tileIndex, 1);
      if (!set.length) {
        state.workTable.splice(src.setIndex, 1);
        removedSet = src.setIndex;
      }
    }

    /* --- הכנסה ליעד --- */
    if (dst.kind === 'rack') {
      const at = dst.insertAt == null ? state.workRack.length : dst.insertAt;
      state.workRack.splice(Math.min(at, state.workRack.length), 0, src.tile);
      const fi = state.freshTiles.indexOf(src.tile);
      if (fi >= 0) state.freshTiles.splice(fi, 1);
    } else if (dst.kind === 'new') {
      state.workTable.push([src.tile]);
      if (src.from === 'rack') state.freshTiles.push(src.tile);
    } else {
      // מחיקת צירוף המקור מזיזה אחורה כל מה שאחריו
      let idx = dst.setIndex;
      if (removedSet >= 0 && removedSet < idx) idx--;
      const set = state.workTable[idx];
      if (!set) {
        state.workTable.push([src.tile]);
      } else {
        let at = dst.insertAt == null ? set.length : dst.insertAt;
        // ההסרה מאותו צירוף מזיזה גם את נקודת ההכנסה
        if (src.from === 'table' && idx === src.setIndex && at > src.tileIndex) at--;
        set.splice(Math.min(Math.max(at, 0), set.length), 0, src.tile);
      }
      if (src.from === 'rack') state.freshTiles.push(src.tile);
    }

    /*
     * ברגע שצירוף נהיה חוקי הוא נכנס לסדר מעצמו. זה קורה כאן ולא בזמן
     * הציור, כי הסדר הוא של הנתונים עצמם — אחרת האינדקסים שהגרירה
     * עובדת מולם היו מתייחסים למשהו אחר ממה שרואים
     */
    state.workTable = tidy(state.workTable);

    clearSelection();

    /*
     * שתי תחושות שונות בכוונה: הנחה רגילה היא נקישה קלה, אבל אבן
     * שסגרה צירוף חוקי מקבלת פעימה כפולה. היד יודעת שהצירוף נסגר עוד
     * לפני שהעין הספיקה לבדוק
     */
    const dstSet = state.workTable[dst.setIndex];
    feel(dstSet && T.isValidSet(dstSet) ? 'lock' : 'move');

    render();
    saveDraft();
    return true;
  }

  /** מיקום האבן מתוך אלמנט ה-DOM שלה. */
  function sourceOf(node) {
    if (!node) return null;
    const tile = Number(node.dataset.tile);
    if (node.dataset.rack != null) {
      return { from: 'rack', setIndex: -1, tileIndex: Number(node.dataset.rack), tile };
    }
    return {
      from: 'table',
      setIndex: Number(node.dataset.set),
      tileIndex: Number(node.dataset.index),
      tile,
    };
  }

  /**
   * מזהה לאן האבן תיפול לפי נקודה על המסך, כולל באיזה *מקום* בתוך הצירוף.
   * נקודת ההכנסה נקבעת לפי אמצע כל אבן, כמו בכל עורך שמסדרים בו פריטים.
   */
  function dropTargetAt(x, y) {
    const under = document.elementFromPoint(x, y);
    if (!under) return null;

    if (under.closest('.set-new')) return { kind: 'new' };

    const rackEl = under.closest('#rack');
    if (rackEl) return { kind: 'rack', insertAt: insertIndex(rackEl, x) };

    const setEl = under.closest('.set');
    if (setEl) {
      return {
        kind: 'set',
        setIndex: Number(setEl.dataset.set),
        insertAt: insertIndex(setEl, x),
      };
    }
    // נפילה על השולחן עצמו ולא על צירוף => צירוף חדש
    if (under.closest('#table')) return { kind: 'new' };
    return null;
  }

  /** כמה אבנים נמצאות "לפני" הנקודה. ב-RTL הכיוון הפוך. */
  function insertIndex(container, x) {
    const rects = [...container.querySelectorAll('.tile')]
      .filter((n) => !n.classList.contains('is-dragging'))
      .map((n) => n.getBoundingClientRect());
    return M.insertIndex(rects, x, true);
  }

  /* ------------------------------ הקשה ---------------------------------- */

  function handleTap(node, container) {
    if (!myTurn() || state.aiRunning) return;

    if (node) {
      const src = sourceOf(node);
      if (isSelected(src.from, src.setIndex, src.tileIndex)) {
        clearSelection();
        render();
        return;
      }
      // יש בחירה קודמת => ההקשה הזו היא היעד
      if (state.selection) {
        const sel = state.selection;
        const samePlace = sel.from === src.from && sel.setIndex === src.setIndex;
        if (!samePlace) {
          const dst = src.from === 'rack'
            ? { kind: 'rack', insertAt: src.tileIndex }
            : { kind: 'set', setIndex: src.setIndex, insertAt: src.tileIndex + 1 };
          if (applyMove(sel, dst)) return;
        }
      }
      state.selection = src;
      render();
      return;
    }

    if (!state.selection) return;
    if (container === 'rack') applyMove(state.selection, { kind: 'rack' });
    else { clearSelection(); render(); }
  }

  /* --------------------------------------------------------------------- */
  /* מקלדת                                                                  */
  /* --------------------------------------------------------------------- */

  /*
   * המשחק היה גרירה והקשה בלבד. המקלדת נשענת על **אותו מודל בחירה**
   * שההקשה כבר משתמשת בו — בוחרים אבן, ואז בוחרים יעד — ולכן אין כאן
   * מנגנון שני שצריך להישאר מסונכרן עם הראשון.
   *
   * cursor.zone הוא 'rack' או 'table'. במגש הוא מצביע על אבן, ובשולחן
   * על צירוף שלם, כי זו יחידת היעד.
   */
  const cursor = { zone: 'rack', rack: 0, set: 0, on: false };

  function cursorNode() {
    if (cursor.zone === 'rack') {
      return el.rack.querySelectorAll('.tile')[cursor.rack] || null;
    }
    return el.table.querySelectorAll('.set')[cursor.set] || null;
  }

  function paintCursor() {
    el.rack.querySelectorAll('.is-cursor').forEach((n) => n.classList.remove('is-cursor'));
    el.table.querySelectorAll('.is-cursor').forEach((n) => n.classList.remove('is-cursor'));
    if (!cursor.on) return;
    const node = cursorNode();
    if (node) {
      node.classList.add('is-cursor');
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function moveCursor(delta) {
    if (cursor.zone === 'rack') {
      const n = state.workRack.length;
      if (!n) return;
      // המגש RTL: חץ ימינה הולך לאבן הקודמת
      cursor.rack = (cursor.rack + delta + n) % n;
    } else {
      const n = state.workTable.length;
      if (!n) return;
      cursor.set = (cursor.set + delta + n) % n;
    }
    paintCursor();
  }

  function switchZone(zone) {
    if (zone === 'table' && !state.workTable.length) return;
    cursor.zone = zone;
    cursor.rack = Math.min(cursor.rack, Math.max(0, state.workRack.length - 1));
    cursor.set = Math.min(cursor.set, Math.max(0, state.workTable.length - 1));
    paintCursor();
  }

  /** מה הסמן מצביע עליו, בפורמט שה-applyMove מבין. */
  function cursorSource() {
    if (cursor.zone !== 'rack') return null;
    const tile = state.workRack[cursor.rack];
    if (tile == null) return null;
    return { from: 'rack', setIndex: -1, tileIndex: cursor.rack, tile };
  }

  document.addEventListener('keydown', (e) => {
    if (window.Modal && window.Modal.top()) return;
    if (!myTurn() || state.aiRunning) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;

    const key = e.key;

    if (key === 'Escape') {
      if (state.selection) { clearSelection(); render(); }
      else { cursor.on = false; paintCursor(); }
      return;
    }

    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      e.preventDefault();
      if (!cursor.on) { cursor.on = true; paintCursor(); return; }
      moveCursor(key === 'ArrowRight' ? -1 : 1);
      return;
    }

    if (key === 'ArrowUp' || key === 'ArrowDown') {
      e.preventDefault();
      if (!cursor.on) { cursor.on = true; paintCursor(); return; }
      switchZone(key === 'ArrowUp' ? 'table' : 'rack');
      return;
    }

    if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      if (!cursor.on) { cursor.on = true; paintCursor(); return; }

      if (!state.selection) {
        // בחירה — רק ממגש, כי משם מניחים
        const src = cursorSource();
        if (!src) { toast('בחרו אבן מהמגש'); return; }
        state.selection = src;
        render();
        paintCursor();
        return;
      }

      // הנחה על היעד שהסמן מצביע עליו
      const dst = cursor.zone === 'table'
        ? { kind: 'set', setIndex: cursor.set }
        : { kind: 'rack' };
      applyMove(state.selection, dst);
      paintCursor();
      return;
    }

    /* צירוף חדש */
    if (key === 'n' || key === 'N') {
      e.preventDefault();
      if (state.selection) { applyMove(state.selection, { kind: 'new' }); paintCursor(); }
      return;
    }

    /* קיצורים לפעולות */
    if (key === 'Backspace' || key === 'z' || key === 'Z') {
      e.preventDefault();
      const btn = el.actions.querySelector('[data-action="undo"]');
      if (btn && !btn.disabled) btn.click();
      return;
    }
    if (key === 'd' || key === 'D') {
      e.preventDefault();
      const btn = el.actions.querySelector('[data-action="draw"]');
      if (btn && !btn.disabled) btn.click();
      return;
    }
    if (key === 'c' || key === 'C') {
      e.preventDefault();
      const btn = el.actions.querySelector('[data-action="commit"]');
      if (btn && !btn.disabled) btn.click();
    }
  });

  el.table.addEventListener('click', (e) => {
    if (dragMoved) return; // סוף גרירה אינו הקשה
    if (!myTurn() || state.aiRunning) return;

    if (e.target.closest('.set-new') && state.selection) {
      applyMove(state.selection, { kind: 'new' });
      return;
    }
    const setEl = e.target.closest('.set');
    const tileEl = e.target.closest('.tile');
    if (!tileEl && setEl && state.selection) {
      applyMove(state.selection, { kind: 'set', setIndex: Number(setEl.dataset.set) });
      return;
    }
    handleTap(tileEl, 'table');
  });

  el.rack.addEventListener('click', (e) => {
    if (dragMoved) return;
    handleTap(e.target.closest('.tile'), 'rack');
  });

  /* ------------------------------ גרירה --------------------------------- */

  /*
   * גרירה ממומשת ב-Pointer Events ולא ב-HTML5 drag&drop, שאינו נתמך במגע.
   * האבן המקורית נשארת דהויה במקומה ועותק "עף" עם האצבע, כך שרואים גם
   * מאיפה וגם לאן. סף של 6px מפריד בין גרירה להקשה.
   */
  let dragSrc = null;
  let dragGhost = null;
  let dragMoved = false;
  let dragStart = null;
  const DRAG_THRESHOLD = 6;

  function onPointerDown(e) {
    if (!myTurn() || state.aiRunning) return;
    if (e.button != null && e.button !== 0) return;
    const node = e.target.closest('.tile');
    if (!node) return;

    dragSrc = { node, loc: sourceOf(node) };
    dragStart = { x: e.clientX, y: e.clientY };
    dragMoved = false;
  }

  function onPointerMove(e) {
    if (!dragSrc) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;

    if (!dragMoved) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      dragMoved = true;
      beginGhost(e);
    }
    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
    highlightDrop(e.clientX, e.clientY);
  }

  function beginGhost(e) {
    const rect = dragSrc.node.getBoundingClientRect();
    dragGhost = dragSrc.node.cloneNode(true);
    dragGhost.classList.add('drag-ghost');
    dragGhost.classList.remove('is-selected', 'is-dragging');
    dragGhost.style.width = rect.width + 'px';
    dragGhost.style.height = rect.height + 'px';
    document.body.appendChild(dragGhost);
    dragSrc.node.classList.add('is-dragging');
    clearSelection();
    feel('pick');
    moveGhost(e.clientX, e.clientY);
  }

  function moveGhost(x, y) {
    if (!dragGhost) return;
    dragGhost.style.left = x + 'px';
    dragGhost.style.top = y + 'px';
  }

  /** מסמן את היעד ומצייר קו הכנסה במקום המדויק שאליו האבן תיכנס. */
  function highlightDrop(x, y) {
    document.querySelectorAll('.is-target').forEach((n) => n.classList.remove('is-target'));
    const old = document.querySelector('.drop-caret');
    if (old) old.remove();

    const dst = dropTargetAt(x, y);
    if (!dst) return;

    if (dst.kind === 'new') {
      const slot = document.querySelector('.set-new');
      if (slot) slot.classList.add('is-target');
      return;
    }

    const host = dst.kind === 'rack'
      ? el.rack
      : el.table.querySelector('.set[data-set="' + dst.setIndex + '"]');
    if (!host) return;
    host.classList.add('is-target');

    const mark = document.createElement('div');
    mark.className = 'drop-caret';
    const tiles = [...host.querySelectorAll('.tile')].filter(
      (n) => !n.classList.contains('is-dragging')
    );
    const before = tiles[dst.insertAt];
    if (before) host.insertBefore(mark, before);
    else host.appendChild(mark);
  }

  function onPointerUp(e) {
    if (!dragSrc) return;
    const src = dragSrc.loc;
    const wasDrag = dragMoved;

    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
    dragSrc.node.classList.remove('is-dragging');
    document.querySelectorAll('.is-target').forEach((n) => n.classList.remove('is-target'));
    const caret = document.querySelector('.drop-caret');
    if (caret) caret.remove();
    dragSrc = null;

    if (!wasDrag) return; // הקשה רגילה — ה-click יטפל

    const dst = dropTargetAt(e.clientX, e.clientY);
    if (dst) applyMove(src, dst);
    else render();

    // מונע מה-click שאחרי השחרור להיחשב כבחירה
    setTimeout(() => { dragMoved = false; }, 0);
  }

  [el.table, el.rack].forEach((zone) => {
    zone.addEventListener('pointerdown', onPointerDown);
  });
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);

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
    undoStack.length = 0;
    state.workTable = tidy(state.game.snapshotTable());
    state.workRack = state.game.currentRack.slice();
    state.freshTiles = [];
    clearSelection();
    render();
    startTimer();
  }

  function resetTurn() {
    beginTurn();
    saveDraft();
  }

  function commitTurn() {
    const g = state.game;
    const res = g.commitTurn(state.workTable, state.workRack);

    if (!res.ok) {
      feel('reject');
      toast(commitError(res));

      // מסמנים את הצירוף הבעייתי
      if (res.reason === 'invalid-set' && res.badIndex >= 0) {
        const box = el.table.children[res.badIndex];
        if (box) box.classList.add('is-invalid');
      }
      /*
       * הרעידה היא לא קישוט: באייפון הרטט עשוי לא לעבוד בכלל, ואז זה
       * כל מה שמסמן שהמהלך נדחה חוץ מהטוסט
       */
      shake(res.reason === 'invalid-set' && res.badIndex >= 0
        ? el.table.children[res.badIndex]
        : el.actions.querySelector('[data-action="commit"]'));
      return;
    }

    stopTimer();
    logMove(0, 'הנחתי ' + tileCount(state.freshTiles.length), state.freshTiles);

    g.table = tidy(g.table);
    state.workTable = g.snapshotTable();
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
      case 'joker-locked':
        return "אי אפשר לפרק צירוף שיש בו ג'וקר. אפשר רק להוסיף לו — או להחליף "
          + "את הג'וקר באבן שהוא מייצג";
      case 'joker-to-rack':
        return "ג'וקר שלקחת מהשולחן חייב לחזור לשולחן באותו תור, לא למגש";
      case 'tiles-mismatch': return 'משהו השתבש בספירת האבנים';
      default: return 'לא ניתן לסיים את התור';
    }
  }

  function drawAndPass() {
    if (state.freshTiles.length) {
      confirmAction('משיכה תחזיר את כל מה שהנחת בתור הזה. להמשיך?', () => {
        resetTurn();
        forceDraw();
      });
      return;
    }
    forceDraw();
  }

  /**
   * משיכה בפועל, בלי לשאול. משמש גם כשנגמר הזמן.
   *
   * @param {{text:string, tiles:number[]}} [penalty] כשהמשיכה היא חלק
   *   מקנס זמן, כדי שהיומן יראה שורה אחת נכונה ולא שתיים חלקיות
   */
  function forceDraw(penalty) {
    const g = state.game;
    stopTimer();

    const d = g.drawTile();
    feel('draw');
    if (penalty) {
      const all = penalty.tiles.concat(d.tile != null ? [d.tile] : []);
      logMove(0, penalty.text, all);
    } else {
      logMove(0, d.empty ? 'לא משכתי — הבריכה ריקה' : 'משכתי אבן',
        d.tile != null ? [d.tile] : null);
    }
    if (d.stalemate) { saveGame(); return endGame(); }
    if (d.empty) toast('הבריכה ריקה — התור עובר');
    if (state.prefs.autoSort) {
      g.racks[0].sort((a, b) => {
        const na = T.isJoker(a) ? 99 : T.tileNumber(a);
        const nb = T.isJoker(b) ? 99 : T.tileNumber(b);
        return na - nb || T.tileColorIndex(a) - T.tileColorIndex(b);
      });
    }
    /*
     * המשיכה כבר העבירה את התור, ולכן currentRack הוא כבר של היריב.
     * בלי העדכון הזה מונה "ביד" היה מציג את המצב שלפני המשיכה עד שהתור
     * חוזר אליי — האבן שנמשכה פשוט לא נראתה
     */
    state.workRack = g.racks[0].slice();

    saveGame();
    render();
    runOpponents();
  }

  /** מריץ את תורות היריבים אחד אחרי השני, עם השהיה. */
  function runOpponents() {
    const g = state.game;
    if (g.finished) return endGame();
    if (g.turn === 0) { beginTurn(); return; }

    const who = g.turn;
    state.aiRunning = true;
    thinkingFor = who;
    lastMove[who] = '';
    justPlayed = [];
    updateStatus();
    renderOpponents();

    setTimeout(() => {
      if (!state.game || state.game !== g) return;
      const before = g.racks[who].length;
      const result = AI.playTurn(g, state.prefs.aiLevel);
      const name = oppInfo(who).name;

      const v = verbs(who);
      thinkingFor = -1;
      lastActor = who;
      justPlayed = result.action === 'meld' ? result.placed.slice() : [];
      lastMove[who] = result.action === 'meld'
        ? v.placed + ' ' + tileCount(result.placed.length)
        : v.drew;

      g.table = tidy(g.table);
      state.workTable = g.snapshotTable();

      if (result.action === 'meld') {
        logMove(who, v.placed + ' ' + tileCount(result.placed.length), result.placed);
      } else {
        logMove(who, before === g.racks[who].length
          ? v.cannot + ' — הבריכה ריקה' : v.drew,
          result.tile != null ? [result.tile] : null);
      }

      render();
      saveGame();
      feel('opponent');

      if (result.action === 'meld') {
        toast(name + ' ' + v.placed + ' ' + tileCount(result.placed.length)
          + ' · ' + v.leftHim + ' ' + g.racks[who].length);
      } else if (before === g.racks[who].length) {
        toast(name + ' ' + v.cannot + ' — הבריכה ריקה');
      }

      // ההבהוב מתפוגג לבד, בלי לצייר מחדש את כל השולחן
      setTimeout(() => {
        justPlayed = [];
        el.table.querySelectorAll('.tile.is-played')
          .forEach((t) => t.classList.remove('is-played'));
      }, 1800);

      if (g.finished) { state.aiRunning = false; return endGame(); }
      setTimeout(() => {
        if (!state.game || state.game !== g) return;
        if (g.turn === 0) {
          state.aiRunning = false;
          beginTurn();
          updateStatus();
        } else {
          runOpponents();
        }
      }, AI_READ);
    }, AI_THINK);
  }

  /* --------------------------------------------------------------------- */
  /* סוף משחק                                                               */
  /* --------------------------------------------------------------------- */

  function endGame() {
    const g = state.game;
    state.aiRunning = false;
    stopTimer();
    say(g.winner === 0 ? 'ניצחת!' : oppInfo(g.winner).name + ' ' + verbs(g.winner).finishedFirst, true);
    feel(g.winner === 0 ? 'win' : 'reject');
    logMove(g.winner === 0 ? 0 : g.winner,
      g.winner === 0 ? 'סיימתי ראשון — ניצחתי' : verbs(g.winner).finishedFirst);
    const scores = g.finalScores();
    const iWon = g.winner === 0;

    const stats = readStats();
    stats.played += 1;
    if (iWon) stats.won += 1;
    if (scores[0] > (stats.best || 0)) stats.best = scores[0];

    /*
     * צבירה לצורך ממוצע, ורצף הניצחונות הנוכחי. בלי הצבירה "ממוצע" היה
     * ניחוש, ובלי הרצף אין שום מדד שמתאפס — וזה מה שגורם למשחק הבא
     * להיות מעניין
     */
    stats.totalScore = (stats.totalScore || 0) + scores[0];
    stats.streak = iWon ? (stats.streak || 0) + 1 : 0;
    if ((stats.streak || 0) > (stats.bestStreak || 0)) stats.bestStreak = stats.streak;

    store.write(STATS_KEY, stats);

    el.overTitle.textContent = iWon ? 'ניצחת!' : 'המשחק נגמר';
    el.overSub.textContent = iWon
      ? 'רוקנת את המגש'
      : oppInfo(g.winner).name + ' ' + verbs(g.winner).finishedFirst;

    el.overStats.innerHTML = scores.map((sc, i) => `
      <div class="win-stat${i === g.winner ? ' is-best' : ''}">
        <span class="k">${i === 0 ? 'אתה' : oppInfo(i).name}${i === g.winner ? ' 🏆' : ''}</span>
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
      case 'undo':
        if (popUndo()) { render(); saveDraft(); }
        else toast('אין מה לבטל');
        break;
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
    lastMove.length = 0;
    thinkingFor = -1;
    lastActor = -1;
    moveLog = [];
    logUnread = 0;
    el.logDot.hidden = true;
    saveLog();
    stopTimer();
    justPlayed = [];
    state.game = new Rummikub({
      players: Number(state.prefs.players) || 2,
      rules: { jokerLock: !!state.prefs.jokerLock },
    });
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

  /* --------------------------------------------------------------------- */
  /* סטטיסטיקות                                                             */
  /* --------------------------------------------------------------------- */

  const readStats = () => store.read(STATS_KEY, {
    played: 0, won: 0, best: 0, totalScore: 0, streak: 0, bestStreak: 0,
  });

  function renderStats() {
    const s = readStats();
    const rate = s.played ? Math.round((s.won / s.played) * 100) : 0;
    const avg = s.played ? Math.round((s.totalScore || 0) / s.played) : 0;

    const rows = [
      ['משחקים', String(s.played || 0)],
      ['ניצחונות', s.played ? s.won + ' (' + rate + '%)' : '0'],
      ['הניקוד הגבוה ביותר', String(s.best || 0)],
      ['ניקוד ממוצע', s.played ? String(avg) : '—'],
      ['רצף ניצחונות נוכחי', String(s.streak || 0)],
      ['הרצף הארוך ביותר', String(s.bestStreak || 0)],
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
    confirmAction('לאפס את כל הסטטיסטיקות? אי אפשר לשחזר.', () => {
      store.remove(STATS_KEY);
      renderStats();
      toast('הנתונים אופסו');
    });
  });


  el.btnLog.addEventListener('click', () => {
    logUnread = 0;
    el.logDot.hidden = true;
    renderLog();
    openModal(el.logModal);
  });

  el.btnSettings.addEventListener('click', () => {
    el.settingsModal.querySelectorAll('[data-pref]').forEach((i) => {
      i.checked = !!state.prefs[i.dataset.pref];
    });
    el.optPlayers.value = String(state.prefs.players);
    el.optAiLevel.value = state.prefs.aiLevel;
    el.optTurnTimer.value = String(state.prefs.turnTimer);

    /*
     * אומרים למשתמש מה באמת קורה במכשיר שלו. באייפון הרטט מגיע מטריק
     * שאפל סגרה ב-iOS 26.5, ועדיף להגיד את זה מאשר להציג מתג שלא עושה
     * כלום
     */
    const mode = H.supported();
    el.hapticsNote.textContent =
      mode === 'vibrate' ? 'משוב מישושי על הנחה, דחייה וסיום'
      : mode === 'ios-switch'
        ? 'באייפון הרטט מוגבל לנקישה אחידה, ובגרסאות iOS חדשות הוא עשוי לא לעבוד כלל'
        : 'הדפדפן הזה אינו מאפשר רטט לדף. המשוב החזותי פועל כרגיל';
    el.optHaptics.disabled = mode === 'none';

    openModal(el.settingsModal);
  });

  el.settingsModal.addEventListener('change', (e) => {
    const input = e.target.closest('[data-pref]');
    if (input) {
      state.prefs[input.dataset.pref] = input.checked;
      savePrefs();
      if (input.dataset.pref === 'haptics') H.setEnabled(input.checked);
      if (input.dataset.pref === 'jokerLock' && state.game) {
        state.game.setRule('jokerLock', input.checked);
        saveGame();
      }
      if (input.dataset.pref === 'tidySets') {
        state.workTable = tidy(state.workTable);
        clearSelection();
      }
      render();
      return;
    }
    if (e.target === el.optTurnTimer) {
      state.prefs.turnTimer = Number(el.optTurnTimer.value);
      savePrefs();
      // מתחיל לספור מיד אם זה התור שלי, ונעלם אם כובה
      if (myTurn()) startTimer(); else stopTimer();
      return;
    }
    if (e.target === el.optAiLevel) {
      // משנה מיד — אין צורך להתחיל משחק חדש בשביל להחליף יריב
      state.prefs.aiLevel = el.optAiLevel.value;
      savePrefs();
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

  /*
   * טיימר שממשיך לרוץ כשהמסך כבוי הוא רק דרך להפסיד בלי לדעת. כשחוזרים
   * ללשונית הוא מתחיל את הספירה מחדש
   */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopTimer();
    else if (myTurn()) startTimer();
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
      // ההגדרה גוברת על מה שנשמר, אחרת שינוי חוק לא היה תופס במשחק פתוח
      g.setRule('jokerLock', !!state.prefs.jokerLock);
      loadLog();
      if (!loadDraft()) beginTurn();
      render();
      if (g.turn !== 0) runOpponents();
      else startTimer();
    } else {
      newGame();
    }

    if (!store.ok) setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
  }

  init();
})();
