/* =============================================================================
 * test/test-2048.js — בדיקות למנוע 2048
 * -----------------------------------------------------------------------------
 *     node test/test-2048.js
 * =========================================================================== */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'js', '2048', 'engine.js'));

const Game2048 = globalThis.Game2048;

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
};
const section = (t) => console.log('\n' + t);

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * משחק על לוח נתון, בלי הגרלת פתיחה ובלי הגרלה אחרי מהלך — כך בדיקות
 * ההחלקה בודקות את הלוגיקה בלבד, בלי אריח אקראי שמשבש את התוצאה.
 */
const from = (grid) => new Game2048({ grid, autoSpawn: false });

/* --------------------------------------------------------------------- */

section('החלקה ומיזוג — שורה אחת');

{
  const g = from([
    2, 2, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  const res = g.move('left');
  check('זוג שווה מתמזג', g.grid[0] === 4);
  check('התא השני מתרוקן', g.grid[1] === 0);
  check('הניקוד עלה בערך המיזוג', g.score === 4 && res.gained === 4);
}

{
  const g = from([
    2, 2, 2, 2,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  g.move('left');
  check('ארבעה שווים נותנים שני זוגות', eq(g.grid.slice(0, 4), [4, 4, 0, 0]));
  check('הניקוד על שני מיזוגים', g.score === 8);
}

{
  // מיזוג יחיד לכל אריח: [2,2,2] שמאלה => [4,2] ולא [8]
  const g = from([
    2, 2, 2, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  g.move('left');
  check('שלושה שווים: זוג + יחיד', eq(g.grid.slice(0, 4), [4, 2, 0, 0]));
}

{
  // מיזוג שנוצר לא מתמזג שוב באותו מהלך: [4,4,8] => [8,8], לא [16]
  const g = from([
    4, 4, 8, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  g.move('left');
  check('תוצאת מיזוג אינה מתמזגת שוב מיד', eq(g.grid.slice(0, 4), [8, 8, 0, 0]));
}

section('כיוונים');

{
  const g = from([
    2, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 2,
  ]);
  g.move('down');
  check('החלקה למטה מיישרת לקצה התחתון',
    g.grid[3 * 4 + 0] === 2 && g.grid[3 * 4 + 3] === 2);
}

{
  const g = from([
    2, 0, 0, 0,
    2, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  g.move('up');
  check('החלקה למעלה ממזגת עמודה', g.grid[0] === 4 && g.grid[4] === 0);
}

{
  const g = from([
    0, 0, 2, 2,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  g.move('right');
  check('החלקה ימינה מיישרת ומזגת לקצה', eq(g.grid.slice(0, 4), [0, 0, 0, 4]));
}

section('מהלך ריק');

{
  const g = from([
    2, 4, 8, 16,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  const res = g.move('left');
  check('שורה כבר דחוסה — אין מהלך', res.moved === false);
  check('מהלך ריק אינו מגדיל את מונה המהלכים', g.moves === 0);
}

{
  const g = from([
    2, 4, 2, 4,
    4, 2, 4, 2,
    2, 4, 2, 4,
    4, 2, 4, 2,
  ]);
  check('לוח משבצות מלא בלי שכנים שווים = נגמר', g.isOver() === true);
  check('אין מהלך לאף כיוון',
    !g.move('left').moved && !g.move('right').moved &&
    !g.move('up').moved && !g.move('down').moved);
}

{
  const g = from([
    2, 2, 4, 8,
    4, 8, 16, 32,
    2, 4, 8, 16,
    4, 8, 16, 32,
  ]);
  check('יש זוג שכנים אופקי — לא נגמר', g.isOver() === false);
}

section('הגרלה');

{
  // rng קבוע: הראשון בוחר תא, השני קובע ערך (0.5 < 0.9 => 2)
  const g = new Game2048({ rng: () => 0.5 });
  const filled = g.grid.filter((v) => v !== 0);
  check('פתיחה עם שני אריחים', filled.length === 2);
  check('אריחי הפתיחה הם 2 או 4', filled.every((v) => v === 2 || v === 4));
}

{
  let calls = 0;
  const seq = [0, 0.95]; // תא ראשון, ואז >0.9 => הערך 4
  const g = new Game2048({ grid: new Array(16).fill(0), rng: () => seq[calls++] });
  const res = g._spawn();
  check('rng>0.9 מגריל 4', res.value === 4 && g.grid[0] === 4);
}

{
  const full = new Array(16).fill(2);
  const g = from(full);
  check('אין הגרלה ללוח מלא', g._spawn() === null);
}

section('transitions');

{
  const g = from([
    2, 2, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  const res = g.move('left');
  check('שני מקורות למיזוג', res.transitions.filter((t) => t.to === 0).length === 2);
  check('שניהם מסומנים merged', res.transitions.every((t) => t.merged === true));
  check('היעד נרשם ב-mergeTargets', res.mergeTargets.indexOf(0) >= 0);
}

section('ניצחון');

{
  const g = from([
    1024, 1024, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  const res = g.move('left');
  check('הגעה ל-2048 מסמנת ניצחון', g.won === true && res.won === true);
  check('bestTile מחזיר את הגבוה', g.bestTile() === 2048);
}

{
  const g = from([
    2048, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ]);
  g.won = true;
  const res = g.move('left');
  check('ניצחון חוזר אינו מדווח שוב כחדש', res.won === false);
}

section('שחזור');

{
  const g = from([
    2, 4, 8, 16,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 2,
  ]);
  g.score = 42;
  g.moves = 7;
  const back = Game2048.deserialize(g.serialize());
  check('הלוח משוחזר במדויק', eq(back.grid, g.grid));
  check('הניקוד והמהלכים משוחזרים', back.score === 42 && back.moves === 7);
  check('שחזור אינו מגריל אריח חדש',
    back.grid.filter((v) => v !== 0).length === g.grid.filter((v) => v !== 0).length);
}

section('שלמות לאורך משחק');

{
  // משחק אקראי ארוך — הלוח תמיד תקין, הניקוד לא יורד
  let ok = true;
  let seed = 12345;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const g = new Game2048({ rng });
  let prevScore = 0;
  const dirs = Game2048.DIRS;
  for (let i = 0; i < 2000 && !g.isOver(); i++) {
    const dir = dirs[Math.floor(rng() * 4)];
    g.move(dir);
    if (g.score < prevScore) ok = false;
    prevScore = g.score;
    const count = g.grid.filter((v) => v !== 0).length;
    if (count > 16 || g.grid.some((v) => v !== 0 && (v & (v - 1)) !== 0)) ok = false;
  }
  check('לאורך משחק: לוח תקין, כל ערך חזקת 2, ניקוד לא יורד', ok);
}

/* --------------------------------------------------------------------- */

console.log('\n' + passed + ' עברו, ' + failed + ' נכשלו');
process.exit(failed ? 1 : 0);
