/* =============================================================================
 * tetris/engine.js — מנוע טטריס
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM. הזמן מוזרק מבחוץ דרך tick(ms), ולכן המנוע דטרמיניסטי
 * לגמרי ונבדק ב-Node בלי שעונים אמיתיים.
 *
 * ההתנהגות לפי ההנחיות המודרניות של המשחק, כי שם נמצאת התחושה ש"זה
 * טטריס אמיתי":
 *   - סיבוב SRS עם טבלאות ה-wall kick הרשמיות (נפרדת לחלק I)
 *   - מחולל "שקית של 7": כל שבעה חלקים — כל אחד פעם אחת, בסדר אקראי.
 *     אין בצורת של I ואין רצף של ארבעה S
 *   - שמירה (hold) פעם אחת לכל חלק, תור של החלקים הבאים, חלק רפאים
 *   - השהיית נעילה של 500ms שמתאפסת בתזוזה, עד 15 פעמים — כך אפשר להחליק
 *     חלק על הקרקע בלי שיינעל מתחת לאצבע, אבל אי אפשר לדחות לנצח
 *   - ניקוד: 100/300/500/800 × שלב, רצף טטריסים ×1.5, קומבו, והפלה
 *
 * הלוח: 10×22. שתי השורות העליונות מוסתרות — שם החלקים נולדים.
 * y גדל כלפי מטה.
 * =========================================================================== */
(function (global) {
  'use strict';

  const W = 10;
  const H = 22;
  const HIDDEN = 2;

  const LOCK_DELAY = 500;
  const MAX_RESETS = 15;
  const CLEAR_DELAY = 300;

  /* --------------------------------------------------------------------- */
  /* צורות                                                                  */
  /* --------------------------------------------------------------------- */

  /* מצב 0 של כל חלק, בתוך תיבה n×n. שאר המצבים = סיבוב התיבה */
  const BASE = {
    I: { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    O: { n: 4, cells: [[1, 0], [2, 0], [1, 1], [2, 1]] },
    T: { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    S: { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    Z: { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
    J: { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
    L: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  };
  const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

  /** SHAPES[type][rot] = [[x,y],…]. סיבוב עם כיוון השעון: (x,y) → (n-1-y, x) */
  const SHAPES = {};
  TYPES.forEach((t) => {
    const { n, cells } = BASE[t];
    const rots = [cells];
    for (let r = 1; r < 4; r++) {
      rots.push(rots[r - 1].map(([x, y]) => [n - 1 - y, x]));
    }
    // O לא מסתובב בפועל — אבל נשמור ארבעה מצבים זהים כדי שהקוד יהיה אחיד
    SHAPES[t] = t === 'O' ? [cells, cells, cells, cells] : rots;
  });

  /*
   * טבלאות SRS. בטבלה הרשמית y חיובי = למעלה; כאן y גדל למטה, ולכן הופכים
   * את הסימן בזמן הטעינה. המפתח: "ממצב>למצב".
   */
  const KICKS_JLSTZ = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  };
  const KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  };
  const flipY = (table) => {
    const out = {};
    Object.keys(table).forEach((k) => { out[k] = table[k].map(([x, y]) => [x, -y]); });
    return out;
  };
  const KICKS = { I: flipY(KICKS_I), other: flipY(KICKS_JLSTZ) };

  const LINE_POINTS = [0, 100, 300, 500, 800];

  /** מילישניות לשורה בשלב נתון — הנוסחה של ההנחיות, עם תקרה בשלב 20 */
  function gravityMs(level) {
    const l = Math.min(20, Math.max(1, level));
    return Math.pow(0.8 - (l - 1) * 0.007, l - 1) * 1000;
  }

  /* --------------------------------------------------------------------- */
  /* משחק                                                                   */
  /* --------------------------------------------------------------------- */

  /**
   * @param {object} [opts]
   * @param {function} [opts.rng=Math.random]
   * @param {number} [opts.startLevel=1]
   * @param {number} [opts.preview=5] כמה חלקים הבאים מוצגים
   * @param {string[]} [opts.sequence] סדר חלקים קבוע — לבדיקות
   */
  function Tetris(opts) {
    opts = opts || {};
    this.rng = opts.rng || Math.random;
    this.startLevel = opts.startLevel || 1;
    this.previewCount = opts.preview || 5;
    this.fixed = opts.sequence ? opts.sequence.slice() : null;

    this.board = [];
    for (let y = 0; y < H; y++) this.board.push(new Array(W).fill(null));

    this.bag = [];
    this.queue = [];
    this.hold = null;
    this.canHold = true;

    this.score = 0;
    this.lines = 0;
    this.level = this.startLevel;
    this.combo = -1;
    this.b2b = false;
    this.tetrises = 0;
    this.over = false;

    this.active = null;
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lowestY = 0;
    /** שורות מלאות שמהבהבות לפני שהן נעלמות: { rows, t } */
    this.clearing = null;
    /** אירועים עבור ה-UI — נשאבים ב-drain() */
    this.events = [];

    this._refill();
    this._spawn();
  }

  const P = Tetris.prototype;

  /* ------------------------------ תור -------------------------------- */

  P._nextType = function () {
    if (this.fixed) return this.fixed.length ? this.fixed.shift() : 'I';
    if (!this.bag.length) {
      this.bag = TYPES.slice();
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        const t = this.bag[i]; this.bag[i] = this.bag[j]; this.bag[j] = t;
      }
    }
    return this.bag.pop();
  };

  P._refill = function () {
    while (this.queue.length < this.previewCount) this.queue.push(this._nextType());
  };

  /* ---------------------------- התנגשות ------------------------------ */

  P.cells = function (piece) {
    const p = piece || this.active;
    if (!p) return [];
    return SHAPES[p.type][p.rot].map(([x, y]) => [p.x + x, p.y + y]);
  };

  P.fits = function (type, rot, px, py) {
    const shape = SHAPES[type][rot];
    for (let i = 0; i < shape.length; i++) {
      const x = px + shape[i][0];
      const y = py + shape[i][1];
      if (x < 0 || x >= W || y >= H) return false;
      if (y >= 0 && this.board[y][x]) return false;
    }
    return true;
  };

  P._fitsActive = function (dx, dy, rot) {
    const a = this.active;
    return this.fits(a.type, rot == null ? a.rot : rot, a.x + dx, a.y + dy);
  };

  P.grounded = function () {
    return !!this.active && !this._fitsActive(0, 1);
  };

  /* ------------------------------ לידה ------------------------------ */

  P._spawn = function (type) {
    const t = type || this.queue.shift();
    this._refill();
    // כל התיבות מתחילות בעמודה 3 — כך O ו-I ממורכזים ושאר החלקים שמאל-מרכז
    this.active = { type: t, rot: 0, x: 3, y: 0 };
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;

    if (!this._fitsActive(0, 0)) {
      // block out — החלק החדש לא נכנס
      this.active = null;
      this._gameOver();
      return false;
    }
    // לפי ההנחיות החלק יורד שורה אחת מיד אם יש מקום
    if (this._fitsActive(0, 1)) this.active.y++;
    this.lowestY = this.active.y;
    return true;
  };

  /* ----------------------------- תנועה ------------------------------- */

  /** נקרא אחרי כל תזוזה או סיבוב מוצלחים — מאפס את טיימר הנעילה במידה. */
  P._afterShift = function () {
    const a = this.active;
    if (a.y > this.lowestY) {
      // ירידה לשורה חדשה — מונה האיפוסים מתחיל מחדש
      this.lowestY = a.y;
      this.lockResets = 0;
      this.lockTimer = 0;
      return;
    }
    if (this.lockResets < MAX_RESETS) {
      this.lockResets++;
      this.lockTimer = 0;
    }
  };

  P._canAct = function () {
    return !this.over && !this.clearing && !!this.active;
  };

  P.move = function (dx) {
    if (!this._canAct() || !this._fitsActive(dx, 0)) return false;
    this.active.x += dx;
    this._afterShift();
    return true;
  };

  P.left = function () { return this.move(-1); };
  P.right = function () { return this.move(1); };

  /**
   * סיבוב עם wall kicks. dir: 1 = עם השעון, -1 = נגד, 2 = 180 (בלי kicks).
   * @returns {boolean}
   */
  P.rotate = function (dir) {
    if (!this._canAct()) return false;
    const a = this.active;
    if (a.type === 'O') return false;
    const from = a.rot;
    const to = (from + (dir === 2 ? 2 : dir === -1 ? 3 : 1)) % 4;
    const tests = dir === 2 ? [[0, 0]] : (a.type === 'I' ? KICKS.I : KICKS.other)[from + '>' + to];
    for (let i = 0; i < tests.length; i++) {
      const [kx, ky] = tests[i];
      if (this.fits(a.type, to, a.x + kx, a.y + ky)) {
        a.rot = to;
        a.x += kx;
        a.y += ky;
        a.kick = i;
        this._afterShift();
        return true;
      }
    }
    return false;
  };

  /** ירידה רכה בשורה אחת — נקודה לכל שורה. */
  P.softDrop = function () {
    if (!this._canAct() || !this._fitsActive(0, 1)) return false;
    this.active.y++;
    this.score += 1;
    this.gravityAcc = 0;
    this._afterShift();
    return true;
  };

  /** כמה שורות החלק יכול לרדת — גם בשביל חלק הרפאים. */
  P.dropDistance = function () {
    if (!this.active) return 0;
    let d = 0;
    while (this._fitsActive(0, d + 1)) d++;
    return d;
  };

  P.ghost = function () {
    if (!this.active) return null;
    return Object.assign({}, this.active, { y: this.active.y + this.dropDistance() });
  };

  /** הפלה — שתי נקודות לשורה, ונעילה מיידית. */
  P.hardDrop = function () {
    if (!this._canAct()) return 0;
    const d = this.dropDistance();
    this.active.y += d;
    this.score += d * 2;
    this.events.push({ type: 'hardDrop', rows: d, cells: this.cells() });
    this._lock();
    return d;
  };

  P.holdPiece = function () {
    if (!this._canAct() || !this.canHold) return false;
    const cur = this.active.type;
    const prev = this.hold;
    this.hold = cur;
    this.canHold = false;
    this.events.push({ type: 'hold' });
    if (prev) this._spawn(prev);
    else this._spawn();
    return true;
  };

  /* ------------------------------ נעילה ------------------------------ */

  P._lock = function () {
    const cells = this.cells();
    const type = this.active.type;
    let allHidden = true;
    cells.forEach(([x, y]) => {
      if (y >= 0) this.board[y][x] = type;
      if (y >= HIDDEN) allHidden = false;
    });
    this.active = null;
    this.canHold = true;

    const full = [];
    for (let y = 0; y < H; y++) if (this.board[y].every(Boolean)) full.push(y);

    const n = full.length;
    let points = 0;
    let b2bBonus = false;
    if (n) {
      this.combo++;
      points = LINE_POINTS[n] * this.level;
      if (n === 4) {
        if (this.b2b) { points = Math.floor(points * 1.5); b2bBonus = true; }
        this.b2b = true;
        this.tetrises++;
      } else {
        this.b2b = false;
      }
      if (this.combo > 0) points += 50 * this.combo * this.level;
    } else {
      this.combo = -1;
    }
    this.score += points;

    this.events.push({ type: 'lock', cells, piece: type, rows: full, points, b2b: b2bBonus, combo: Math.max(0, this.combo) });

    if (allHidden && !n) {
      // lock out — החלק ננעל כולו מעל השטח הנראה
      this._gameOver();
      return;
    }

    if (n) {
      this.clearing = { rows: full, t: CLEAR_DELAY };
    } else {
      this._spawn();
    }
  };

  P._finishClear = function () {
    const rows = this.clearing.rows;
    this.clearing = null;
    // מוחקים מלמטה למעלה ומוסיפים שורות ריקות מלמעלה
    rows.slice().sort((a, b) => b - a).forEach((y) => this.board.splice(y, 1));
    rows.forEach(() => this.board.unshift(new Array(W).fill(null)));

    const before = this.level;
    this.lines += rows.length;
    this.level = Math.max(this.startLevel, this.startLevel + Math.floor(this.lines / 10));
    if (this.level > before) this.events.push({ type: 'level', level: this.level });

    this._spawn();
  };

  P._gameOver = function () {
    this.over = true;
    this.events.push({ type: 'over' });
  };

  /* ------------------------------ זמן -------------------------------- */

  /**
   * מקדם את המשחק ב-ms מילישניות: כבידה, נעילה והשהיית ניקוי שורות.
   * @param {number} ms
   * @param {boolean} [soft] האם השחקן מחזיק ירידה רכה (כבידה ×20)
   */
  P.tick = function (ms, soft) {
    if (this.over) return;

    if (this.clearing) {
      this.clearing.t -= ms;
      if (this.clearing.t <= 0) this._finishClear();
      return;
    }
    if (!this.active) return;

    const g = gravityMs(this.level);
    const step = soft ? Math.min(g, 50) : g;

    if (this.grounded()) {
      this.gravityAcc = 0;
      this.lockTimer += ms;
      // אחרי שנגמרו האיפוסים — נועלים ברגע שנוגעים
      if (this.lockTimer >= LOCK_DELAY || (this.lockResets >= MAX_RESETS && this.lockTimer > 0)) this._lock();
      return;
    }

    this.gravityAcc += ms;
    while (this.gravityAcc >= step && this.active && !this.grounded()) {
      this.gravityAcc -= step;
      this.active.y++;
      if (soft) this.score += 1;
      if (this.active.y > this.lowestY) {
        this.lowestY = this.active.y;
        this.lockResets = 0;
        this.lockTimer = 0;
      }
    }
  };

  P.drain = function () {
    const e = this.events;
    this.events = [];
    return e;
  };

  /* ------------------------------ שמירה ------------------------------ */

  P.serialize = function () {
    return {
      board: this.board.map((r) => r.slice()),
      bag: this.bag.slice(),
      queue: this.queue.slice(),
      hold: this.hold,
      canHold: this.canHold,
      active: this.active ? Object.assign({}, this.active) : null,
      score: this.score, lines: this.lines, level: this.level,
      startLevel: this.startLevel, combo: this.combo, b2b: this.b2b,
      tetrises: this.tetrises, over: this.over,
      clearing: this.clearing ? { rows: this.clearing.rows.slice(), t: this.clearing.t } : null,
    };
  };

  Tetris.deserialize = function (d) {
    const g = new Tetris({ startLevel: d.startLevel, sequence: ['I'] });
    g.fixed = null;
    g.board = d.board.map((r) => r.slice());
    g.bag = d.bag.slice();
    g.queue = d.queue.slice();
    g.hold = d.hold;
    g.canHold = d.canHold;
    g.active = d.active ? Object.assign({}, d.active) : null;
    g.score = d.score; g.lines = d.lines; g.level = d.level;
    g.combo = d.combo; g.b2b = d.b2b; g.tetrises = d.tetrises || 0;
    g.over = d.over;
    g.clearing = d.clearing ? { rows: d.clearing.rows.slice(), t: d.clearing.t } : null;
    g.lowestY = g.active ? g.active.y : 0;
    g.events = [];
    return g;
  };

  Tetris.W = W;
  Tetris.H = H;
  Tetris.HIDDEN = HIDDEN;
  Tetris.TYPES = TYPES;
  Tetris.SHAPES = SHAPES;
  Tetris.LOCK_DELAY = LOCK_DELAY;
  Tetris.CLEAR_DELAY = CLEAR_DELAY;
  Tetris.gravityMs = gravityMs;

  global.Tetris = Tetris;
})(typeof window !== 'undefined' ? window : globalThis);
