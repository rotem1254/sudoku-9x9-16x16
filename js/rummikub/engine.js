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
   * ניקוד צירוף. ג'וקר שווה את הערך שהוא מייצג בפועל, ולכן חייבים לגזור
   * אותו מהצירוף ולא להניח ערך קבוע.
   * @returns {number} 0 אם הצירוף אינו חוקי
   */
  function setValue(tiles) {
    if (!isValidSet(tiles)) return 0;

    const real = tiles.filter((t) => !isJoker(t));
    const jokers = tiles.length - real.length;

    if (isGroup(tiles)) {
      // בקבוצה כל האבנים באותו ערך, כולל הג'וקרים
      return tileNumber(real[0]) * tiles.length;
    }

    // בסדרה: סכום כל הטווח, פחות מה שכבר ידוע — הג'וקרים משלימים אותו
    const numbers = real.map(tileNumber).sort((a, b) => a - b);
    let low = numbers[0];
    let high = numbers[numbers.length - 1];
    let spare = jokers - (high - low + 1 - real.length); // ג'וקרים שאינם בפערים

    // דוחפים את העודפים קודם למעלה, כי זה שווה יותר
    while (spare > 0 && high < MAX_NUMBER) { high++; spare--; }
    while (spare > 0 && low > MIN_NUMBER) { low--; spare--; }

    let sum = 0;
    for (let n = low; n <= high; n++) sum += n;
    return sum;
  }

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

      // 4. חוק הפתיחה
      if (!this.melded[this.turn]) {
        const check2 = this._initialMeldCheck(table, placed);
        if (!check2.ok) return check2;
        this.melded[this.turn] = true;
      }

      this.table = table.map((s) => s.slice());
      this.racks[this.turn] = rack.slice();
      this.moves++;

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
        // הבריכה נגמרה — התור עובר בלי משיכה
        this._nextTurn();
        return { ok: true, tile: null, empty: true };
      }
      const tile = this.pool.pop();
      this.racks[this.turn].push(tile);
      this.moves++;
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
    finalScores() {
      const penalties = this.racks.map((r) => rackValue(r));
      const scores = penalties.map((p) => -p);
      if (this.winner >= 0) {
        scores[this.winner] = penalties.reduce((a, b) => a + b, 0);
      }
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
        savedAt: Date.now(),
      };
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
    rackValue,
    validateTable,
    sameMultiset,
  };
})(typeof window !== 'undefined' ? window : globalThis);
