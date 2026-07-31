/* =============================================================================
 * game.js — מצב המשחק (ללא DOM)
 * -----------------------------------------------------------------------------
 * מחזיק את הלוח, הפתקים, ההיסטוריה (Undo/Redo), הטיימר, הרמזים והסטטיסטיקה.
 * כל הלוגיקה גנרית לגודל הלוח — אין כאן שום הנחה על 9x9.
 * =========================================================================== */
(function (global) {
  'use strict';

  const Core = global.SudokuCore;

  const MAX_HINTS = 3;

  class Game {
    /**
     * @param {object} data תוצאת Core.generatePuzzle או מצב שמור
     */
    constructor(data) {
      const spec = Core.specFor(data.size);
      this.spec = spec;
      this.size = data.size;
      this.difficulty = data.difficulty;
      this.seed = data.seed;

      this.puzzle = Int32Array.from(data.puzzle); // הלוח ההתחלתי (נתונים קבועים)
      this.solution = Int32Array.from(data.solution);

      // הערכים הנוכחיים על הלוח
      this.values = Int32Array.from(data.values || data.puzzle);
      // פתקים: מסכת ביטים לכל תא
      this.notes = Int32Array.from(data.notes || new Int32Array(spec.cells));
      // תאים שמולאו ע"י רמז (לצביעה שונה)
      this.hintCells = Uint8Array.from(
        data.hintCells || new Uint8Array(spec.cells)
      );

      this.hintsUsed = data.hintsUsed || 0;
      this.mistakes = data.mistakes || 0;
      this.elapsed = data.elapsed || 0; // שניות
      this.notesMode = false;
      this.solvedByComputer = !!data.solvedByComputer;
      this.finished = !!data.finished;

      /** @type {Array<Array<object>>} מחסנית שינויים לביטול */
      this.undoStack = [];
      /** @type {Array<Array<object>>} מחסנית שינויים לביצוע חוזר */
      this.redoStack = [];

      this._timerRunning = false;
      this._tickBase = 0;
    }

    /* --------------------------- שאילתות בסיס --------------------------- */

    isGiven(i) {
      return this.puzzle[i] !== 0;
    }

    get cells() {
      return this.spec.cells;
    }

    get hintsLeft() {
      return Math.max(0, MAX_HINTS - this.hintsUsed);
    }

    /** מחזיר Uint8Array של התנגשויות נוכחיות. */
    conflicts() {
      return Core.findConflicts(this.values, this.size);
    }

    /** האם הלוח מלא ותקין. */
    isComplete() {
      return Core.isSolved(this.values, this.size);
    }

    /** מספר התאים שנותרו ריקים. */
    remainingCells() {
      let n = 0;
      for (let i = 0; i < this.cells; i++) if (!this.values[i]) n++;
      return n;
    }

    /** כמה פעמים ערך מסוים כבר מוצב על הלוח (לפאנל המספרים). */
    countOfValue(v) {
      let n = 0;
      for (let i = 0; i < this.cells; i++) if (this.values[i] === v) n++;
      return n;
    }

    /* ------------------------- מנגנון היסטוריה -------------------------- */

    /** מצלם את מצבו של תא בודד לפני שינוי. */
    _snapshot(i) {
      return {
        i,
        value: this.values[i],
        notes: this.notes[i],
        hint: this.hintCells[i],
      };
    }

    /** משחזר תא ממצב שצולם. */
    _restore(s) {
      this.values[s.i] = s.value;
      this.notes[s.i] = s.notes;
      this.hintCells[s.i] = s.hint;
    }

    /**
     * מבצע קבוצת שינויים כפעולה אטומית אחת בהיסטוריה.
     * @param {function(Array):void} mutator מקבל מערך לאיסוף snapshots
     */
    _transaction(mutator) {
      const before = [];
      const touch = (i) => before.push(this._snapshot(i));
      mutator(touch);
      if (!before.length) return null;

      const after = before.map((s) => this._snapshot(s.i));
      // אם שום דבר לא באמת השתנה — לא מלכלכים את ההיסטוריה
      const changed = before.some(
        (b, k) =>
          b.value !== after[k].value ||
          b.notes !== after[k].notes ||
          b.hint !== after[k].hint
      );
      if (!changed) return null;

      this.undoStack.push({ before, after });
      this.redoStack.length = 0;
      return { before, after };
    }

    canUndo() {
      return this.undoStack.length > 0;
    }
    canRedo() {
      return this.redoStack.length > 0;
    }

    undo() {
      const entry = this.undoStack.pop();
      if (!entry) return false;
      entry.before.forEach((s) => this._restore(s));
      this.redoStack.push(entry);
      return true;
    }

    redo() {
      const entry = this.redoStack.pop();
      if (!entry) return false;
      entry.after.forEach((s) => this._restore(s));
      this.undoStack.push(entry);
      return true;
    }

    /* ---------------------------- פעולות משחק --------------------------- */

    /**
     * מציב ערך בתא (או מוחק אם הערך זהה לקיים — toggle).
     * @returns {{ok:boolean, mistake:boolean, reason?:string}}
     */
    setValue(i, val, opts) {
      const o = opts || {};
      if (this.finished) return { ok: false, mistake: false, reason: 'finished' };
      if (this.isGiven(i)) return { ok: false, mistake: false, reason: 'given' };

      // לחיצה על אותו ערך שוב => מחיקה (נוח במיוחד במגע)
      if (this.values[i] === val) return this.erase(i);

      const wrong = this.solution[i] !== val;

      const tx = this._transaction((touch) => {
        touch(i);
        this.values[i] = val;
        this.notes[i] = 0; // תא מלא לא מחזיק פתקים
        this.hintCells[i] = 0;

        // ניקוי אוטומטי של הפתק המתאים אצל השכנים (שורה/עמודה/תיבה)
        if (o.autoClearNotes) {
          const bit = 1 << (val - 1);
          const unitIds = this.spec.unitsOfCell[i];
          for (let u = 0; u < unitIds.length; u++) {
            const unit = this.spec.units[unitIds[u]];
            for (let k = 0; k < unit.length; k++) {
              const j = unit[k];
              if (j !== i && this.notes[j] & bit) {
                touch(j);
                this.notes[j] &= ~bit;
              }
            }
          }
        }
      });

      if (!tx) return { ok: false, mistake: false };
      if (wrong) this.mistakes++;
      return { ok: true, mistake: wrong };
    }

    /** מוסיף/מסיר פתק בתא ריק. */
    toggleNote(i, val) {
      if (this.finished) return { ok: false };
      if (this.isGiven(i)) return { ok: false, reason: 'given' };
      if (this.values[i]) return { ok: false, reason: 'filled' };

      const tx = this._transaction((touch) => {
        touch(i);
        this.notes[i] ^= 1 << (val - 1);
      });
      return { ok: !!tx };
    }

    /** מנקה תא (ערך ופתקים). */
    erase(i) {
      if (this.finished) return { ok: false, mistake: false };
      if (this.isGiven(i)) return { ok: false, mistake: false, reason: 'given' };
      if (!this.values[i] && !this.notes[i]) return { ok: false, mistake: false };

      const tx = this._transaction((touch) => {
        touch(i);
        this.values[i] = 0;
        this.notes[i] = 0;
        this.hintCells[i] = 0;
      });
      return { ok: !!tx, mistake: false };
    }

    /**
     * ממלא רמז. אם לא הועבר תא — בוחר תא ריק אקראי.
     * @returns {{ok:boolean, index?:number, value?:number, reason?:string}}
     */
    hint(i) {
      if (this.finished) return { ok: false, reason: 'finished' };
      if (this.hintsLeft <= 0) return { ok: false, reason: 'no-hints' };

      let target = i;
      // תא שנבחר אך כבר נכון/נתון — לא מבזבזים עליו רמז
      if (
        target == null ||
        target < 0 ||
        this.isGiven(target) ||
        this.values[target] === this.solution[target]
      ) {
        const empties = [];
        for (let k = 0; k < this.cells; k++) {
          if (!this.isGiven(k) && this.values[k] !== this.solution[k]) empties.push(k);
        }
        if (!empties.length) return { ok: false, reason: 'nothing-to-hint' };
        target = empties[(Math.random() * empties.length) | 0];
      }

      const val = this.solution[target];
      const tx = this._transaction((touch) => {
        touch(target);
        this.values[target] = val;
        this.notes[target] = 0;
        this.hintCells[target] = 1;

        const bit = 1 << (val - 1);
        const unitIds = this.spec.unitsOfCell[target];
        for (let u = 0; u < unitIds.length; u++) {
          const unit = this.spec.units[unitIds[u]];
          for (let k = 0; k < unit.length; k++) {
            const j = unit[k];
            if (j !== target && this.notes[j] & bit) {
              touch(j);
              this.notes[j] &= ~bit;
            }
          }
        }
      });

      if (!tx) return { ok: false, reason: 'noop' };
      this.hintsUsed++;
      return { ok: true, index: target, value: val };
    }

    /**
     * ממלא בכל תא ריק את כל הערכים שעדיין חוקיים בו.
     *
     * זו לא עזרה שמגלה מידע חדש — היא רק חוסכת את העבודה הידנית של רישום
     * מה שכבר נגזר מהלוח. לכן היא אינה נספרת כרמז ואינה משפיעה על הניקוד.
     *
     * הפעולה כולה נכנסת כצעד אחד בהיסטוריה, כדי שביטול אחד יבטל את כולה.
     *
     * @returns {number} כמה תאים קיבלו פתקים
     */
    fillNotes() {
      if (this.finished) return 0;
      const masks = Core.candidateMasks(this.values, this.size);
      let touched = 0;

      this._transaction((touch) => {
        for (let i = 0; i < this.cells; i++) {
          if (this.values[i] || this.isGiven(i)) continue;
          if (masks[i] === this.notes[i]) continue;
          touch(i);
          this.notes[i] = masks[i];
          touched++;
        }
      });
      return touched;
    }

    /** מוחק את כל הפתקים מהלוח, כצעד אחד בהיסטוריה. */
    clearAllNotes() {
      if (this.finished) return 0;
      let touched = 0;
      this._transaction((touch) => {
        for (let i = 0; i < this.cells; i++) {
          if (!this.notes[i]) continue;
          touch(i);
          this.notes[i] = 0;
          touched++;
        }
      });
      return touched;
    }

    /** פתרון אוטומטי מלא — מסיים את המשחק בלי לרשום ניצחון. */
    solveAll() {
      this._transaction((touch) => {
        for (let i = 0; i < this.cells; i++) {
          if (this.values[i] !== this.solution[i]) {
            touch(i);
            this.values[i] = this.solution[i];
            this.notes[i] = 0;
            this.hintCells[i] = 1;
          } else if (this.notes[i]) {
            touch(i);
            this.notes[i] = 0;
          }
        }
      });
      this.solvedByComputer = true;
      this.finished = true;
      this.stopTimer();
    }

    /** מנקה את כל מה שהשחקן מילא ומחזיר ללוח ההתחלתי. */
    restart() {
      this._transaction((touch) => {
        for (let i = 0; i < this.cells; i++) {
          if (this.values[i] !== this.puzzle[i] || this.notes[i] || this.hintCells[i]) {
            touch(i);
            this.values[i] = this.puzzle[i];
            this.notes[i] = 0;
            this.hintCells[i] = 0;
          }
        }
      });
      this.mistakes = 0;
      this.hintsUsed = 0;
      this.elapsed = 0;
      this.finished = false;
      this.solvedByComputer = false;
      this.undoStack.length = 0;
      this.redoStack.length = 0;
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

    /** הזמן הנוכחי בשניות, כולל הריצה הפעילה. */
    currentSeconds() {
      const live = this._timerRunning ? (Date.now() - this._tickBase) / 1000 : 0;
      return Math.floor(this.elapsed + live);
    }

    /* ------------------------- שמירה / שחזור --------------------------- */

    serialize() {
      return {
        v: 1,
        size: this.size,
        difficulty: this.difficulty,
        seed: this.seed,
        puzzle: Array.from(this.puzzle),
        solution: Array.from(this.solution),
        values: Array.from(this.values),
        notes: Array.from(this.notes),
        hintCells: Array.from(this.hintCells),
        hintsUsed: this.hintsUsed,
        mistakes: this.mistakes,
        elapsed: this.currentSeconds(),
        finished: this.finished,
        solvedByComputer: this.solvedByComputer,
        savedAt: Date.now(),
      };
    }

    static deserialize(data) {
      if (!data || !data.puzzle || !data.solution) return null;
      try {
        return new Game(data);
      } catch (e) {
        return null;
      }
    }
  }

  Game.MAX_HINTS = MAX_HINTS;
  global.SudokuGame = Game;
})(typeof window !== 'undefined' ? window : globalThis);
