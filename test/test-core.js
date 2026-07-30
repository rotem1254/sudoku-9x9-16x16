/* =============================================================================
 * test/test-core.js — בדיקות למנוע הסודוקו
 * -----------------------------------------------------------------------------
 * core.js ו-game.js לא נוגעים ב-DOM, ולכן אפשר להריץ אותם ישירות ב-Node:
 *     node test/test-core.js
 * =========================================================================== */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'js', 'core.js'));
require(path.join(__dirname, '..', 'js', 'game.js'));

const Core = globalThis.SudokuCore;
const Game = globalThis.SudokuGame;

let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + name);
  } else {
    failed++;
    console.log('  ✗ ' + name);
  }
}

function section(title) {
  console.log('\n' + title);
}

/* --------------------------------------------------------------------- */

section('גיאומטריית הלוח');

const s9 = Core.specFor(9);
const s16 = Core.specFor(16);
check('9x9: 81 תאים, 27 יחידות', s9.N === 9 && s9.cells === 81 && s9.units.length === 27);
check('16x16: 256 תאים, 48 יחידות', s16.N === 16 && s16.cells === 256 && s16.units.length === 48);
check('16x16: מסכה מלאה = 65535', s16.FULL === 65535);
check('אינדוקס תיבות 9x9', s9.boxOf[0] === 0 && s9.boxOf[40] === 4 && s9.boxOf[80] === 8);
check('אינדוקס תיבות 16x16', s16.boxOf[0] === 0 && s16.boxOf[255] === 15 && s16.boxOf[16 * 5 + 5] === 5);

// כל יחידה חייבת להכיל בדיוק N תאים ייחודיים
let unitsOk = true;
[s9, s16].forEach((sp) => {
  sp.units.forEach((u) => {
    if (u.length !== sp.N || new Set(u).size !== sp.N) unitsOk = false;
  });
});
check('כל יחידה מכילה N תאים ייחודיים', unitsOk);

// מבנה גנרי לחלוטין — גם לוח לא ריבועי בתיבות (6x6 עם תיבות 3x2)
const s6 = Core.buildSpec(3, 2);
check('לוח 6x6 גנרי (תיבות 3x2)', s6.N === 6 && s6.cells === 36 && s6.units.length === 18);

/* --------------------------------------------------------------------- */

section('זיהוי התנגשויות');

const board = new Array(81).fill(0);
board[0] = 5;
board[1] = 5; // אותה שורה + אותה תיבה
let bad = Core.findConflicts(board, 9);
check('מזהה כפילות בשורה', bad[0] === 1 && bad[1] === 1 && bad[2] === 0);

board[1] = 0;
board[9] = 5; // אותה עמודה
bad = Core.findConflicts(board, 9);
check('מזהה כפילות בעמודה', bad[0] === 1 && bad[9] === 1);

board[9] = 0;
board[20] = 5; // אותה תיבה, שורה ועמודה שונות
bad = Core.findConflicts(board, 9);
check('מזהה כפילות בתיבה', bad[0] === 1 && bad[20] === 1);

check('לוח חוקי חלקי אינו נחשב פתור', !Core.isSolved(board, 9));

/* --------------------------------------------------------------------- */

section('יצירת לוח פתור');

[9, 16].forEach((size) => {
  const t0 = Date.now();
  const sol = Core.generateSolved(size, Core.mulberry32(4242 + size));
  const dt = Date.now() - t0;
  check(`generateSolved ${size}x${size} מחזיר לוח חוקי ומלא (${dt}ms)`,
    sol && Core.isSolved(Array.from(sol), size));
});

// אותו seed => אותו לוח (חשוב לשחזור פאזלים)
const a = Core.generateSolved(9, Core.mulberry32(777));
const b = Core.generateSolved(9, Core.mulberry32(777));
check('seed זהה מייצר לוח זהה', String(a) === String(b));

/* --------------------------------------------------------------------- */

section('פתרון יחיד וספירת פתרונות');

// לוח ריק => המון פתרונות (הספירה נעצרת ב-limit)
const emptyRes = Core.solve(new Array(81).fill(0), 9, { limit: 2 });
check('לוח ריק: נמצאו 2 פתרונות לפחות', emptyRes.count === 2);
check('לוח ריק אינו בעל פתרון יחיד', !Core.hasUniqueSolution(new Array(81).fill(0), 9, 1e6));

/* --------------------------------------------------------------------- */

section('יצירת פאזלים — כל הגדלים וכל הרמות');

(async () => {
  for (const size of [9, 16]) {
    for (const diff of Core.DIFFICULTY_ORDER) {
      const t0 = Date.now();
      const p = await Core.generatePuzzle(size, diff);
      const dt = Date.now() - t0;
      const target = Core.DIFFICULTY[size][diff].clues;

      const unique = Core.hasUniqueSolution(p.puzzle, size, 5e6);
      const solutionValid = Core.isSolved(p.solution, size);

      // כל רמז בפאזל חייב להתאים לפתרון
      let subset = true;
      for (let i = 0; i < p.puzzle.length; i++) {
        if (p.puzzle[i] && p.puzzle[i] !== p.solution[i]) subset = false;
      }

      // ברמה "קל" הפאזל חייב להיות פתיר בהיסק בלבד
      const logicOk = diff !== 'easy' || Core.solvableByLogicOnly(p.puzzle, size);

      // "חפירת החורים" עלולה להיתקע מעל היעד: בשלב מסוים כל הסרה נוספת
      // שוברת את יחידות הפתרון. זה תקין — הפאזל עדיין חוקי ובעל פתרון יחיד,
      // רק מעט קל יותר. לכן בודקים סטייה סבירה ולא שוויון מדויק.
      const tolerance = Math.ceil(target * 0.15);
      const cluesOk = p.clues <= target + tolerance;

      check(
        `${size}x${size} ${diff}: רמזים ${p.clues}/${target} (סבולת +${tolerance}), ${dt}ms, יחיד=${unique}`,
        unique && solutionValid && subset && logicOk && cluesOk
      );
    }
  }

  /* ------------------------------------------------------------------- */

  section('מצב המשחק (game.js)');

  const data = await Core.generatePuzzle(9, 'easy', { seed: 2024 });
  const g = new Game(data);
  const firstEmpty = data.puzzle.findIndex((v) => v === 0);
  const correct = data.solution[firstEmpty];
  const wrong = (correct % 9) + 1;

  check('תא נתון מזוהה כנתון', g.isGiven(data.puzzle.findIndex((v) => v !== 0)));
  check('לא ניתן לשנות תא נתון',
    !g.setValue(data.puzzle.findIndex((v) => v !== 0), 1, {}).ok);

  let res = g.setValue(firstEmpty, wrong, {});
  check('הצבת ערך שגוי נספרת כשגיאה', res.ok && res.mistake && g.mistakes === 1);

  res = g.setValue(firstEmpty, correct, {});
  check('הצבת ערך נכון אינה שגיאה', res.ok && !res.mistake);

  g.setValue(firstEmpty, correct, {});
  check('לחיצה על אותו ערך מוחקת אותו', g.values[firstEmpty] === 0);

  // Undo/Redo
  const beforeUndo = g.values[firstEmpty];
  g.undo();
  check('Undo משחזר את הערך', g.values[firstEmpty] !== beforeUndo);
  g.redo();
  check('Redo מחזיר את המצב', g.values[firstEmpty] === beforeUndo);

  // פתקים
  g.erase(firstEmpty);
  g.toggleNote(firstEmpty, 3);
  g.toggleNote(firstEmpty, 7);
  check('שני פתקים נשמרים כמסכת ביטים',
    g.notes[firstEmpty] === ((1 << 2) | (1 << 6)));
  g.toggleNote(firstEmpty, 3);
  check('פתק נמחק בלחיצה חוזרת', g.notes[firstEmpty] === (1 << 6));

  // ניקוי פתקים אוטומטי אצל שכנים + שחזור ב-Undo
  const spec = g.spec;
  const peer = spec.units[spec.rowOf[firstEmpty]].find(
    (j) => j !== firstEmpty && !g.isGiven(j)
  );
  g.erase(peer);
  g.toggleNote(peer, correct);
  const hadNote = (g.notes[peer] & (1 << (correct - 1))) !== 0;
  g.setValue(firstEmpty, correct, { autoClearNotes: true });
  const cleared = (g.notes[peer] & (1 << (correct - 1))) === 0;
  g.undo();
  const restored = (g.notes[peer] & (1 << (correct - 1))) !== 0;
  check('הצבת ערך מנקה את הפתק אצל שכן', hadNote && cleared);
  check('Undo משחזר גם פתקים שנוקו אוטומטית', restored);

  // רמזים
  const g2 = new Game(data);
  check('3 רמזים בהתחלה', g2.hintsLeft === 3);
  const h = g2.hint(-1);
  check('רמז ממלא ערך נכון',
    h.ok && g2.values[h.index] === data.solution[h.index] && g2.hintCells[h.index] === 1);
  g2.hint(-1);
  g2.hint(-1);
  check('הרמזים נגמרים אחרי 3', g2.hintsLeft === 0 && !g2.hint(-1).ok);

  // פתרון אוטומטי
  const g3 = new Game(data);
  g3.solveAll();
  check('solveAll משלים לוח תקין', g3.isComplete() && g3.finished);

  // אתחול מחדש
  g3.restart();
  check('restart מחזיר ללוח ההתחלתי',
    String(Array.from(g3.values)) === String(data.puzzle) &&
    g3.hintsUsed === 0 && g3.mistakes === 0 && !g3.finished);

  // סריאליזציה הלוך ושוב
  const g4 = new Game(data);
  g4.setValue(firstEmpty, correct, {});
  g4.toggleNote(peer, 5);
  const round = Game.deserialize(JSON.parse(JSON.stringify(g4.serialize())));
  check('serialize/deserialize שומר על המצב',
    round &&
    String(Array.from(round.values)) === String(Array.from(g4.values)) &&
    String(Array.from(round.notes)) === String(Array.from(g4.notes)) &&
    round.difficulty === g4.difficulty);

  /* ------------------------------------------------------------------- */

  section('תוויות תצוגה');
  check('1-9 כספרות, 10-16 כאותיות A-G',
    Core.labelFor(1) === '1' && Core.labelFor(9) === '9' &&
    Core.labelFor(10) === 'A' && Core.labelFor(16) === 'G');

  /* ------------------------------------------------------------------- */

  console.log(`\n${passed} עברו, ${failed} נכשלו`);
  process.exit(failed ? 1 : 0);
})();
