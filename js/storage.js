/* =============================================================================
 * storage.js — שכבת שמירה מקומית (localStorage)
 * -----------------------------------------------------------------------------
 * שמירה נפרדת לכל סוג לוח ("mode"), כדי שמשחקים לא ידרסו זה את זה:
 *   '9'  — 9×9 קלאסי     '16' — 16×16     'x9' — 9×9 אלכסון
 * המפתחות של 9 ו-16 זהים לגרסאות הקודמות, כך שמשחקים וסטטיסטיקות קיימים
 * ממשיכים לעבוד.
 * כל הגישות עטופות ב-try/catch: במצב פרטי / חסימת אחסון האתר ימשיך לעבוד,
 * פשוט בלי שמירה.
 * =========================================================================== */
(function (global) {
  'use strict';

  const PREFIX = 'sudoku.v1.';
  const KEY_SAVE = (mode) => PREFIX + 'save.' + mode; // מצב משחק פעיל
  const KEY_STATS = PREFIX + 'stats'; // סטטיסטיקות מצטברות
  const KEY_PREFS = PREFIX + 'prefs'; // העדפות (ערכת נושא, גודל אחרון, קושי)

  let available = null;

  /** בודק פעם אחת אם localStorage באמת זמין וכתיב. */
  function isAvailable() {
    if (available !== null) return available;
    try {
      const k = PREFIX + '__probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      available = true;
    } catch (e) {
      available = false;
    }
    return available;
  }

  function read(key, fallback) {
    if (!isAvailable()) return fallback;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    if (!isAvailable()) return false;
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false; // מכסה גם QuotaExceededError
    }
  }

  function remove(key) {
    if (!isAvailable()) return;
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* מתעלמים */
    }
  }

  /* ------------------------------ משחק שמור ---------------------------- */

  /** סוג הלוח של משחק שמור — כדי לוודא שהוא שייך לטאב שביקש אותו */
  const modeOf = (data) => (data.variant === 'diagonal' ? 'x' : '') + data.size;

  function loadGame(mode) {
    const data = read(KEY_SAVE(mode), null);
    if (!data || modeOf(data) !== String(mode) || !Array.isArray(data.puzzle)) return null;
    return data;
  }

  function saveGame(mode, state) {
    return write(KEY_SAVE(mode), state);
  }

  function clearGame(mode) {
    remove(KEY_SAVE(mode));
  }

  /* ----------------------------- סטטיסטיקות ---------------------------- */

  const emptyStats = () => ({});

  /** מפתח סטטיסטיקה לכל צירוף סוג לוח+קושי, כדי שהנתונים לא יתערבבו. */
  const statKey = (mode, difficulty) => mode + ':' + difficulty;

  function loadStats() {
    return read(KEY_STATS, emptyStats());
  }

  /**
   * רושם ניצחון ומחזיר את רשומת הסטטיסטיקה המעודכנת.
   * @returns {{played:number, won:number, best:number|null, isNewBest:boolean}}
   */
  function recordWin(size, difficulty, seconds) {
    const stats = loadStats();
    const key = statKey(size, difficulty);
    const rec = stats[key] || { played: 0, won: 0, best: null };
    rec.won += 1;
    const isNewBest = rec.best == null || seconds < rec.best;
    if (isNewBest) rec.best = seconds;
    stats[key] = rec;
    write(KEY_STATS, stats);
    return Object.assign({}, rec, { isNewBest });
  }

  /** רושם התחלת משחק חדש (לצורך יחס ניצחונות). */
  function recordStart(size, difficulty) {
    const stats = loadStats();
    const key = statKey(size, difficulty);
    const rec = stats[key] || { played: 0, won: 0, best: null };
    rec.played += 1;
    stats[key] = rec;
    write(KEY_STATS, stats);
    return rec;
  }

  function getStat(size, difficulty) {
    const stats = loadStats();
    return stats[statKey(size, difficulty)] || { played: 0, won: 0, best: null };
  }

  function clearStats() {
    remove(KEY_STATS);
  }

  /* ------------------------------- העדפות ------------------------------ */

  const DEFAULT_PREFS = {
    theme: 'auto', // auto | light | dark
    size: 9,
    /** הטאב האחרון: '9' | '16' | 'x9' (size נשאר לתאימות לאחור) */
    mode: null,
    difficulty: { 9: 'easy', 16: 'easy', x9: 'easy' },
    highlightPeers: true,
    highlightSame: true,
    showErrors: true,
    autoClearNotes: true,
    // השלמה אוטומטית כשנשארים מעט תאים — ניתן לכיבוי מתוך ההגדרות
    autoComplete: true,
  };

  function loadPrefs() {
    const p = read(KEY_PREFS, {});
    // מיזוג עמוק-חלקי כדי שהעדפות חדשות בגרסאות עתידיות יקבלו ברירת מחדל
    return Object.assign({}, DEFAULT_PREFS, p, {
      difficulty: Object.assign({}, DEFAULT_PREFS.difficulty, p.difficulty),
    });
  }

  function savePrefs(prefs) {
    return write(KEY_PREFS, prefs);
  }

  global.SudokuStorage = {
    isAvailable,
    loadGame,
    saveGame,
    clearGame,
    loadStats,
    getStat,
    recordWin,
    recordStart,
    clearStats,
    loadPrefs,
    savePrefs,
    DEFAULT_PREFS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
