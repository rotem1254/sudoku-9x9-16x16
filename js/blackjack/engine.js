/* =============================================================================
 * blackjack/engine.js — מנוע בלאקג'ק
 * -----------------------------------------------------------------------------
 * חוקים בלבד, בלי DOM, ולכן נבדק ב-Node. הממשק (ui.js) רק מצייר את המצב
 * ומעביר אליו פעולות.
 *
 * מהלך סיבוב (phase):
 *   'bet'        מניחים הימור. deal() מחלק ועובר לשלב הבא
 *   'insurance'  לדילר אס גלוי — מציעים ביטוח לפני שהוא מציץ
 *   'player'     השחקן משחק את הידיים שלו, אחת אחרי השנייה
 *   'done'       הדילר שיחק, הכול שולם. newRound() חוזר ל-'bet'
 *
 * הרמות אינן "מחשב חכם יותר" — בבלאקג'ק הדילר משחק לפי חוק קבוע. הרמה
 * משנה שני דברים: את החוקים (מספר חפיסות, 17 רך, תשלום על בלאקג'ק,
 * הכפלה אחרי פיצול, כניעה), ואת העזרה (המלצה גלויה, רמז, הצגת סכום).
 * ככל שהרמה עולה יתרון הבית גדל והעזרה נעלמת.
 *
 * כסף: כל ההימורים בכפולות של 10, ולכן גם 3:2 (15) וגם 6:5 (12) וחצי
 * הימור לביטוח יוצאים מספרים שלמים — אין ז'יטונים של חצי.
 * =========================================================================== */
(function (global) {
  'use strict';

  const SUITS = ['s', 'h', 'd', 'c'];

  /** הרמות. ההבדלים מוסברים גם בחלון המשחק החדש. */
  const LEVELS = {
    1: {
      name: 'מתחיל', decks: 1, h17: false, bjPays: 1.5, das: true, surrender: true,
      advice: 'auto', totals: true, minBet: 10, maxBet: 500,
      desc: "חפיסה אחת, הדילר עומד על 17 רך, בלאקג'ק משלם 3:2. הכפתור המומלץ מסומן בכל מהלך.",
    },
    2: {
      name: 'קל', decks: 2, h17: false, bjPays: 1.5, das: true, surrender: true,
      advice: 'hint', totals: true, minBet: 10, maxBet: 1000,
      desc: "שתי חפיסות, אותם חוקים נוחים. אין המלצה גלויה, אבל יש כפתור רמז.",
    },
    3: {
      name: 'בינוני', decks: 6, h17: true, bjPays: 1.5, das: true, surrender: true,
      advice: 'none', totals: true, minBet: 50, maxBet: 2000,
      desc: "שש חפיסות, הדילר מושך על 17 רך. בלי רמזים. הימור מינימום 50.",
    },
    4: {
      name: 'קשה', decks: 8, h17: true, bjPays: 1.2, das: false, surrender: false,
      advice: 'none', totals: false, minBet: 100, maxBet: 5000,
      desc: "שמונה חפיסות, בלאקג'ק משלם רק 6:5, בלי הכפלה אחרי פיצול ובלי כניעה. הסכום לא מוצג — סופרים לבד.",
    },
  };

  const START_BANKROLL = 1000;
  const MAX_HANDS = 4; // עד שלושה פיצולים
  /* מעבירים לחפיסה חדשה כשנשאר רבע ממנה — כמו כרטיס החיתוך בקזינו */
  const PENETRATION = 0.75;

  /* --------------------------------------------------------------------- */
  /* קלפים וסכומים                                                          */
  /* --------------------------------------------------------------------- */

  /** ערך הקלף בבלאקג'ק: תמונות 10, אס 11 (ויורד ל-1 כשצריך). */
  const cardValue = (c) => (c.rank === 14 ? 11 : c.rank >= 10 ? 10 : c.rank);

  /**
   * סכום יד. soft = יש אס שנספר כ-11, כלומר קלף נוסף לא יכול לשרוף אותה.
   * @returns {{total:number, soft:boolean}}
   */
  function handValue(cards) {
    let total = 0;
    let aces = 0;
    for (const c of cards) {
      total += cardValue(c);
      if (c.rank === 14) aces++;
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return { total, soft: aces > 0 };
  }

  /** בלאקג'ק "טבעי": שני קלפים ראשונים שמגיעים ל-21. לא אחרי פיצול. */
  const isNatural = (cards) => cards.length === 2 && handValue(cards).total === 21;

  /** RNG ברירת מחדל. הבדיקות מזריקות RNG דטרמיניסטי. */
  const defaultRng = () => Math.random();

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function buildShoe(decks, rng) {
    const cards = [];
    for (let d = 0; d < decks; d++) {
      for (const suit of SUITS) {
        for (let rank = 2; rank <= 14; rank++) cards.push({ rank, suit });
      }
    }
    return shuffle(cards, rng);
  }

  /* --------------------------------------------------------------------- */
  /* אסטרטגיה בסיסית                                                        */
  /* --------------------------------------------------------------------- */

  /*
   * הטבלאות הסטנדרטיות למספר חפיסות. עמודה לכל קלף גלוי של הדילר: 2–10 ואז
   * אס. קוד בכל תא:
   *   H קלף · S עומד · P פיצול
   *   D הכפלה, ואם אסור — קלף · X הכפלה, ואם אסור — עומד
   *   R כניעה, ואם אסורה — קלף · Q כניעה, ואם אסורה — עומד · Y כניעה, ואם אסורה — פיצול
   * ההבדלים בין "עומד על 17 רך" (S17) ל"מושך על 17 רך" (H17) מיושמים
   * כתיקונים קטנים אחרי הטבלה, כדי שלא יהיו שתי טבלאות כמעט זהות.
   */
  //                    2    3    4    5    6    7    8    9    10   A
  const HARD = {
    8: 'HHHHHHHHHH',
    9: 'HDDDDHHHHH',
    10: 'DDDDDDDDHH',
    11: 'DDDDDDDDDH',
    12: 'HHSSSHHHHH',
    13: 'SSSSSHHHHH',
    14: 'SSSSSHHHHH',
    15: 'SSSSSHHHRH',
    16: 'SSSSSHHRRR',
    17: 'SSSSSSSSSS',
  };
  // לפי הקלף שאינו אס: A2 עד A9
  const SOFT = {
    13: 'HHHDDHHHHH',
    14: 'HHHDDHHHHH',
    15: 'HHDDDHHHHH',
    16: 'HHDDDHHHHH',
    17: 'HDDDDHHHHH',
    18: 'SXXXXSSHHH',
    19: 'SSSSSSSSSS',
    20: 'SSSSSSSSSS',
  };
  // לפי ערך הקלף בזוג (אס = 11). 5,5 ו-10,10 לא מתפצלים — הולכים לטבלה הרגילה
  const PAIRS = {
    2: 'PPPPPPHHHH',
    3: 'PPPPPPHHHH',
    4: 'HHHPPHHHHH',
    6: 'PPPPPHHHHH',
    7: 'PPPPPPHHHH',
    8: 'PPPPPPPPPP',
    9: 'PPPPPSPPSS',
    11: 'PPPPPPPPPP',
  };
  // בלי הכפלה אחרי פיצול, כמה זוגות קטנים כבר לא שווים פיצול
  const PAIRS_NO_DAS = {
    2: 'HHPPPPHHHH',
    3: 'HHPPPPHHHH',
    4: 'HHHHHHHHHH',
    6: 'HPPPPHHHHH',
  };

  const col = (up) => (up === 11 ? 9 : up - 2);

  function setCode(table, row, up, code) {
    const s = table[row];
    const i = col(up);
    return s.slice(0, i) + code + s.slice(i + 1);
  }

  function chartFor(rules) {
    const hard = Object.assign({}, HARD);
    const soft = Object.assign({}, SOFT);
    const pairs = Object.assign({}, PAIRS, rules.das ? {} : PAIRS_NO_DAS);
    if (rules.h17) {
      hard[11] = setCode(hard, 11, 11, 'D');
      hard[15] = setCode(hard, 15, 11, 'R');
      hard[17] = setCode(hard, 17, 11, 'Q');
      soft[18] = setCode(soft, 18, 2, 'X');
      soft[19] = setCode(soft, 19, 6, 'X');
      pairs[8] = setCode(pairs, 8, 11, 'Y');
    }
    return { hard, soft, pairs };
  }

  const chartCache = new Map();
  function chart(rules) {
    const key = (rules.h17 ? 'h' : 's') + (rules.das ? 'd' : 'n');
    if (!chartCache.has(key)) chartCache.set(key, chartFor(rules));
    return chartCache.get(key);
  }

  /**
   * הפעולה המומלצת לפי האסטרטגיה הבסיסית.
   *
   * @param {Array} cards הקלפים ביד
   * @param {object} upCard הקלף הגלוי של הדילר
   * @param {object} rules { h17, das }
   * @param {object} allowed { double, split, surrender } — מה מותר עכשיו
   * @returns {'hit'|'stand'|'double'|'split'|'surrender'}
   */
  function advise(cards, upCard, rules, allowed) {
    allowed = allowed || {};
    const up = cardValue(upCard);
    const c = chart(rules);
    const { total, soft } = handValue(cards);

    let code = null;
    if (allowed.split && cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1])) {
      const row = c.pairs[cardValue(cards[0])];
      if (row) {
        const p = row[col(up)];
        if (p === 'P' || p === 'Y') code = p;
      }
    }
    if (!code) {
      if (soft && total >= 13 && total <= 20) code = c.soft[total][col(up)];
      else if (soft && total === 21) code = 'S';
      // שני אסים שאי אפשר לפצל: 12 רך, שום קלף לא שורף אותו
      else if (soft) code = 'H';
      else if (total <= 8) code = 'H';
      // 18 ומעלה עומדים תמיד; 17 לפי הטבלה, בגלל הכניעה מול אס
      else if (total >= 18) code = 'S';
      else code = c.hard[total][col(up)];
    }

    switch (code) {
      case 'P': return 'split';
      case 'Y': return allowed.surrender ? 'surrender' : 'split';
      case 'D': return allowed.double ? 'double' : 'hit';
      case 'X': return allowed.double ? 'double' : 'stand';
      case 'R': return allowed.surrender ? 'surrender' : 'hit';
      case 'Q': return allowed.surrender ? 'surrender' : 'stand';
      case 'S': return 'stand';
      default: return 'hit';
    }
  }

  /* --------------------------------------------------------------------- */
  /* השולחן                                                                 */
  /* --------------------------------------------------------------------- */

  class Table {
    /**
     * @param {object} [opts] { level, bankroll, rng }
     */
    constructor(opts) {
      opts = opts || {};
      this.rng = opts.rng || defaultRng;
      this.level = LEVELS[opts.level] ? Number(opts.level) : 1;
      this.rules = LEVELS[this.level];
      this.bankroll = opts.bankroll != null ? opts.bankroll : START_BANKROLL;
      this.shoe = buildShoe(this.rules.decks, this.rng);
      this.shoeSize = this.shoe.length;
      this.nextId = 1;
      this.shuffled = false;
      this.resetRound();
    }

    resetRound() {
      this.phase = 'bet';
      this.hands = [];
      this.active = 0;
      this.dealer = [];
      this.insurance = 0;
      this.insuranceResult = 0;
      this.lastNet = 0;
    }

    /* ---------------------------- חפיסה ----------------------------- */

    draw() {
      if (!this.shoe.length) {
        /*
         * לא אמור לקרות — מערבבים מחדש לפני כל סיבוב כשנשאר רבע. אבל
         * בחפיסה אחת עם ארבעה פיצולים זה אפשרי, ואז פשוט פותחים חפיסה
         * חדשה במקום להיתקע
         */
        this.shoe = buildShoe(this.rules.decks, this.rng);
        this.shuffled = true;
      }
      const c = this.shoe.pop();
      c.id = this.nextId++;
      return c;
    }

    /** האם הגיע הזמן לערבב (נשאר פחות מרבע). */
    needsShuffle() {
      return this.shoe.length < this.shoeSize * (1 - PENETRATION);
    }

    /* ---------------------------- הימור ----------------------------- */

    /** האם אפשר להמר בסכום הזה עכשיו. */
    canBet(amount) {
      return this.phase === 'bet' &&
        Number.isInteger(amount) && amount % 10 === 0 &&
        amount >= this.rules.minBet && amount <= this.rules.maxBet &&
        amount <= this.bankroll;
    }

    /** האם נגמר הכסף לרמה הזו — אין מספיק אפילו להימור המינימלי. */
    broke() {
      return this.phase === 'bet' && this.bankroll < this.rules.minBet;
    }

    /**
     * מניח הימור ומחלק. מחזיר false אם ההימור אינו חוקי.
     */
    deal(amount) {
      if (!this.canBet(amount)) return false;
      this.shuffled = false;
      if (this.needsShuffle()) {
        this.shoe = buildShoe(this.rules.decks, this.rng);
        this.shuffled = true;
      }

      this.bankroll -= amount;
      const hand = { cards: [], bet: amount, doubled: false, split: false, splitAces: false,
        done: false, surrendered: false, result: null, payout: 0 };
      this.hands = [hand];
      this.active = 0;
      this.dealer = [];

      // סדר החלוקה האמיתי: שחקן, דילר, שחקן, דילר (הפוך)
      hand.cards.push(this.draw());
      this.dealer.push(this.draw());
      hand.cards.push(this.draw());
      this.dealer.push(this.draw());

      if (this.dealer[0].rank === 14) {
        this.phase = 'insurance';
        return true;
      }
      this.afterPeek();
      return true;
    }

    /** כמה עולה ביטוח — חצי מההימור. */
    insuranceCost() {
      return this.hands.length ? this.hands[0].bet / 2 : 0;
    }

    canInsure() {
      return this.phase === 'insurance' && this.bankroll >= this.insuranceCost();
    }

    /** תשובה להצעת הביטוח. */
    resolveInsurance(take) {
      if (this.phase !== 'insurance') return false;
      if (take && this.canInsure()) {
        this.insurance = this.insuranceCost();
        this.bankroll -= this.insurance;
      }
      this.afterPeek();
      return true;
    }

    /**
     * הדילר מציץ (כשהגלוי אס או 10). עם בלאקג'ק — הסיבוב נגמר מיד.
     * בלאקג'ק של השחקן בלי בלאקג'ק לדילר משולם מיד, בלי לשחק.
     */
    afterPeek() {
      const dealerBJ = isNatural(this.dealer);
      if (this.insurance) {
        // ביטוח משלם 2:1, כלומר מחזיר פי 3 מהעלות
        this.insuranceResult = dealerBJ ? this.insurance * 2 : -this.insurance;
        if (dealerBJ) this.bankroll += this.insurance * 3;
      }
      if (dealerBJ || isNatural(this.hands[0].cards)) {
        this.hands[0].done = true;
        this.finish(false);
        return;
      }
      this.phase = 'player';
    }

    /* ----------------------------- תורות ----------------------------- */

    current() {
      return this.phase === 'player' ? this.hands[this.active] : null;
    }

    /** מה מותר לעשות עכשיו ביד הפעילה. */
    allowed() {
      const h = this.current();
      const none = { hit: false, stand: false, double: false, split: false, surrender: false };
      if (!h) return none;
      const two = h.cards.length === 2;
      const v = (c) => cardValue(c);
      return {
        hit: !h.splitAces,
        stand: true,
        double: two && !h.splitAces && this.bankroll >= h.bet && (!h.split || this.rules.das),
        split: two && v(h.cards[0]) === v(h.cards[1]) && this.hands.length < MAX_HANDS &&
          this.bankroll >= h.bet && !(h.splitAces && h.cards[0].rank === 14),
        surrender: two && this.hands.length === 1 && !h.split && this.rules.surrender,
      };
    }

    /** האסטרטגיה הבסיסית ליד הפעילה. */
    advice() {
      const h = this.current();
      if (!h) return null;
      return advise(h.cards, this.dealer[0], this.rules, this.allowed());
    }

    /**
     * מבצע פעולה ביד הפעילה.
     * @param {'hit'|'stand'|'double'|'split'|'surrender'} action
     */
    act(action) {
      const h = this.current();
      if (!h || !this.allowed()[action]) return false;

      switch (action) {
        case 'hit':
          h.cards.push(this.draw());
          if (handValue(h.cards).total >= 21) h.done = true;
          break;
        case 'stand':
          h.done = true;
          break;
        case 'double':
          this.bankroll -= h.bet;
          h.bet *= 2;
          h.doubled = true;
          h.cards.push(this.draw());
          h.done = true;
          break;
        case 'surrender':
          h.surrendered = true;
          h.done = true;
          break;
        case 'split': {
          this.bankroll -= h.bet;
          const aces = h.cards[0].rank === 14;
          const second = h.cards.pop();
          const twin = { cards: [second], bet: h.bet, doubled: false, split: true, splitAces: aces,
            done: false, surrendered: false, result: null, payout: 0 };
          h.split = true;
          h.splitAces = aces;
          this.hands.splice(this.active + 1, 0, twin);
          // היד הנוכחית מקבלת קלף שני מיד; התאומה תקבל כשיגיע תורה
          h.cards.push(this.draw());
          if (aces) {
            // אסים מפוצלים מקבלים קלף אחד בלבד כל אחד
            twin.cards.push(this.draw());
            h.done = true;
            twin.done = true;
          } else if (handValue(h.cards).total === 21) {
            h.done = true;
          }
          break;
        }
        default:
          return false;
      }
      this.advance();
      return true;
    }

    /** עובר ליד הבאה שעוד לא הסתיימה, או לדילר. */
    advance() {
      while (this.active < this.hands.length && this.hands[this.active].done) {
        this.active++;
        const next = this.hands[this.active];
        if (next && next.cards.length === 1) {
          // יד מפוצלת שמגיע תורה — עכשיו היא מקבלת את הקלף השני
          next.cards.push(this.draw());
          if (handValue(next.cards).total === 21 && !next.splitAces) next.done = true;
        }
      }
      if (this.active >= this.hands.length) {
        this.active = this.hands.length - 1;
        this.finish(true);
      }
    }

    /* ----------------------------- סיום ------------------------------ */

    /**
     * תור הדילר ותשלום.
     * @param {boolean} play האם הדילר מושך (לא אחרי בלאקג'ק בהצצה)
     */
    finish(play) {
      const live = this.hands.some((h) => !h.surrendered && handValue(h.cards).total <= 21);
      const natural = this.hands.length === 1 && isNatural(this.hands[0].cards);
      if (play && live && !natural) {
        for (;;) {
          const { total, soft } = handValue(this.dealer);
          if (total > 17 || (total === 17 && !(soft && this.rules.h17))) break;
          this.dealer.push(this.draw());
        }
      }
      this.settle();
      this.phase = 'done';
    }

    settle() {
      const d = handValue(this.dealer).total;
      const dealerBJ = isNatural(this.dealer);
      let net = this.insuranceResult;

      for (const h of this.hands) {
        const p = handValue(h.cards).total;
        const natural = this.hands.length === 1 && isNatural(h.cards);
        let back = 0; // כמה חוזר לקופה, כולל ההימור עצמו

        if (h.surrendered) { h.result = 'surrender'; back = h.bet / 2; }
        else if (p > 21) { h.result = 'bust'; back = 0; }
        else if (natural && dealerBJ) { h.result = 'push'; back = h.bet; }
        else if (natural) { h.result = 'blackjack'; back = h.bet + Math.floor(h.bet * this.rules.bjPays); }
        else if (dealerBJ) { h.result = 'lose'; back = 0; }
        else if (d > 21 || p > d) { h.result = 'win'; back = h.bet * 2; }
        else if (p === d) { h.result = 'push'; back = h.bet; }
        else { h.result = 'lose'; back = 0; }

        h.payout = back - h.bet;
        this.bankroll += back;
        net += h.payout;
      }
      this.lastNet = net;
    }

    /** מנקה את השולחן לסיבוב הבא. */
    newRound() {
      if (this.phase !== 'done') return false;
      this.resetRound();
      return true;
    }

    /** מוסיף קופה חדשה כשנגמר הכסף. */
    rebuy() {
      this.bankroll += START_BANKROLL;
    }

    /* ----------------------------- שמירה ----------------------------- */

    toJSON() {
      return {
        level: this.level,
        bankroll: this.bankroll,
        shoe: this.shoe.map((c) => [c.rank, c.suit]),
        shoeSize: this.shoeSize,
        nextId: this.nextId,
        phase: this.phase,
        hands: this.hands,
        active: this.active,
        dealer: this.dealer,
        insurance: this.insurance,
        insuranceResult: this.insuranceResult,
        lastNet: this.lastNet,
      };
    }

    static fromJSON(data, rng) {
      const t = new Table({ level: data.level, bankroll: data.bankroll, rng });
      if (Array.isArray(data.shoe) && data.shoe.length) {
        t.shoe = data.shoe.map(([rank, suit]) => ({ rank, suit }));
      }
      t.shoeSize = data.shoeSize || t.shoeSize;
      t.nextId = data.nextId || 1;
      if (['bet', 'insurance', 'player', 'done'].includes(data.phase)) t.phase = data.phase;
      t.hands = Array.isArray(data.hands) ? data.hands : [];
      t.active = data.active || 0;
      t.dealer = Array.isArray(data.dealer) ? data.dealer : [];
      t.insurance = data.insurance || 0;
      t.insuranceResult = data.insuranceResult || 0;
      t.lastNet = data.lastNet || 0;
      // שמירה פגומה באמצע סיבוב — חוזרים בבטחה לשלב ההימור, בלי לאבד כסף
      if (t.phase !== 'bet' && (!t.hands.length || t.dealer.length < 2)) t.resetRound();
      return t;
    }
  }

  const Blackjack = {
    LEVELS, START_BANKROLL, MAX_HANDS,
    Table, handValue, isNatural, cardValue, advise, buildShoe,
  };

  global.Blackjack = Blackjack;
  if (typeof module !== 'undefined' && module.exports) module.exports = Blackjack;
})(typeof window !== 'undefined' ? window : globalThis);
