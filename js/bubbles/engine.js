/* =============================================================================
 * bubbles/engine.js — מנוע באבלס (Bubble Shooter)
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM.
 *
 * הלוח הוא רשת משושים בשורות מוסטות: כל שורה שנייה זזה חצי בועה ימינה
 * ומכילה בועה אחת פחות. כל הגיאומטריה ביחידות של קוטר בועה אחד:
 *   x של תא = c + 0.5 (+0.5 בשורה מוסטת),  y = r * ROW_H + 0.5
 * ROW_H = √3/2 — המרחק האנכי בין שורות צמודות במשושים.
 *
 * "איזו שורה מוסטת" נקבע ע"י shift. כשנדחפת שורה חדשה מלמעלה כל השורות
 * יורדות אחת, ו-shift מתהפך — כך כל בועה שומרת על מיקומה הפיזי.
 *
 * אין שלבים: הלוח מתחדש כל הזמן. כשהבועות מתדלדלות ונשארות פחות מ-
 * refillRows שורות, שורות חדשות נדחפות מלמעלה עד שחוזרים לעומק הזה — כך
 * תמיד יש במה לירות, והמשחק נמשך עד שהבועות מגיעות לקו.
 *
 * trace(angle) מחשב את מסלול הירייה (כולל קפיצות מהקירות) ואת התא שבו
 * הבועה תיעצר. אותה פונקציה משמשת גם לקו הכיוון וגם לירייה עצמה, ולכן מה
 * שרואים בכוונת הוא בדיוק מה שקורה.
 * =========================================================================== */
(function (global) {
  'use strict';

  const ROW_H = Math.sqrt(3) / 2;
  const EMPTY = -1;

  /* מרחק מרכזים שנחשב פגיעה. מעט פחות מקוטר, כדי שבועה תוכל לעבור ברווח
     צר בלי להיתקע בשפה של שכנה — כך זה מרגיש במשחק המקורי */
  const HIT_DIST = 0.82;
  const STEP = 0.08;

  /* מידות המשחק הקלאסי: 17 בועות לרוחב, 9 שורות בפתיחה.
     refillRows — העומק המינימלי; מתחתיו הלוח מתמלא מחדש מלמעלה */
  const DEFAULTS = { cols: 17, rows: 17, startRows: 9, refillRows: 5 };

  /* בונוס על ניקוי הלוח כולו */
  const CLEAR_BONUS = 500;

  const MIN_ANGLE = (8 * Math.PI) / 180;
  const MAX_ANGLE = Math.PI - MIN_ANGLE;

  /**
   * @param {object} [opts]
   * @param {number} [opts.cols=17]
   * @param {number} [opts.rows=17] השורה האחרונה כבר מחוץ ללוח — בועה שם מסיימת
   * @param {number} [opts.startRows=9]
   * @param {number} [opts.refillRows=5]
   * @param {function} [opts.rng=Math.random]
   * @param {number[][]} [opts.grid] לוח נתון (בדיקות ושחזור)
   */
  function Bubbles(opts) {
    opts = opts || {};
    this.cols = opts.cols || DEFAULTS.cols;
    this.rows = opts.rows || DEFAULTS.rows;
    this.startRows = opts.startRows || DEFAULTS.startRows;
    this.refillRows = opts.refillRows || DEFAULTS.refillRows;
    this.rng = opts.rng || Math.random;
    this.shift = opts.shift || 0;
    this.score = opts.score || 0;
    this.shots = opts.shots || 0;
    this.misses = opts.misses || 0;
    this.popped = opts.popped || 0;
    this.over = !!opts.over;

    if (opts.grid) {
      this.grid = opts.grid.map((row) => row.slice());
      while (this.grid.length < this.rows) this.grid.push(this._emptyRow());
    } else {
      this.grid = [];
      for (let r = 0; r < this.rows; r++) this.grid.push(this._emptyRow());
      for (let r = 0; r < this.startRows; r++) this.grid[r] = this._randomRow(r);
    }

    this.current = opts.current != null ? opts.current : this._pickColor();
    this.next = opts.next != null ? opts.next : this._pickColor();
  }

  const P = Bubbles.prototype;

  /* --------------------------------------------------------------------- */
  /* גיאומטריה                                                              */
  /* --------------------------------------------------------------------- */

  P.isShifted = function (r) { return ((r + this.shift) & 1) === 1; };
  P.rowLen = function (r) { return this.cols - (this.isShifted(r) ? 1 : 0); };
  P.valid = function (r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.rowLen(r);
  };
  P.get = function (r, c) { return this.valid(r, c) ? this.grid[r][c] : EMPTY; };

  P.center = function (r, c) {
    return Bubbles.center(r, c, this.shift);
  };

  /** מרכז תא לפי shift נתון — ה-UI מצייר לפעמים לוח "ישן" עם shift ישן. */
  Bubbles.center = function (r, c, shift) {
    const shifted = ((r + shift) & 1) === 1;
    return { x: c + 0.5 + (shifted ? 0.5 : 0), y: r * ROW_H + 0.5 };
  };

  /** ששת השכנים של תא (רק תאים חוקיים). */
  P.neighbors = function (r, c) {
    const out = [];
    const add = (rr, cc) => { if (this.valid(rr, cc)) out.push([rr, cc]); };
    add(r, c - 1);
    add(r, c + 1);
    // בשורה מוסטת השכנים למעלה ולמטה הם c ו-c+1; בשורה רגילה c-1 ו-c
    const d = this.isShifted(r) ? 0 : -1;
    add(r - 1, c + d); add(r - 1, c + d + 1);
    add(r + 1, c + d); add(r + 1, c + d + 1);
    return out;
  };

  /** רוחב וגובה העולם, ומיקום התותח. */
  P.world = function () {
    // תחתית הלוח — תחתית השורה שלפני האחרונה. בועה בשורה האחרונה חוצה אותה
    const lineY = (this.rows - 2) * ROW_H + 1;
    const shooterY = lineY + 1.75;
    return {
      width: this.cols,
      height: shooterY + 0.75,
      lineY,
      shooter: { x: this.cols / 2, y: shooterY },
    };
  };

  /* --------------------------------------------------------------------- */
  /* צבעים                                                                  */
  /* --------------------------------------------------------------------- */

  /** שישה צבעים, כמו במשחק המקורי. */
  P.colorCount = function () { return 6; };

  /**
   * כמה החטאות (ירייה בלי פיצוץ) עד שנדחפת שורה חדשה. בלי שלבים הקושי
   * עולה בהדרגה לפי כמות הבועות שפוצצו: 5, אחרי 300 — 4, אחרי 700 — 3.
   */
  P.missLimit = function () {
    return this.popped < 300 ? 5 : this.popped < 700 ? 4 : 3;
  };
  P.shotsLeft = function () { return this.missLimit() - this.misses; };

  P.colorsOnBoard = function () {
    const set = new Set();
    this.grid.forEach((row) => row.forEach((v) => { if (v !== EMPTY) set.add(v); }));
    return Array.from(set).sort((a, b) => a - b);
  };

  /**
   * צבע לבועה הבאה — רק מהצבעים שעוד נמצאים על הלוח. בועה בצבע שכבר
   * נעלם היא ירייה מבוזבזת בלי שום אפשרות לשימוש, וזה מתסכל.
   */
  P._pickColor = function () {
    const present = this.colorsOnBoard();
    const pool = present.length ? present : range(this.colorCount());
    return pool[Math.floor(this.rng() * pool.length)];
  };

  P._emptyRow = function () { return new Array(this.cols).fill(EMPTY); };

  /**
   * שורה אקראית, עם נטייה להמשיך את צבע השכן — כך נוצרים אשכולות קטנים
   * שאפשר לפוצץ, במקום רעש שבו כמעט אין שלישיות.
   */
  P._randomRow = function (r, below) {
    const row = this._emptyRow();
    const len = this.cols - (this.isShifted(r) ? 1 : 0);
    const n = this.colorCount();
    for (let c = 0; c < len; c++) {
      const roll = this.rng();
      if (c > 0 && roll < 0.35) row[c] = row[c - 1];
      else if (below && below[c] !== EMPTY && below[c] != null && roll < 0.55) row[c] = below[c];
      else row[c] = Math.floor(this.rng() * n);
    }
    return row;
  };

  P.swap = function () {
    if (this.over) return false;
    const t = this.current;
    this.current = this.next;
    this.next = t;
    return true;
  };

  /* --------------------------------------------------------------------- */
  /* מסלול                                                                  */
  /* --------------------------------------------------------------------- */

  Bubbles.clampAngle = function (a) {
    return Math.min(MAX_ANGLE, Math.max(MIN_ANGLE, a));
  };

  /**
   * מסלול ירייה בזווית angle (רדיאנים, 0 = ימינה, π/2 = ישר למעלה).
   * @returns {{ path: {x:number,y:number}[], cell: {r:number,c:number}|null }}
   *   path — נקודת היציאה, נקודות הקפיצה מהקירות, ומרכז התא הסופי.
   */
  P.trace = function (angle) {
    angle = Bubbles.clampAngle(angle);
    const w = this.world();
    let x = w.shooter.x;
    let y = w.shooter.y;
    let dx = Math.cos(angle);
    const dy = -Math.sin(angle);
    const path = [{ x, y }];
    const minX = 0.5;
    const maxX = this.cols - 0.5;

    for (let i = 0; i < 4000; i++) {
      x += dx * STEP;
      y += dy * STEP;

      if (x < minX) { x = 2 * minX - x; dx = -dx; path.push({ x: minX, y }); }
      else if (x > maxX) { x = 2 * maxX - x; dx = -dx; path.push({ x: maxX, y }); }

      if (y <= 0.5 || this._hits(x, y)) {
        const cell = this._snap(x, y);
        if (cell) path.push(this.center(cell.r, cell.c));
        return { path, cell };
      }
    }
    return { path, cell: null };
  };

  /** האם נקודה נוגעת בבועה קיימת. בודקים רק שורות קרובות. */
  P._hits = function (x, y) {
    const rr = Math.round((y - 0.5) / ROW_H);
    for (let r = Math.max(0, rr - 1); r <= Math.min(this.rows - 1, rr + 1); r++) {
      const len = this.rowLen(r);
      for (let c = 0; c < len; c++) {
        if (this.grid[r][c] === EMPTY) continue;
        const p = this.center(r, c);
        const ddx = p.x - x, ddy = p.y - y;
        if (ddx * ddx + ddy * ddy < HIT_DIST * HIT_DIST) return true;
      }
    }
    return false;
  };

  /** תא ריק שמחובר ללוח (תקרה או שכן תפוס) והקרוב ביותר לנקודה. */
  P._snap = function (x, y) {
    const rr = Math.round((y - 0.5) / ROW_H);
    const pick = (r0, r1) => {
      let best = null, bestD = Infinity;
      for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++) {
        const len = this.rowLen(r);
        for (let c = 0; c < len; c++) {
          if (this.grid[r][c] !== EMPTY) continue;
          if (!this._attachable(r, c)) continue;
          const p = this.center(r, c);
          const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
          if (d < bestD) { bestD = d; best = { r, c }; }
        }
      }
      return best;
    };
    return pick(rr - 1, rr + 1) || pick(0, this.rows - 1);
  };

  P._attachable = function (r, c) {
    if (r === 0) return true;
    return this.neighbors(r, c).some(([nr, nc]) => this.grid[nr][nc] !== EMPTY);
  };

  /* --------------------------------------------------------------------- */
  /* ירייה                                                                  */
  /* --------------------------------------------------------------------- */

  /** קבוצת הבועות המחוברות מאותו צבע, כולל תא ההתחלה. */
  P.group = function (r, c) {
    const color = this.grid[r][c];
    if (color === EMPTY) return [];
    const seen = new Set([r + ',' + c]);
    const out = [[r, c]];
    for (let i = 0; i < out.length; i++) {
      this.neighbors(out[i][0], out[i][1]).forEach(([nr, nc]) => {
        const k = nr + ',' + nc;
        if (seen.has(k) || this.grid[nr][nc] !== color) return;
        seen.add(k);
        out.push([nr, nc]);
      });
    }
    return out;
  };

  /** בועות שאינן מחוברות לתקרה — הן נופלות. */
  P.floating = function () {
    const seen = new Set();
    const queue = [];
    for (let c = 0; c < this.rowLen(0); c++) {
      if (this.grid[0][c] !== EMPTY) { seen.add('0,' + c); queue.push([0, c]); }
    }
    for (let i = 0; i < queue.length; i++) {
      this.neighbors(queue[i][0], queue[i][1]).forEach(([nr, nc]) => {
        const k = nr + ',' + nc;
        if (seen.has(k) || this.grid[nr][nc] === EMPTY) return;
        seen.add(k);
        queue.push([nr, nc]);
      });
    }
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.rowLen(r); c++) {
        if (this.grid[r][c] !== EMPTY && !seen.has(r + ',' + c)) out.push([r, c]);
      }
    }
    return out;
  };

  P.isEmpty = function () {
    return this.grid.every((row) => row.every((v) => v === EMPTY));
  };

  /** מספר השורות מהתקרה ועד הבועה הנמוכה ביותר (0 ללוח ריק). */
  P.depth = function () {
    for (let r = this.rows - 1; r >= 0; r--) {
      if (this.grid[r].some((v) => v !== EMPTY)) return r + 1;
    }
    return 0;
  };

  /** האם יש בועה בשורה האחרונה — קו הסיום. */
  P._crossed = function () {
    return this.grid[this.rows - 1].some((v) => v !== EMPTY);
  };

  /** דוחף שורה חדשה מלמעלה; כל הלוח יורד שורה אחת. */
  P.pushRow = function () {
    this.shift ^= 1;
    const row = this._randomRow(0, null);
    this.grid.pop();
    this.grid.unshift(row);
  };

  /** ממלא מחדש מלמעלה עד לעומק refillRows. מחזיר כמה שורות נדחפו. */
  P.refill = function () {
    let n = 0;
    while (this.depth() < this.refillRows) { this.pushRow(); n++; }
    return n;
  };

  /**
   * יורה את הבועה הנוכחית.
   * @returns {null|{
   *   path, cell, color,
   *   popped: {r,c,color}[], dropped: {r,c,color}[],
   *   gained: number, pushed: boolean, cleared: boolean,
   *   refilled: number,  // שורות שנדחפו כי הלוח התדלדל
   *   over: boolean,
   *   shift: number  // ה-shift שבו נמדדו popped/dropped
   * }}
   */
  P.shoot = function (angle) {
    if (this.over) return null;
    const t = this.trace(angle);
    if (!t.cell) return null;

    const color = this.current;
    const { r, c } = t.cell;
    this.grid[r][c] = color;
    this.shots++;

    const res = {
      path: t.path, cell: t.cell, color,
      popped: [], dropped: [], gained: 0,
      pushed: false, cleared: false, refilled: 0, over: false,
      shift: this.shift,
    };

    const grp = this.group(r, c);
    if (grp.length >= 3) {
      grp.forEach(([gr, gc]) => {
        res.popped.push({ r: gr, c: gc, color: this.grid[gr][gc] });
        this.grid[gr][gc] = EMPTY;
      });
      this.floating().forEach(([fr, fc]) => {
        res.dropped.push({ r: fr, c: fc, color: this.grid[fr][fc] });
        this.grid[fr][fc] = EMPTY;
      });
      /* פיצוץ שווה 10 לבועה; נפילה שווה 20, ומוכפלת כשהיא גדולה — ניתוק
         של ענף שלם הוא המהלך הטוב ביותר במשחק, והניקוד צריך לשקף את זה */
      const drops = res.dropped.length;
      res.gained = res.popped.length * 10 + drops * 20 * (drops >= 8 ? 2 : 1);
      this.popped += res.popped.length + drops;
      this.misses = 0;
    } else {
      this.misses++;
      if (this.misses >= this.missLimit()) {
        this.misses = 0;
        this.pushRow();
        res.pushed = true;
      }
    }

    if (this.isEmpty()) {
      res.cleared = true;
      res.gained += CLEAR_BONUS;
    }
    res.refilled = this.refill();

    this.score += res.gained;

    if (this._crossed()) {
      this.over = true;
      res.over = true;
    }

    // הבאה נהיית נוכחית — אלא אם הצבע שלה נעלם מהלוח בינתיים
    const present = this.colorsOnBoard();
    this.current = present.indexOf(this.next) >= 0 ? this.next : this._pickColor();
    this.next = this._pickColor();

    return res;
  };

  /* --------------------------------------------------------------------- */
  /* שמירה                                                                  */
  /* --------------------------------------------------------------------- */

  P.serialize = function () {
    return {
      cols: this.cols, rows: this.rows, startRows: this.startRows,
      grid: this.grid.map((row) => row.slice()),
      shift: this.shift, score: this.score, shots: this.shots,
      refillRows: this.refillRows,
      misses: this.misses, popped: this.popped,
      over: this.over, current: this.current, next: this.next,
    };
  };

  Bubbles.deserialize = function (d) {
    return new Bubbles(d);
  };

  function range(n) { const a = []; for (let i = 0; i < n; i++) a.push(i); return a; }

  Bubbles.DEFAULTS = DEFAULTS;
  Bubbles.EMPTY = EMPTY;
  Bubbles.CLEAR_BONUS = CLEAR_BONUS;
  Bubbles.ROW_H = ROW_H;
  Bubbles.MIN_ANGLE = MIN_ANGLE;
  Bubbles.MAX_ANGLE = MAX_ANGLE;

  global.Bubbles = Bubbles;
})(typeof window !== 'undefined' ? window : globalThis);
