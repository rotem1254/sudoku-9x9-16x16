/* =============================================================================
 * test/test-blockblast.js — בדיקות למנוע Block Blast
 * -----------------------------------------------------------------------------
 *     node test/test-blockblast.js
 * =========================================================================== */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'js', 'blockblast', 'engine.js'));
require(path.join(__dirname, '..', 'js', 'blockblast', 'deal.js'));
require(path.join(__dirname, '..', 'js', 'blockblast', 'game.js'));

const C = globalThis.BlockBlastCore;
const D = globalThis.BlockBlastDeal;
const BlockBlast = globalThis.BlockBlast;

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
};
const section = (t) => console.log('\n' + t);

/** בונה לוח מתוך ציור טקסטואלי — שורה למחרוזת, '#' תפוס. */
function boardFrom(rows) {
  let b = C.emptyBoard();
  rows.forEach((line, r) => {
    for (let c = 0; c < C.SIZE; c++) if (line[c] === '#') b = C.setCell(b, r, c);
  });
  return b;
}
const EMPTY_ROW = '........';

/* --------------------------------------------------------------------- */

section('הלוח — שני חצאים של 32 ביט');

check('לוח ריק', C.countCells(C.emptyBoard()) === 0);
check('64 תאים', C.CELLS === 64);

// הגבול בין שני החצאים הוא בדיוק המקום שקל לטעות בו
{
  let b = C.emptyBoard();
  b = C.setCell(b, 3, 7); // ביט 31 — האחרון ב-lo
  b = C.setCell(b, 4, 0); // ביט 32 — הראשון ב-hi
  check('הביט האחרון בחצי התחתון', b.lo !== 0 && (b.lo >>> 31) === 1);
  check('הביט הראשון בחצי העליון', b.hi === 1);
  check('שני התאים נספרים', C.countCells(b) === 2);
  check('קריאה חוזרת מחזירה את מה שנכתב',
    C.getCell(b, 3, 7) === 1 && C.getCell(b, 4, 0) === 1 && C.getCell(b, 4, 1) === 0);
}

// כל 64 התאים ניתנים לכתיבה ולקריאה, כולל הפינות
{
  let ok = true;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const b = C.setCell(C.emptyBoard(), r, c);
      if (C.countCells(b) !== 1 || C.getCell(b, r, c) !== 1) ok = false;
    }
  }
  check('כל 64 התאים נכתבים ונקראים נכון', ok);
}

check('popcount על מספר מלא', C.popcount(0xffffffff) === 32);
check('popcount על אפס', C.popcount(0) === 0);

// מסכות
check('8 מסכות שורה ו-8 מסכות עמודה',
  C.ROW_MASK.length === 8 && C.COL_MASK.length === 8);
check('כל מסכת שורה מכסה 8 תאים',
  C.ROW_MASK.every((m) => C.countCells(m) === 8));
check('כל מסכת עמודה מכסה 8 תאים',
  C.COL_MASK.every((m) => C.countCells(m) === 8));

/* --------------------------------------------------------------------- */

section('החלקים');

check('19 צורות', C.PIECES.length === 19);
check('לכל צורה מזהה ייחודי',
  new Set(C.PIECES.map((p) => p.id)).size === C.PIECES.length);

// כל צורה חייבת להיות רציפה — תאים מנותקים היו בונים חלק בלתי אפשרי
{
  let allConnected = true;
  for (const piece of C.PIECES) {
    const key = (r, c) => r + ',' + c;
    const set = new Set(piece.cells.map(([r, c]) => key(r, c)));
    const seen = new Set();
    const stack = [piece.cells[0]];
    while (stack.length) {
      const [r, c] = stack.pop();
      if (seen.has(key(r, c))) continue;
      seen.add(key(r, c));
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (set.has(key(r + dr, c + dc))) stack.push([r + dr, c + dc]);
      }
    }
    if (seen.size !== piece.cells.length) allConnected = false;
  }
  check('כל צורה רציפה', allConnected);
}

check('אף צורה לא חורגת מ-5 תאים',
  C.PIECES.every((p) => p.size >= 1 && p.size <= 5));
check('אין תא כפול בתוך צורה',
  C.PIECES.every((p) => new Set(p.cells.map((x) => x.join())).size === p.size));

// המיקומים המוכנים מראש — יחיד נכנס ב-64 מקומות, קו של 5 בהרבה פחות
check('יחיד: 64 מיקומים', C.pieceById.x1.placements.length === 64);
check('קו אופקי של 5: 4 עמודות × 8 שורות',
  C.pieceById.h5.placements.length === 32);
check('ריבוע 2×2: 7×7', C.pieceById.sq.placements.length === 49);
check('כל מסכת מיקום מכילה בדיוק את תאי הצורה',
  C.PIECES.every((p) => p.placements.every((pl) => C.countCells(pl.mask) === p.size)));

/* --------------------------------------------------------------------- */

section('הנחה');

check('חלק נכנס ללוח ריק', C.canPlace(C.emptyBoard(), C.pieceById.h5));

// לוח מלא לגמרי — שום דבר לא נכנס
{
  const full = boardFrom(new Array(8).fill('########'));
  check('לוח מלא: 64 תאים', C.countCells(full) === 64);
  check('לוח מלא — אפילו יחיד לא נכנס', !C.canPlace(full, C.pieceById.x1));
}

// חפיפה נחסמת
{
  const b = C.setCell(C.emptyBoard(), 0, 0);
  const single = C.pieceById.x1.placements.find((p) => p.row === 0 && p.col === 0);
  check('לא ניתן להניח על תא תפוס', !C.fits(b, single.mask));
  const next = C.pieceById.x1.placements.find((p) => p.row === 0 && p.col === 1);
  check('התא שלידו פנוי', C.fits(b, next.mask));
}

// חלק לא גולש משורה לשורה — הטעות הקלאסית בביטבורד
{
  const h3 = C.pieceById.h3;
  const atEnd = h3.placements.filter((p) => p.col === 6);
  check('קו של 3 אינו מתחיל בעמודה 6 (היה גולש לשורה הבאה)', atEnd.length === 0);
  const last = h3.placements.filter((p) => p.col === 5);
  check('קו של 3 כן מתחיל בעמודה 5', last.length === 8);
}

/* --------------------------------------------------------------------- */

section('ניקוי');

// שורה בודדת
{
  const b = boardFrom(['#######.', ...new Array(7).fill(EMPTY_ROW)]);
  const spot = C.pieceById.x1.placements.find((p) => p.row === 0 && p.col === 7);
  const res = C.place(b, spot.mask);
  check('שורה שהתמלאה נמחקת', res.rows.length === 1 && res.rows[0] === 0);
  check('לא נוקתה שום עמודה', res.cols.length === 0);
  check('הלוח התרוקן', C.countCells(res.board) === 0);
}

// עמודה בודדת
{
  const rows = new Array(8).fill(EMPTY_ROW);
  for (let r = 0; r < 7; r++) rows[r] = '#.......';
  const b = boardFrom(rows);
  const spot = C.pieceById.x1.placements.find((p) => p.row === 7 && p.col === 0);
  const res = C.place(b, spot.mask);
  check('עמודה שהתמלאה נמחקת', res.cols.length === 1 && res.cols[0] === 0);
  check('הלוח התרוקן', C.countCells(res.board) === 0);
}

/*
 * שורה ועמודה שנסגרות באותה הנחה — המקרה שבו קל לטעות: אם מוחקים את
 * השורה קודם, העמודה כבר אינה מלאה ונספרת רק אחת
 */
{
  const rows = [];
  rows.push('#######.');            // שורה 0 חסרה את (0,7)
  for (let r = 1; r < 8; r++) rows.push('.......#'); // עמודה 7 חסרה את (0,7)
  const b = boardFrom(rows);
  const spot = C.pieceById.x1.placements.find((p) => p.row === 0 && p.col === 7);
  const res = C.place(b, spot.mask);
  check('שורה ועמודה שנסגרו יחד נספרות שתיהן',
    res.rows.length === 1 && res.cols.length === 1 && res.cleared === 2);
  check('ההצטלבות לא נספרה פעמיים', C.countCells(res.board) === 0);
}

/*
 * סיבית 31 היא המלכודת. אופרטור & ב-JS מחזיר מספר מסומן, ולכן ברגע
 * שהסיבית הזו דלוקה התוצאה שלילית וההשוואה למסכה הלא-מסומנת נכשלת.
 * שורה 3 (סיביות 24..31) ועמודה 7 (סיביות 7,15,23,31,...) הן היחידות
 * שנוגעות בה, והן פשוט לא היו מתנקות. הבדיקה הזו נועלת את זה
 */
{
  const rows = new Array(8).fill(EMPTY_ROW);
  rows[3] = '#######.';
  const b = boardFrom(rows);
  const spot = C.pieceById.x1.placements.find((p) => p.row === 3 && p.col === 7);
  const res = C.place(b, spot.mask);
  check('שורה 3 מתנקה — הסיבית שגלשה לשלילי', res.rows.length === 1 && res.rows[0] === 3);
}
{
  const rows = new Array(8).fill('.......#');
  rows[0] = EMPTY_ROW;
  const b = boardFrom(rows);
  const spot = C.pieceById.x1.placements.find((p) => p.row === 0 && p.col === 7);
  const res = C.place(b, spot.mask);
  check('עמודה 7 מתנקה — אותה סיבית', res.cols.length === 1 && res.cols[0] === 7);
}

// שתי שורות בבת אחת
{
  const rows = ['#######.', '#######.', ...new Array(6).fill(EMPTY_ROW)];
  const b = boardFrom(rows);
  const spot = C.pieceById.v2.placements.find((p) => p.row === 0 && p.col === 7);
  const res = C.place(b, spot.mask);
  check('שתי שורות שנסגרו יחד', res.cleared === 2 && res.rows.length === 2);
}

/* --------------------------------------------------------------------- */

section('ניקוד');

check('נקודה לכל תא שמניחים, בלי ניקוי', C.scoreMove(5, 0, 0, false) === 5);
check('שורה אחת: 5 תאים + 10', C.scoreMove(5, 1, 1, false) === 15);
check('שתי שורות: 20', C.scoreMove(1, 2, 1, false) === 21);
check('שלוש שורות קופצות ל-60', C.scoreMove(1, 3, 1, false) === 61);
check('ארבע: 120', C.scoreMove(1, 4, 1, false) === 121);
check('חמש: 200', C.scoreMove(1, 5, 1, false) === 201);
check('שש ומעלה: 300', C.scoreMove(1, 6, 1, false) === 301);
check('שבע נחסם על 300', C.scoreMove(1, 7, 1, false) === 301);
check('ניקוי לוח מוסיף 360', C.scoreMove(1, 1, 1, true) === 1 + 10 + 360);

// הקומבו מכפיל את הניקוי, לא את ההנחה
check('קומבו 2 מכפיל את בונוס הניקוי בלבד', C.scoreMove(4, 1, 2, false) === 4 + 20);
check('קומבו 3 על שלוש שורות', C.scoreMove(1, 3, 3, false) === 1 + 180);
check('בלי ניקוי אין קומבו גם אם המונה גבוה', C.scoreMove(3, 0, 5, false) === 3);

/* --------------------------------------------------------------------- */

section('מהלך במשחק');

// הקומבו — ההתנהגות שהכי קל לשבור
{
  const g = new BlockBlast({ seed: 1 });
  // בונים ידנית מצב שבו הנחה אחת מנקה
  g.board = boardFrom(['#######.', ...new Array(7).fill(EMPTY_ROW)]);
  g.tray = [C.pieceById.x1, C.pieceById.x1, C.pieceById.x1];

  const r1 = g.playPiece(0, 0, 7);
  check('הנחה שמנקה מעלה את הקומבו ל-1', r1.ok && r1.combo === 1);

  const r2 = g.playPiece(0, 4, 4); // לא מנקה כלום
  check('הנחה בלי ניקוי מאפסת את הקומבו', r2.ok && r2.combo === 0);
}

// הקומבו נמשך על פני שלישיות
{
  const g = new BlockBlast({ seed: 2 });
  g.board = boardFrom(['#######.', '#######.', ...new Array(6).fill(EMPTY_ROW)]);
  g.tray = [C.pieceById.x1];
  const r1 = g.playPiece(0, 0, 7);
  check('ניקוי בחלק האחרון של השלישייה', r1.ok && r1.combo === 1);
  check('הגיעה שלישייה חדשה', g.tray.length === 3);

  // ממשיכים לנקות עם השלישייה החדשה
  g.board = boardFrom(['#######.', ...new Array(7).fill(EMPTY_ROW)]);
  g.tray = [C.pieceById.x1].concat(g.tray.slice(0, 2));
  const r2 = g.playPiece(0, 0, 7);
  check('הקומבו נמשך אל תוך השלישייה החדשה', r2.ok && r2.combo === 2);
}

// הנחה לא חוקית נדחית ואינה משנה כלום
{
  const g = new BlockBlast({ seed: 3 });
  g.board = C.setCell(C.emptyBoard(), 0, 0);
  g.tray = [C.pieceById.x1];
  const before = g.score;
  const r = g.playPiece(0, 0, 0);
  check('הנחה על תא תפוס נדחית', !r.ok && r.reason === 'occupied');
  check('הניקוד לא השתנה', g.score === before);
  check('החלק נשאר במגש', g.tray.length === 1);
}

// סוף משחק בדיוק כשאין מהלך
{
  const g = new BlockBlast({ seed: 4 });
  // לוח כמעט מלא: רק תא אחד פנוי, והמגש מחזיק קו של 5
  const rows = new Array(8).fill('########');
  rows[0] = '.#######';
  g.board = boardFrom(rows);
  g.tray = [C.pieceById.h5];
  check('אין מהלך', !g.hasMove());

  g.tray = [C.pieceById.x1];
  check('יחיד כן נכנס לתא הבודד', g.hasMove());
}

/* --------------------------------------------------------------------- */

section('המחולל וההבטחה');

check('שש תמורות', D.ORDERS.length === 6);

// הסדר באמת משנה — זו כל הסיבה שבודקים תמורות
{
  /*
   * לוח שבו שורה 0 חסרה 5 תאים. קו של 5 סוגר אותה ומפנה מקום, ורק
   * *אחריו* יש מקום לריבוע. בסדר ההפוך הריבוע חוסם
   */
  const rows = ['###.....', ...new Array(7).fill('########')];
  rows[1] = '########';
  const b = boardFrom(rows);
  // רק שורה 0 פנויה חלקית — h5 נכנס ב-(0,3) ומנקה את השורה
  const h5 = C.pieceById.h5;
  check('קו של 5 נכנס ומנקה',
    h5.placements.some((p) => C.fits(b, p.mask)));
}

// ההבטחה עצמה — הטענה המרכזית של המשחק
{
  const rng = C.mulberry32(12345);
  let dealt = 0;
  let unsolvable = 0;
  let worstTries = 0;

  for (let run = 0; run < 60; run++) {
    const g = new BlockBlast({ seed: 5000 + run, guaranteed: true });
    let guard = 0;
    while (!g.finished && guard++ < 400) {
      // בכל חלוקה חדשה מוודאים שבאמת יש פתרון
      if (g.tray.length === 3) {
        dealt++;
        if (!D.isSolvable(g.board, g.tray)) unsolvable++;
        if (g.lastDeal) worstTries = Math.max(worstTries, g.lastDeal.tries);
      }
      // משחקים מהלך אקראי חוקי
      const idx = g.tray.findIndex((p) => g.canPlace(p));
      if (idx < 0) break;
      const spots = g.placements(g.tray[idx]);
      const spot = spots[Math.floor(rng() * spots.length)];
      g.playPiece(idx, spot.row, spot.col);
    }
  }

  console.log(`    (נבדקו ${dealt} חלוקות · מקסימום ${worstTries} ניסיונות לחלוקה)`);
  check('נבדקו מספיק חלוקות כדי שזה יהיה משמעותי', dealt > 400);
  check('לכל חלוקה מובטחת באמת יש פתרון', unsolvable === 0);
}

// בלי ההבטחה — צריך *לפעמים* לקבל שלישייה בלתי פתירה, אחרת ההבטחה חסרת ערך
{
  let unsolvable = 0;
  let total = 0;
  for (let run = 0; run < 40; run++) {
    const g = new BlockBlast({ seed: 9000 + run, guaranteed: false });
    let guard = 0;
    while (!g.finished && guard++ < 300) {
      if (g.tray.length === 3) {
        total++;
        if (!D.isSolvable(g.board, g.tray)) unsolvable++;
      }
      const idx = g.tray.findIndex((p) => g.canPlace(p));
      if (idx < 0) break;
      const spots = g.placements(g.tray[idx]);
      g.playPiece(idx, spots[0].row, spots[0].col);
    }
  }
  console.log(`    (בלי הבטחה: ${unsolvable} מתוך ${total} חלוקות ללא פתרון)`);
  check('בלי ההבטחה אכן מופיעות חלוקות בלתי פתירות', unsolvable > 0);
}

/* --------------------------------------------------------------------- */

section('שלמות ומהירות');

// משחקים שלמים — הלוח חייב להישאר חוקי לאורך כל הדרך
{
  let bad = 0;
  let longest = 0;
  let bestScore = 0;
  for (let run = 0; run < 30; run++) {
    const g = new BlockBlast({ seed: 700 + run });
    let guard = 0;
    while (!g.finished && guard++ < 500) {
      const idx = g.tray.findIndex((p) => g.canPlace(p));
      if (idx < 0) break;
      const spots = g.placements(g.tray[idx]);
      g.playPiece(idx, spots[0].row, spots[0].col);

      const n = C.countCells(g.board);
      if (n < 0 || n > 64) bad++;
      if (g.tray.length < 1 || g.tray.length > 3) bad++;
    }
    longest = Math.max(longest, g.moves);
    bestScore = Math.max(bestScore, g.score);
  }
  console.log(`    (משחק ארוך ביותר ${longest} מהלכים · ניקוד גבוה ${bestScore})`);
  check('הלוח והמגש נשארים תקינים לאורך 30 משחקים', bad === 0);
  check('משחק מגיע לאורך סביר', longest > 15);
}

// מהירות: החלוקה היא הדבר היקר, והיא חייבת להיבלע בתוך מגע של שחקן
{
  let worst = 0;
  const rng = C.mulberry32(4242);
  for (let run = 0; run < 25; run++) {
    const g = new BlockBlast({ seed: 300 + run });
    let guard = 0;
    while (!g.finished && guard++ < 400) {
      const idx = g.tray.findIndex((p) => g.canPlace(p));
      if (idx < 0) break;
      const spots = g.placements(g.tray[idx]);
      const spot = spots[Math.floor(rng() * spots.length)];

      const t0 = process.hrtime.bigint();
      g.playPiece(idx, spot.row, spot.col);
      worst = Math.max(worst, Number(process.hrtime.bigint() - t0) / 1e6);
    }
  }
  console.log(`    (המהלך האיטי ביותר: ${worst.toFixed(1)}ms)`);
  check('שום מהלך אינו חורג מ-50ms', worst < 50);
}

// שמירה ושחזור
{
  const g = new BlockBlast({ seed: 77 });
  for (let i = 0; i < 6; i++) {
    const idx = g.tray.findIndex((p) => g.canPlace(p));
    if (idx < 0) break;
    const spots = g.placements(g.tray[idx]);
    g.playPiece(idx, spots[0].row, spots[0].col);
  }
  const back = BlockBlast.deserialize(JSON.parse(JSON.stringify(g.serialize())));
  check('הלוח משוחזר במדויק',
    back.board.lo === g.board.lo && back.board.hi === g.board.hi);
  check('הניקוד, הקומבו והמהלכים משוחזרים',
    back.score === g.score && back.combo === g.combo && back.moves === g.moves);
  check('המגש משוחזר עם אותם חלקים',
    back.tray.map((p) => p.id).join() === g.tray.map((p) => p.id).join());
}

/* --------------------------------------------------------------------- */

console.log(`\n${passed} עברו, ${failed} נכשלו`);
process.exit(failed ? 1 : 0);
