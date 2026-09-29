/* =============================================================================
 * test/test-bubbles.js — בדיקות למנוע באבלס
 * -----------------------------------------------------------------------------
 *     node test/test-bubbles.js
 * =========================================================================== */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'js', 'bubbles', 'engine.js'));

const Bubbles = globalThis.Bubbles;
const E = Bubbles.EMPTY;

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
};
const section = (t) => console.log('\n' + t);

/** rng דטרמיניסטי (mulberry32) */
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

/** לוח ריק בגודל נתון, עם שורות ראשונות לפי הצורך. */
function blank(rowsSpec, opts) {
  opts = opts || {};
  const cols = opts.cols || 10;
  const rows = opts.rows || 13;
  const grid = [];
  for (let r = 0; r < rows; r++) {
    const row = new Array(cols).fill(E);
    if (rowsSpec[r]) rowsSpec[r].forEach((v, c) => { row[c] = v; });
    grid.push(row);
  }
  // refillRows: 1 — לוחות הבדיקה רדודים בכוונה; מתמלאים מחדש רק כשהם ריקים
  return new Bubbles(Object.assign({ cols, rows, grid, current: 0, next: 0, rng: seeded(1), refillRows: 1 }, opts));
}

const UP = Math.PI / 2;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* --------------------------------------------------------------------- */

section('גיאומטריה');

{
  const g = blank([]);
  check('שורה 0 מלאה, שורה 1 מוסטת וקצרה באחת', g.rowLen(0) === 10 && g.rowLen(1) === 9);
  check('תא בשורה מוסטת זז חצי בועה', g.center(1, 0).x === 1 && g.center(0, 0).x === 0.5);

  // כל שכן נמצא במרחק קוטר אחד בדיוק — זו ההגדרה של רשת משושים
  let ok = true;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.rowLen(r); c++) {
      g.neighbors(r, c).forEach(([nr, nc]) => {
        if (Math.abs(dist(g.center(r, c), g.center(nr, nc)) - 1) > 1e-9) ok = false;
      });
    }
  }
  check('כל השכנים במרחק קוטר אחד', ok);
  check('לתא פנימי יש שישה שכנים', g.neighbors(4, 4).length === 6);
  check('לפינה שמאלית עליונה יש שני שכנים', g.neighbors(0, 0).length === 2);

  // שכנות סימטרית
  let sym = true;
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.rowLen(r); c++) {
      g.neighbors(r, c).forEach(([nr, nc]) => {
        if (!g.neighbors(nr, nc).some(([a, b]) => a === r && b === c)) sym = false;
      });
    }
  }
  check('השכנות סימטרית', sym);
}

section('מסלול');

{
  const g = blank([]);
  const t = g.trace(UP);
  check('ירייה ישר למעלה בלוח ריק נעצרת בתקרה', t.cell && t.cell.r === 0);
  check('ובעמודה האמצעית', t.cell && Math.abs(g.center(0, t.cell.c).x - 5) <= 0.5);
  check('בלי קפיצות: יציאה ונחיתה בלבד', t.path.length === 2);
}

{
  const g = blank([]);
  const t = g.trace(Math.PI * 0.2);
  check('ירייה באלכסון חד פוגעת בקיר וקופצת', t.path.length >= 3);
  check('נקודת הקפיצה על הקיר הימני', Math.abs(t.path[1].x - 9.5) < 1e-9);
  check('ועדיין נוחתת בתקרה', t.cell && t.cell.r === 0);
}

{
  const g = blank([[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]]);
  const t = g.trace(UP);
  check('מתחת לשורה מלאה — נעצרים בשורה 1', t.cell && t.cell.r === 1);
  check('התא מחובר לשכן תפוס', g.neighbors(t.cell.r, t.cell.c).some(([r, c]) => g.grid[r][c] !== E));
}

{
  const g = blank([]);
  check('זווית שטוחה מדי נחתכת', Bubbles.clampAngle(0) === Bubbles.MIN_ANGLE);
  check('גם בצד השני', Bubbles.clampAngle(Math.PI) === Bubbles.MAX_ANGLE);
  const a = g.trace(0), b = g.trace(Bubbles.MIN_ANGLE);
  check('trace מתנהג לפי הזווית החתוכה', a.cell.r === b.cell.r && a.cell.c === b.cell.c);
}

section('פיצוץ');

{
  // שתי בועות אדומות בשורה 0 מעל המרכז; יורים אדומה שלישית ביניהן
  const g = blank([[1, 1, 1, 1, 0, 0, 1, 1, 1, 1]]);
  g.current = 0;
  const res = g.shoot(UP);
  check('שלוש באותו צבע מתפוצצות', res.popped.length === 3);
  check('הניקוד 10 לבועה', res.gained === 30 && g.score === 30);
  check('ההחטאות מתאפסות', g.misses === 0);
}

{
  const g = blank([[1, 1, 1, 1, 0, 2, 1, 1, 1, 1]]);
  g.current = 0;
  const res = g.shoot(UP);
  check('שתיים בלבד לא מתפוצצות', res.popped.length === 0);
  check('הבועה נשארת על הלוח', g.grid[res.cell.r][res.cell.c] === 0);
  check('ונספרת החטאה', g.misses === 1);
}

section('נפילה');

{
  // עמוד צהוב תלוי על אדומה אחת בשורה 0. פיצוץ האדומה מפיל את הצהובים
  const g = blank([
    [1, 1, 1, 0, 0, 1, 1, 1, 1, 1],
    [1, 1, 1, 2, 1, 1, 1, 1, 1],
    [1, 1, 1, 1, 2, 1, 1, 1, 1, 1],
  ]);
  // נוריד את כל מה שלא קשור, כדי שהמבנה יהיה ברור: רק (0,3),(0,4),(1,3),(2,4)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 10; c++) g.grid[r][c] = E;
  g.grid[0][3] = 0; g.grid[0][4] = 0;
  g.grid[1][3] = 2; g.grid[2][4] = 2;
  check('המבנה מחובר לפני הירייה', g.floating().length === 0);

  // מוסיפים אדומה שלישית ליד (0,3),(0,4) ומפעילים את הלוגיקה ישירות
  g.grid[0][5] = 0;
  const grp = g.group(0, 5);
  check('group מוצא את שלוש האדומות', grp.length === 3);
  grp.forEach(([r, c]) => { g.grid[r][c] = E; });
  const fl = g.floating();
  check('הצהובות מתנתקות ונופלות', fl.length === 2);
}

{
  const g = blank([
    [0, 0, E, E, E, E, E, E, E, E],
    [E, 3],
    [E, 3],
    [E, E, 3],
  ]);
  // (1,1) שכן של (0,1)? שורה 1 מוסטת: שכנים למעלה הם c ו-c+1 => (0,1),(0,2)
  g.current = 0;
  // מחפשים זווית שמנחיתה אדומה ב-(0,2)
  let found = null;
  for (let a = 0.3; a < Math.PI - 0.3; a += 0.001) {
    const t = g.trace(a);
    if (t.cell && t.cell.r === 0 && t.cell.c === 2) { found = a; break; }
  }
  check('יש זווית שפוגעת בתא המבוקש', found != null);
  if (found != null) {
    const res = g.shoot(found);
    check('שלוש אדומות מתפוצצות', res.popped.length === 3);
    check('שלוש הירוקות שנשארו תלויות נופלות', res.dropped.length === 3);
    check('נפילה שווה 20 לבועה, ועוד בונוס ניקוי', res.gained === 30 + 60 + Bubbles.CLEAR_BONUS);
    check('לוח ריק — מתמלא מחדש מלמעלה', res.cleared && res.refilled === 1 && g.depth() === 1);
    check('אין יותר שלבים', g.level === undefined);
  }
}

section('התחדשות');

{
  // לוח רדוד משורה אחת, עם refillRows ברירת מחדל (5)
  const g = blank([[0, 0, 1, 1, 2, 2, 3, 3, 4, 4]], { refillRows: 5 });
  g.current = 5;
  const res = g.shoot(UP);
  check('לוח רדוד מתמלא עד 5 שורות', res.refilled >= 3 && g.depth() >= 5);
  check('השורות החדשות מלאות', g.grid[0].slice(0, g.rowLen(0)).every((v) => v !== E));
  check('אין בועות צפות אחרי מילוי', g.floating().length === 0);
}

{
  const g = blank([], { refillRows: 5 });
  g.popped = 0;
  const a = g.missLimit();
  g.popped = 400;
  const b = g.missLimit();
  g.popped = 5000;
  const c = g.missLimit();
  check('הסבלנות מתקצרת בהדרגה: ' + a + ' → ' + b + ' → ' + c, a === 5 && b === 4 && c === 3);
}

section('שורה חדשה');

{
  const g = blank([[0, 1, 2, 3, 4, 0, 1, 2, 3, 4]]);
  const before = g.center(0, 2);
  const shift0 = g.shift;
  g.pushRow();
  check('shift מתהפך', g.shift !== shift0);
  check('השורה הישנה ירדה לשורה 1', g.grid[1][2] === 2);
  const after = g.center(1, 2);
  check('בועה שומרת על מיקום אופקי', Math.abs(after.x - before.x) < 1e-9);
  check('ויורדת בגובה שורה', Math.abs(after.y - before.y - Bubbles.ROW_H) < 1e-9);
  check('שורה 0 מלאה מחדש', g.grid[0].slice(0, g.rowLen(0)).every((v) => v !== E));
  check('תא עודף בשורה מוסטת נשאר ריק', g.rowLen(0) === 10 || g.grid[0][9] === E);
}

{
  const g = blank([[1, 1, 1, 1, 1, 1, 1, 1, 1, 1]]);
  g.current = 0;
  g.next = 0;
  const limit = g.missLimit();
  let pushed = false;
  for (let i = 0; i < limit; i++) {
    // כל ירייה בצד אחר כדי שלא ייווצר פיצוץ
    const res = g.shoot(i % 2 ? Math.PI * 0.3 : Math.PI * 0.7);
    g.current = 2 + (i % 3); g.next = 2 + ((i + 1) % 3);
    if (res.pushed) pushed = true;
  }
  check('אחרי ' + limit + ' החטאות נדחפת שורה', pushed);
  check('מונה ההחטאות מתאפס', g.misses === 0);
}

section('סיום');

{
  const rows = [];
  for (let r = 0; r < 12; r++) rows.push(new Array(10).fill(r % 2 ? 1 : 2));
  const g = blank(rows);
  check('לוח עד השורה שלפני הקו — עוד לא נגמר', !g.over);
  g.pushRow();
  check('דחיפה נוספת חוצה את הקו', g._crossed());
}

{
  const rows = [];
  for (let r = 0; r < 12; r++) rows.push(new Array(10).fill(r % 2 ? 1 : 2));
  const g = blank(rows);
  g.current = 3;
  const res = g.shoot(UP);
  check('בועה שנוחתת על הקו בלי לפוצץ — סוף משחק', res.over && g.over);
  check('אחרי הסיום אי אפשר לירות', g.shoot(UP) === null);
  check('ואי אפשר להחליף', g.swap() === false);
}

section('צבעים');

{
  const g = blank([[3, 3, 4, 4]]);
  let ok = true;
  for (let i = 0; i < 200; i++) {
    const c = g._pickColor();
    if (c !== 3 && c !== 4) ok = false;
  }
  check('בועה חדשה רק בצבע שקיים על הלוח', ok);
}

{
  const g = new Bubbles({ rng: seeded(7) });
  check('ברירת המחדל — 17 עמודות ו-9 שורות בפתיחה', g.cols === 17 && g.grid[8][0] !== E && g.grid[9][0] === E);
  check('שישה צבעים', g.colorCount() === 6 && g.colorsOnBoard().every((c) => c < 6));
  check('התותח מתחת לתחתית הלוח', g.world().shooter.y > g.world().lineY + 1);
  const a = g.current, b = g.next;
  g.swap();
  check('החלפה מחליפה בין הנוכחית לבאה', g.current === b && g.next === a);
}

section('שמירה');

{
  const g = new Bubbles({ rng: seeded(3) });
  g.shoot(1.2);
  g.shoot(2.0);
  const copy = Bubbles.deserialize(JSON.parse(JSON.stringify(g.serialize())));
  check('שחזור שומר את הלוח', JSON.stringify(copy.grid) === JSON.stringify(g.grid));
  check('ואת הניקוד, ה-shift והבועות', copy.score === g.score && copy.shift === g.shift &&
    copy.current === g.current && copy.next === g.next && copy.misses === g.misses);
  const t1 = g.trace(1.1), t2 = copy.trace(1.1);
  check('ואותו מסלול בדיוק', JSON.stringify(t1) === JSON.stringify(t2));
}

section('שלמות לאורך משחקים אקראיים');

{
  let ok = true, games = 0, totalShots = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seeded(seed);
    const g = new Bubbles({ rng });
    for (let i = 0; i < 400 && !g.over; i++) {
      const res = g.shoot(0.2 + rng() * (Math.PI - 0.4));
      totalShots++;
      if (!res) { ok = false; break; }
      // אין בועה צפה אחרי ירייה
      if (g.floating().length) { ok = false; break; }
      // הבועות הבאות תמיד בצבע שקיים
      const present = g.colorsOnBoard();
      if (!g.over && present.length && (present.indexOf(g.current) < 0 || present.indexOf(g.next) < 0)) { ok = false; break; }
      // אין בועות בתאים שלא קיימים בשורה מוסטת
      for (let r = 0; r < g.rows; r++) {
        if (g.rowLen(r) < g.cols && g.grid[r][g.cols - 1] !== E) ok = false;
      }
      if (!ok) break;
    }
    // הלוח לא מתרוקן — אחרי כל ירייה יש לפחות refillRows שורות
    if (!g.over && g.depth() < g.refillRows) ok = false;
    games++;
  }
  check('40 משחקים אקראיים בלי שבירת אינווריאנטים (' + totalShots + ' יריות)', ok && games === 40);
}

/* --------------------------------------------------------------------- */

console.log('\n' + passed + ' עברו, ' + failed + ' נכשלו');
if (failed) process.exit(1);
