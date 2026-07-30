/* =============================================================================
 * core.js — מנוע סודוקו גנרי (Generic Sudoku Engine)
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM. תומך בכל גודל לוח שמתפרק לתיבות משנה (boxW × boxH),
 * ובפרט 9x9 (תיבות 3x3) ו-16x16 (תיבות 4x4).
 *
 * טכניקות:
 *   - ייצוג מועמדים כ-bitmask (עד 16 ביטים) => פעולות O(1) על קבוצות.
 *   - Constraint Propagation: Naked Singles + Hidden Singles.
 *   - Backtracking עם היוריסטיקת MRV (Minimum Remaining Values).
 *   - ספירת פתרונות עם limit (מספיק 2 כדי לדעת שאין יחידות).
 *
 * זה חיוני ל-16x16: לוח של 256 תאים לא ניתן לפתור בזמן סביר עם
 * backtracking נאיבי בלבד.
 * =========================================================================== */
(function (global) {
  'use strict';

  /* --------------------------------------------------------------------- */
  /* עזרי ביטים                                                             */
  /* --------------------------------------------------------------------- */

  /** מיפוי מביט בודד (1<<k) לערך k+1. נבנה פעם אחת. */
  const BIT_TO_VAL = new Map();
  for (let k = 0; k < 24; k++) BIT_TO_VAL.set(1 << k, k + 1);

  /** ספירת ביטים דלוקים (population count). */
  function popcount(x) {
    x = x - ((x >> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333);
    x = (x + (x >> 4)) & 0x0f0f0f0f;
    return (x * 0x01010101) >> 24;
  }

  /** האם למספר יש בדיוק ביט אחד דלוק. */
  function isSingleBit(x) {
    return x !== 0 && (x & (x - 1)) === 0;
  }

  /** ממיר מסכת ביטים לרשימת ערכים (1..N). */
  function maskToValues(mask) {
    const out = [];
    let m = mask;
    while (m) {
      const low = m & -m;
      out.push(BIT_TO_VAL.get(low));
      m ^= low;
    }
    return out;
  }

  /* --------------------------------------------------------------------- */
  /* מחולל מספרים אקראי עם seed (משחזר פאזלים מתוך seed שמור)               */
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

  function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /* --------------------------------------------------------------------- */
  /* מפרט לוח (Spec) — כל המידע הגיאומטרי, מחושב פעם אחת לכל גודל            */
  /* --------------------------------------------------------------------- */

  const specCache = new Map();

  /**
   * בונה מפרט לוח גנרי.
   * @param {number} boxW רוחב תיבת משנה (מספר עמודות בתיבה)
   * @param {number} boxH גובה תיבת משנה (מספר שורות בתיבה)
   */
  function buildSpec(boxW, boxH) {
    const N = boxW * boxH;
    const key = boxW + 'x' + boxH;
    if (specCache.has(key)) return specCache.get(key);

    const cells = N * N;
    const rowOf = new Int32Array(cells);
    const colOf = new Int32Array(cells);
    const boxOf = new Int32Array(cells);
    const boxesPerRow = N / boxW; // כמה תיבות לרוחב הלוח

    for (let i = 0; i < cells; i++) {
      const r = (i / N) | 0;
      const c = i % N;
      rowOf[i] = r;
      colOf[i] = c;
      boxOf[i] = ((r / boxH) | 0) * boxesPerRow + ((c / boxW) | 0);
    }

    // 3N יחידות: N שורות, N עמודות, N תיבות. כל יחידה = רשימת אינדקסים.
    const units = [];
    for (let r = 0; r < N; r++) {
      const u = new Int32Array(N);
      for (let c = 0; c < N; c++) u[c] = r * N + c;
      units.push(u);
    }
    for (let c = 0; c < N; c++) {
      const u = new Int32Array(N);
      for (let r = 0; r < N; r++) u[r] = r * N + c;
      units.push(u);
    }
    for (let b = 0; b < N; b++) {
      const u = new Int32Array(N);
      let k = 0;
      const br = ((b / boxesPerRow) | 0) * boxH;
      const bc = (b % boxesPerRow) * boxW;
      for (let r = 0; r < boxH; r++)
        for (let c = 0; c < boxW; c++) u[k++] = (br + r) * N + (bc + c);
      units.push(u);
    }

    // עבור כל תא — שלוש היחידות שהוא שייך להן (לעדכון ממוקד)
    const unitsOfCell = [];
    for (let i = 0; i < cells; i++) {
      unitsOfCell.push([rowOf[i], N + colOf[i], 2 * N + boxOf[i]]);
    }

    const spec = {
      N,
      boxW,
      boxH,
      boxesPerRow,
      cells,
      FULL: (1 << N) - 1,
      rowOf,
      colOf,
      boxOf,
      units,
      unitsOfCell,
    };
    specCache.set(key, spec);
    return spec;
  }

  /** מפרטים מוכנים לגדלים הנתמכים באתר. */
  const SPECS = {
    9: buildSpec(3, 3),
    16: buildSpec(4, 4),
  };

  function specFor(size) {
    const s = SPECS[size];
    if (!s) throw new Error('Unsupported board size: ' + size);
    return s;
  }

  /* --------------------------------------------------------------------- */
  /* מצב פתרון (Solver State) — grid + מסכות שורה/עמודה/תיבה                */
  /* --------------------------------------------------------------------- */

  function createState(grid, spec) {
    const st = {
      grid: Int32Array.from(grid),
      rowM: new Int32Array(spec.N),
      colM: new Int32Array(spec.N),
      boxM: new Int32Array(spec.N),
      empty: 0,
      nodes: 0,
      aborted: false,
      nodeBudget: Infinity,
    };
    for (let i = 0; i < spec.cells; i++) {
      const v = st.grid[i];
      if (v) {
        const bit = 1 << (v - 1);
        st.rowM[spec.rowOf[i]] |= bit;
        st.colM[spec.colOf[i]] |= bit;
        st.boxM[spec.boxOf[i]] |= bit;
      } else {
        st.empty++;
      }
    }
    return st;
  }

  /** מסכת המועמדים החוקיים לתא ריק. */
  function candidates(st, spec, i) {
    return (
      spec.FULL &
      ~(st.rowM[spec.rowOf[i]] | st.colM[spec.colOf[i]] | st.boxM[spec.boxOf[i]])
    );
  }

  function place(st, spec, i, val) {
    const bit = 1 << (val - 1);
    st.grid[i] = val;
    st.rowM[spec.rowOf[i]] |= bit;
    st.colM[spec.colOf[i]] |= bit;
    st.boxM[spec.boxOf[i]] |= bit;
    st.empty--;
  }

  function unplace(st, spec, i) {
    const val = st.grid[i];
    if (!val) return;
    const bit = ~(1 << (val - 1));
    st.grid[i] = 0;
    st.rowM[spec.rowOf[i]] &= bit;
    st.colM[spec.colOf[i]] &= bit;
    st.boxM[spec.boxOf[i]] &= bit;
    st.empty++;
  }

  /** מבטל את כל ההצבות שנרשמו ב-trail (LIFO). */
  function rollback(st, spec, trail, from) {
    for (let k = trail.length - 1; k >= from; k--) unplace(st, spec, trail[k]);
    trail.length = from;
  }

  /* --------------------------------------------------------------------- */
  /* Constraint Propagation                                                 */
  /* --------------------------------------------------------------------- */

  /**
   * מפיץ אילוצים עד שאין שינוי:
   *   1. Naked Single  — לתא ריק יש בדיוק מועמד אחד.
   *   2. Hidden Single — בתוך יחידה, לערך מסוים יש בדיוק תא אפשרי אחד.
   * מחזיר false אם התגלתה סתירה (הענף מת).
   * כל ההצבות נרשמות ב-trail כדי לאפשר rollback.
   */
  function propagate(st, spec, trail) {
    const { N, FULL, units } = spec;
    let changed = true;

    while (changed) {
      changed = false;

      // --- Naked Singles -------------------------------------------------
      for (let i = 0; i < spec.cells; i++) {
        if (st.grid[i]) continue;
        const cand = candidates(st, spec, i);
        if (cand === 0) return false; // תא ריק בלי מועמדים => סתירה
        if (isSingleBit(cand)) {
          place(st, spec, i, BIT_TO_VAL.get(cand));
          trail.push(i);
          changed = true;
        }
      }
      if (changed) continue; // עדיף לרוקן naked singles לפני שעוברים ליקרים

      // --- Hidden Singles ------------------------------------------------
      for (let u = 0; u < units.length; u++) {
        const unit = units[u];
        let once = 0; // ערכים שראינו לפחות פעם אחת כמועמד ביחידה
        let twice = 0; // ערכים שראינו לפחות פעמיים
        let filled = 0; // ערכים שכבר מוצבים ביחידה

        for (let k = 0; k < N; k++) {
          const i = unit[k];
          const v = st.grid[i];
          if (v) {
            filled |= 1 << (v - 1);
          } else {
            const cand = candidates(st, spec, i);
            twice |= once & cand;
            once |= cand;
          }
        }

        // ערך שאינו מוצב ואין לו אף תא אפשרי => סתירה
        if ((FULL & ~filled & ~once) !== 0) return false;

        const hidden = once & ~twice;
        if (!hidden) continue;

        for (let k = 0; k < N; k++) {
          const i = unit[k];
          if (st.grid[i]) continue;
          const h = candidates(st, spec, i) & hidden;
          if (h) {
            if (!isSingleBit(h)) return false; // שני ערכים חבויים באותו תא => סתירה
            place(st, spec, i, BIT_TO_VAL.get(h));
            trail.push(i);
            changed = true;
          }
        }
      }
    }
    return true;
  }

  /* --------------------------------------------------------------------- */
  /* חיפוש (Backtracking + MRV)                                             */
  /* --------------------------------------------------------------------- */

  /**
   * חיפוש רקורסיבי. עוצר כשמספר הפתרונות שנמצאו הגיע ל-limit.
   * @returns {void} התוצאות נצברות ב-res
   */
  function searchRec(st, spec, limit, res, rng) {
    if (st.aborted) return;
    if (++st.nodes > st.nodeBudget) {
      st.aborted = true;
      return;
    }

    const base = res.trail.length;
    if (!propagate(st, spec, res.trail)) {
      rollback(st, spec, res.trail, base);
      return;
    }

    if (st.empty === 0) {
      res.count++;
      if (res.count === 1) res.solution = Int32Array.from(st.grid);
      rollback(st, spec, res.trail, base);
      return;
    }

    // MRV: בוחרים את התא עם הכי מעט מועמדים — מקטין דרסטית את עץ החיפוש.
    let bestIdx = -1;
    let bestMask = 0;
    let bestCount = spec.N + 1;
    for (let i = 0; i < spec.cells; i++) {
      if (st.grid[i]) continue;
      const cand = candidates(st, spec, i);
      const n = popcount(cand);
      if (n < bestCount) {
        bestCount = n;
        bestIdx = i;
        bestMask = cand;
        if (n === 2) break; // 2 הוא המינימום האפשרי כאן (1 טופל ב-propagate)
      }
    }

    const vals = maskToValues(bestMask);
    if (rng) shuffleInPlace(vals, rng);

    for (let k = 0; k < vals.length; k++) {
      place(st, spec, bestIdx, vals[k]);
      searchRec(st, spec, limit, res, rng);
      unplace(st, spec, bestIdx);
      if (res.count >= limit || st.aborted) break;
    }

    rollback(st, spec, res.trail, base);
  }

  /**
   * פותר / סופר פתרונות.
   * @param {ArrayLike<number>} grid לוח (0 = ריק)
   * @param {number} size גודל הלוח
   * @param {object} [opts] { limit, rng, nodeBudget }
   * @returns {{count:number, solution:Int32Array|null, aborted:boolean, nodes:number}}
   */
  function solve(grid, size, opts) {
    const spec = specFor(size);
    const o = opts || {};
    const st = createState(grid, spec);
    st.nodeBudget = o.nodeBudget || Infinity;
    const res = { count: 0, solution: null, trail: [] };
    searchRec(st, spec, o.limit || 1, res, o.rng || null);
    return {
      count: res.count,
      solution: res.solution,
      aborted: st.aborted,
      nodes: st.nodes,
    };
  }

  /** האם ללוח יש בדיוק פתרון אחד. */
  function hasUniqueSolution(grid, size, nodeBudget) {
    const r = solve(grid, size, { limit: 2, nodeBudget: nodeBudget });
    if (r.aborted) return false; // לא הצלחנו להכריע — נחשיב כלא-יחיד (שמרני)
    return r.count === 1;
  }

  /**
   * האם הפאזל פתיר בהיסק לוגי בלבד (Naked/Hidden Singles), בלי ניחושים.
   * משמש לדירוג קושי: פאזל "קל" חייב להיות פתיר כך.
   */
  function solvableByLogicOnly(grid, size) {
    const spec = specFor(size);
    const st = createState(grid, spec);
    const trail = [];
    if (!propagate(st, spec, trail)) return false;
    return st.empty === 0;
  }

  /* --------------------------------------------------------------------- */
  /* בדיקת חוקיות / התנגשויות                                               */
  /* --------------------------------------------------------------------- */

  /**
   * מחזיר Uint8Array שבו 1 = התא מתנגש עם תא מלא אחר באותה שורה/עמודה/תיבה.
   * מיועד לסימון שגיאות בזמן אמת בממשק.
   */
  function findConflicts(values, size) {
    const spec = specFor(size);
    const bad = new Uint8Array(spec.cells);
    const seenRow = [];
    const seenCol = [];
    const seenBox = [];
    for (let k = 0; k < spec.N; k++) {
      seenRow.push(new Int32Array(spec.N + 1).fill(-1));
      seenCol.push(new Int32Array(spec.N + 1).fill(-1));
      seenBox.push(new Int32Array(spec.N + 1).fill(-1));
    }
    for (let i = 0; i < spec.cells; i++) {
      const v = values[i];
      if (!v) continue;
      const r = spec.rowOf[i], c = spec.colOf[i], b = spec.boxOf[i];
      const groups = [seenRow[r], seenCol[c], seenBox[b]];
      for (let g = 0; g < 3; g++) {
        const prev = groups[g][v];
        if (prev >= 0) {
          bad[i] = 1;
          bad[prev] = 1;
        } else {
          groups[g][v] = i;
        }
      }
    }
    return bad;
  }

  /** האם הלוח מלא וחוקי לחלוטין. */
  function isSolved(values, size) {
    const spec = specFor(size);
    for (let i = 0; i < spec.cells; i++) if (!values[i]) return false;
    const bad = findConflicts(values, size);
    for (let i = 0; i < spec.cells; i++) if (bad[i]) return false;
    return true;
  }

  /* --------------------------------------------------------------------- */
  /* יצירת לוח פתור מלא                                                     */
  /* --------------------------------------------------------------------- */

  /**
   * יוצר לוח פתור אקראי.
   * טריק להאצה: ממלאים קודם את תיבות האלכסון (שאינן חולקות שורה/עמודה,
   * ולכן ניתן למלא אותן בפרמוטציה אקראית חופשית), ורק אז פותרים את השאר.
   * ב-16x16 זה מקצר משמעותית את זמן החיפוש.
   */
  function generateSolved(size, rng) {
    const spec = specFor(size);
    const grid = new Int32Array(spec.cells);
    const diagCount = Math.min(spec.boxesPerRow, spec.N / spec.boxH);

    for (let d = 0; d < diagCount; d++) {
      const b = d * spec.boxesPerRow + d; // תיבה על האלכסון
      const unit = spec.units[2 * spec.N + b];
      const vals = [];
      for (let v = 1; v <= spec.N; v++) vals.push(v);
      shuffleInPlace(vals, rng);
      for (let k = 0; k < spec.N; k++) grid[unit[k]] = vals[k];
    }

    const res = solve(grid, size, { limit: 1, rng: rng, nodeBudget: 2000000 });
    if (!res.solution) {
      // נדיר מאוד — ננסה שוב מאפס בלי זרעי אלכסון
      const res2 = solve(new Int32Array(spec.cells), size, {
        limit: 1,
        rng: rng,
      });
      return res2.solution;
    }
    return res.solution;
  }

  /* --------------------------------------------------------------------- */
  /* רמות קושי — יעדי רמזים (clues) לכל גודל לוח                            */
  /* --------------------------------------------------------------------- */

  const DIFFICULTY = {
    9: {
      easy: { clues: 44, logicOnly: true, timeBudget: 6000 },
      medium: { clues: 34, logicOnly: false, timeBudget: 8000 },
      hard: { clues: 28, logicOnly: false, timeBudget: 10000 },
      expert: { clues: 24, logicOnly: false, timeBudget: 14000 },
    },
    16: {
      // מתוך 256 תאים — יחסים מותאמים ללוח הגדול
      easy: { clues: 150, logicOnly: true, timeBudget: 15000 },
      medium: { clues: 128, logicOnly: false, timeBudget: 20000 },
      hard: { clues: 110, logicOnly: false, timeBudget: 25000 },
      // 100 הוא "נקודת השבירה" — מתחת לזה זמן היצירה מזנק (מדוד), ולכן
      // זהו האיזון הטוב ביותר בין קושי לבין המתנה סבירה במובייל.
      expert: { clues: 100, logicOnly: false, timeBudget: 30000 },
    },
  };

  const DIFFICULTY_ORDER = ['easy', 'medium', 'hard', 'expert'];

  /* --------------------------------------------------------------------- */
  /* יצירת פאזל                                                             */
  /* --------------------------------------------------------------------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * יוצר פאזל עם פתרון יחיד מובטח.
   *
   * אלגוריתם "חפירת חורים" (dig holes):
   *   1. יוצרים לוח פתור אקראי.
   *   2. עוברים על התאים בסדר אקראי ומנסים לרוקן כל אחד.
   *   3. אחרי כל ריקון בודקים שהפאזל עדיין בעל פתרון יחיד — אם לא, מחזירים.
   *   4. לרמת "קל" דורשים בנוסף שהפאזל יהיה פתיר בהיסק לוגי בלבד.
   *
   * הפונקציה אסינכרונית ומשחררת את ה-thread מדי כמה צעדים, כדי שהממשק
   * לא ייתקע — קריטי ב-16x16 שבו הבדיקות כבדות.
   *
   * @param {number} size 9 או 16
   * @param {string} difficulty easy|medium|hard|expert
   * @param {object} [opts] { seed, onProgress(0..1) }
   */
  async function generatePuzzle(size, difficulty, opts) {
    const o = opts || {};
    const spec = specFor(size);
    const conf = (DIFFICULTY[size] || DIFFICULTY[9])[difficulty] ||
      DIFFICULTY[size].medium;
    const seed = o.seed != null ? o.seed : (Math.random() * 4294967295) >>> 0;
    const rng = mulberry32(seed);
    const onProgress = o.onProgress || function () {};

    onProgress(0.02, 'בונה לוח פתור…');
    await sleep(0);

    const solution = generateSolved(size, rng);
    if (!solution) throw new Error('failed to build a solved board');

    onProgress(0.12, 'מסיר תאים…');
    await sleep(0);

    const puzzle = Int32Array.from(solution);
    const order = [];
    for (let i = 0; i < spec.cells; i++) order.push(i);
    shuffleInPlace(order, rng);

    // תקציב צמתים לבדיקת יחידות בודדת — מונע תקיעות בפאזלים פתולוגיים
    const nodeBudget = size === 16 ? 400000 : 60000;
    const target = conf.clues;
    const started = Date.now();
    let clues = spec.cells;
    const toRemove = spec.cells - target;

    for (let k = 0; k < order.length; k++) {
      if (clues <= target) break;
      if (Date.now() - started > conf.timeBudget) break; // עוצרים בזמן סביר

      const idx = order[k];
      const val = puzzle[idx];
      if (!val) continue;

      puzzle[idx] = 0;

      let ok = hasUniqueSolution(puzzle, size, nodeBudget);
      if (ok && conf.logicOnly) ok = solvableByLogicOnly(puzzle, size);

      if (ok) {
        clues--;
      } else {
        puzzle[idx] = val; // מחזירים — ההסרה שברה יחידות/רמת קושי
      }

      // משחררים את ה-thread מדי כמה בדיקות כדי לשמור על ממשק מגיב
      if ((k & (size === 16 ? 3 : 7)) === 0) {
        const removed = spec.cells - clues;
        onProgress(0.12 + 0.86 * Math.min(1, removed / toRemove), 'מסיר תאים…');
        await sleep(0);
      }
    }

    onProgress(1, 'מוכן!');

    return {
      size,
      difficulty,
      seed,
      puzzle: Array.from(puzzle),
      solution: Array.from(solution),
      clues,
    };
  }

  /* --------------------------------------------------------------------- */
  /* תצוגת ערכים (1-9, ומעל 9 => A..G ב-16x16)                              */
  /* --------------------------------------------------------------------- */

  const LETTERS = 'ABCDEFG'; // 10=A, 11=B, ... 16=G

  /** ממיר ערך פנימי (1..N) לתווית תצוגה קריאה. */
  function labelFor(value) {
    if (!value) return '';
    return value <= 9 ? String(value) : LETTERS[value - 10] || '?';
  }

  /* --------------------------------------------------------------------- */
  /* ייצוא                                                                  */
  /* --------------------------------------------------------------------- */

  global.SudokuCore = {
    // גיאומטריה
    buildSpec,
    specFor,
    SPECS,
    // פתרון ובדיקות
    solve,
    hasUniqueSolution,
    solvableByLogicOnly,
    findConflicts,
    isSolved,
    // יצירה
    generateSolved,
    generatePuzzle,
    DIFFICULTY,
    DIFFICULTY_ORDER,
    // תצוגה
    labelFor,
    // עזרים (חשופים לשימוש חוזר בשכבות אחרות)
    popcount,
    maskToValues,
    mulberry32,
    shuffleInPlace,
  };
})(typeof window !== 'undefined' ? window : globalThis);
