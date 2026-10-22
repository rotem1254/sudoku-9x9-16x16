/* =============================================================================
 * poker/ai.js — יריבים ממוחשבים לפוקר, בארבע רמות
 * -----------------------------------------------------------------------------
 * ללא DOM. decide(game, { level, rng }) מחזיר פעולה חוקית לשחקן שתורו.
 *
 * הרמות שונות באופי ולא רק בכמות "חוכמה":
 *   1 מתחיל — רופף ופסיבי: משווה כמעט הכול, כמעט לא מעלה, טועה לפעמים.
 *             בדיוק השחקן שאפשר ללמוד מולו לשחק ידיים חזקות בשביל ערך.
 *   2 קל    — משחק לפי "דליים" של חוזק יד, כמעט בלי בלופים. צפוי.
 *   3 בינוני — מעריך סיכויי ניצחון בסימולציה (מונטה קרלו) מול מספר
 *             היריבים שנשארו, ומשווה ליחס הקופה. מבלף מדי פעם.
 *   4 קשה   — יותר סימולציות, גודל הימור משתנה, צ'ק-רייז, ומתאים את עצמו
 *             לסגנון של מי שמהמר מולו (אגרסיבי → משווה קל יותר).
 *
 * הסימולציה תחומה בזמן (עד ~120ms) — היא רצה על אותו thread כמו הממשק,
 * ובטלפון חלש הלוח לא אמור לקפוא בזמן שהיריב "חושב".
 * =========================================================================== */
(function (global) {
  'use strict';

  const P = global.Poker;

  const LEVELS = {
    1: { name: 'מתחיל', sims: 0 },
    2: { name: 'קל', sims: 0 },
    3: { name: 'בינוני', sims: 260, time: 70, noise: 0.05, bluff: 0.08 },
    4: { name: 'קשה', sims: 600, time: 120, noise: 0.02, bluff: 0.13 },
  };

  /* --------------------------------------------------------------------- */
  /* חוזק יד                                                                */
  /* --------------------------------------------------------------------- */

  /**
   * נוסחת צ'ן — ציון מהיר לשני קלפים לפני הפלופ, בערך בין 0 ל-20.
   * מנורמל ל-0..1 כדי שיתאים לאותם ספים כמו אחרי הפלופ.
   */
  function chen(a, b) {
    const hi = Math.max(a.rank, b.rank);
    const lo = Math.min(a.rank, b.rank);
    const base = (r) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
    let s = base(hi);
    if (hi === lo) return Math.min(1, Math.max(5, s * 2) / 20);
    if (a.suit === b.suit) s += 2;
    const gap = hi - lo - 1;
    s -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
    if (gap <= 1 && hi < 12) s += 1;
    return Math.max(0, Math.min(1, (Math.ceil(s) + 1) / 21));
  }

  /*
   * חוזק בלי סימולציה, לרמות הנמוכות: לפי הקטגוריה. אם השולחן לבדו
   * כבר נותן את אותה קטגוריה (זוג על השולחן), היד לא באמת שווה אותה.
   */
  const CAT_STRENGTH = [0.18, 0.5, 0.68, 0.78, 0.84, 0.87, 0.93, 0.97, 0.99, 1];

  function heuristic(hole, board) {
    if (board.length < 3) return chen(hole[0], hole[1]);
    const mine = P.evaluate(hole.concat(board));
    const table = P.evaluate(board);
    let s = CAT_STRENGTH[mine.cat];
    if (mine.cat === table.cat) s = 0.2 + (mine.cat >= 4 ? 0.3 : 0);
    // זוג נמוך שווה פחות מזוג גבוה
    if (mine.cat === 1) s += (mine.ranks[0] - 8) * 0.02;
    return Math.max(0, Math.min(1, s));
  }

  /**
   * סיכויי ניצחון (0..1) מול opps יריבים עם ידיים אקראיות. תיקו נספר
   * כחלק יחסי. נעצר אחרי sims סימולציות או כשהזמן נגמר.
   */
  function equity(hole, board, opps, sims, rng, timeMs) {
    rng = rng || Math.random;
    const known = new Set(hole.concat(board).map((c) => c.rank * 4 + P.SUITS.indexOf(c.suit)));
    const deck = P.makeDeck().filter((c) => !known.has(c.rank * 4 + P.SUITS.indexOf(c.suit)));
    const missing = 5 - board.length;
    const need = missing + opps * 2;
    const mine = hole.concat(board);
    const opp = [null, null].concat(board);
    const deadline = timeMs ? Date.now() + timeMs : Infinity;

    let wins = 0;
    let n = 0;
    for (; n < sims; n++) {
      if ((n & 31) === 31 && Date.now() > deadline) break;
      for (let k = 0; k < need; k++) {
        const j = k + Math.floor(rng() * (deck.length - k));
        const t = deck[k]; deck[k] = deck[j]; deck[j] = t;
      }
      for (let k = 0; k < missing; k++) { mine[2 + board.length + k] = deck[k]; opp[2 + board.length + k] = deck[k]; }
      const me = P.score(mine);
      let best = 0;
      let ties = 0;
      for (let o = 0; o < opps; o++) {
        opp[0] = deck[missing + o * 2];
        opp[1] = deck[missing + o * 2 + 1];
        const s = P.score(opp);
        if (s > best) { best = s; ties = 0; if (best > me) break; }
        else if (s === best) ties++;
      }
      if (me > best) wins += 1;
      else if (me === best) wins += 1 / (ties + 2);
    }
    return n ? wins / n : 0;
  }

  /* --------------------------------------------------------------------- */
  /* כלים                                                                   */
  /* --------------------------------------------------------------------- */

  /** הופך כוונה לפעולה חוקית: מעגל, מגביל, ומחליף פעולה אסורה בקרובה לה */
  function legalize(L, a) {
    if (a.type === 'fold' && L.canCheck) return { type: 'check' };
    if (a.type === 'check' && !L.canCheck) return { type: 'fold' };
    if (a.type === 'raise') {
      if (!L.canRaise) return { type: L.canCheck ? 'check' : 'call' };
      let to = Math.round(a.to / 5) * 5;
      // הימור שאוכל את רוב הערימה — עדיף פשוט הכל-אין
      if (to >= L.maxTo * 0.7) to = L.maxTo;
      to = Math.max(L.minTo, Math.min(L.maxTo, to));
      if (to <= L.currentBet) return { type: L.canCheck ? 'check' : 'call' };
      return { type: 'raise', to };
    }
    return { type: a.type };
  }

  /** העלאה לגודל יחסי לקופה (אחרי ההשוואה) */
  const sized = (L, frac) => ({ type: 'raise', to: L.currentBet + frac * (L.pot + L.toCall) });

  /* --------------------------------------------------------------------- */
  /* החלטה                                                                  */
  /* --------------------------------------------------------------------- */

  function decide(game, opts) {
    opts = opts || {};
    const level = opts.level || 2;
    const rng = opts.rng || Math.random;
    const L = P.legal(game);
    if (!L) return null;
    return legalize(L, think(game, L, level, rng));
  }

  function think(game, L, level, rng) {
    const h = game.h;
    const i = L.seat;
    const hole = h.seats[i].hole;
    const bb = h.bb;
    const r = rng();
    const preflop = h.board.length === 0;
    const opps = h.seats.filter((s, j) => s && j !== i && !s.folded).length;
    const potOdds = L.toCall > 0 ? L.toCall / (L.pot + L.toCall) : 0;

    /* ---------------- מתחיל: רופף ופסיבי ---------------- */
    if (level === 1) {
      const s = heuristic(hole, h.board);
      if (L.toCall === 0) {
        if (s > 0.8 && r < 0.5) return sized(L, 0.5);
        if (r < 0.07) return { type: 'raise', to: L.minTo };
        return { type: 'check' };
      }
      if (s > 0.88 && r < 0.3) return { type: 'raise', to: L.minTo };
      const cost = L.toCall / (L.stack + L.bet);
      if (cost > 0.45 && s < 0.55 && r < 0.75) return { type: 'fold' };
      if (s < 0.25 && r < 0.3) return { type: 'fold' };
      return { type: 'call' };
    }

    /* ---------------- קל: דליים של חוזק ---------------- */
    if (level === 2) {
      const s = heuristic(hole, h.board);
      if (L.toCall === 0) {
        if (s > 0.7 && r < 0.85) return sized(L, preflop ? 0.6 : 0.55 + r * 0.2);
        if (s > 0.5 && r < 0.3) return sized(L, 0.5);
        if (r < 0.04) return sized(L, 0.5);
        return { type: 'check' };
      }
      if (s > 0.86 && r < 0.75) return sized(L, 0.8);
      const need = potOdds + (preflop ? 0.08 : 0.18);
      if (s >= need || (s > 0.4 && L.toCall <= bb)) return { type: 'call' };
      return { type: 'fold' };
    }

    /* ---------------- בינוני וקשה: סימולציה ---------------- */
    const cfg = LEVELS[level];
    let eq = equity(hole, h.board, Math.max(1, opps), cfg.sims, rng, cfg.time);
    eq += (rng() - 0.5) * 2 * cfg.noise;

    const fair = 1 / (opps + 1);
    const valueT = 0.35 + 0.6 / (opps + 1);
    const stackBB = (L.stack + L.bet) / bb;
    const after = playersAfter(game, i);

    // ערימה קצרה: אין מקום לתמרון, רק "הכול או כלום"
    if (stackBB <= 10 && preflop) {
      if (eq > fair + (opps > 2 ? 0.1 : 0.06)) return { type: 'raise', to: L.maxTo };
      return L.canCheck ? { type: 'check' } : (eq > potOdds + 0.05 && L.toCall <= bb ? { type: 'call' } : { type: 'fold' });
    }

    // קריאת היריב (רק בקשה): מי שמעלה הרבה — מבלף יותר
    let margin = level === 4 ? 0.03 : 0.05;
    if (level === 4 && h.lastAggressor !== undefined && h.lastAggressor !== i) {
      const seen = game.players[h.lastAggressor].seen;
      const rate = seen.raises / Math.max(4, seen.hands);
      if (seen.hands >= 4 && rate > 0.45) margin -= 0.06;
      else if (seen.hands >= 4 && rate < 0.15) margin += 0.07;
    }

    if (L.toCall === 0) {
      if (eq > valueT) {
        // צ'ק-רייז: בקשה, עם יד חזקה כשיש אחריו מי שיהמר
        if (level === 4 && !preflop && after > 0 && eq > valueT + 0.12 && r < 0.22) return { type: 'check' };
        return sized(L, level === 4 ? 0.45 + rng() * 0.4 : 0.6);
      }
      if (eq > fair + 0.08 && r < 0.45) return sized(L, 0.5);
      // בלוף: יותר כשיש מעט יריבים ואחרון לדבר
      const bluff = cfg.bluff * (opps <= 2 ? 1 : 0.4) * (after === 0 ? 1.5 : 1);
      if (!preflop && r < bluff) return sized(L, level === 4 ? 0.5 + rng() * 0.3 : 0.6);
      return { type: 'check' };
    }

    if (eq > potOdds + margin) {
      if (eq > valueT + 0.1 && L.canRaise && r < (level === 4 ? 0.8 : 0.65)) {
        return sized(L, level === 4 ? 0.6 + rng() * 0.5 : 0.75);
      }
      return { type: 'call' };
    }
    // חצי-בלוף: יד שעוד יכולה להשתפר, בפלופ ובטרן
    if (level === 4 && (h.street === 'flop' || h.street === 'turn') && eq > 0.3 && r < 0.07 && L.canRaise) {
      return sized(L, 0.7);
    }
    return { type: 'fold' };
  }

  /** כמה שחקנים עוד יפעלו אחריו ברחוב הזה (מיקום) */
  function playersAfter(game, i) {
    const h = game.h;
    const n = h.seats.length;
    let count = 0;
    for (let k = 1; k < n; k++) {
      const j = (i + k) % n;
      if (j === (game.button + 1) % n && h.board.length) break;
      const s = h.seats[j];
      if (s && !s.folded && !s.allIn && !s.acted) count++;
    }
    return count;
  }

  global.PokerAI = { decide, equity, chen, heuristic, legalize, LEVELS };
})(typeof window !== 'undefined' ? window : globalThis);
