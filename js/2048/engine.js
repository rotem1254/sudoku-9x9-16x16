/* =============================================================================
 * 2048/engine.js — מנוע 2048
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM.
 *
 * לוח n×n (ברירת מחדל 4×4) של מספרים; 0 הוא תא ריק. בכל מהלך כל האריחים
 * מחליקים לכיוון אחד, וזוג שכנים שווים מתמזג לאריח כפול. **כל אריח מתמזג
 * פעם אחת לכל היותר במהלך** — [2,2,2] שמאלה נותן [4,2] ולא [8]. זה לב
 * המשחק, וזו גם הטעות הנפוצה במימושים.
 *
 * הלוח שטוח: index = r*n + c. מהלך מתואר כרשימת "קווים" — כל שורה או
 * עמודה כרשימת אינדקסים בסדר הנסיעה (התא הקרוב לקצה היעד ראשון), וכך
 * אותה לוגיקת החלקה משרתת את ארבעת הכיוונים.
 *
 * ה-move מחזיר גם transitions: לכל אריח מאיפה לאן הוא זז והאם התמזג —
 * כדי שה-UI יוכל להנפיש את ההחלקה במדויק, בלי לנחש. המנוע נשאר מקור
 * האמת היחיד למצב הלוח.
 * =========================================================================== */
(function (global) {
  'use strict';

  const DIRS = ['up', 'down', 'left', 'right'];

  /**
   * @param {object} [opts]
   * @param {number} [opts.size=4]
   * @param {function} [opts.rng=Math.random]
   * @param {number[]} [opts.grid] לוח נתון (לבדיקות ולשחזור) — אז אין הגרלת פתיחה
   * @param {boolean} [opts.spawn=true] האם להגריל שני אריחים בפתיחה
   * @param {boolean} [opts.autoSpawn=true] האם move יגריל אריח אחרי מהלך.
   *   כיבוי מבודד את לוגיקת ההחלקה מההגרלה — שימושי לבדיקות דטרמיניסטיות.
   */
  function Game2048(opts) {
    opts = opts || {};
    this.size = opts.size || 4;
    this.rng = opts.rng || Math.random;
    this.grid = opts.grid ? opts.grid.slice() : new Array(this.size * this.size).fill(0);
    this.score = opts.score || 0;
    this.moves = opts.moves || 0;
    this.won = !!opts.won;
    this.autoSpawn = opts.autoSpawn !== false;

    if (!opts.grid && opts.spawn !== false) {
      this._spawn();
      this._spawn();
    }
  }

  /** קווי הנסיעה לכיוון נתון — כל אחד רשימת אינדקסים, היעד ראשון. */
  Game2048.prototype._lines = function (dir) {
    const n = this.size;
    const lines = [];
    if (dir === 'left' || dir === 'right') {
      for (let r = 0; r < n; r++) {
        const row = [];
        for (let c = 0; c < n; c++) row.push(r * n + c);
        if (dir === 'right') row.reverse();
        lines.push(row);
      }
    } else {
      for (let c = 0; c < n; c++) {
        const col = [];
        for (let r = 0; r < n; r++) col.push(r * n + c);
        if (dir === 'down') col.reverse();
        lines.push(col);
      }
    }
    return lines;
  };

  /**
   * מבצע מהלך.
   * @param {'up'|'down'|'left'|'right'} dir
   * @returns {{moved:boolean, gained:number, transitions:object[],
   *            mergeTargets:number[], spawn:{index:number,value:number}|null,
   *            won:boolean}}
   */
  Game2048.prototype.move = function (dir) {
    if (DIRS.indexOf(dir) < 0) return notMoved();

    const n = this.size;
    const next = new Array(n * n).fill(0);
    const transitions = [];
    const mergeTargets = [];
    let gained = 0;
    let moved = false;

    for (const idx of this._lines(dir)) {
      /* האריחים על הקו, בסדר הנסיעה */
      const occ = [];
      for (const i of idx) if (this.grid[i] !== 0) occ.push({ from: i, value: this.grid[i] });

      /* דחיסה + מיזוג יחיד לכל זוג */
      const slots = [];
      for (let k = 0; k < occ.length; k++) {
        const cur = occ[k];
        const prev = slots[slots.length - 1];
        if (prev && !prev.merged && prev.value === cur.value) {
          prev.value *= 2;
          prev.merged = true;
          prev.sources.push(cur.from);
          gained += prev.value;
        } else {
          slots.push({ value: cur.value, merged: false, sources: [cur.from] });
        }
      }

      slots.forEach((slot, si) => {
        const to = idx[si];
        next[to] = slot.value;
        if (slot.merged) mergeTargets.push(to);
        slot.sources.forEach((from) => {
          transitions.push({ from, to, value: this.grid[from], merged: slot.merged });
          if (from !== to) moved = true;
        });
      });
    }

    if (mergeTargets.length) moved = true;
    if (!moved) return notMoved();

    this.grid = next;
    this.score += gained;
    this.moves += 1;

    let newlyWon = false;
    if (!this.won && this.grid.some((v) => v >= 2048)) {
      this.won = true;
      newlyWon = true;
    }

    const spawn = this.autoSpawn ? this._spawn() : null;
    return { moved: true, gained, transitions, mergeTargets, spawn, won: newlyWon };
  };

  function notMoved() {
    return { moved: false, gained: 0, transitions: [], mergeTargets: [], spawn: null, won: false };
  }

  /** מגריל אריח בתא ריק: 2 בהסתברות 0.9, אחרת 4. מחזיר {index,value} או null. */
  Game2048.prototype._spawn = function () {
    const empties = [];
    for (let i = 0; i < this.grid.length; i++) if (this.grid[i] === 0) empties.push(i);
    if (!empties.length) return null;

    const index = empties[Math.floor(this.rng() * empties.length)];
    const value = this.rng() < 0.9 ? 2 : 4;
    this.grid[index] = value;
    return { index, value };
  };

  /** האם קיים מהלך אפשרי כלשהו. */
  Game2048.prototype.canMove = function () {
    if (this.grid.some((v) => v === 0)) return true;
    const n = this.size;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const v = this.grid[r * n + c];
        if (c + 1 < n && this.grid[r * n + c + 1] === v) return true;
        if (r + 1 < n && this.grid[(r + 1) * n + c] === v) return true;
      }
    }
    return false;
  };

  /** המשחק נגמר כשאין אף מהלך. */
  Game2048.prototype.isOver = function () {
    return !this.canMove();
  };

  /** האריח הגבוה ביותר על הלוח. */
  Game2048.prototype.bestTile = function () {
    let best = 0;
    for (const v of this.grid) if (v > best) best = v;
    return best;
  };

  Game2048.prototype.serialize = function () {
    return {
      size: this.size,
      grid: this.grid.slice(),
      score: this.score,
      moves: this.moves,
      won: this.won,
    };
  };

  Game2048.deserialize = function (data) {
    return new Game2048({
      size: data.size,
      grid: data.grid,
      score: data.score,
      moves: data.moves,
      won: data.won,
    });
  };

  Game2048.DIRS = DIRS;

  global.Game2048 = Game2048;
})(typeof window !== 'undefined' ? window : globalThis);
