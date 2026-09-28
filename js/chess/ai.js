/* =============================================================================
 * chess/ai.js — היריב הממוחשב
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM.
 *
 * חיפוש negamax עם גיזום אלפא-בטא, העמקה הדרגתית (iterative deepening)
 * ומגבלת זמן, וחיפוש שקט (quiescence) בסוף כל ענף — כדי שהמחשב לא יעצור
 * באמצע חילופי כלים ויחשוב שהוא "מרוויח" מלכה שתיכף תילקח.
 *
 * הערכה: חומר + טבלאות מיקום (piece-square) — מלך מסתתר בפתיחה ויוצא
 * למרכז בסיום, רגלים מתקדמים שווים יותר, פרשים בשוליים שווים פחות.
 *
 * הרמות נבדלות בעומק, בזמן ובכמות ה"רעש" שמתווסף לציון מהלכי השורש.
 * רעש קטן גם ברמה הגבוהה, כדי שלא יפתח תמיד באותו מהלך בדיוק.
 * =========================================================================== */
(function (global) {
  'use strict';

  const Chess = global.Chess;

  const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const MATE = 100000;

  /* טבלאות מיקום מנקודת מבט הלבן; אינדקס 0 = a8. לשחור — שיקוף אנכי */
  const PST = {
    p: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0,
    ],
    n: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50,
    ],
    b: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20,
    ],
    r: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0,
    ],
    q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20,
    ],
    k: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20,
    ],
    kEnd: [
      -50, -40, -30, -20, -20, -30, -40, -50,
      -30, -20, -10, 0, 0, -10, -20, -30,
      -30, -10, 20, 30, 30, 20, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30,
      -30, -10, 30, 40, 40, 30, -10, -30,
      -30, -10, 20, 30, 30, 20, -10, -30,
      -30, -30, 0, 0, 0, 0, -30, -30,
      -50, -30, -30, -30, -30, -30, -30, -50,
    ],
  };

  /** הערכה מנקודת המבט של הצד שבתור (כמקובל ב-negamax) */
  function evaluate(g) {
    const b = g.board;
    let score = 0;
    let heavy = 0; // חומר שאינו רגלים ומלכים — לזיהוי סיום
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq];
      if (!p) continue;
      const t = p.toLowerCase();
      if (t !== 'p' && t !== 'k') heavy += VALUE[t];
    }
    const endgame = heavy <= 2600;

    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq];
      if (!p) continue;
      const white = p === p.toUpperCase();
      const t = p.toLowerCase();
      const r = sq >> 4, f = sq & 7;
      const idx = white ? r * 8 + f : (7 - r) * 8 + f;
      const table = t === 'k' ? (endgame ? PST.kEnd : PST.k) : PST[t];
      const v = VALUE[t] + table[idx];
      score += white ? v : -v;
    }
    return g.turn === 'w' ? score : -score;
  }

  /** סדר מהלכים: הכאות (הקורבן היקר ביותר, התוקף הזול ביותר) והכתרות קודם */
  function orderScore(m, best) {
    if (best && m.from === best.from && m.to === best.to && m.promo === best.promo) return 1e6;
    let s = 0;
    if (m.captured) s += 10 * VALUE[m.captured.toLowerCase()] - VALUE[m.piece.toLowerCase()] + 1000;
    if (m.promo) s += VALUE[m.promo.toLowerCase()] + 900;
    return s;
  }

  function sortMoves(list, best) {
    return list
      .map((m) => ({ m, s: orderScore(m, best) }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.m);
  }

  /** עד איזה עומק שומרים מפתחות עמדה לזיהוי חזרות */
  const KEY_PLIES = 3;

  /** זמן נגמר — זורקים כדי לצאת מכל עומקי הרקורסיה בבת אחת */
  const TIMEOUT = { timeout: true };

  function Searcher(g, deadline) {
    this.g = g;
    this.deadline = deadline;
    this.nodes = 0;
  }

  Searcher.prototype.tick = function () {
    if ((++this.nodes & 1023) === 0 && Date.now() > this.deadline) throw TIMEOUT;
  };

  /** חיפוש שקט: רק הכאות והכתרות, עד שהעמדה "נרגעת" */
  Searcher.prototype.quiesce = function (alpha, beta, qdepth) {
    this.tick();
    const g = this.g;
    const stand = evaluate(g);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (qdepth <= 0) return alpha;

    const us = g.turn;
    const them = us === 'w' ? 'b' : 'w';
    const list = sortMoves(g._pseudo(true));
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      g._make(m);
      if (g.attacked(g.kings[us], them)) { g._unmake(); continue; }
      const score = -this.quiesce(-beta, -alpha, qdepth - 1);
      g._unmake();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  Searcher.prototype.search = function (depth, alpha, beta, ply, quiet) {
    this.tick();
    const g = this.g;

    // תיקו בתוך העץ: 50 מהלכים, או חזרה על עמדה שכבר הופיעה. מפתח עמדה
    // יקר לבנייה, ולכן חזרות נבדקות רק בשכבות הקרובות לשורש — שם הן
    // משנות את ההחלטה בפועל
    if (ply > 0 && (g.half >= 100 || (ply <= KEY_PLIES && this.repeats()))) return 0;

    const us = g.turn;
    const them = us === 'w' ? 'b' : 'w';
    const inCheck = g.attacked(g.kings[us], them);
    if (inCheck) depth++; // הרחבת שח — לא עוצרים באמצע רצף שחים

    if (depth <= 0) return quiet ? this.quiesce(alpha, beta, 6) : evaluate(g);

    const list = sortMoves(g._pseudo(false));
    let legal = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      g._make(m);
      if (g.attacked(g.kings[us], them)) { g._unmake(); continue; }
      legal++;
      const track = ply + 1 <= KEY_PLIES;
      if (track) g.keys.push(g.key());
      const score = -this.search(depth - 1, -beta, -alpha, ply + 1, quiet);
      if (track) g.keys.pop();
      g._unmake();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    if (!legal) return inCheck ? -MATE + ply : 0;
    return alpha;
  };

  Searcher.prototype.repeats = function () {
    const keys = this.g.keys;
    const k = keys[keys.length - 1];
    for (let i = keys.length - 3; i >= 0; i -= 2) if (keys[i] === k) return true;
    return false;
  };

  /* --------------------------------------------------------------------- */
  /* רמות                                                                   */
  /* --------------------------------------------------------------------- */

  const LEVELS = {
    1: { depth: 1, time: 400, noise: 160, quiet: false, blunder: 0.25 },
    2: { depth: 2, time: 700, noise: 45, quiet: true, blunder: 0 },
    3: { depth: 3, time: 1200, noise: 12, quiet: true, blunder: 0 },
    4: { depth: 6, time: 1800, noise: 4, quiet: true, blunder: 0 },
  };

  /**
   * בוחר מהלך לצד שבתור.
   * @param {Chess} game — לא משתנה (החיפוש עובד על עותק)
   * @param {object} [opts] { level: 1-4, rng, time }
   * @returns {{ from:string, to:string, promotion:string|null, score:number, depth:number } | null}
   */
  function bestMove(game, opts) {
    opts = opts || {};
    const L = LEVELS[opts.level] || LEVELS[3];
    const rng = opts.rng || Math.random;
    const time = opts.time != null ? opts.time : L.time;

    // עותק: החיפוש לא נוגע במשחק שמוצג
    const g = new Chess(game.fen());
    g.keys = game.keys.slice();

    const root = g.moves();
    if (!root.length) return null;
    if (root.length === 1) return pack(root[0], 0, 0);

    // ברמת מתחילים — לפעמים מהלך אקראי לגמרי, כמו שחקן מתחיל אמיתי
    if (L.blunder && rng() < L.blunder) return pack(root[Math.floor(rng() * root.length)], 0, 0);

    const s = new Searcher(g, Date.now() + time);
    const noise = root.map(() => (rng() * 2 - 1) * L.noise);
    let best = null, bestScore = -Infinity, doneDepth = 0;

    for (let depth = 1; depth <= L.depth; depth++) {
      let iterBest = null, iterScore = -Infinity;
      const ordered = sortMoves(root, best);
      try {
        for (let i = 0; i < ordered.length; i++) {
          const m = ordered[i];
          g._make(m);
          g.keys.push(g.key());
          /*
           * חלון אלפא מהמהלך הטוב עד כה: מהלך שלא יכול לעלות עליו נגזם
           * מהר. מורידים ממנו פעמיים את הרעש, כדי שמהלך קרוב עדיין יקבל
           * ציון מדויק ויוכל לנצח בזכות הרעש
           */
          const alpha = iterScore === -Infinity ? -MATE - 1 : iterScore - 2 * L.noise - 1;
          const raw = -s.search(depth - 1, -MATE - 1, -alpha, 1, L.quiet);
          g.keys.pop();
          g._unmake();
          const score = raw + noise[root.indexOf(m)];
          if (score > iterScore) { iterScore = score; iterBest = m; }
        }
      } catch (e) {
        if (e !== TIMEOUT) throw e;
        // מחזירים את g למצב השורש — הזריקה קטעה את ה-unmake
        while (g.stack.length) g._unmake();
        g.keys = game.keys.slice();
        break;
      }
      best = iterBest;
      bestScore = iterScore;
      doneDepth = depth;
      if (Math.abs(bestScore) > MATE - 100) break; // נמצא מט — אין טעם להעמיק
    }
    if (!best) best = sortMoves(root)[0];
    return pack(best, bestScore, doneDepth);
  }

  function pack(m, score, depth) {
    return {
      from: Chess.sqName(m.from), to: Chess.sqName(m.to),
      promotion: m.promo ? m.promo.toLowerCase() : null,
      score: Math.round(score), depth,
    };
  }

  global.ChessAI = { bestMove, evaluate, LEVELS };
})(typeof window !== 'undefined' ? window : globalThis);
