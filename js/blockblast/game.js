/* =============================================================================
 * blockblast/game.js — מצב משחק
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM. דורש את engine.js ואת deal.js.
 *
 * המשחק עצמו פשוט: לוח, שלושה חלקים, ניקוד וקומבו. כל הכובד יושב
 * במחולל, ולכן כאן העיקר הוא לשמור שהמצב יישאר עקבי — ובעיקר שהקומבו
 * יתאפס בדיוק ברגע הנכון.
 * =========================================================================== */
(function (global) {
  'use strict';

  const C = global.BlockBlastCore;
  const D = global.BlockBlastDeal;

  class BlockBlast {
    /**
     * @param {object} [opts] { seed, guaranteed, state }
     */
    constructor(opts) {
      const o = opts || {};
      if (o.state) { this._load(o.state); return; }

      this.seed = o.seed != null ? o.seed : (Math.random() * 4294967295) >>> 0;
      this.rng = C.mulberry32(this.seed);
      this.guaranteed = o.guaranteed !== false;

      this.board = C.emptyBoard();
      this.score = 0;
      this.best = 0;
      this.combo = 0;
      this.moves = 0;
      this.linesCleared = 0;
      this.finished = false;

      /** החלקים שטרם הונחו מתוך השלישייה הנוכחית */
      this.tray = [];
      this.lastDeal = null;

      this._refill();
    }

    /* ---------------------------- שאילתות ---------------------------- */

    /** החלקים שנשארו במגש. */
    get pieces() { return this.tray.slice(); }

    /** האם החלק הזה נכנס לאנשהו. */
    canPlace(piece) { return C.canPlace(this.board, piece); }

    /** כל המיקומים החוקיים לחלק. */
    placements(piece) { return C.legalPlacements(this.board, piece); }

    /** האם יש עוד מהלך כלשהו. */
    hasMove() {
      return this.tray.some((p) => C.canPlace(this.board, p));
    }

    density() { return C.density(this.board); }

    /* ------------------------------ מהלך ------------------------------ */

    /**
     * מניח חלק מהמגש.
     *
     * @param {number} trayIndex מיקום החלק במגש
     * @param {number} row שורת הפינה
     * @param {number} col עמודת הפינה
     * @returns {object} תוצאה, או { ok:false, reason }
     */
    playPiece(trayIndex, row, col) {
      if (this.finished) return { ok: false, reason: 'finished' };

      const piece = this.tray[trayIndex];
      if (!piece) return { ok: false, reason: 'no-piece' };

      const spot = piece.placements.find((p) => p.row === row && p.col === col);
      if (!spot) return { ok: false, reason: 'off-board' };
      if (!C.fits(this.board, spot.mask)) return { ok: false, reason: 'occupied' };

      const res = C.place(this.board, spot.mask);
      this.board = res.board;

      /*
       * הקומבו עולה על כל הנחה שמנקה, ומתאפס על הנחה שלא מנקה כלום.
       * הוא נמשך על פני שלישיות — לא מתאפס כשמגיעים חלקים חדשים
       */
      if (res.cleared > 0) this.combo++;
      else this.combo = 0;

      const boardCleared = C.countCells(this.board) === 0;
      const gained = C.scoreMove(piece.size, res.cleared, this.combo, boardCleared);

      this.score += gained;
      if (this.score > this.best) this.best = this.score;
      this.linesCleared += res.cleared;
      this.moves++;

      this.tray.splice(trayIndex, 1);
      if (!this.tray.length) this._refill();

      if (!this.hasMove()) this.finished = true;

      return {
        ok: true,
        gained,
        cleared: res.cleared,
        rows: res.rows,
        cols: res.cols,
        combo: this.combo,
        boardCleared,
        refilled: this.tray.length === 3,
        finished: this.finished,
      };
    }

    /* ---------------------------- פנימי ------------------------------ */

    _refill() {
      const d = D.deal(this.board, this.rng, { guaranteed: this.guaranteed });
      this.tray = d.pieces.slice();
      this.lastDeal = { guaranteed: d.guaranteed, tries: d.tries };
    }

    /* ------------------------ שמירה ושחזור --------------------------- */

    serialize() {
      return {
        v: 1,
        seed: this.seed,
        guaranteed: this.guaranteed,
        board: { lo: this.board.lo, hi: this.board.hi },
        score: this.score,
        best: this.best,
        combo: this.combo,
        moves: this.moves,
        linesCleared: this.linesCleared,
        finished: this.finished,
        tray: this.tray.map((p) => p.id),
        // מצב ה-rng אינו ניתן לשחזור, ולכן נשמר מונה החלוקות
        savedAt: Date.now(),
      };
    }

    _load(s) {
      this.seed = s.seed;
      this.rng = C.mulberry32((s.seed ^ (s.moves * 2654435761)) >>> 0);
      this.guaranteed = s.guaranteed !== false;
      this.board = { lo: s.board.lo >>> 0, hi: s.board.hi >>> 0 };
      this.score = s.score || 0;
      this.best = s.best || 0;
      this.combo = s.combo || 0;
      this.moves = s.moves || 0;
      this.linesCleared = s.linesCleared || 0;
      this.finished = !!s.finished;
      this.tray = (s.tray || []).map((id) => C.pieceById[id]).filter(Boolean);
      this.lastDeal = null;
      if (!this.tray.length && !this.finished) this._refill();
    }

    static deserialize(data) {
      return new BlockBlast({ state: data });
    }
  }

  global.BlockBlast = BlockBlast;
})(typeof globalThis !== 'undefined' ? globalThis : this);
