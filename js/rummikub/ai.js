/* =============================================================================
 * rummikub/ai.js — יריב ממוחשב
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM. דורש את engine.js.
 *
 * הבעיה: בהינתן יד, מהי הדרך להניח ממנה כמה שיותר אבנים? זו בעיית
 * set-packing — בוחרים אוסף צירופים חוקיים זרים זה לזה שמכסה כמה שיותר
 * אבנים. הפתרון כאן מדויק עבור היד עצמה:
 *
 *   1. מונים את *כל* הצירופים החוקיים שאפשר לבנות מהיד (חסום — פחות מ-800)
 *   2. בוחרים אוסף זר מקסימלי בחיפוש עם גיזום
 *
 * הגיזום הוא מה שהופך את זה למעשי: בכל צעד לוקחים את האבן הראשונה שטרם
 * הוכרעה, ומסתעפים רק על הצירופים שמכילים אותה (או מוותרים עליה). כך
 * העומק חסום בגודל היד ולא במספר הצירופים.
 *
 * פירוק וסידור מחדש של השולחן הוא בעיית אופטימיזציה על היד והשולחן יחד,
 * והיא יקרה בהרבה. לכן היא שמורה לרמה "קשה" בלבד (repackTable), עם תקציב
 * צמתים שתוחם את המקרה הגרוע. ברמות הנמוכות היריב מסתפק בהוספת אבנים
 * לצירופים קיימים, וזה מכסה את רוב המהלכים הטבעיים.
 * =========================================================================== */
(function (global) {
  'use strict';

  const T = global.RummikubTiles;
  const Rummikub = global.Rummikub;

  const MAX_NUMBER = T.MAX_NUMBER;
  const COLOR_COUNT = T.COLORS.length;

  /* --------------------------------------------------------------------- */
  /* דרגות קושי                                                             */
  /* --------------------------------------------------------------------- */

  /*
   * שלוש התנהגויות שנבדלות בדברים שבאמת משנים במשחק:
   *
   *   extend     — האם היריב מוסיף אבנים לצירופים שכבר על השולחן. בלי זה
   *                הוא מפספס חלק גדול מהמהלכים הזמינים
   *   hesitate   — הסתברות לוותר על מהלך אפשרי ולמשוך במקומו
   *   repack     — סידור מחדש של כל השולחן יחד עם היד. זה המהלך החזק
   *                באמת ברמי קוב: לפרק צירוף קיים ולהרכיב אותו אחרת כדי
   *                לפנות מקום לאבן מהיד. מכיל בתוכו גם צירופים חדשים וגם
   *                הוספות, ולכן תמיד שווה או טוב יותר מ-extend
   *
   * מדדתי את ההבדל, לא הנחתי אותו: ראו את הדו-קרבות ב-test-rummikub.js
   */
  const LEVELS = {
    easy: { extend: false, hesitate: 0.4, repack: false },
    normal: { extend: true, hesitate: 0, repack: false },
    hard: { extend: true, hesitate: 0, repack: true },
  };
  const LEVEL_ORDER = ['easy', 'normal', 'hard'];

  /* --------------------------------------------------------------------- */
  /* מניית צירופים אפשריים                                                  */
  /* --------------------------------------------------------------------- */

  /**
   * כל הצירופים החוקיים שניתן לבנות מאוסף אבנים.
   * מוחזרים כאינדקסים לתוך המערך המקורי, כדי שאפשר יהיה לזהות עותקים.
   *
   * @param {number[]} tiles
   * @returns {number[][]} כל איבר הוא רשימת אינדקסים
   */
  function enumerateSets(tiles) {
    const jokerIdx = [];
    // byColorNumber[color][number] = רשימת אינדקסים של אותה אבן
    const byCN = [];
    for (let c = 0; c < COLOR_COUNT; c++) {
      byCN.push(new Array(MAX_NUMBER + 1).fill(null).map(() => []));
    }

    tiles.forEach((tile, i) => {
      if (T.isJoker(tile)) jokerIdx.push(i);
      else byCN[T.tileColorIndex(tile)][T.tileNumber(tile)].push(i);
    });

    const out = [];
    const jokerCount = jokerIdx.length;

    /* --- קבוצות: אותו מספר, צבעים שונים --- */
    for (let n = 1; n <= MAX_NUMBER; n++) {
      const colorsWith = [];
      for (let c = 0; c < COLOR_COUNT; c++) if (byCN[c][n].length) colorsWith.push(c);

      // כל תת-קבוצה של הצבעים הזמינים, בתוספת 0..jokerCount ג'וקרים
      const subsets = combinations(colorsWith);
      for (const sub of subsets) {
        for (let j = 0; j <= jokerCount; j++) {
          const size = sub.length + j;
          if (size < 3 || size > COLOR_COUNT) continue;
          if (!sub.length) continue; // צירוף מג'וקרים בלבד אינו צירוף
          const idx = sub.map((c) => byCN[c][n][0]).concat(jokerIdx.slice(0, j));
          if (T.isGroup(idx.map((i) => tiles[i]))) out.push(idx);
        }
      }
    }

    /* --- סדרות: אותו צבע, מספרים עוקבים --- */
    for (let c = 0; c < COLOR_COUNT; c++) {
      for (let start = 1; start <= MAX_NUMBER - 2; start++) {
        for (let len = 3; start + len - 1 <= MAX_NUMBER; len++) {
          const idx = [];
          let need = 0;
          for (let n = start; n < start + len; n++) {
            if (byCN[c][n].length) idx.push(byCN[c][n][0]);
            else need++;
          }
          if (need > jokerCount) break; // ארוך יותר רק יחמיר
          if (!idx.length) continue;
          const full = idx.concat(jokerIdx.slice(0, need));
          if (T.isRun(full.map((i) => tiles[i]))) out.push(full);
        }
      }
    }

    return out;
  }

  /** כל תתי-הקבוצות הלא ריקות של מערך קצר. */
  function combinations(arr) {
    const out = [];
    for (let mask = 1; mask < 1 << arr.length; mask++) {
      const sub = [];
      for (let i = 0; i < arr.length; i++) if (mask & (1 << i)) sub.push(arr[i]);
      out.push(sub);
    }
    return out;
  }

  /* --------------------------------------------------------------------- */
  /* בחירת אוסף זר מקסימלי                                                  */
  /* --------------------------------------------------------------------- */

  /**
   * בוחר אוסף צירופים זרים שמכסה כמה שיותר אבנים.
   *
   * @param {number[]} tiles
   * @param {object} [opts] { minValue, mustUse }
   *   minValue — סף ניקוד, לצורך חוק הפתיחה
   *   mustUse  — מערך בוליאני: אבנים שחייבות להיכנס לצירוף כלשהו. משמש
   *              לסידור השולחן מחדש, כי אסור להחזיר אבן מהשולחן ליד
   * @returns {{sets:number[][], used:number, value:number}}
   */
  function bestPacking(tiles, opts) {
    const o = opts || {};
    const candidates = enumerateSets(tiles);

    // לכל אבן, אילו צירופים מכילים אותה
    const containing = tiles.map(() => []);
    candidates.forEach((set, si) => set.forEach((i) => containing[i].push(si)));

    const mustUse = o.mustUse || [];
    const used = new Array(tiles.length).fill(false);
    let best = { sets: [], used: 0, value: 0 };

    /*
     * תקציב צמתים. עלות החיפוש היא דו-קוטבית: רוב הקריאות מסתיימות
     * במיקרו-שניות, אבל הזנב הארוך הגיע ל-111ms על שולחן גדול — וזה
     * מורגש היטב על טלפון. חסם על מספר הצמתים תוחם את המקרה הגרוע
     * בלי לפגוע במקרה הרגיל, ומה שנמצא עד לעצירה עדיין תקף
     */
    let nodes = 0;
    const budget = o.maxNodes || Infinity;

    /** @param {number} from האבן הראשונה שטרם הוכרעה */
    function search(from, chosen, usedCount, value) {
      if (++nodes > budget) return;
      // גיזום: גם אם כל השאר ייכנס, לא נשתפר
      if (usedCount + (tiles.length - from) <= best.used) return;

      let i = from;
      while (i < tiles.length && used[i]) i++;
      if (i >= tiles.length) {
        record(chosen, usedCount, value);
        return;
      }

      // ענף 1: האבן נכנסת לאחד הצירופים שמכילים אותה
      for (const si of containing[i]) {
        const set = candidates[si];
        if (set.some((k) => used[k])) continue;
        set.forEach((k) => { used[k] = true; });
        chosen.push(si);
        search(i + 1, chosen, usedCount + set.length, value + T.setValue(set.map((k) => tiles[k])));
        chosen.pop();
        set.forEach((k) => { used[k] = false; });
      }

      // ענף 2: מוותרים על האבן הזו — אלא אם היא חייבת להיכנס
      if (!mustUse[i]) {
        used[i] = true;
        search(i + 1, chosen, usedCount, value);
        used[i] = false;
      }
    }

    function record(chosen, usedCount, value) {
      if (o.minValue != null && value < o.minValue) return;
      if (usedCount > best.used || (usedCount === best.used && value > best.value)) {
        best = {
          sets: chosen.map((si) => candidates[si].slice()),
          used: usedCount,
          value,
        };
      }
    }

    if (mustUse.length) best.used = -1; // כדי שגם פתרון "גרוע" עדיף על כלום
    search(0, [], 0, 0);
    if (best.used < 0) return { sets: [], used: 0, value: 0 };
    return best;
  }

  /* --------------------------------------------------------------------- */
  /* הוספות לצירופים שכבר על השולחן                                         */
  /* --------------------------------------------------------------------- */

  /**
   * מוצא אבנים מהיד שאפשר לתקוע בצירוף קיים בלי לפרק כלום.
   * רץ שוב ושוב, כי הוספה אחת יכולה לפתוח את הבאה.
   *
   * @returns {{table:number[][], placed:number[]}}
   */
  function extendTable(table, rack) {
    const work = table.map((s) => s.slice());
    const hand = rack.slice();
    const placed = [];

    let progress = true;
    while (progress) {
      progress = false;
      for (let s = 0; s < work.length && !progress; s++) {
        for (let h = 0; h < hand.length; h++) {
          const trial = work[s].concat([hand[h]]);
          if (!T.isValidSet(trial)) continue;
          work[s] = trial;
          placed.push(hand[h]);
          hand.splice(h, 1);
          progress = true;
          break;
        }
      }
    }
    return { table: work, rack: hand, placed };
  }

  /* --------------------------------------------------------------------- */
  /* סידור השולחן מחדש                                                      */
  /* --------------------------------------------------------------------- */

  /*
   * תקציב הצמתים לסידור מחדש. מכויל כך שהתור האיטי ביותר נשאר בסדר גודל
   * של כמה מילישניות גם על שולחן מלא — נמדד, לא מנוחש
   */
  const REPACK_NODES = 20000;

  /**
   * מסדר את השולחן מחדש יחד עם היד, כדי לשחק כמה שיותר אבנים מהיד.
   * כל אבני השולחן חייבות להישאר על השולחן — זה בדיוק mustUse.
   *
   * **כשחוק נעילת הג'וקר פעיל**, צירוף שיש בו ג'וקר יוצא מהחישוב לגמרי:
   * אי אפשר לקחת ממנו דבר ואי אפשר לסדר אותו מחדש, ולכן הוא נשאר בצד
   * ומוחזר כמו שהוא. בלי זה היריב היה מייצר מהלכים שהמנוע דוחה.
   *
   * כשהחוק כבוי הג'וקר הוא אבן ככל אבן אחרת, והיריב מסדר גם אותו.
   *
   * @param {boolean} [freezeJokers] האם חוק הנעילה פעיל
   * @returns {{table:number[][], rack:number[], placed:number[]}|null}
   */
  function repackTable(table, rack, freezeJokers) {
    const lock = freezeJokers !== false;
    const frozen = lock ? table.filter((s) => s.some(T.isJoker)) : [];
    const movable = lock ? table.filter((s) => !s.some(T.isJoker)) : table;

    const tableTiles = [].concat(...movable);
    const all = tableTiles.concat(rack);

    const mustUse = all.map((_, i) => i < tableTiles.length);
    const packing = bestPacking(all, { mustUse, maxNodes: REPACK_NODES });
    if (!packing.sets.length && tableTiles.length) return null;

    const usedIdx = new Set([].concat(...packing.sets));
    const placed = [];
    const left = [];
    rack.forEach((tile, i) => {
      if (usedIdx.has(tableTiles.length + i)) placed.push(tile);
      else left.push(tile);
    });
    if (!placed.length) return null;

    return {
      table: frozen.map((s) => s.slice())
        .concat(packing.sets.map((set) => set.map((i) => all[i]))),
      rack: left,
      placed,
    };
  }

  /* --------------------------------------------------------------------- */
  /* תור של היריב                                                           */
  /* --------------------------------------------------------------------- */

  /**
   * מחשב ומבצע תור עבור השחקן הנוכחי.
   *
   * @param {Rummikub} game
   * @param {string} [level] easy | normal | hard
   * @param {function} [rng] מקור אקראיות, לצורך בדיקות דטרמיניסטיות
   * @returns {{action:'meld'|'draw', placed?:number[], value?:number, won?:boolean}}
   */
  function playTurn(game, level, rng) {
    const conf = LEVELS[level] || LEVELS.normal;
    const random = rng || Math.random;
    const rack = game.currentRack.slice();

    /* --- טרם פתח: חייב 30 נקודות מהיד בלבד --- */
    if (!game.hasMelded()) {
      const packing = bestPacking(rack, { minValue: Rummikub.INITIAL_MELD });
      if (packing.sets.length && packing.value >= Rummikub.INITIAL_MELD) {
        const placedIdx = new Set([].concat(...packing.sets));
        const newSets = packing.sets.map((set) => set.map((i) => rack[i]));
        const left = rack.filter((_, i) => !placedIdx.has(i));

        const res = game.commitTurn(game.table.concat(newSets), left);
        if (res.ok) {
          return {
            action: 'meld',
            placed: [].concat(...newSets),
            value: packing.value,
            won: !!res.won,
          };
        }
      }
      const d = game.drawTile();
      return { action: 'draw', tile: d.tile };
    }

    /* --- כבר פתח: צירופים חדשים מהיד + הוספות לשולחן --- */

    // ברמה הקלה הוא מדי פעם פשוט לא רואה את המהלך
    if (conf.hesitate && random() < conf.hesitate) {
      const d0 = game.drawTile();
      return { action: 'draw', tile: d0.tile, hesitated: true };
    }

    const packing = bestPacking(rack);
    const placedIdx = new Set([].concat(...packing.sets));
    const newSets = packing.sets.map((set) => set.map((i) => rack[i]));
    const afterPacking = rack.filter((_, i) => !placedIdx.has(i));

    let ext = conf.extend
      ? extendTable(game.table.concat(newSets), afterPacking)
      : { table: game.table.concat(newSets), rack: afterPacking, placed: [] };
    let totalPlaced = [].concat(...newSets, ext.placed);

    // ברמה הקשה: לנסות לסדר את כל השולחן מחדש, ולקחת את זה רק אם באמת עדיף
    if (conf.repack) {
      const rp = repackTable(game.table, rack, game.rules && game.rules.jokerLock);
      if (rp && rp.placed.length > totalPlaced.length) {
        ext = rp;
        totalPlaced = rp.placed;
      }
    }

    if (totalPlaced.length) {
      const res = game.commitTurn(ext.table, ext.rack);
      if (res.ok) {
        return { action: 'meld', placed: totalPlaced, won: !!res.won };
      }
    }

    const d = game.drawTile();
    return { action: 'draw', tile: d.tile };
  }

  global.RummikubAI = {
    LEVELS,
    LEVEL_ORDER,
    REPACK_NODES,
    repackTable,
    enumerateSets,
    bestPacking,
    extendTable,
    playTurn,
  };
})(typeof window !== 'undefined' ? window : globalThis);
