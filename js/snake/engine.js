/* =============================================================================
 * snake/engine.js — מנוע סנייק
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM. המנוע מתקדם צעד אחד בכל step(); הקצב נקבע ע"י ה-UI.
 *
 * שתי החלטות שעושות את ההבדל בין "עובד" ל"מרגיש נכון":
 *
 * 1. תור פניות. שתי לחיצות מהירות (למעלה ואז שמאלה) בין שני צעדים חייבות
 *    להתבצע שתיהן, אחת בכל צעד. בלי תור השנייה דורסת את הראשונה והנחש
 *    "מתעלם" מהשחקן — זו התלונה הנפוצה ביותר על מימושי סנייק.
 *    פנייה הפוכה לכיוון האחרון שבתור נדחית, כדי שלא יתאבד בתוך עצמו.
 *
 * 2. הזנב זז לפני בדיקת ההתנגשות. הראש רשאי להיכנס לתא שהזנב עוזב באותו
 *    צעד — אלא אם הנחש אוכל עכשיו, ואז הזנב נשאר במקומו.
 * =========================================================================== */
(function (global) {
  'use strict';

  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const QUEUE_MAX = 3;

  /**
   * @param {object} [opts]
   * @param {number} [opts.cols=15]
   * @param {number} [opts.rows=17]
   * @param {boolean} [opts.wrap=false] מעבר דרך הקירות
   * @param {function} [opts.rng=Math.random]
   * @param {{x,y}[]} [opts.body] ראש ראשון — לבדיקות ולשחזור
   * @param {string} [opts.dir]
   * @param {{x,y}|null} [opts.apple]
   */
  function Snake(opts) {
    opts = opts || {};
    this.cols = opts.cols || 15;
    this.rows = opts.rows || 17;
    this.wrap = !!opts.wrap;
    this.rng = opts.rng || Math.random;
    this.score = opts.score || 0;
    this.steps = opts.steps || 0;
    this.over = !!opts.over;
    this.won = !!opts.won;
    this.queue = [];
    this.lastTail = null;

    if (opts.body) {
      this.body = opts.body.map((p) => ({ x: p.x, y: p.y }));
      this.dir = opts.dir || 'right';
    } else {
      // נחש של 4 ברבע השמאלי, באמצע הגובה, פונה ימינה
      const y = Math.floor(this.rows / 2);
      const hx = Math.min(this.cols - 2, 5);
      this.body = [];
      for (let i = 0; i < 4; i++) this.body.push({ x: hx - i, y });
      this.dir = 'right';
    }

    if (opts.apple !== undefined) this.apple = opts.apple ? { x: opts.apple.x, y: opts.apple.y } : null;
    else if (!opts.body) {
      // התפוח הראשון מול הנחש, כמו במשחק המקורי — מיד יש לאן לנסוע
      this.apple = { x: this.cols - 5, y: this.body[0].y };
    } else {
      this.apple = this._randomEmpty();
    }
  }

  const P = Snake.prototype;

  P.head = function () { return this.body[0]; };
  P.length = function () { return this.body.length; };

  /** הכיוון שבו הנחש ינוע בצעד הבא אחרי כל הפניות שבתור */
  P._lastDir = function () {
    return this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
  };

  /** מבקש פנייה. מחזיר true אם נכנסה לתור. */
  P.turn = function (dir) {
    if (this.over || !DIRS[dir]) return false;
    const last = this._lastDir();
    if (dir === last || dir === OPPOSITE[last]) return false;
    if (this.queue.length >= QUEUE_MAX) return false;
    this.queue.push(dir);
    return true;
  };

  P.occupied = function (x, y) {
    return this.body.some((p) => p.x === x && p.y === y);
  };

  P._randomEmpty = function () {
    const free = [];
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) if (!this.occupied(x, y)) free.push({ x, y });
    }
    if (!free.length) return null;
    return free[Math.floor(this.rng() * free.length)];
  };

  /**
   * צעד אחד.
   * @returns {{ ate: boolean, died: boolean, won: boolean, lastTail: {x,y}|null, dir: string }}
   */
  P.step = function () {
    const res = { ate: false, died: false, won: false, lastTail: null, dir: this.dir };
    if (this.over) return res;

    if (this.queue.length) this.dir = this.queue.shift();
    res.dir = this.dir;
    const d = DIRS[this.dir];
    const h = this.head();
    let nx = h.x + d.x;
    let ny = h.y + d.y;

    if (this.wrap) {
      nx = (nx + this.cols) % this.cols;
      ny = (ny + this.rows) % this.rows;
    } else if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) {
      this.over = true;
      res.died = true;
      return res;
    }

    const ate = !!this.apple && this.apple.x === nx && this.apple.y === ny;
    // הזנב עוזב את התא שלו באותו צעד — אלא אם אוכלים
    const checkLen = ate ? this.body.length : this.body.length - 1;
    for (let i = 0; i < checkLen; i++) {
      if (this.body[i].x === nx && this.body[i].y === ny) {
        this.over = true;
        res.died = true;
        return res;
      }
    }

    this.body.unshift({ x: nx, y: ny });
    this.steps++;
    if (ate) {
      this.score++;
      res.ate = true;
      this.lastTail = null;
      this.apple = this._randomEmpty();
      if (!this.apple) {
        this.over = true;
        this.won = true;
        res.won = true;
      }
    } else {
      this.lastTail = this.body.pop();
    }
    res.lastTail = this.lastTail;
    return res;
  };

  P.serialize = function () {
    return {
      cols: this.cols, rows: this.rows, wrap: this.wrap,
      body: this.body.map((p) => ({ x: p.x, y: p.y })),
      dir: this.dir, apple: this.apple,
      score: this.score, steps: this.steps, over: this.over, won: this.won,
    };
  };

  Snake.deserialize = function (d) { return new Snake(d); };

  Snake.DIRS = DIRS;
  Snake.OPPOSITE = OPPOSITE;

  global.Snake = Snake;
})(typeof window !== 'undefined' ? window : globalThis);
