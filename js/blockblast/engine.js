/* =============================================================================
 * blockblast/engine.js — מנוע Block Blast
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM.
 *
 * לוח 8×8. בכל סבב מוצעים שלושה חלקים, ומניחים אותם בכל סדר. שורה או
 * עמודה שהתמלאה נמחקת. **אין סיבוב** — זה לב המשחק, ובלעדיו כל חלק
 * מתאים לכל מקום.
 *
 * הייצוג: הלוח הוא 64 תאים, ומספר ב-JS מחזיק 53 ביט בלבד. לכן כל לוח
 * הוא **שני מספרים של 32 ביט** — שורות 0..3 ב-lo, שורות 4..7 ב-hi.
 * לא BigInt: הוא נוח אבל איטי, וכאן עושים מיליוני בדיקות התאמה.
 *
 * ביט התא (r,c) הוא r*8+c, כלומר סיבית 0 היא הפינה הימנית-עליונה של
 * המערך הלוגי. התצוגה היא עניין של ה-UI ולא של המנוע.
 * =========================================================================== */
(function (global) {
  'use strict';

  const SIZE = 8;
  const CELLS = SIZE * SIZE;

  /* --------------------------------------------------------------------- */
  /* לוח: שני חצאים של 32 ביט                                              */
  /* --------------------------------------------------------------------- */

  /**
   * לוח ריק.
   * @returns {{lo:number, hi:number}}
   */
  const emptyBoard = () => ({ lo: 0, hi: 0 });

  /** האם התא (r,c) תפוס. */
  function getCell(board, r, c) {
    const bit = r * SIZE + c;
    return bit < 32
      ? (board.lo >>> bit) & 1
      : (board.hi >>> (bit - 32)) & 1;
  }

  /** מדליק תא. מחזיר לוח חדש. */
  function setCell(board, r, c) {
    const bit = r * SIZE + c;
    return bit < 32
      ? { lo: (board.lo | (1 << bit)) >>> 0, hi: board.hi }
      : { lo: board.lo, hi: (board.hi | (1 << (bit - 32))) >>> 0 };
  }

  /** מספר התאים התפוסים. */
  function countCells(board) {
    return popcount(board.lo) + popcount(board.hi);
  }

  /** ספירת סיביות דלוקות — אלגוריתם SWAR הסטנדרטי. */
  function popcount(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    x = (x + (x >>> 4)) & 0x0f0f0f0f;
    return (x * 0x01010101) >>> 24;
  }

  /** צפיפות הלוח, 0..1. קובעת באיזה אלגוריתם המחולל משתמש. */
  const density = (board) => countCells(board) / CELLS;

  /* --------------------------------------------------------------------- */
  /* מסכות שורות ועמודות — מחושבות פעם אחת                                  */
  /* --------------------------------------------------------------------- */

  /** מסכה של שורה שלמה, לכל אחת מ-8 השורות. */
  const ROW_MASK = [];
  /** מסכה של עמודה שלמה, לכל אחת מ-8 העמודות. */
  const COL_MASK = [];

  (function buildMasks() {
    for (let r = 0; r < SIZE; r++) {
      let m = emptyBoard();
      for (let c = 0; c < SIZE; c++) m = setCell(m, r, c);
      ROW_MASK.push(m);
    }
    for (let c = 0; c < SIZE; c++) {
      let m = emptyBoard();
      for (let r = 0; r < SIZE; r++) m = setCell(m, r, c);
      COL_MASK.push(m);
    }
  })();

  /**
   * האם כל סיביות המסכה דלוקות בלוח.
   *
   * ה-`>>> 0` אינו קישוט: אופרטור `&` ב-JS מחזיר מספר **מסומן** של 32
   * ביט, ולכן ברגע שסיבית 31 דלוקה התוצאה שלילית — בעוד שהמסכה נשמרה
   * כלא-מסומנת. בלי ההמרה ההשוואה נכשלת בדיוק בשורה 3 ובעמודה 7, שתיהן
   * מכילות את סיבית 31, והן היו נמחקות. זה נתפס בבדיקה של הצטלבות
   * שורה ועמודה
   */
  const covers = (board, mask) =>
    ((board.lo & mask.lo) >>> 0) === mask.lo &&
    ((board.hi & mask.hi) >>> 0) === mask.hi;

  /* --------------------------------------------------------------------- */
  /* החלקים                                                                 */
  /* --------------------------------------------------------------------- */

  /*
   * כל צורה היא רשימת תאים ביחס לפינה שלה. **אין סיבוב במשחק**, ולכן כל
   * כיוון של אותה צורה הוא חלק נפרד לגמרי — L שפונה ימינה ו-L שפונה
   * שמאלה אינם אותו דבר.
   *
   * size הוא מספר התאים, והוא גם הניקוד על ההנחה (נקודה לתא).
   */
  const SHAPES = [
    { id: 'x1', cells: [[0, 0]] },

    { id: 'h2', cells: [[0, 0], [0, 1]] },
    { id: 'v2', cells: [[0, 0], [1, 0]] },

    { id: 'h3', cells: [[0, 0], [0, 1], [0, 2]] },
    { id: 'v3', cells: [[0, 0], [1, 0], [2, 0]] },

    // ארבע הפינות של L קטן — כל אחת חלק בפני עצמו
    { id: 'L3a', cells: [[0, 0], [1, 0], [1, 1]] },
    { id: 'L3b', cells: [[0, 1], [1, 0], [1, 1]] },
    { id: 'L3c', cells: [[0, 0], [0, 1], [1, 1]] },
    { id: 'L3d', cells: [[0, 0], [0, 1], [1, 0]] },

    { id: 'sq', cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
    { id: 'h4', cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
    { id: 'v4', cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },

    // L ארוך, ארבעה כיוונים
    { id: 'L4a', cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
    { id: 'L4b', cells: [[0, 1], [1, 1], [2, 0], [2, 1]] },
    { id: 'L4c', cells: [[0, 0], [0, 1], [1, 0], [2, 0]] },
    { id: 'L4d', cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },

    { id: 'T4', cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },

    { id: 'h5', cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
    { id: 'v5', cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },
  ];

  /* לכל צורה: גובה, רוחב, מספר תאים, וכל המיקומים החוקיים על לוח ריק */
  const PIECES = SHAPES.map((shape) => {
    const rows = Math.max(...shape.cells.map((x) => x[0])) + 1;
    const cols = Math.max(...shape.cells.map((x) => x[1])) + 1;

    /*
     * המסכה של הצורה בכל מיקום אפשרי, מחושבת מראש. זה מה שהופך את
     * בדיקת ההתאמה לפעולת AND בודדת בזמן ריצה
     */
    const placements = [];
    for (let r = 0; r + rows <= SIZE; r++) {
      for (let c = 0; c + cols <= SIZE; c++) {
        let mask = emptyBoard();
        for (const [dr, dc] of shape.cells) mask = setCell(mask, r + dr, c + dc);
        placements.push({ row: r, col: c, mask });
      }
    }

    return {
      id: shape.id,
      cells: shape.cells.map((x) => x.slice()),
      rows,
      cols,
      size: shape.cells.length,
      placements,
    };
  });

  const pieceById = {};
  PIECES.forEach((p) => { pieceById[p.id] = p; });

  /* --------------------------------------------------------------------- */
  /* הנחה וניקוי                                                            */
  /* --------------------------------------------------------------------- */

  /** האם המסכה נכנסת ללוח בלי לחפוף. */
  const fits = (board, mask) =>
    (board.lo & mask.lo) === 0 && (board.hi & mask.hi) === 0;

  /** כל המיקומים שבהם החלק נכנס למצב הלוח הנוכחי. */
  function legalPlacements(board, piece) {
    const out = [];
    for (const p of piece.placements) if (fits(board, p.mask)) out.push(p);
    return out;
  }

  /** האם לחלק יש בכלל מקום. עוצר בראשון שנמצא. */
  function canPlace(board, piece) {
    for (const p of piece.placements) if (fits(board, p.mask)) return true;
    return false;
  }

  /**
   * מניח חלק ומנקה מה שהתמלא.
   *
   * @returns {{board:object, rows:number[], cols:number[], cleared:number}}
   *   הלוח אחרי הניקוי, ואילו שורות ועמודות נמחקו
   */
  function place(board, mask) {
    let next = { lo: (board.lo | mask.lo) >>> 0, hi: (board.hi | mask.hi) >>> 0 };

    /*
     * מזהים הכול *לפני* שמוחקים משהו. אם מוחקים שורה ואז בודקים עמודות,
     * העמודה שהצטלבה איתה כבר לא מלאה — ושתי שורות שנסגרו יחד היו
     * נספרות כאחת
     */
    const rows = [];
    const cols = [];
    for (let r = 0; r < SIZE; r++) if (covers(next, ROW_MASK[r])) rows.push(r);
    for (let c = 0; c < SIZE; c++) if (covers(next, COL_MASK[c])) cols.push(c);

    for (const r of rows) {
      next = { lo: (next.lo & ~ROW_MASK[r].lo) >>> 0, hi: (next.hi & ~ROW_MASK[r].hi) >>> 0 };
    }
    for (const c of cols) {
      next = { lo: (next.lo & ~COL_MASK[c].lo) >>> 0, hi: (next.hi & ~COL_MASK[c].hi) >>> 0 };
    }

    return { board: next, rows, cols, cleared: rows.length + cols.length };
  }

  /* --------------------------------------------------------------------- */
  /* ניקוד                                                                  */
  /* --------------------------------------------------------------------- */

  /*
   * הטבלה של המשחק המקורי. הקפיצה מ-20 ל-60 בשלוש שורות אינה טעות: היא
   * מה שהופך את המשחק מ"לסדר" ל"לבנות מלכודת", והיא הליבה של העומק.
   */
  const CLEAR_BONUS = [0, 10, 20, 60, 120, 200, 300];
  const BOARD_CLEAR_BONUS = 360;

  /** בונוס על מספר שורות/עמודות שנוקו יחד. */
  const clearBonus = (n) =>
    n <= 0 ? 0 : CLEAR_BONUS[Math.min(n, CLEAR_BONUS.length - 1)];

  /**
   * ניקוד מהלך יחיד.
   *
   * @param {number} cellsPlaced מספר התאים בחלק — נקודה לתא
   * @param {number} linesCleared שורות ועמודות שנמחקו יחד
   * @param {number} combo מונה הקומבו *אחרי* המהלך (1 = ניקוי ראשון ברצף)
   * @param {boolean} boardCleared האם הלוח התרוקן לגמרי
   */
  function scoreMove(cellsPlaced, linesCleared, combo, boardCleared) {
    let score = cellsPlaced;
    if (linesCleared > 0) {
      // הקומבו מכפיל את ניקוד הניקוי בלבד, לא את ההנחה
      score += clearBonus(linesCleared) * Math.max(1, combo);
    }
    if (boardCleared) score += BOARD_CLEAR_BONUS;
    return score;
  }

  /* --------------------------------------------------------------------- */
  /* אקראיות עם seed                                                        */
  /* --------------------------------------------------------------------- */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  global.BlockBlastCore = {
    SIZE,
    CELLS,
    SHAPES,
    PIECES,
    pieceById,
    ROW_MASK,
    COL_MASK,
    CLEAR_BONUS,
    BOARD_CLEAR_BONUS,

    emptyBoard,
    getCell,
    setCell,
    countCells,
    popcount,
    density,
    covers,
    fits,
    legalPlacements,
    canPlace,
    place,
    clearBonus,
    scoreMove,
    mulberry32,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
