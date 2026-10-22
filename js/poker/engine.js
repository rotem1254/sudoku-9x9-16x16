/* =============================================================================
 * poker/engine.js — חוקי טקסס הולדם ללא הגבלה
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM, ולכן נבדק ב-Node.
 *
 * כל מצב המשחק הוא אובייקט JSON רגיל (קלפים הם { rank, suit }), כך שהשמירה
 * היא פשוט JSON.stringify — גם באמצע יד, כולל החפיסה שנותרה.
 *
 * מבנה:
 *   game.players[i]  — שם, ערימת ז'יטונים, האם אנושי, האם בחוץ
 *   game.h           — היד הנוכחית: חפיסה, קלפי שולחן, ולכל מושב: קלפים,
 *                      הימור ברחוב הנוכחי (bet) וסך ההשקעה ביד (total)
 *
 * הזרימה: startHand → act (שוב ושוב, לפי h.toAct) → כש-toAct הוא ‎-1 הסיבוב
 * נגמר, ו-proceed פותח את הרחוב הבא או מחלק את הקופה. ההפרדה מכוונת: הממשק
 * רוצה להשהות בין סוף סיבוב לבין חשיפת הפלופ, וכשכולם הכל-אין — לחשוף את
 * הקלפים אחד-אחד ולא בבת אחת.
 *
 * חוקי ההעלאה: העלאה מינימלית = גודל ההעלאה המלאה האחרונה. הכל-אין שקטן
 * מהעלאה מלאה אינו "פותח מחדש" את ההימור — מי שכבר פעל מולו רשאי רק
 * להשוות או לוותר. קופות צד נבנות מסך ההשקעה של כל מושב ביד, ושבר
 * ז'יטון בחלוקה הולך לזוכה הראשון משמאל לכפתור.
 * =========================================================================== */
(function (global) {
  'use strict';

  const SUITS = ['s', 'h', 'd', 'c'];
  const SUIT_I = { s: 0, h: 1, d: 2, c: 3 };

  /* מדרגות הבליינדים. אחרי האחרונה ממשיכים להכפיל */
  const BLINDS = [
    [10, 20], [15, 30], [25, 50], [50, 100], [75, 150],
    [100, 200], [150, 300], [200, 400], [300, 600], [400, 800],
  ];

  const CAT_NAMES = [
    'קלף גבוה', 'זוג', 'שני זוגות', 'שלישייה', 'סטרייט',
    'פלאש', 'פול האוס', 'רביעייה', 'סטרייט פלאש', 'רויאל פלאש',
  ];

  /* --------------------------------------------------------------------- */
  /* חפיסה                                                                  */
  /* --------------------------------------------------------------------- */

  function makeDeck() {
    const d = [];
    for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ rank: r, suit: s });
    return d;
  }

  /** ערבוב פישר-ייטס. rng מוזרק כדי שבדיקות יהיו דטרמיניסטיות */
  function shuffle(deck, rng) {
    rng = rng || Math.random;
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    return deck;
  }

  /* --------------------------------------------------------------------- */
  /* הערכת יד                                                               */
  /* --------------------------------------------------------------------- */

  /*
   * הציון הוא מספר אחד: קטגוריה ואחריה חמש דרגות בבסיס 15. כך השוואת
   * ידיים היא השוואת מספרים, וזה מה שמאפשר לסימולציות של המחשב לרוץ
   * אלפי פעמים בשנייה.
   *
   * חמש הדרגות הן חמשת הקלפים עצמם לפי סדר החשיבות — זוג מלכים עם 9-7-5
   * הוא [13,13,9,7,5]. השוואה לקסיקוגרפית של הרצף היא בדיוק שובר השוויון
   * הנכון, ומאותו רצף אפשר אחר כך לשלוף את חמשת הקלפים המנצחים.
   * גלגל (A-2-3-4-5) נרשם [5,4,3,2,14]: הקלף הראשון, 5, הוא שקובע.
   */

  // מאגרים קבועים — evaluate רץ בלולאות חמות, ובלי הקצאה לכל קריאה
  const RC = new Int8Array(15);
  const SC = new Int8Array(4);
  const SM = new Int32Array(4);

  function pack(cat, r) {
    return ((((cat * 15 + (r[0] || 0)) * 15 + (r[1] || 0)) * 15 + (r[2] || 0)) * 15 + (r[3] || 0)) * 15 + (r[4] || 0);
  }

  /** הקלף הגבוה של הסטרייט הטוב במסכת דרגות, או 0 */
  function straightHigh(mask) {
    if (mask & (1 << 14)) mask |= 1 << 1; // אס גם כ-1
    for (let h = 14; h >= 5; h--) {
      if (((mask >> (h - 4)) & 31) === 31) return h;
    }
    return 0;
  }

  const straightRanks = (h) => (h === 5 ? [5, 4, 3, 2, 14] : [h, h - 1, h - 2, h - 3, h - 4]);

  function topBits(mask, n, skip) {
    const out = [];
    for (let r = 14; r >= 2 && out.length < n; r--) {
      if ((mask & (1 << r)) && (!skip || skip.indexOf(r) < 0)) out.push(r);
    }
    return out;
  }

  /** ציון של 2–7 קלפים (החמישייה הטובה ביותר) */
  function score(cards) {
    RC.fill(0); SC.fill(0); SM.fill(0);
    let mask = 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      const si = SUIT_I[c.suit];
      RC[c.rank]++;
      SC[si]++;
      SM[si] |= 1 << c.rank;
      mask |= 1 << c.rank;
    }

    let fs = -1;
    for (let s = 0; s < 4; s++) if (SC[s] >= 5) fs = s;
    if (fs >= 0) {
      const sh = straightHigh(SM[fs]);
      if (sh) return pack(sh === 14 ? 9 : 8, straightRanks(sh));
    }

    let quad = 0;
    const trips = [], pairs = [];
    for (let r = 14; r >= 2; r--) {
      const n = RC[r];
      if (n === 4) quad = r;
      else if (n === 3) trips.push(r);
      else if (n === 2) pairs.push(r);
    }

    if (quad) {
      const k = topBits(mask, 1, [quad]);
      return pack(7, [quad, quad, quad, quad, k[0]]);
    }
    if (trips.length && (trips.length > 1 || pairs.length)) {
      const t = trips[0];
      const p = Math.max(trips[1] || 0, pairs[0] || 0);
      return pack(6, [t, t, t, p, p]);
    }
    if (fs >= 0) return pack(5, topBits(SM[fs], 5));
    const sh = straightHigh(mask);
    if (sh) return pack(4, straightRanks(sh));
    if (trips.length) {
      const t = trips[0];
      const k = topBits(mask, 2, [t]);
      return pack(3, [t, t, t, k[0], k[1]]);
    }
    if (pairs.length >= 2) {
      const a = pairs[0], b = pairs[1];
      const k = topBits(mask, 1, [a, b]);
      return pack(2, [a, a, b, b, k[0]]);
    }
    if (pairs.length === 1) {
      const p = pairs[0];
      const k = topBits(mask, 3, [p]);
      return pack(1, [p, p, k[0], k[1], k[2]]);
    }
    return pack(0, topBits(mask, 5));
  }

  function decode(s) {
    const r = [];
    for (let i = 0; i < 5; i++) { r.unshift(s % 15); s = Math.floor(s / 15); }
    return { cat: s, ranks: r };
  }

  /* שמות בעברית — ברבים לקלפי תמונה ולאס, ספרה לקלפי מספר */
  const PLURAL = { 14: 'אסים', 13: 'מלכים', 12: 'מלכות', 11: 'נסיכים' };
  const LABEL = { 14: 'A', 13: 'K', 12: 'Q', 11: 'J' };
  const pl = (r) => PLURAL[r] || String(r);
  const lb = (r) => LABEL[r] || String(r);
  const and = (r) => (PLURAL[r] ? 'ו' : 'ו-') + pl(r);

  function describe(cat, r) {
    switch (cat) {
      case 9: return 'רויאל פלאש';
      case 8: return 'סטרייט פלאש עד ' + lb(r[0]);
      case 7: return 'רביעיית ' + pl(r[0]);
      case 6: return 'פול האוס, ' + pl(r[0]) + ' על ' + pl(r[3]);
      case 5: return 'פלאש, ' + lb(r[0]) + ' גבוה';
      case 4: return 'סטרייט עד ' + lb(r[0]);
      case 3: return 'שלישיית ' + pl(r[0]);
      case 2: return 'שני זוגות, ' + pl(r[0]) + ' ' + and(r[2]);
      case 1: return 'זוג ' + pl(r[0]);
      default: return 'קלף גבוה ' + lb(r[0]);
    }
  }

  /**
   * הערכה מלאה: ציון, קטגוריה, שם, תיאור, וחמשת הקלפים המנצחים.
   * הקלפים נשלפים מתוך רצף הדרגות של הציון, כך שהם תמיד תואמים לו.
   */
  function evaluate(cards) {
    const s = score(cards);
    const { cat, ranks } = decode(s);

    let suit = null;
    if (cat === 5 || cat === 8 || cat === 9) {
      const n = { s: 0, h: 0, d: 0, c: 0 };
      cards.forEach((c) => { n[c.suit]++; });
      suit = SUITS.find((x) => n[x] >= 5);
    }
    const used = new Set();
    const best = [];
    ranks.forEach((r) => {
      if (!r) return;
      const i = cards.findIndex((c, k) => !used.has(k) && c.rank === r && (!suit || c.suit === suit));
      if (i >= 0) { used.add(i); best.push(cards[i]); }
    });

    return { score: s, cat, ranks, name: CAT_NAMES[cat], desc: describe(cat, ranks), cards: best };
  }

  /* --------------------------------------------------------------------- */
  /* משחק                                                                   */
  /* --------------------------------------------------------------------- */

  /**
   * משחק חדש.
   * @param {Array<{name:string, human?:boolean}>} list
   * @param {object} [opts] { stack, handsPerLevel }
   */
  function newGame(list, opts) {
    opts = opts || {};
    return {
      players: list.map((p) => ({
        name: p.name,
        stack: opts.stack || 1000,
        human: !!p.human,
        out: false,
        bustHand: 0,
        // מעקב סגנון — היריב הקשה משתמש בזה כדי לקרוא שחקנים
        seen: { hands: 0, vpip: 0, raises: 0, calls: 0, folds: 0 },
      })),
      button: -1,
      hand: 0,
      handsPerLevel: opts.handsPerLevel || 10,
      h: null,
      over: false,
    };
  }

  function blindsFor(game, hand) {
    const lv = Math.floor(((hand || game.hand) - 1) / game.handsPerLevel);
    if (lv < BLINDS.length) return BLINDS[lv].slice();
    const last = BLINDS[BLINDS.length - 1];
    const k = Math.pow(2, lv - BLINDS.length + 1);
    return [last[0] * k, last[1] * k];
  }

  /** המושב הפעיל הבא אחרי from (לא כולל) — בין מי שעדיין במשחק */
  function nextActive(game, from) {
    const n = game.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + k) % n) + n) % n;
      if (!game.players[i].out) return i;
    }
    return -1;
  }

  const activeCount = (game) => game.players.filter((p) => !p.out).length;

  /** פותח יד חדשה. מחזיר false אם המשחק נגמר */
  function startHand(game, rng) {
    if (game.over || activeCount(game) < 2) { game.over = true; return false; }
    rng = rng || Math.random;
    const n = game.players.length;
    game.hand++;
    game.button = game.button < 0 ? nextActive(game, Math.floor(rng() * n) - 1) : nextActive(game, game.button);

    const [sb, bb] = blindsFor(game);
    const heads = activeCount(game) === 2;

    const h = {
      deck: shuffle(makeDeck(), rng),
      board: [],
      street: 'preflop',
      sb, bb,
      seats: game.players.map((p) => (p.out ? null : {
        hole: [], bet: 0, total: 0, folded: false, allIn: false,
        acted: false, canRaise: true, last: null,
      })),
      toAct: -1,
      currentBet: 0,
      minRaise: bb,
      fullLevel: 0,
      history: [],
      result: null,
    };
    game.h = h;

    // בשניים: הכפתור הוא הבליינד הקטן ופועל ראשון לפני הפלופ
    const sbIdx = heads ? game.button : nextActive(game, game.button);
    const bbIdx = nextActive(game, sbIdx);
    h.sbIdx = sbIdx;
    h.bbIdx = bbIdx;

    for (let round = 0; round < 2; round++) {
      let i = sbIdx;
      do {
        h.seats[i].hole.push(h.deck.pop());
        i = nextActive(game, i);
      } while (i !== sbIdx);
    }

    post(game, sbIdx, sb, 'sb');
    post(game, bbIdx, bb, 'bb');
    // גם אם הבליינד הגדול קצר, ההשוואה היא לבליינד המלא; העודף מוחזר בקופה
    h.currentBet = bb;
    h.fullLevel = bb;
    h.minRaise = bb;

    game.players.forEach((p, i) => { if (h.seats[i]) p.seen.hands++; });

    settle(game, heads ? sbIdx : nextActive(game, bbIdx));
    return true;
  }

  function post(game, i, amount, label) {
    const p = game.players[i];
    const s = game.h.seats[i];
    const a = Math.min(amount, p.stack);
    p.stack -= a;
    s.bet += a;
    s.total += a;
    s.last = label;
    if (p.stack === 0) s.allIn = true;
  }

  function needsAction(h, i) {
    const s = h.seats[i];
    return !!s && !s.folded && !s.allIn && (!s.acted || s.bet < h.currentBet);
  }

  /** קובע מי פועל עכשיו (החל מ-from, כולל), או ‎-1 אם הסיבוב נגמר */
  function settle(game, from) {
    const h = game.h;
    const n = h.seats.length;
    const inHand = [];
    h.seats.forEach((s, i) => { if (s && !s.folded) inHand.push(i); });

    h.toAct = -1;
    if (inHand.length < 2) return;
    const able = inHand.filter((i) => !h.seats[i].allIn);
    if (able.length === 0) return;
    if (able.length === 1) {
      // נשאר אחד שיכול לפעול: הוא צריך להחליט רק אם יש מולו הימור גבוה יותר
      const me = h.seats[able[0]];
      const maxOther = Math.max.apply(null, inHand.filter((i) => i !== able[0]).map((i) => h.seats[i].bet));
      if (me.bet >= maxOther) return;
    }
    for (let k = 0; k < n; k++) {
      const i = (((from + k) % n) + n) % n;
      if (needsAction(h, i)) { h.toAct = i; return; }
    }
  }

  /** הקופה כולה: מה שכבר נאסף ומה שמונח מול השחקנים */
  const potTotal = (h) => h.seats.reduce((a, s) => a + (s ? s.total : 0), 0);

  /** אילו פעולות מותרות לשחקן שתורו */
  function legal(game) {
    const h = game.h;
    if (!h || h.toAct < 0) return null;
    const i = h.toAct;
    const s = h.seats[i];
    const stack = game.players[i].stack;
    const owe = h.currentBet - s.bet;
    const toCall = Math.min(owe, stack);
    const maxTo = s.bet + stack;
    let othersAble = 0;
    h.seats.forEach((o, j) => { if (o && j !== i && !o.folded && !o.allIn) othersAble++; });
    const canRaise = s.canRaise && stack > owe && othersAble > 0;
    return {
      seat: i,
      toCall,
      canCheck: owe <= 0,
      canRaise,
      minTo: Math.min(h.currentBet + h.minRaise, maxTo),
      maxTo,
      currentBet: h.currentBet,
      bet: s.bet,
      stack,
      pot: potTotal(h),
    };
  }

  /**
   * פעולה של מי שתורו.
   * @param {{type:'fold'|'check'|'call'|'raise', to?:number}} a
   *   raise.to הוא סך ההימור ברחוב הזה (לא התוספת)
   * @returns {boolean} האם הפעולה חוקית ובוצעה
   */
  function act(game, a) {
    const L = legal(game);
    if (!L || !a) return false;
    const h = game.h;
    const i = L.seat;
    const s = h.seats[i];
    const p = game.players[i];
    let type = a.type;

    if (type === 'check') {
      if (!L.canCheck) return false;
      s.acted = true;
      s.last = 'check';
    } else if (type === 'call') {
      if (L.toCall === 0) {
        s.acted = true;
        s.last = 'check';
        type = 'check';
      } else {
        p.stack -= L.toCall;
        s.bet += L.toCall;
        s.total += L.toCall;
        s.acted = true;
        if (p.stack === 0) s.allIn = true;
        s.last = s.allIn ? 'allin' : 'call';
        p.seen.calls++;
        if (h.street === 'preflop' && !s.vpip) { s.vpip = true; p.seen.vpip++; }
      }
    } else if (type === 'fold') {
      s.folded = true;
      s.acted = true;
      s.last = 'fold';
      if (!L.canCheck) p.seen.folds++;
    } else if (type === 'raise') {
      if (!L.canRaise) return false;
      const to = Math.floor(a.to);
      if (!(to > h.currentBet) || to > L.maxTo) return false;
      if (to < L.minTo && to !== L.maxTo) return false;

      const prev = h.currentBet;
      const add = to - s.bet;
      p.stack -= add;
      s.bet = to;
      s.total += add;
      s.acted = true;
      if (p.stack === 0) s.allIn = true;
      s.last = s.allIn ? 'allin' : prev === 0 ? 'bet' : 'raise';
      p.seen.raises++;
      if (h.street === 'preflop' && !s.vpip) { s.vpip = true; p.seen.vpip++; }

      const full = to >= h.fullLevel + h.minRaise;
      if (full) {
        h.minRaise = Math.max(h.minRaise, to - prev);
        h.fullLevel = to;
      }
      h.currentBet = to;
      h.lastAggressor = i;
      h.seats.forEach((o, j) => {
        if (!o || j === i || o.folded || o.allIn) return;
        // הכל-אין קצר: מי שכבר פעל חייב להגיב, אבל רק בהשוואה או בוויתור
        if (full) o.canRaise = true;
        else if (o.acted) o.canRaise = false;
        o.acted = false;
      });
    } else {
      return false;
    }

    h.history.push({ seat: i, type: s.last === 'allin' ? 'allin' : type, to: s.bet, street: h.street });
    settle(game, i + 1);
    return true;
  }

  /* --------------------------------------------------------------------- */
  /* קופות                                                                  */
  /* --------------------------------------------------------------------- */

  /**
   * קופה ראשית וקופות צד, מתוך סך ההשקעה של כל מושב ביד.
   * בכל שלב: הסכום הקטן ביותר שהשקיע שחקן שעוד בפנים קובע "קומה". כל אחד
   * תורם עד הקומה, וזכאים לה רק מי שבפנים ותרמו לה. מי שוויתר תורם אבל
   * לא זכאי. קופה עם זכאי אחד בלבד היא בעצם החזר של הימור שאיש לא השווה.
   */
  function computePots(h) {
    const rem = h.seats.map((s) => (s ? s.total : 0));
    const pots = [];
    for (;;) {
      const live = [];
      h.seats.forEach((s, i) => { if (s && !s.folded && rem[i] > 0) live.push(i); });
      if (!live.length) {
        const left = rem.reduce((a, b) => a + b, 0);
        if (left > 0 && pots.length) {
          const last = pots[pots.length - 1];
          last.amount += left;
          rem.forEach((r, i) => { if (r > 0 && last.from.indexOf(i) < 0) last.from.push(i); });
        }
        break;
      }
      const level = Math.min.apply(null, live.map((i) => rem[i]));
      let amount = 0;
      const from = [];
      rem.forEach((r, i) => {
        const take = Math.min(r, level);
        amount += take;
        rem[i] -= take;
        if (take > 0) from.push(i);
      });
      const last = pots[pots.length - 1];
      if (last && last.eligible.join() === live.join()) {
        last.amount += amount;
        from.forEach((i) => { if (last.from.indexOf(i) < 0) last.from.push(i); });
      } else {
        pots.push({ amount, eligible: live, from });
      }
    }
    return pots;
  }

  /** מחלק את הקופות, מסמן מודחים, ומסיים את היד */
  function award(game) {
    const h = game.h;
    const n = h.seats.length;
    const contenders = [];
    h.seats.forEach((s, i) => { if (s && !s.folded) contenders.push(i); });

    const showdown = contenders.length > 1;
    const hands = {};
    if (showdown) {
      contenders.forEach((i) => { hands[i] = evaluate(h.seats[i].hole.concat(h.board)); });
    }

    // סדר קבלת שבר הז'יטון: משמאל לכפתור
    const order = (i) => (i - game.button - 1 + n * 2) % n;

    const pots = computePots(h).map((pot) => {
      let winners = pot.eligible;
      if (winners.length > 1) {
        const best = Math.max.apply(null, winners.map((i) => hands[i].score));
        winners = winners.filter((i) => hands[i].score === best);
      }
      winners = winners.slice().sort((a, b) => order(a) - order(b));
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      const paid = {};
      winners.forEach((w) => {
        const x = share + (odd > 0 ? 1 : 0);
        if (odd > 0) odd--;
        game.players[w].stack += x;
        paid[w] = x;
      });
      return { amount: pot.amount, eligible: pot.eligible, from: pot.from, winners, paid };
    });

    // סכום שכל שחקן קיבל — לא כולל החזר: קופה שרק הוא עצמו תרם לה
    const won = {};
    pots.forEach((p) => {
      if (p.from.length === 1 && p.from[0] === p.winners[0]) return;
      Object.keys(p.paid).forEach((w) => { won[w] = (won[w] || 0) + p.paid[w]; });
    });

    h.seats.forEach((s) => { if (s) s.bet = 0; });
    h.toAct = -1;
    h.street = 'done';
    h.result = { showdown, hands, pots, won };

    const busted = [];
    game.players.forEach((p, i) => {
      if (!p.out && p.stack === 0) {
        p.out = true;
        p.bustHand = game.hand;
        busted.push(i);
      }
    });
    h.result.busted = busted;

    const left = activeCount(game);
    const human = game.players.find((p) => p.human);
    if (left < 2 || (human && human.out)) {
      game.over = true;
      if (human) {
        // מקום: כמה עוד נשארו כשנפלת, ועוד אחד
        game.place = human.out ? left + 1 : 1;
      }
    }
    return h.result;
  }

  /**
   * ממשיך אחרי שסיבוב הימורים נגמר: אוסף הימורים, פותח רחוב, או מחלק.
   * כשאין מי שיפעל (כולם הכל-אין) — כל קריאה חושפת רחוב אחד.
   */
  function proceed(game) {
    const h = game.h;
    if (!h || h.toAct >= 0 || h.street === 'done') return false;

    h.seats.forEach((s) => {
      if (!s) return;
      s.bet = 0;
      s.acted = false;
      s.canRaise = true;
      if (s.last !== 'fold' && s.last !== 'allin') s.last = null;
    });

    const inHand = h.seats.filter((s) => s && !s.folded).length;
    if (inHand < 2 || h.board.length === 5) {
      award(game);
      return true;
    }

    h.deck.pop(); // שריפה
    if (h.board.length === 0) {
      h.board.push(h.deck.pop(), h.deck.pop(), h.deck.pop());
      h.street = 'flop';
    } else {
      h.board.push(h.deck.pop());
      h.street = h.board.length === 4 ? 'turn' : 'river';
    }
    h.currentBet = 0;
    h.fullLevel = 0;
    h.minRaise = h.bb;
    h.lastAggressor = undefined;
    settle(game, game.button + 1);
    return true;
  }

  /** סך כל הז'יטונים במשחק — בדיקת שימור */
  function totalChips(game) {
    let t = game.players.reduce((a, p) => a + p.stack, 0);
    if (game.h && game.h.street !== 'done') t += potTotal(game.h);
    return t;
  }

  global.Poker = {
    SUITS,
    BLINDS,
    CAT_NAMES,
    makeDeck,
    shuffle,
    score,
    evaluate,
    describe,
    newGame,
    blindsFor,
    startHand,
    legal,
    act,
    proceed,
    computePots,
    potTotal,
    totalChips,
    nextActive,
    activeCount,
  };
})(typeof window !== 'undefined' ? window : globalThis);
