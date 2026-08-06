/* =============================================================================
 * rummikub/engine.js — מנוע רמי קוב
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM.
 *
 * החפיסה: 106 אבנים — שני עותקים של 1..13 בארבעה צבעים (104), ועוד 2 ג'וקרים.
 *
 * צירופים חוקיים:
 *   סדרה (run)   — 3+ אבנים באותו צבע, במספרים עוקבים
 *   קבוצה (group) — 3 או 4 אבנים באותו מספר, כולן בצבעים שונים
 *
 * ג'וקר מחליף כל אבן. הערך שהוא מייצג נגזר מהצירוף שסביבו.
 *
 * חוק הפתיחה: בהנחה הראשונה של שחקן, סכום האבנים *שהוא הניח* חייב להיות
 * 30 לפחות, והוא אינו רשאי להיעזר באבנים שכבר על השולחן.
 * =========================================================================== */
(function (global) {
  'use strict';

  /* --------------------------------------------------------------------- */
  /* אבנים                                                                  */
  /* --------------------------------------------------------------------- */

  const COLORS = ['black', 'red', 'blue', 'orange'];
  const COLOR_LABEL = { black: 'שחור', red: 'אדום', blue: 'כחול', orange: 'כתום' };

  const MIN_NUMBER = 1;
  const MAX_NUMBER = 13;
  const COPIES = 2;
  const JOKERS = 2;

  /** ג'וקר מסומן בערך קבוע שאינו מתנגש עם אף אבן רגילה. */
  const JOKER = -1;

  /**
   * אבן רגילה מקודדת כמספר יחיד: colorIndex * 13 + (number - 1), ועוד
   * ביט לעותק. שני העותקים מקודדים בנפרד כדי שכל אבן בחפיסה תהיה ייחודית
   * ואפשר יהיה לזהות אותה חד-משמעית ב-UI ובשמירה.
   */
  const makeTile = (colorIndex, number, copy) =>
    (copy || 0) * 52 + colorIndex * MAX_NUMBER + (number - 1);

  const isJoker = (t) => t === JOKER;
  const tileColorIndex = (t) => (isJoker(t) ? -1 : ((t % 52) / MAX_NUMBER) | 0);
  const tileColor = (t) => (isJoker(t) ? null : COLORS[tileColorIndex(t)]);
  const tileNumber = (t) => (isJoker(t) ? 0 : ((t % 52) % MAX_NUMBER) + 1);
  const tileCopy = (t) => (isJoker(t) ? 0 : (t / 52) | 0);
  const tileLabel = (t) => (isJoker(t) ? '★' : String(tileNumber(t)));

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

  /** חפיסה מלאה: 104 אבנים ממוספרות + 2 ג'וקרים. */
  function fullDeck() {
    const deck = [];
    for (let copy = 0; copy < COPIES; copy++) {
      for (let c = 0; c < COLORS.length; c++) {
        for (let n = MIN_NUMBER; n <= MAX_NUMBER; n++) deck.push(makeTile(c, n, copy));
      }
    }
    for (let j = 0; j < JOKERS; j++) deck.push(JOKER);
    return deck;
  }

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /* --------------------------------------------------------------------- */
  /* חוקיות צירוף                                                           */
  /* --------------------------------------------------------------------- */

  /**
   * בודק אם אוסף אבנים מהווה **קבוצה**: אותו מספר, צבעים שונים, 3 או 4.
   *
   * ג'וקרים אינם מגבילים את המספר אבל כן תופסים צבע: קבוצה של 4 עם ג'וקר
   * אחד חייבת שלושה צבעים שונים מבין האמיתיות, והג'וקר לוקח את הרביעי.
   */
  function isGroup(tiles) {
    if (tiles.length < 3 || tiles.length > COLORS.length) return false;

    const real = tiles.filter((t) => !isJoker(t));
    const jokers = tiles.length - real.length;
    if (jokers > JOKERS) return false;
    if (!real.length) return false; // צירוף מג'וקרים בלבד אינו צירוף

    const number = tileNumber(real[0]);
    if (real.some((t) => tileNumber(t) !== number)) return false;

    const colors = new Set(real.map((t) => tileColorIndex(t)));
    if (colors.size !== real.length) return false; // צבע כפול

    // צריך להישאר מספיק צבעים פנויים לג'וקרים
    return COLORS.length - colors.size >= jokers;
  }

  /**
   * בודק אם אוסף אבנים מהווה **סדרה**: אותו צבע, מספרים עוקבים, 3+.
   *
   * הסדר שהתקבל אינו מחייב — האבנים ממוינות, והג'וקרים מוצבים בפערים.
   * זה מאפשר לממשק להעביר אבנים בסדר שבו השחקן הניח אותן.
   */
  function isRun(tiles) {
    if (tiles.length < 3 || tiles.length > MAX_NUMBER) return false;

    const real = tiles.filter((t) => !isJoker(t));
    let jokers = tiles.length - real.length;
    if (jokers > JOKERS) return false;
    if (!real.length) return false;

    const colorIdx = tileColorIndex(real[0]);
    if (real.some((t) => tileColorIndex(t) !== colorIdx)) return false;

    const numbers = real.map(tileNumber).sort((a, b) => a - b);
    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i] === numbers[i - 1]) return false; // אותה אבן פעמיים
    }

    // ממלאים את הפערים בג'וקרים
    for (let i = 1; i < numbers.length; i++) {
      const gap = numbers[i] - numbers[i - 1] - 1;
      jokers -= gap;
      if (jokers < 0) return false;
    }

    // ג'וקרים שנשארו נדחפים לקצוות, אם יש מקום בטווח 1..13
    const span = numbers[numbers.length - 1] - numbers[0] + 1;
    const roomBefore = numbers[0] - MIN_NUMBER;
    const roomAfter = MAX_NUMBER - numbers[numbers.length - 1];
    if (jokers > roomBefore + roomAfter) return false;

    return span + jokers === tiles.length;
  }

  /** האם האוסף הוא צירוף חוקי כלשהו. */
  const isValidSet = (tiles) => isGroup(tiles) || isRun(tiles);

  /**
   * הטווח שסדרה מכסה בפועל, כולל ההכרעה איפה יושבים הג'וקרים העודפים.
   *
   * שלושה מקומות צריכים בדיוק את אותה הכרעה — הניקוד, סדר התצוגה,
   * וחוק החלפת הג'וקר — ואם הם היו מחשבים אותה בנפרד, אבן הייתה מוצגת
   * במקום אחד, נספרת כמשהו אחר, ומוחלפת באבן שלישית. לכן זה יושב כאן.
   *
   * @returns {{low:number, high:number, color:number, byNumber:Map}|null}
   */
  function runSpan(tiles) {
    if (!isRun(tiles)) return null;

    const real = tiles.filter((t) => !isJoker(t));
    const jokers = tiles.length - real.length;
    const color = tileColorIndex(real[0]);

    const byNumber = new Map();
    real.forEach((t) => byNumber.set(tileNumber(t), t));
    const numbers = real.map(tileNumber).sort((a, b) => a - b);

    let low = numbers[0];
    let high = numbers[numbers.length - 1];
    let spare = jokers - (high - low + 1 - real.length); // ג'וקרים שאינם בפערים

    // דוחפים את העודפים קודם למעלה, כי זה שווה יותר
    while (spare > 0 && high < MAX_NUMBER) { high++; spare--; }
    while (spare > 0 && low > MIN_NUMBER) { low--; spare--; }

    return { low, high, color, byNumber };
  }

  /**
   * ניקוד צירוף. ג'וקר שווה את הערך שהוא מייצג בפועל, ולכן חייבים לגזור
   * אותו מהצירוף ולא להניח ערך קבוע.
   * @returns {number} 0 אם הצירוף אינו חוקי
   */
  function setValue(tiles) {
    if (!isValidSet(tiles)) return 0;

    if (isGroup(tiles)) {
      // בקבוצה כל האבנים באותו ערך, כולל הג'וקרים
      const real = tiles.filter((t) => !isJoker(t));
      return tileNumber(real[0]) * tiles.length;
    }

    const span = runSpan(tiles);
    let sum = 0;
    for (let n = span.low; n <= span.high; n++) sum += n;
    return sum;
  }

  /**
   * מה כל ג'וקר בצירוף מייצג בפועל.
   *
   * בסדרה התשובה יחידה — מספר וצבע. בקבוצה המספר קבוע אבל הצבע אינו
   * מוכרע: הג'וקר עומד במקום *אחד* מהצבעים החסרים, וכל אחד מהם תקף.
   *
   * @returns {Array<Array<{color:number, number:number}>>}
   *   איבר לכל ג'וקר, ובו כל האבנים שיכולות להחליף אותו
   */
  function jokerSubstitutes(tiles) {
    if (!isValidSet(tiles)) return [];
    const jokers = tiles.filter(isJoker).length;
    if (!jokers) return [];

    if (isGroup(tiles)) {
      const real = tiles.filter((t) => !isJoker(t));
      const number = tileNumber(real[0]);
      const used = new Set(real.map(tileColorIndex));
      const free = [];
      for (let c = 0; c < COLORS.length; c++) {
        if (!used.has(c)) free.push({ color: c, number });
      }
      return new Array(jokers).fill(null).map(() => free);
    }

    const span = runSpan(tiles);
    const out = [];
    for (let n = span.low; n <= span.high; n++) {
      if (!span.byNumber.has(n)) out.push([{ color: span.color, number: n }]);
    }
    return out;
  }

  /**
   * מסדר צירוף לסדר התצוגה הטבעי שלו.
   *
   *   סדרה  — לפי המספר, כולל הג'וקרים שיושבים בדיוק במקום שהם מייצגים
   *   קבוצה — לפי סדר הצבעים הקבוע, וג'וקרים בסוף
   *
   * צירוף שאינו חוקי מוחזר כמו שהוא: באמצע התור השחקן מסדר אבנים ועדיין
   * לא בנה צירוף, ואסור לקפוץ לו על הידיים.
   *
   * שיבוץ הג'וקרים מגיע מ-runSpan, המקור היחיד שגם setValue וגם חוק
   * החלפת הג'וקר נשענים עליו.
   *
   * @param {number[]} tiles
   * @returns {number[]} מערך חדש
   */
  function orderSet(tiles) {
    if (!isValidSet(tiles)) return tiles.slice();

    const real = tiles.filter((t) => !isJoker(t));
    let jokers = tiles.length - real.length;

    if (isGroup(tiles)) {
      const sorted = real.slice().sort((a, b) => tileColorIndex(a) - tileColorIndex(b));
      while (jokers-- > 0) sorted.push(JOKER);
      return sorted;
    }

    const span = runSpan(tiles);
    const out = [];
    for (let n = span.low; n <= span.high; n++) {
      out.push(span.byNumber.has(n) ? span.byNumber.get(n) : JOKER);
    }
    return out;
  }

  /** מסדר את כל צירופי השולחן. */
  const orderTable = (table) => table.map(orderSet);

  /** סכום האבנים ביד — הקנס בסוף משחק. ג'וקר נספר 30. */
  function rackValue(tiles) {
    return tiles.reduce((sum, t) => sum + (isJoker(t) ? 30 : tileNumber(t)), 0);
  }

  /* --------------------------------------------------------------------- */
  /* השולחן                                                                 */
  /* --------------------------------------------------------------------- */

  /**
   * האם כל הצירופים על השולחן חוקיים. זו הבדיקה שמריצים בסוף תור:
   * ברמי קוב מותר לפרק ולסדר מחדש את השולחן כרצונך, ובלבד שבסוף התור
   * כל מה שעליו חוקי.
   * @returns {{ok:boolean, badIndex:number}}
   */
  function validateTable(sets) {
    for (let i = 0; i < sets.length; i++) {
      if (!isValidSet(sets[i])) return { ok: false, badIndex: i };
    }
    return { ok: true, badIndex: -1 };
  }

  /* --------------------------------------------------------------------- */
  /* המשחק                                                                  */
  /* --------------------------------------------------------------------- */

  const RACK_SIZE = 14;
  const INITIAL_MELD = 30;

  class Rummikub {
    /**
     * @param {object} [opts] { seed, players } — players הוא 2..4
     */
    constructor(opts) {
      const o = opts || {};
      if (o.state) {
        this._load(o.state);
        return;
      }

      this.seed = o.seed != null ? o.seed : (Math.random() * 4294967295) >>> 0;
      this.playerCount = Math.min(4, Math.max(2, o.players || 2));
      this._deal();
    }

    _deal() {
      const deck = shuffle(fullDeck(), mulberry32(this.seed));

      this.racks = [];
      for (let p = 0; p < this.playerCount; p++) {
        this.racks.push(deck.splice(0, RACK_SIZE));
      }
      this.pool = deck; // מה שנשאר — הבריכה למשיכה
      this.table = []; // מערך של צירופים
      this.melded = new Array(this.playerCount).fill(false); // מי כבר פתח
      this.turn = 0;
      this.finished = false;
      this.winner = -1;
      this.moves = 0;
      // ספירת מסירות רצופות — מסיימת משחק שנתקע כשהבריכה ריקה
      this.passes = 0;
    }

    /* ------------------------------ שאילתות ---------------------------- */

    get currentRack() {
      return this.racks[this.turn];
    }

    hasMelded(player) {
      return this.melded[player == null ? this.turn : player];
    }

    poolCount() {
      return this.pool.length;
    }

    /** עותק עמוק של השולחן — נקודת שחזור לתור שלא הושלם. */
    snapshotTable() {
      return this.table.map((set) => set.slice());
    }

    /* ------------------------------ פעולות ----------------------------- */

    /**
     * מסיים תור שבו השחקן הניח אבנים.
     *
     * @param {number[][]} table   מצב השולחן המוצע
     * @param {number[]} rack      היד שנותרה לשחקן
     * @returns {{ok:boolean, reason?:string, meldValue?:number}}
     */
    commitTurn(table, rack) {
      if (this.finished) return { ok: false, reason: 'finished' };

      // 1. כל האבנים חייבות להישמר — אי אפשר להמציא או להעלים
      const before = this._allTiles();
      const after = []
        .concat(...table, rack)
        .concat(...this.racks.filter((_, i) => i !== this.turn))
        .concat(this.pool);
      if (!sameMultiset(before, after)) return { ok: false, reason: 'tiles-mismatch' };

      // 2. כל צירוף על השולחן חייב להיות חוקי
      const check = validateTable(table);
      if (!check.ok) return { ok: false, reason: 'invalid-set', badIndex: check.badIndex };

      // 3. חייב להניח לפחות אבן אחת
      const placed = this._placedTiles(table);
      if (!placed.length) return { ok: false, reason: 'nothing-placed' };

      // 4. חוקי הג'וקר
      const jokerCheck = this._jokerCheck(table, rack);
      if (!jokerCheck.ok) return jokerCheck;

      // 5. חוק הפתיחה
      if (!this.melded[this.turn]) {
        const check2 = this._initialMeldCheck(table, placed);
        if (!check2.ok) return check2;
        this.melded[this.turn] = true;
      }

      this.table = table.map((s) => s.slice());
      this.racks[this.turn] = rack.slice();
      this.moves++;
      this.passes = 0; // מישהו הצליח להניח — המשחק לא תקוע

      if (!this.racks[this.turn].length) {
        this.finished = true;
        this.winner = this.turn;
        return { ok: true, won: true };
      }

      this._nextTurn();
      return { ok: true };
    }

    /**
     * בפתיחה מותר להשתמש רק באבנים מהיד, והסכום שלהן חייב להגיע ל-30.
     * אבנים שכבר היו על השולחן אינן נספרות, ואסור לגעת בהן בכלל.
     */
    _initialMeldCheck(table, placed) {
      const existing = countTiles([].concat(...this.table));
      const proposed = countTiles([].concat(...table));

      // אף אבן שהייתה על השולחן לא הוזזה מצירוף לצירוף:
      // בודקים שכל צירוף קיים עדיין נמצא כמות שהוא
      const stillIntact = this.table.every((set) =>
        table.some((s) => sameMultiset(s, set))
      );
      if (!stillIntact) return { ok: false, reason: 'meld-touches-table' };

      let value = 0;
      for (const set of table) {
        // רק צירופים חדשים לגמרי נספרים לפתיחה
        if (this.table.some((s) => sameMultiset(s, set))) continue;
        value += setValue(set);
      }

      if (value < INITIAL_MELD) {
        return { ok: false, reason: 'meld-too-low', meldValue: value };
      }
      void existing;
      void proposed;
      void placed;
      return { ok: true, meldValue: value };
    }

    /**
     * חוקי הג'וקר — הכלל שהכי הרבה גרסאות ביתיות מפספסות.
     *
     * מהחוקים הרשמיים:
     *   "צירוף שיש בו ג'וקר אפשר להוסיף לו אבנים, אבל אי אפשר לקחת ממנו
     *    דבר ואי אפשר לסדר אותו מחדש כל עוד הג'וקר בתוכו"
     *   "שחקן שיש *בידו* האבן שהג'וקר מייצג יכול להחליף אותה בג'וקר,
     *    ואז לשלב את הג'וקר בצירוף אחר על השולחן"
     *   "ג'וקר שהשתחרר כך אינו יכול להילקח ליד לשימוש מאוחר יותר"
     *
     * המנוע מאמת מצב סופי בלבד, ולכן החוק הזה נבדק בהשוואה בין השולחן
     * שלפני התור לזה שאחריו: כל צירוף שהיה בו ג'וקר חייב להימצא כמות
     * שהוא (אולי עם תוספות) — או שהג'וקר הוחלף כדין.
     *
     * @param {number[][]} table השולחן בסוף התור
     * @param {number[]} rack המגש בסוף התור
     */
    _jokerCheck(table, rack) {
      /* ג'וקר לא חוזר ליד. אם מספרם ביד גדל — מישהו לקח אחד מהשולחן */
      const jokersBefore = this.racks[this.turn].filter(isJoker).length;
      const jokersAfter = rack.filter(isJoker).length;
      if (jokersAfter > jokersBefore) return { ok: false, reason: 'joker-to-rack' };

      for (const set of this.table) {
        if (!set.some(isJoker)) continue;

        // א. נשאר שלם, אולי עם תוספות — זה תמיד מותר
        if (table.some((t) => containsAll(t, set))) continue;

        // ב. אחרת מותר רק אם כל ג'וקר הוחלף באבן שהוא ייצג, מהיד
        if (this._jokerReplaced(set, table)) continue;

        return { ok: false, reason: 'joker-locked' };
      }
      return { ok: true };
    }

    /**
     * האם הצירוף פורק כדין: כל ג'וקר שבו הוחלף באבן שהוא מייצג, האבן
     * הגיעה מהיד, והצירוף שנוצר נמצא על השולחן.
     */
    _jokerReplaced(set, table) {
      const options = jokerSubstitutes(set);
      if (!options.length) return false;

      const real = set.filter((t) => !isJoker(t));
      const hand = this.racks[this.turn];

      /* כל שילוב של החלפות — חסום, כי יש לכל היותר 2 ג'וקרים ו-4 צבעים */
      const combos = (function build(i) {
        if (i === options.length) return [[]];
        const rest = build(i + 1);
        const out = [];
        for (const opt of options[i]) for (const r of rest) out.push([opt].concat(r));
        return out;
      })(0);

      for (const combo of combos) {
        const pool = hand.slice();
        const swapped = [];
        let possible = true;

        for (const want of combo) {
          const idx = pool.findIndex((t) =>
            !isJoker(t) && tileColorIndex(t) === want.color && tileNumber(t) === want.number);
          if (idx < 0) { possible = false; break; }
          swapped.push(pool.splice(idx, 1)[0]);
        }
        if (!possible) continue;

        const target = real.concat(swapped);
        if (table.some((t) => containsAll(t, target))) return true;
      }
      return false;
    }

    /** אבנים שנוספו לשולחן ביחס למצב הקודם. */
    _placedTiles(table) {
      const before = countTiles([].concat(...this.table));
      const out = [];
      for (const t of [].concat(...table)) {
        if (before[t] > 0) before[t]--;
        else out.push(t);
      }
      return out;
    }

    /**
     * מושך אבן ומעביר את התור. זה מה שעושים כשאין מה להניח.
     * @returns {{ok:boolean, tile?:number, reason?:string}}
     */
    drawTile() {
      if (this.finished) return { ok: false, reason: 'finished' };
      if (!this.pool.length) {
        /*
         * הבריכה ריקה ואין מה להניח — זו מסירה. כשכל השחקנים מסרו ברצף
         * המשחק תקוע, ולפי החוקים הוא נגמר: מנצח מי שנשארו לו הכי מעט
         * נקודות ביד. בלי זה המשחק היה נכנס ללולאה אינסופית.
         */
        this.passes++;
        this._nextTurn();
        if (this.passes >= this.playerCount) {
          this.finished = true;
          this.winner = lowestRack(this.racks);
          return { ok: true, tile: null, empty: true, stalemate: true };
        }
        return { ok: true, tile: null, empty: true };
      }
      const tile = this.pool.pop();
      this.racks[this.turn].push(tile);
      this.moves++;
      this.passes = 0; // משיכה משנה את המצב, אז זו אינה מסירה
      this._nextTurn();
      return { ok: true, tile };
    }

    _nextTurn() {
      this.turn = (this.turn + 1) % this.playerCount;
    }

    _allTiles() {
      return []
        .concat(...this.table)
        .concat(...this.racks)
        .concat(this.pool);
    }

    /** ניקוד סופי: המנצח מקבל את סכום הקנסות של כולם. */
    /**
     * ניקוד סופי, לפי החוקים הרשמיים — ושתי הדרכים לסיים שונות זו מזו:
     *
     *   ניצחון רגיל (מישהו רוקן את המגש) — המנצח מקבל את סכום כל אבני
     *   האחרים, וכל אחד מהאחרים מפסיד את מה שנשאר בידו.
     *
     *   בריכה ריקה בלי מנצח — מנצח מי שנשארו לו הכי מעט נקודות, אבל
     *   הספירה היא של *ההפרש* ממנו ולא של המגש המלא. מי שנשארו לו 12
     *   מול מנצח עם 10 מפסיד 2, לא 12. קודם נספר כאן המגש המלא, וזו
     *   הייתה טעות: היא העניקה למנצח גם את האבנים שנשארו בידו שלו
     */
    finalScores() {
      const penalties = this.racks.map((r) => rackValue(r));
      if (this.winner < 0) return penalties.map((p) => -p);

      const base = penalties[this.winner]; // 0 בניצחון רגיל
      const scores = penalties.map((p) => -(p - base));
      scores[this.winner] = penalties.reduce((sum, p) => sum + (p - base), 0);
      return scores;
    }

    /* --------------------------- שמירה ושחזור -------------------------- */

    serialize() {
      return {
        v: 1,
        seed: this.seed,
        playerCount: this.playerCount,
        racks: this.racks.map((r) => r.slice()),
        pool: this.pool.slice(),
        table: this.table.map((s) => s.slice()),
        melded: this.melded.slice(),
        turn: this.turn,
        finished: this.finished,
        winner: this.winner,
        moves: this.moves,
        passes: this.passes,
        savedAt: Date.now(),
      };
    }

    /**
     * עותק עצמאי לחלוטין של המשחק. משמש להשוואת מהלכים חלופיים מאותה
     * עמדה בדיוק, בלי לגעת במשחק האמיתי.
     */
    clone() {
      return new Rummikub({ state: this.serialize() });
    }

    _load(s) {
      this.seed = s.seed;
      this.playerCount = s.playerCount;
      this.racks = s.racks.map((r) => r.slice());
      this.pool = s.pool.slice();
      this.table = s.table.map((t) => t.slice());
      this.melded = s.melded.slice();
      this.turn = s.turn || 0;
      this.finished = !!s.finished;
      this.winner = s.winner == null ? -1 : s.winner;
      this.moves = s.moves || 0;
      this.passes = s.passes || 0;
    }

    static deserialize(data) {
      if (!data || !data.racks || !data.table) return null;
      try {
        return new Rummikub({ state: data });
      } catch (e) {
        return null;
      }
    }
  }

  /* --------------------------------------------------------------------- */
  /* עזרים                                                                  */
  /* --------------------------------------------------------------------- */

  /** אינדקס השחקן עם הכי מעט נקודות ביד. */
  function lowestRack(racks) {
    let best = 0;
    let bestValue = Infinity;
    racks.forEach((r, i) => {
      const v = rackValue(r);
      if (v < bestValue) { bestValue = v; best = i; }
    });
    return best;
  }

  function countTiles(tiles) {
    const map = Object.create(null);
    for (const t of tiles) map[t] = (map[t] || 0) + 1;
    return map;
  }

  /** האם שני אוספים מכילים בדיוק אותן אבנים, בלי תלות בסדר. */
  function sameMultiset(a, b) {
    if (a.length !== b.length) return false;
    const ca = countTiles(a);
    const cb = countTiles(b);
    for (const k in ca) if (ca[k] !== cb[k]) return false;
    for (const k in cb) if (cb[k] !== ca[k]) return false;
    return true;
  }

  /** האם `big` מכיל את כל אבני `small`, כולל כפילויות. */
  function containsAll(big, small) {
    if (small.length > big.length) return false;
    const have = countTiles(big);
    for (const t of small) {
      if (!have[t]) return false;
      have[t]--;
    }
    return true;
  }

  Rummikub.RACK_SIZE = RACK_SIZE;
  Rummikub.INITIAL_MELD = INITIAL_MELD;
  Rummikub.COLORS = COLORS;

  global.Rummikub = Rummikub;
  global.RummikubTiles = {
    COLORS,
    COLOR_LABEL,
    JOKER,
    MIN_NUMBER,
    MAX_NUMBER,
    makeTile,
    isJoker,
    tileColor,
    tileColorIndex,
    tileNumber,
    tileCopy,
    tileLabel,
    fullDeck,
    shuffle,
    mulberry32,
    isGroup,
    isRun,
    isValidSet,
    setValue,
    runSpan,
    jokerSubstitutes,
    orderSet,
    orderTable,
    containsAll,
    rackValue,
    validateTable,
    sameMultiset,
  };
})(typeof window !== 'undefined' ? window : globalThis);
