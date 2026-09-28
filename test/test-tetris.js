/* =============================================================================
 * test/test-tetris.js — בדיקות למנוע טטריס
 * -----------------------------------------------------------------------------
 *     node test/test-tetris.js
 * =========================================================================== */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'js', 'tetris', 'engine.js'));

const Tetris = globalThis.Tetris;
const { W, H } = Tetris;

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
};
const section = (t) => console.log('\n' + t);

function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ממלא שורה מלאה חוץ מהעמודות שב-gaps */
function fillRow(g, y, gaps) {
  for (let x = 0; x < W; x++) g.board[y][x] = gaps.indexOf(x) >= 0 ? null : 'Z';
}

const key = (cells) => cells.map(([x, y]) => x + ',' + y).sort().join(' ');

/* --------------------------------------------------------------------- */

section('צורות');

{
  let ok = true;
  Tetris.TYPES.forEach((t) => {
    Tetris.SHAPES[t].forEach((rot) => { if (rot.length !== 4) ok = false; });
  });
  check('לכל חלק ארבעה ריבועים בכל מצב', ok);
  // סיבוב נוסף של מצב 3 חייב להחזיר בדיוק את מצב 0
  const turn = (cells, n) => cells.map(([x, y]) => [n - 1 - y, x]);
  check('ארבעה סיבובים מחזירים למצב ההתחלתי',
    Tetris.TYPES.filter((t) => t !== 'O').every((t) =>
      key(turn(Tetris.SHAPES[t][3], t === 'I' ? 4 : 3)) === key(Tetris.SHAPES[t][0])));
  check('ל-T ארבעה מצבים שונים', new Set(Tetris.SHAPES.T.map(key)).size === 4);
  check('O זהה בכל המצבים', new Set(Tetris.SHAPES.O.map(key)).size === 1);
}

section('שקית של 7');

{
  const g = new Tetris({ rng: seeded(3) });
  const seen = [g.active.type];
  for (let i = 0; i < 27; i++) { seen.push(g.queue[0]); g.queue.shift(); g._refill(); }
  let ok = true;
  for (let b = 0; b < 4; b++) {
    const bag = seen.slice(b * 7, b * 7 + 7);
    if (new Set(bag).size !== 7) ok = false;
  }
  check('כל קבוצה של 7 רצופים מכילה את כל שבעת החלקים', ok);
  check('התור מלא תמיד', g.queue.length === 5);
}

section('לידה ותנועה');

{
  const g = new Tetris({ sequence: ['T', 'I', 'O'] });
  check('החלק הראשון לפי הסדר', g.active.type === 'T');
  check('נולד בעמודה 3 וירד שורה אחת', g.active.x === 3 && g.active.y === 1);
  let n = 0;
  while (g.left()) n++;
  check('זז שמאלה עד הקיר', g.cells().some(([x]) => x === 0) && n === 3);
  check('לא חוצה את הקיר', !g.left());
  while (g.right()) n++;
  check('וימינה עד הקיר השני', g.cells().some(([x]) => x === W - 1));
}

section('סיבוב ו-wall kick');

{
  const g = new Tetris({ sequence: ['T'] });
  check('סיבוב במרכז מצליח', g.rotate(1) && g.active.rot === 1);
  check('סיבוב נגד מחזיר', g.rotate(-1) && g.active.rot === 0);
  check('180 מעלות', g.rotate(2) && g.active.rot === 2);
}

{
  // I אנכי צמוד לקיר ימין — סיבוב חייב לבעוט אותו פנימה
  const g = new Tetris({ sequence: ['I'] });
  g.rotate(1);
  while (g.right()) {}
  const before = g.active.x;
  const ok = g.rotate(1);
  check('I ליד הקיר מסתובב בעזרת בעיטה', ok && g.cells().every(([x]) => x >= 0 && x < W));
  check('ואכן זז מהמקום', g.active.x !== before);
}

{
  // T אנכי צמוד לקיר שמאל: סיבוב נוסף ישים ריבוע מחוץ ללוח — הבעיטה (1,0) מצילה
  const g = new Tetris({ sequence: ['T'] });
  g.rotate(1);
  while (g.left()) {}
  const res = g.rotate(1);
  check('T ליד הקיר מסתובב בבעיטה הראשונה', res && g.active.kick === 1 && g.cells().every(([x]) => x >= 0));
}

{
  // חסום לגמרי — אף בעיטה לא עוזרת והסיבוב נכשל בלי לזוז
  const g = new Tetris({ sequence: ['I'] });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (y !== g.active.y + 1) g.board[y][x] = 'Z';
  const before = JSON.stringify(g.active);
  check('סיבוב בלי מקום נכשל ולא משנה כלום', !g.rotate(1) && JSON.stringify(g.active) === before);
}

{
  const g = new Tetris({ sequence: ['O'] });
  check('O לא מסתובב', !g.rotate(1));
}

section('נפילה ונעילה');

{
  const g = new Tetris({ sequence: ['O', 'T'] });
  const d = g.dropDistance();
  const gh = g.ghost();
  check('חלק הרפאים בתחתית', gh.y === g.active.y + d && Math.max(...g.cells(gh).map((c) => c[1])) === H - 1);
  const score0 = g.score;
  g.hardDrop();
  check('הפלה נועלת מיד', g.board[H - 1][4] === 'O' && g.board[H - 1][5] === 'O');
  check('ומזכה 2 לשורה', g.score - score0 === d * 2);
  check('החלק הבא נולד', g.active.type === 'T');
}

{
  const g = new Tetris({ sequence: ['O', 'T'] });
  g.tick(1000);
  check('כבידה בשלב 1 — שורה לשנייה', g.active.y === 2);
  while (g.softDrop()) {}
  check('על הקרקע — עוד לא ננעל', g.active.type === 'O' && g.grounded());
  g.tick(Tetris.LOCK_DELAY - 1);
  check('לפני 500ms עדיין לא', g.active && g.active.type === 'O');
  g.left();
  g.tick(Tetris.LOCK_DELAY - 1);
  check('תזוזה מאפסת את טיימר הנעילה', g.active && g.active.type === 'O');
  g.tick(2);
  check('ואחרי 500ms בלי תזוזה — ננעל', g.active && g.active.type === 'T');
}

{
  // אי אפשר לדחות נעילה לנצח
  const g = new Tetris({ sequence: ['T', 'O'] });
  while (g.softDrop()) {}
  for (let i = 0; i < 40; i++) { g.rotate(1); g.tick(100); if (!g.active || g.active.type !== 'T') break; }
  check('אחרי 15 איפוסים החלק ננעל', g.active && g.active.type === 'O');
}

section('ניקוי שורות וניקוד');

{
  const g = new Tetris({ sequence: ['I', 'O'] });
  for (let y = H - 4; y < H; y++) fillRow(g, y, [9]);
  g.rotate(1);
  while (g.right()) {}
  g.hardDrop();
  check('טטריס — ארבע שורות מסומנות לניקוי', g.clearing && g.clearing.rows.length === 4);
  const ev = g.drain().find((e) => e.type === 'lock');
  check('800 × שלב', ev.points === 800);
  g.tick(Tetris.CLEAR_DELAY);
  check('אחרי ההשהיה השורות נעלמות', g.board.every((r) => r.every((c) => !c)));
  check('ספירת שורות', g.lines === 4 && g.tetrises === 1);
  check('החלק הבא נולד אחרי הניקוי', g.active && g.active.type === 'O');
}

{
  const g = new Tetris({ sequence: ['I', 'I', 'O'] });
  for (let y = H - 8; y < H; y++) fillRow(g, y, [9]);
  g.rotate(1); while (g.right()) {} g.hardDrop(); g.tick(Tetris.CLEAR_DELAY);
  g.drain();
  g.rotate(1); while (g.right()) {} g.hardDrop();
  const ev = g.drain().find((e) => e.type === 'lock');
  check('טטריס רצוף — ×1.5 ועוד קומבו', ev.b2b && ev.points === 1200 + 50);
}

{
  const g = new Tetris({ sequence: ['I', 'O'], startLevel: 3 });
  fillRow(g, H - 1, [3, 4, 5, 6]);
  g.hardDrop();
  const ev = g.drain().find((e) => e.type === 'lock');
  check('שורה אחת בשלב 3 — 300', ev.points === 300);
}

{
  const g = new Tetris({ sequence: new Array(20).fill('I') });
  for (let k = 0; k < 10; k++) {
    fillRow(g, H - 1, [3, 4, 5, 6]);
    g.hardDrop();
    g.tick(Tetris.CLEAR_DELAY);
  }
  check('עשר שורות — שלב 2', g.lines === 10 && g.level === 2);
  check('הכבידה מהירה יותר', Tetris.gravityMs(2) < Tetris.gravityMs(1));
}

section('שמירה (hold)');

{
  const g = new Tetris({ sequence: ['T', 'I', 'O', 'S'] });
  check('שמירה ראשונה מוציאה את הבא בתור', g.holdPiece() && g.hold === 'T' && g.active.type === 'I');
  check('אין שמירה פעמיים לאותו חלק', !g.holdPiece());
  g.hardDrop();
  check('אחרי נעילה אפשר שוב, והחלק השמור חוזר', g.holdPiece() && g.active.type === 'T' && g.hold === 'O');
}

section('סוף משחק');

{
  const g = new Tetris({ sequence: ['O', 'O'] });
  for (let y = 2; y < H; y++) fillRow(g, y, [0]);
  g.hardDrop();
  check('חלק שלא נכנס בלידה — סוף', g.over);
  check('ואירוע over', g.drain().some((e) => e.type === 'over'));
  check('אחרי הסוף שום דבר לא זז', !g.left() && !g.rotate(1) && g.hardDrop() === 0);
}

section('שחזור ושלמות');

{
  const g = new Tetris({ rng: seeded(5) });
  g.left(); g.rotate(1); g.hardDrop(); g.holdPiece(); g.tick(300);
  const c = Tetris.deserialize(JSON.parse(JSON.stringify(g.serialize())));
  check('שחזור שומר לוח, חלק פעיל, תור ושמירה',
    JSON.stringify(c.board) === JSON.stringify(g.board) &&
    JSON.stringify(c.active) === JSON.stringify(g.active) &&
    c.queue.join() === g.queue.join() && c.hold === g.hold && c.score === g.score);
}

{
  let ok = true, games = 0, totalLines = 0;
  for (let seed = 1; seed <= 30 && ok; seed++) {
    const rng = seeded(seed);
    const g = new Tetris({ rng });
    for (let i = 0; i < 3000 && !g.over; i++) {
      const r = rng();
      if (r < 0.2) g.left();
      else if (r < 0.4) g.right();
      else if (r < 0.55) g.rotate(rng() < 0.5 ? 1 : -1);
      else if (r < 0.6) g.holdPiece();
      else if (r < 0.7) g.hardDrop();
      else g.tick(16 + rng() * 200, rng() < 0.3);
      if (g.active && !g.fits(g.active.type, g.active.rot, g.active.x, g.active.y)) { ok = false; break; }
      if (g.board.length !== H || g.board.some((row) => row.length !== W)) { ok = false; break; }
      if (!g.clearing && g.board.some((row) => row.every(Boolean))) { ok = false; break; }
    }
    games++;
    totalLines += g.lines;
  }
  check('30 משחקים אקראיים: חלק תמיד במקום חוקי, אין שורה מלאה שנשארת', ok && games === 30);
}

/* --------------------------------------------------------------------- */

console.log('\n' + passed + ' עברו, ' + failed + ' נכשלו');
if (failed) process.exit(1);
