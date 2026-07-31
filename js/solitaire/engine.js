/* =============================================================================
 * solitaire/engine.js — מנוע סוליטר קלונדייק (Klondike)
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM. מחזיק את כל מצב המשחק, את חוקי החוקיות ואת ההיסטוריה.
 *
 * מבנה הלוח:
 *   stock       — חפיסת המשיכה
 *   waste       — הקלפים שנמשכו (הגלוי הוא האחרון)
 *   foundations — 4 ערימות סיום, אחת לכל צורה, מא' ועד מלך
 *   tableau     — 7 עמודות משחק, בסדר יורד ובצבעים מתחלפים
 * =========================================================================== */
(function (global) {
  'use strict';

  /* --------------------------------------------------------------------- */
  /* קלפים                                                                  */
  /* --------------------------------------------------------------------- */

  const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
  const SUIT_SYMBOL = {
    spades: '♠',
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
  };
  /** לב ויהלום אדומים — קובע את חוק "צבעים מתחלפים" בעמודות */
  const RED = { hearts: true, diamonds: true };

  const RANK_LABEL = [
    '', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
  ];

  const isRed = (suit) => !!RED[suit];

  /**
   * קלף מיוצג כמספר שלם יחיד: suitIndex * 13 + (rank - 1).
   * זה שומר על מצב המשחק קטן ופשוט לסריאליזציה, והשוואות הן פעולות מספריות.
   */
  const makeCard = (suitIndex, rank) => suitIndex * 13 + (rank - 1);
  const cardSuit = (c) => SUITS[(c / 13) | 0];
  const cardRank = (c) => (c % 13) + 1;
  const cardIsRed = (c) => isRed(cardSuit(c));
  const cardLabel = (c) => RANK_LABEL[cardRank(c)];
  const cardSymbol = (c) => SUIT_SYMBOL[cardSuit(c)];

  /* --------------------------------------------------------------------- */
  /* אקראיות עם seed — מאפשר לשחזר חלוקה מדויקת מתוך מספר יחיד              */
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

  function shuffled(rng) {
    const deck = [];
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push(makeCard(s, r));
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    return deck;
  }

  /* --------------------------------------------------------------------- */
  /* המשחק                                                                  */
  /* --------------------------------------------------------------------- */

  const TABLEAU_COUNT = 7;

  class Solitaire {
    /**
     * @param {object} [opts] { seed, drawCount } — drawCount הוא 1 או 3
     */
    constructor(opts) {
      const o = opts || {};
      this.seed = o.seed != null ? o.seed : (Math.random() * 4294967295) >>> 0;
      this.drawCount = o.drawCount === 3 ? 3 : 1;

      if (o.state) {
        this._load(o.state);
      } else {
        this._deal();
      }
    }

    /* ------------------------------ חלוקה ------------------------------ */

    _deal() {
      const deck = shuffled(mulberry32(this.seed));

      this.tableau = [];
      this.faceUp = []; // כמה קלפים גלויים בסוף כל עמודה
      let k = 0;
      for (let i = 0; i < TABLEAU_COUNT; i++) {
        const pile = [];
        for (let j = 0; j <= i; j++) pile.push(deck[k++]);
        this.tableau.push(pile);
        this.faceUp.push(1); // רק העליון גלוי
      }

      this.stock = deck.slice(k);
      this.waste = [];
      this.foundations = [[], [], [], []];

      this.moves = 0;
      this.score = 0;
      this.elapsed = 0;
      this.finished = false;
      this.recycles = 0;

      this.undoStack = [];
      this.redoStack = [];
      this._timerRunning = false;
      this._tickBase = 0;
    }

    /* ------------------------- שאילתות על המצב ------------------------- */

    /** האם הקלף במיקום index בעמודה pileIndex גלוי. */
    isFaceUp(pileIndex, index) {
      const pile = this.tableau[pileIndex];
      return index >= pile.length - this.faceUp[pileIndex];
    }

    /** הקלף העליון בערימה, או null. */
    static top(pile) {
      return pile.length ? pile[pile.length - 1] : null;
    }

    /** אינדקס ערימת הסיום המתאימה לצורה. */
    foundationFor(card) {
      return SUITS.indexOf(cardSuit(card));
    }

    /* ------------------------- חוקי חוקיות ----------------------------- */

    /**
     * האם מותר להניח קלף על ראש עמודת משחק.
     * מלך על עמודה ריקה, אחרת ערך אחד פחות ובצבע הפוך.
     */
    canPlaceOnTableau(card, pileIndex) {
      const pile = this.tableau[pileIndex];
      if (!pile.length) return cardRank(card) === 13;
      const t = pile[pile.length - 1];
      // אסור להניח על קלף הפוך
      if (!this.isFaceUp(pileIndex, pile.length - 1)) return false;
      return cardRank(card) === cardRank(t) - 1 && cardIsRed(card) !== cardIsRed(t);
    }

    /** האם מותר להניח קלף על ערימת סיום (אותה צורה, בסדר עולה מא'). */
    canPlaceOnFoundation(card, foundationIndex) {
      if (foundationIndex !== this.foundationFor(card)) return false;
      const f = this.foundations[foundationIndex];
      if (!f.length) return cardRank(card) === 1;
      return cardRank(card) === cardRank(f[f.length - 1]) + 1;
    }

    /**
     * האם רצף הקלפים מהאינדקס הזה ועד סוף העמודה ניתן להזזה כיחידה.
     * נדרש שכולם גלויים, יורדים ומתחלפים בצבע.
     */
    isMovableRun(pileIndex, fromIndex) {
      const pile = this.tableau[pileIndex];
      if (fromIndex < 0 || fromIndex >= pile.length) return false;
      if (!this.isFaceUp(pileIndex, fromIndex)) return false;
      for (let i = fromIndex; i < pile.length - 1; i++) {
        const a = pile[i];
        const b = pile[i + 1];
        if (cardRank(b) !== cardRank(a) - 1 || cardIsRed(a) === cardIsRed(b)) return false;
      }
      return true;
    }

    /* ------------------------- מנגנון היסטוריה ------------------------- */

    /** צילום מלא של המצב. הלוח קטן, ולכן פשוט יותר ובטוח יותר מ-diff. */
    _snapshot() {
      return {
        tableau: this.tableau.map((p) => p.slice()),
        faceUp: this.faceUp.slice(),
        stock: this.stock.slice(),
        waste: this.waste.slice(),
        foundations: this.foundations.map((f) => f.slice()),
        moves: this.moves,
        score: this.score,
        recycles: this.recycles,
      };
    }

    _restore(s) {
      this.tableau = s.tableau.map((p) => p.slice());
      this.faceUp = s.faceUp.slice();
      this.stock = s.stock.slice();
      this.waste = s.waste.slice();
      this.foundations = s.foundations.map((f) => f.slice());
      this.moves = s.moves;
      this.score = s.score;
      this.recycles = s.recycles;
    }

    _pushUndo() {
      this.undoStack.push(this._snapshot());
      // מהלך חדש הופך את ענף ה-redo ללא רלוונטי
      this.redoStack.length = 0;
      // תקרה שומרת על זיכרון סביר במשחק ארוך
      if (this.undoStack.length > 300) this.undoStack.shift();
    }

    canUndo() {
      return this.undoStack.length > 0 && !this.finished;
    }

    canRedo() {
      return this.redoStack.length > 0 && !this.finished;
    }

    undo() {
      if (!this.canUndo()) return false;
      // שומרים את ההווה כדי שאפשר יהיה לחזור אליו
      this.redoStack.push(this._snapshot());
      this._restore(this.undoStack.pop());
      return true;
    }

    redo() {
      if (!this.canRedo()) return false;
      this.undoStack.push(this._snapshot());
      this._restore(this.redoStack.pop());
      return true;
    }

    /* ----------------------------- פעולות ------------------------------ */

    /**
     * הופך קלף אחרון בעמודה אם הוא הפוך. מחזיר true אם נחשף קלף.
     * נקרא אחרי כל הזזה שיצאה מעמודה.
     */
    _revealIfNeeded(pileIndex) {
      const pile = this.tableau[pileIndex];
      if (!pile.length) {
        this.faceUp[pileIndex] = 0;
        return false;
      }
      if (this.faceUp[pileIndex] === 0) {
        this.faceUp[pileIndex] = 1;
        this.score += 5;
        return true;
      }
      // שמירה על עקביות: לא יותר גלויים ממה שיש בעמודה
      if (this.faceUp[pileIndex] > pile.length) this.faceUp[pileIndex] = pile.length;
      return false;
    }

    /**
     * משיכה מהחפיסה. כשהיא נגמרת — מחזירים את ה-waste אליה.
     * @returns {{ok:boolean, recycled?:boolean, drawn?:number}}
     */
    draw() {
      if (this.finished) return { ok: false };

      if (!this.stock.length) {
        if (!this.waste.length) return { ok: false };
        this._pushUndo();
        // הסדר מתהפך — כך זה עובד בחפיסה אמיתית
        this.stock = this.waste.reverse();
        this.waste = [];
        this.recycles++;
        this.moves++;
        // במשיכת אחד סיבוב נוסף עולה נקודות; במשיכת שלוש הוא חופשי
        if (this.drawCount === 1) this.score = Math.max(0, this.score - 20);
        return { ok: true, recycled: true };
      }

      this._pushUndo();
      const n = Math.min(this.drawCount, this.stock.length);
      for (let i = 0; i < n; i++) this.waste.push(this.stock.pop());
      this.moves++;
      return { ok: true, drawn: n };
    }

    /**
     * מזיז קלף/רצף בין מקומות.
     * מקור ויעד מתוארים כאובייקט { zone, pile, index }:
     *   zone: 'tableau' | 'waste' | 'foundation'
     *   pile: אינדקס העמודה/ערימה (לא רלוונטי ל-waste)
     *   index: אינדקס הקלף בעמודה (רק ל-tableau)
     * @returns {{ok:boolean, reason?:string, revealed?:boolean, won?:boolean}}
     */
    move(from, to) {
      if (this.finished) return { ok: false, reason: 'finished' };

      const cards = this._takeableCards(from);
      if (!cards || !cards.length) return { ok: false, reason: 'nothing-to-move' };

      // ערימת סיום מקבלת קלף בודד בלבד
      if (to.zone === 'foundation') {
        if (cards.length !== 1) return { ok: false, reason: 'foundation-single' };
        if (!this.canPlaceOnFoundation(cards[0], to.pile)) {
          return { ok: false, reason: 'illegal' };
        }
      } else if (to.zone === 'tableau') {
        if (!this.canPlaceOnTableau(cards[0], to.pile)) {
          return { ok: false, reason: 'illegal' };
        }
      } else {
        return { ok: false, reason: 'bad-target' };
      }

      // הזזה לאותו מקום אינה מהלך
      if (from.zone === to.zone && from.pile === to.pile) {
        return { ok: false, reason: 'same-pile' };
      }

      this._pushUndo();
      this._removeCards(from, cards.length);

      if (to.zone === 'foundation') {
        this.foundations[to.pile].push(cards[0]);
        this.score += 10;
      } else {
        const pile = this.tableau[to.pile];
        cards.forEach((c) => pile.push(c));
        this.faceUp[to.pile] += cards.length;
        // קלף שחוזר מערימת סיום לעמודה מאבד את הניקוד שקיבל
        if (from.zone === 'foundation') this.score = Math.max(0, this.score - 10);
      }

      let revealed = false;
      if (from.zone === 'tableau') revealed = this._revealIfNeeded(from.pile);

      this.moves++;
      const won = this.checkWin();
      return { ok: true, revealed, won };
    }

    /** הקלפים שיילקחו מהמקור, או null אם המקור אינו חוקי. */
    _takeableCards(from) {
      if (from.zone === 'waste') {
        const c = Solitaire.top(this.waste);
        return c == null ? null : [c];
      }
      if (from.zone === 'foundation') {
        const c = Solitaire.top(this.foundations[from.pile]);
        return c == null ? null : [c];
      }
      if (from.zone === 'tableau') {
        const pile = this.tableau[from.pile];
        const idx = from.index != null ? from.index : pile.length - 1;
        if (!this.isMovableRun(from.pile, idx)) return null;
        return pile.slice(idx);
      }
      return null;
    }

    _removeCards(from, count) {
      if (from.zone === 'waste') {
        this.waste.pop();
      } else if (from.zone === 'foundation') {
        this.foundations[from.pile].pop();
      } else {
        const pile = this.tableau[from.pile];
        pile.splice(pile.length - count, count);
        this.faceUp[from.pile] = Math.max(0, this.faceUp[from.pile] - count);
      }
    }

    /**
     * מחפש יעד הגיוני לקלף שנבחר — קודם ערימת סיום, אחר כך עמודה.
     * משמש בלחיצה כפולה ובכפתור "שלח לסיום".
     */
    findAutoTarget(from) {
      const cards = this._takeableCards(from);
      if (!cards || !cards.length) return null;

      if (cards.length === 1) {
        const f = this.foundationFor(cards[0]);
        if (this.canPlaceOnFoundation(cards[0], f)) {
          return { zone: 'foundation', pile: f };
        }
      }

      // מעדיפים עמודה לא ריקה, כדי לא לבזבז מקום פנוי על סתם קלף
      let empty = -1;
      for (let i = 0; i < TABLEAU_COUNT; i++) {
        if (from.zone === 'tableau' && from.pile === i) continue;
        if (!this.canPlaceOnTableau(cards[0], i)) continue;
        if (this.tableau[i].length) return { zone: 'tableau', pile: i };
        if (empty < 0) empty = i;
      }
      if (empty >= 0) return { zone: 'tableau', pile: empty };
      return null;
    }

    /** נוחות: מנסה להזיז אוטומטית ממקור נתון. */
    autoMove(from) {
      const to = this.findAutoTarget(from);
      if (!to) return { ok: false, reason: 'no-target' };
      return this.move(from, to);
    }

    /**
     * שולח לערימות הסיום כל מה שאפשר, שוב ושוב.
     * @returns {number} כמה קלפים נשלחו
     */
    autoCollect() {
      let total = 0;
      let moved = true;
      while (moved && !this.finished) {
        moved = false;
        const sources = [{ zone: 'waste' }];
        for (let i = 0; i < TABLEAU_COUNT; i++) {
          sources.push({ zone: 'tableau', pile: i });
        }
        for (const src of sources) {
          const cards = this._takeableCards(src);
          if (!cards || cards.length !== 1) continue;
          const f = this.foundationFor(cards[0]);
          if (!this.canPlaceOnFoundation(cards[0], f)) continue;
          if (this.move(src, { zone: 'foundation', pile: f }).ok) {
            total++;
            moved = true;
          }
        }
      }
      return total;
    }

    /**
     * צעד בודד לקראת סיום אוטומטי: שולח קלף אחד לערימת סיום, ואם אין מה
     * לשלוח — מושך מהחפיסה כדי לחשוף את הבא בתור.
     *
     * מוחזר צעד אחד ולא לולאה שלמה, כדי שהממשק יוכל להנפיש את הסיום
     * במקום שהלוח יקפוץ למצב מנוצח בבת אחת.
     *
     * @returns {{type:'collect'|'draw'}|null} null כשאין יותר מה לעשות
     */
    autoFinishStep() {
      const c = this.collectOne();
      if (c) return c;

      // שום דבר לא נאסף => מסובבים את החפיסה כדי להביא קלפים חדשים
      if (this.stock.length || this.waste.length) {
        if (this.draw().ok) return { type: 'draw' };
      }
      return null;
    }

    /**
     * שולח קלף בודד לערימת סיום, אם יש כזה. בלי משיכה מהחפיסה — זו
     * ההפרדה שמאפשרת לכפתור "אסוף" רק לאסוף, בלי לסובב את החפיסה מאחורי
     * גבו של השחקן.
     * @returns {{type:'collect'}|null}
     */
    collectOne() {
      const sources = [{ zone: 'waste' }];
      for (let i = 0; i < TABLEAU_COUNT; i++) sources.push({ zone: 'tableau', pile: i });

      for (const src of sources) {
        const cards = this._takeableCards(src);
        if (!cards || cards.length !== 1) continue;
        const f = this.foundationFor(cards[0]);
        if (!this.canPlaceOnFoundation(cards[0], f)) continue;
        if (this.move(src, { zone: 'foundation', pile: f }).ok) {
          return { type: 'collect', card: cards[0], to: f };
        }
      }
      return null;
    }

    /**
     * האם אפשר לסיים את המשחק בלחיצה אחת — כלומר כל הקלפים כבר גלויים
     * ואין קלפים הפוכים שחוסמים. רק אז מציעים "סיים אוטומטית".
     */
    canAutoFinish() {
      if (this.finished) return false;
      if (this.foundationCount() === 52) return false;
      for (let i = 0; i < TABLEAU_COUNT; i++) {
        if (this.faceUp[i] < this.tableau[i].length) return false;
      }
      return true;
    }

    foundationCount() {
      return this.foundations.reduce((n, f) => n + f.length, 0);
    }

    checkWin() {
      if (this.finished) return true;
      if (this.foundationCount() !== 52) return false;
      this.finished = true;
      this.stopTimer();
      return true;
    }

    /**
     * האם נותר מהלך שמקדם את המשחק.
     *
     * מה נחשב מהלך:
     *   - רצף גלוי מעמודה שאפשר להניח על עמודה אחרת או על ערימת סיום
     *   - קלף שעוד ימתין בחפיסה או ב-waste ושיש לו מקום חוקי
     *
     * מה *לא* נחשב:
     *   - החזרת קלף מערימת סיום לעמודה. זה חוקי אך נסיגה, ואילו נספר
     *     אותו כמעט לעולם לא היינו מזהים מבוי סתום.
     *   - העברת עמודה שלמה לעמודה ריקה אחרת. חוקי, אבל רק מחליף חורים
     *     ואפשר לחזור עליו עד אינסוף.
     *
     * ב-draw-3 ייתכן שקלף בחפיסה אינו נגיש בפועל בגלל סבב החלוקה. לכן
     * הבדיקה שמרנית לכיוון הבטוח: היא עלולה לומר "יש מהלך" כשאין, אך לא
     * תכריז על מבוי סתום כשעוד נותר מה לעשות.
     */
    hasAnyMove() {
      // --- רצפים מתוך עמודות המשחק ---
      for (let i = 0; i < TABLEAU_COUNT; i++) {
        const pile = this.tableau[i];
        const start = Math.max(0, pile.length - this.faceUp[i]);
        for (let j = start; j < pile.length; j++) {
          if (!this.isMovableRun(i, j)) continue;

          const card = pile[j];
          if (this.canPlaceOnFoundation(card, this.foundationFor(card))) return true;

          const movingWholePile = j === 0;
          for (let k = 0; k < TABLEAU_COUNT; k++) {
            if (k === i) continue;
            if (!this.canPlaceOnTableau(card, k)) continue;
            // חור מול חור — לא מקדם כלום
            if (movingWholePile && this.tableau[k].length === 0) continue;
            return true;
          }
        }
      }

      // --- קלפים שעוד עתידים לצוף מהחפיסה ומה-waste ---
      const pending = this.stock.concat(this.waste);
      for (let n = 0; n < pending.length; n++) {
        const card = pending[n];
        if (this.canPlaceOnFoundation(card, this.foundationFor(card))) return true;
        for (let k = 0; k < TABLEAU_COUNT; k++) {
          if (this.canPlaceOnTableau(card, k)) return true;
        }
      }

      return false;
    }

    /* ------------------------------ טיימר ------------------------------ */

    startTimer() {
      if (this._timerRunning || this.finished) return;
      this._timerRunning = true;
      this._tickBase = Date.now();
    }

    stopTimer() {
      if (!this._timerRunning) return;
      this.elapsed += (Date.now() - this._tickBase) / 1000;
      this._timerRunning = false;
    }

    get isTimerRunning() {
      return this._timerRunning;
    }

    currentSeconds() {
      const live = this._timerRunning ? (Date.now() - this._tickBase) / 1000 : 0;
      return Math.floor(this.elapsed + live);
    }

    /* --------------------------- שמירה ושחזור -------------------------- */

    serialize() {
      return {
        v: 1,
        seed: this.seed,
        drawCount: this.drawCount,
        tableau: this.tableau.map((p) => p.slice()),
        faceUp: this.faceUp.slice(),
        stock: this.stock.slice(),
        waste: this.waste.slice(),
        foundations: this.foundations.map((f) => f.slice()),
        moves: this.moves,
        score: this.score,
        recycles: this.recycles,
        elapsed: this.currentSeconds(),
        finished: this.finished,
        savedAt: Date.now(),
      };
    }

    _load(s) {
      this.tableau = s.tableau.map((p) => p.slice());
      this.faceUp = s.faceUp.slice();
      this.stock = s.stock.slice();
      this.waste = s.waste.slice();
      this.foundations = s.foundations.map((f) => f.slice());
      this.moves = s.moves || 0;
      this.score = s.score || 0;
      this.recycles = s.recycles || 0;
      this.elapsed = s.elapsed || 0;
      this.finished = !!s.finished;
      this.drawCount = s.drawCount === 3 ? 3 : 1;
      this.seed = s.seed;
      this.undoStack = [];
      this.redoStack = [];
      this._timerRunning = false;
      this._tickBase = 0;
    }

    static deserialize(data) {
      if (!data || !data.tableau || !data.foundations) return null;
      try {
        return new Solitaire({ state: data, seed: data.seed, drawCount: data.drawCount });
      } catch (e) {
        return null;
      }
    }
  }

  Solitaire.TABLEAU_COUNT = TABLEAU_COUNT;
  Solitaire.SUITS = SUITS;
  Solitaire.SUIT_SYMBOL = SUIT_SYMBOL;

  global.Solitaire = Solitaire;
  global.SolitaireCards = {
    makeCard,
    cardSuit,
    cardRank,
    cardIsRed,
    cardLabel,
    cardSymbol,
    isRed,
    mulberry32,
    shuffled,
    SUITS,
    SUIT_SYMBOL,
    RANK_LABEL,
  };
})(typeof window !== 'undefined' ? window : globalThis);
