/* =============================================================================
 * storage.js — שכבת שמירה מקומית (localStorage)
 * -----------------------------------------------------------------------------
 * שמירה נפרדת לכל גודל לוח, כדי שמשחק 9x9 ומשחק 16x16 לא ידרסו זה את זה.
 * כל הגישות עטופות ב-try/catch: במצב פרטי / חסימת אחסון האתר ימשיך לעבוד,
 * פשוט בלי שמירה.
 * =========================================================================== */
(function (global) {
  'use strict';

  const PREFIX = 'sudoku.v1.';
  const KEY_SAVE = (size) => PREFIX + 'save.' + size; // מצב משחק פעיל
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

  function loadGame(size) {
    const data = read(KEY_SAVE(size), null);
    if (!data || data.size !== size || !Array.isArray(data.puzzle)) return null;
    return data;
  }

  function saveGame(size, state) {
    return write(KEY_SAVE(size), state);
  }

  function clearGame(size) {
    remove(KEY_SAVE(size));
  }

  /* ----------------------------- סטטיסטיקות ---------------------------- */

  const emptyStats = () => ({});

  /** מפתח סטטיסטיקה לכל צירוף גודל+קושי, כדי שהנתונים לא יתערבבו. */
  const statKey = (size, difficulty) => size + ':' + difficulty;

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
    difficulty: { 9: 'easy', 16: 'easy' },
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
