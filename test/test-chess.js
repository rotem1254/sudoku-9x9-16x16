/* =============================================================================
 * test/test-chess.js — בדיקות לשחמט: חוקים ויריב ממוחשב
 * -----------------------------------------------------------------------------
 *     node test/test-chess.js
 * =========================================================================== */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'js', 'chess', 'engine.js'));
require(path.join(__dirname, '..', 'js', 'chess', 'ai.js'));

const Chess = globalThis.Chess;
const AI = globalThis.ChessAI;

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

/* --------------------------------------------------------------------- */

section('perft — ספירת עמדות מול ערכים ידועים');

/*
 * perft סופר את כל העמדות החוקיות עד עומק נתון. הערכים הם הערכים
 * המפורסמים לעמדות הבדיקה הסטנדרטיות — כל באג בהצרחה, בהכאה דרך הילוכו,
 * בהכתרה או בריתוק משנה את המספר.
 */
[
  ['עמדת פתיחה', Chess.START, [20, 400, 8902]],
  ['Kiwipete (הצרחות, ריתוקים)', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039]],
  ['סיום עם הכאה דרך הילוכו', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812]],
  ['הכתרות ושחים', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['עמדה 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486]],
].forEach(([name, fen, exp]) => {
  const g = new Chess(fen);
  const got = exp.map((_, i) => g.perft(i + 1));
  check(name + ' — ' + exp.join('/'), got.join() === exp.join());
  check(name + ' — FEN חוזר זהה', g.fen() === fen);
});

section('מהלכים ו-SAN');

{
  const g = new Chess();
  check('20 מהלכים בפתיחה', g.legal().length === 20);
  const m = g.move('e4');
  check('מהלך לפי SAN', m && m.from === 'e2' && m.to === 'e4');
  check('משבצת הכאה דרך הילוכו נרשמת', g.fen().split(' ')[3] === 'e3');
  check('מהלך לא חוקי מוחזר null', g.move({ from: 'e7', to: 'e4' }) === null);
  g.move({ from: 'e7', to: 'e5' });
  g.move('Nf3');
  check('תור מתחלף', g.turn === 'b');
  g.undo();
  check('ביטול מחזיר', g.turn === 'w' && g.get('g1') === 'N');
}

{
  // הבחנה: שני פרשים יכולים להגיע ל-d2
  const g = new Chess('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1');
  const sans = g.legal().map((m) => m.san);
  check('הבחנה לפי טור (Nbd2, Nfd2)', sans.includes('Nbd2') && sans.includes('Nfd2'));
}

{
  const g = new Chess('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  const sans = g.legal().map((m) => m.san);
  check('הצרחות כתובות O-O ו-O-O-O', sans.includes('O-O') && sans.includes('O-O-O'));
  g.move('O-O');
  check('הצריח עבר ל-f1', g.get('f1') === 'R' && g.get('g1') === 'K' && !g.get('h1'));
}

{
  const g = new Chess('7k/P7/8/8/8/8/8/K7 w - - 0 1');
  const sans = g.legal().map((m) => m.san);
  check('ארבע אפשרויות הכתרה', ['a8=Q+', 'a8=R+', 'a8=B', 'a8=N'].every((s) => sans.includes(s)));
  g.move({ from: 'a7', to: 'a8', promotion: 'n' });
  check('הכתרה לפרש', g.get('a8') === 'N');
}

section('הצרחה — מקרים אסורים');

{
  const g = new Chess('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  g.load('4k3/8/8/8/8/5r2/8/R3K2R w KQ - 0 1');
  const sans = g.legal().map((m) => m.san);
  check('אין הצרחה קצרה דרך משבצת מאוימת (f1)', !sans.includes('O-O') && sans.includes('O-O-O'));
  g.load('4k3/8/8/8/8/4r3/8/R3K2R w KQ - 0 1');
  check('אין הצרחה מתוך שח', !g.legal().some((m) => m.san.startsWith('O-O')));
  g.load('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  g.move('Rh2'); g.move('Kd8'); g.move('Rh1'); g.move('Ke8');
  check('צריח שזז מאבד את זכות ההצרחה', !g.legal().some((m) => m.san === 'O-O'));
}

section('הכאה דרך הילוכו');

{
  const g = new Chess('4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1');
  g.move('d5');
  const ep = g.legal().find((m) => m.flag === 'e');
  check('הכאה דרך הילוכו זמינה מיד', ep && ep.san === 'exd6');
  g.move('exd6');
  check('הרגלי השחור נעלם', !g.get('d5') && g.get('d6') === 'P');
  g.undo();
  check('ביטול מחזיר את שני הרגלים', g.get('d5') === 'p' && g.get('e5') === 'P');
}

section('סיום משחק');

{
  const g = new Chess();
  ['f3', 'e5', 'g4', 'Qh4#'].forEach((s) => g.move(s));
  const st = g.status();
  check('מט השוטה — מט', st.over && st.reason === 'mate' && st.result === '0-1');
  check('ה-SAN מסומן #', g.history[3].san === 'Qh4#');
}

{
  const g = new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  check('פט', g.status().reason === 'stalemate');
}

{
  const g = new Chess('4k3/8/8/8/8/8/8/4KB2 w - - 0 1');
  check('מלך ורץ מול מלך — חומר לא מספיק', g.status().reason === 'material');
  g.load('4k3/8/8/8/8/8/8/4KR2 w - - 0 1');
  check('מלך וצריח — לא תיקו', !g.status().over);
  // f1 בהירה, d8 כהה — רצים בצבעים שונים עדיין יכולים (בתיאוריה) לתת מט
  g.load('3bk3/8/8/8/8/8/8/4KB2 w - - 0 1');
  check('רצים בצבעים שונים — לא תיקו אוטומטי', !g.status().over);
  g.load('2b1k3/8/8/8/8/8/8/4KB2 w - - 0 1');
  check('רצים באותו צבע — חומר לא מספיק', g.status().reason === 'material');
}

{
  const g = new Chess();
  for (let i = 0; i < 2; i++) ['Nf3', 'Nf6', 'Ng1', 'Ng8'].forEach((s) => g.move(s));
  check('שלוש חזרות — תיקו', g.status().reason === 'repetition');
}

{
  const g = new Chess('4k3/8/8/8/8/8/8/R3K3 w - - 99 80');
  g.move('Ra2');
  check('50 מהלכים — תיקו', g.status().reason === 'fifty');
}

section('יריב ממוחשב');

{
  // מט במהלך אחד: Qh7#? — עמדה פשוטה: Ra8#
  const g = new Chess('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  const m = AI.bestMove(g, { level: 3, rng: seeded(1) });
  check('מוצא מט במהלך אחד (Ra8#)', m && m.from === 'a1' && m.to === 'a8');
}

{
  // מלכה לבנה מותקפת ע"י רגלי — חייבת לברוח או לאכול
  const g = new Chess('4k3/8/8/3p4/4Q3/8/8/4K3 w - - 0 1');
  const m = AI.bestMove(g, { level: 3, rng: seeded(2) });
  g.move(m);
  check('לא משאיר מלכה תלויה', g.pieces().some((p) => p.piece === 'Q'));
}

{
  // לוקח מלכה חינם
  const g = new Chess('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1');
  const m = AI.bestMove(g, { level: 2, rng: seeded(3) });
  check('לוקח מלכה שלא מוגנת', m && m.to === 'd5');
}

{
  // מלכה ומלך מול מלך בפינה: Qh8# הוא מט מיידי
  const g = new Chess('k7/8/1K6/8/8/8/8/7Q w - - 0 1');
  const t0 = Date.now();
  const m = AI.bestMove(g, { level: 4, rng: seeded(4) });
  const dt = Date.now() - t0;
  g.move(m);
  check('רמה קשה — מוצאת את המט', g.status().reason === 'mate');
  check('ומכבדת את מגבלת הזמן (< 2.5 שנ׳)', dt < 2500);
}

{
  const g = new Chess();
  const before = g.fen();
  AI.bestMove(g, { level: 3, rng: seeded(5) });
  check('החיפוש לא משנה את המשחק המקורי', g.fen() === before && g.history.length === 0);
}

{
  // משחק שלם מחשב מול מחשב — כל המהלכים חוקיים, המשחק מסתיים
  const g = new Chess();
  const rng = seeded(6);
  let ok = true, plies = 0;
  while (!g.status().over && plies < 400) {
    const m = AI.bestMove(g, { level: plies % 2 ? 1 : 2, rng, time: 60 });
    if (!m || !g.move(m)) { ok = false; break; }
    plies++;
  }
  check('משחק מחשב מול מחשב — ' + plies + ' מסעים, כולם חוקיים', ok);
}

/* --------------------------------------------------------------------- */

console.log('\n' + passed + ' עברו, ' + failed + ' נכשלו');
if (failed) process.exit(1);
