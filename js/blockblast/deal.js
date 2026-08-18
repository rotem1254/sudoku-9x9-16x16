/* =============================================================================
 * blockblast/deal.js — מחולל השלישיות
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM. דורש את engine.js.
 *
 * **המשחק המקורי אינו מבטיח שיש פתרון.** הוא יכול לחלק שלישייה שאין לה
 * שום סדר הנחה חוקי, והמשחק נגמר לשחקן בלי שטעה. זו תלונה חוזרת, וגם
 * מקור השמועות שהמשחק מרומה.
 *
 * כאן ההתנהגות הפוכה כברירת מחדל, וזה עקבי עם שאר האתר: הסודוקו מוודא
 * פתרון יחיד אחרי כל חפירה, והסוליטר ברמה קלה מסנן חלוקות עד שהן
 * פתירות. מי שרוצה את ההגרלה החופשית של המקור מדליק guaranteed=false.
 *
 * "יש פתרון" פירושו: **קיים סדר הנחה אחד לפחות** שבו כל שלושת החלקים
 * נכנסים. הסדר משנה, כי הנחה יכולה לנקות שורה ולפנות מקום לבא אחריה —
 * ולכן צריך לבדוק את כל שש התמורות ולא רק את ההתאמה לכל חלק בנפרד.
 * =========================================================================== */
(function (global) {
  'use strict';

  const C = global.BlockBlastCore;

  /* שש התמורות של שלושה חלקים */
  const ORDERS = [
    [0, 1, 2], [0, 2, 1], [1, 0, 2],
    [1, 2, 0], [2, 0, 1], [2, 1, 0],
  ];

  /*
   * תקציב צמתים לחיפוש. העלות התיאורטית היא 6 × 64³ ≈ מיליון וחצי
   * בדיקות, וזה מורגש על טלפון. החסם תוחם את המקרה הגרוע; מה שנמצא עד
   * לעצירה עדיין תקף, ואם לא נמצא כלום פשוט מגרילים שלישייה אחרת.
   *
   * המספר נמדד — ראו את בדיקת הזמנים ב-test-blockblast.js
   */
  const NODE_BUDGET = 60000;

  /**
   * האם קיים סדר הנחה שבו כל השלושה נכנסים.
   *
   * @param {{lo:number,hi:number}} board
   * @param {object[]} pieces שלושה חלקים
   * @returns {number[]|null} סדר האינדקסים שעובד, או null
   */
  function solveOrder(board, pieces) {
    let nodes = 0;

    for (const order of ORDERS) {
      const found = step(board, 0, []);
      if (found) return found;

      function step(b, depth, chosen) {
        if (depth === order.length) return chosen.slice();
        if (++nodes > NODE_BUDGET) return null;

        const piece = pieces[order[depth]];
        for (const p of piece.placements) {
          if (!C.fits(b, p.mask)) continue;
          const after = C.place(b, p.mask);
          const res = step(after.board, depth + 1, chosen.concat(order[depth]));
          if (res) return res;
        }
        return null;
      }
    }
    return null;
  }

  /** האם לשלישייה יש פתרון על הלוח הזה. */
  const isSolvable = (board, pieces) => solveOrder(board, pieces) !== null;

  /* --------------------------------------------------------------------- */
  /* בחירת חלקים                                                            */
  /* --------------------------------------------------------------------- */

  /*
   * ההתפלגות אינה אחידה, ומשתנה עם הלוח. חלק גדול על לוח מלא הוא מה
   * שהורג, ולכן ככל שהלוח מתמלא המשקל עובר לחלקים קטנים. בלי זה המשחק
   * הוא גזר דין ולא משחק.
   *
   * המשקל של חלק בגודל s יורד ככל שהצפיפות עולה: על לוח ריק כל הגדלים
   * שווים בערך, ועל לוח מלא חלק של 5 כמעט לא מוגרל.
   */
  function pieceWeight(piece, dens) {
    const big = piece.size - 1; // 0 ליחיד, 4 לקו של חמש
    return Math.max(0.05, 1 - dens * dens * big * 0.55);
  }

  /** מגריל חלק אחד לפי המשקלים. */
  function pickPiece(rng, dens) {
    const weights = C.PIECES.map((p) => pieceWeight(p, dens));
    let total = 0;
    for (const w of weights) total += w;

    let roll = rng() * total;
    for (let i = 0; i < C.PIECES.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return C.PIECES[i];
    }
    return C.PIECES[C.PIECES.length - 1];
  }

  /** שלישייה אקראית, בלי שום הבטחה. זו ההתנהגות של המשחק המקורי. */
  function randomTriple(rng, dens) {
    return [pickPiece(rng, dens), pickPiece(rng, dens), pickPiece(rng, dens)];
  }

  /* --------------------------------------------------------------------- */
  /* חלוקה                                                                  */
  /* --------------------------------------------------------------------- */

  /*
   * כמה ניסיונות מותר לפני שמוותרים על ההבטחה. ככל שהלוח צפוף יותר
   * קשה יותר למצוא שלישייה פתירה, ולכן מותר יותר.
   */
  const TRIES_BY_DENSITY = (dens) => (dens < 0.4 ? 60 : dens < 0.7 ? 140 : 260);

  /**
   * מחלק שלישייה חדשה.
   *
   * @param {{lo:number,hi:number}} board מצב הלוח כרגע
   * @param {function} rng
   * @param {object} [opts] { guaranteed }
   * @returns {{pieces:object[], guaranteed:boolean, tries:number, order:number[]|null}}
   *   guaranteed מדווח אם ההבטחה אכן התקיימה — ולא אם ביקשנו אותה
   */
  function deal(board, rng, opts) {
    const o = opts || {};
    const guaranteed = o.guaranteed !== false;
    const dens = C.density(board);

    if (!guaranteed) {
      const pieces = randomTriple(rng, dens);
      return { pieces, guaranteed: false, tries: 1, order: solveOrder(board, pieces) };
    }

    const maxTries = TRIES_BY_DENSITY(dens);
    let fallback = null;

    for (let i = 1; i <= maxTries; i++) {
      const pieces = randomTriple(rng, dens);
      const order = solveOrder(board, pieces);
      if (order) return { pieces, guaranteed: true, tries: i, order };

      /*
       * גם אם השלישייה כולה אינה פתירה, עדיף להחזיר אחת שאפשר לפחות
       * להתחיל איתה מאשר כזו שנתקעת מיד. זו רשת ביטחון למקרה שהלוח כל
       * כך צפוף שאין שום שלישייה פתירה — ואז המשחק באמת נגמר
       */
      if (!fallback) fallback = pieces;
      else if (playableCount(board, pieces) > playableCount(board, fallback)) {
        fallback = pieces;
      }
    }

    return { pieces: fallback, guaranteed: false, tries: maxTries, order: null };
  }

  /** כמה מהחלקים נכנסים ללוח כמו שהוא, בלי להתחשב בסדר. */
  function playableCount(board, pieces) {
    let n = 0;
    for (const p of pieces) if (C.canPlace(board, p)) n++;
    return n;
  }

  global.BlockBlastDeal = {
    ORDERS,
    NODE_BUDGET,
    solveOrder,
    isSolvable,
    pieceWeight,
    pickPiece,
    randomTriple,
    playableCount,
    deal,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
