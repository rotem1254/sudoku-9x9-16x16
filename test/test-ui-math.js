/* =============================================================================
 * test/test-ui-math.js — בדיקות לחישובי שכבת הממשק
 * -----------------------------------------------------------------------------
 *     node test/test-ui-math.js
 *
 * כל בדיקה כאן מכוונת לבאג שקרה באמת. שכבת הממשק היא החלק הגדול ביותר
 * בקוד ולא הייתה מכוסה בכלל, וכל התקלות של הסבבים האחרונים ישבו בה.
 * =========================================================================== */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'js', 'ui-math.js'));

const M = globalThis.UIMath;

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
};
const section = (t) => console.log('\n' + t);

/* --------------------------------------------------------------------- */

section('גרירה על רשת — ההרמה מעל האצבע');

/* לוח טיפוסי בטלפון: תא 40, מרווח 3, ריפוד 3 */
const board = { boardLeft: 12, boardTop: 200, pad: 3, gap: 3, step: 43, size: 8 };
const place = (o) => M.dragPlacement(Object.assign({}, board, o));

/*
 * הבאג שהיה: ההרמה הייתה בגובה קבוע, ולכן חלק גבוה נשאר מתחת לאצבע.
 * נמדד בדפדפן — תחתית חלק בן ארבעה תאים יצאה 40 פיקסלים *מתחת* לנקודת
 * המגע. הבדיקה עוברת על כל הגבהים ומוודאת שהמרווח נשמר
 */
{
  let allClear = true;
  const gaps = [];
  for (let rows = 1; rows <= 5; rows++) {
    const r = place({ pointerX: 200, pointerY: 500, rows, cols: 1, clearance: 24 });
    const clearsBy = 500 - r.bottom;
    gaps.push(+clearsBy.toFixed(1));
    if (clearsBy < 23.9) allClear = false;
  }
  console.log('    (מרווח מהאצבע לפי גובה החלק: ' + gaps.join(', ') + ')');
  check('כל גובה חלק מתרחק מהאצבע', allClear);
  check('המרווח זהה בכל הגבהים — הוא קבוע ולא נגזר מהגובה',
    new Set(gaps).size === 1);
}

/* המיקום נקבע לפי הפינה השמאלית-עליונה, ולכן אפשר לחשב אותו הפוך */
function pointerFor(row, col, rows, cols, clearance) {
  const w = cols * board.step - board.gap;
  const h = rows * board.step - board.gap;
  return {
    pointerX: board.boardLeft + board.pad + col * board.step + w / 2,
    pointerY: board.boardTop + board.pad + row * board.step + h / 2 + clearance + h / 2,
  };
}

{
  let ok = true;
  const tried = [];
  for (const [rows, cols] of [[1,1],[2,2],[1,5],[5,1],[3,2],[2,3]]) {
    for (const [r, c] of [[0,0],[3,4],[7-rows+1-1,8-cols]]) {
      if (r < 0 || c < 0 || r + rows > 8 || c + cols > 8) continue;
      const p = pointerFor(r, c, rows, cols, 24);
      const got = place({ pointerX: p.pointerX, pointerY: p.pointerY, rows, cols, clearance: 24 });
      tried.push(1);
      if (got.row !== r || got.col !== c || !got.inRange) ok = false;
    }
  }
  check(`היעד מדויק ב-${tried.length} צירופי צורה ומיקום`, ok && tried.length >= 12);
}

/* גבולות הלוח */
{
  const off = place({ pointerX: -400, pointerY: 500, rows: 2, cols: 2, clearance: 24 });
  check('גרירה מחוץ ללוח משמאל מסומנת כלא בטווח', !off.inRange);

  const p = pointerFor(0, 6, 1, 3, 24); // קו של 3 בעמודה 6 — גולש מהקצה
  const over = place({ pointerX: p.pointerX, pointerY: p.pointerY, rows: 1, cols: 3, clearance: 24 });
  check('חלק שחורג מהקצה הימני אינו בטווח', over.col === 6 && !over.inRange);

  const p2 = pointerFor(0, 5, 1, 3, 24);
  const fit = place({ pointerX: p2.pointerX, pointerY: p2.pointerY, rows: 1, cols: 3, clearance: 24 });
  check('אותו חלק בעמודה 5 כן בטווח', fit.col === 5 && fit.inRange);
}

/* המידות עצמן */
{
  const r = place({ pointerX: 100, pointerY: 400, rows: 3, cols: 2, clearance: 20 });
  check('רוחב וגובה כוללים את המרווחים אבל לא אחרי האחרון',
    r.width === 2 * 43 - 3 && r.height === 3 * 43 - 3);
}

/* --------------------------------------------------------------------- */

section('FLIP — מה נחשב תנועה');

/*
 * הבאג שהיה: המדידה הייתה מול המסך, ולכן כשגובה המגש השתנה כל אבני
 * השולחן "זזו" יחד ונופשו בלי שזזו באמת. נמדד: 15 אבנים, כולן באותו
 * הפרש בדיוק
 */
{
  // אזור שלם זז 6 פיקסלים למעלה, אבל שום דבר בתוכו לא זז ביחס אליו
  const prev = { zone: 'table', x: 40, y: 20, sx: 140, sy: 320 };
  const now  = { zone: 'table', x: 40, y: 20, sx: 140, sy: 314 };
  const d = M.flipDelta(prev, now);
  check('אזור שזז כולו אינו נחשב תנועה של הפריטים שבו', !d.moved);
  check('ההפרש אפס', d.dx === 0 && d.dy === 0);
}

{
  // אותו אזור, והפריט באמת זז בתוכו
  const prev = { zone: 'rack', x: 300, y: 6, sx: 400, sy: 700 };
  const now  = { zone: 'rack', x: 112, y: 6, sx: 212, sy: 700 };
  const d = M.flipDelta(prev, now);
  check('תנועה אמיתית בתוך האזור נתפסת', d.moved && d.dx === 188);
  check('לא סומן כמעבר בין אזורים', !d.crossedZones);
}

{
  // מעבר בין אזורים — כאן דווקא ההפרש על המסך הוא הנכון
  const prev = { zone: 'rack', x: 50, y: 4, sx: 250, sy: 700 };
  const now  = { zone: 'table', x: 10, y: 8, sx: 120, sy: 300 };
  const d = M.flipDelta(prev, now);
  check('מעבר בין אזורים מחושב לפי המסך',
    d.crossedZones && d.dx === 130 && d.dy === 400);
}

check('תזוזה זניחה אינה נחשבת', !M.flipDelta(
  { zone: 'a', x: 0, y: 0, sx: 0, sy: 0 },
  { zone: 'a', x: 0.4, y: 0.4, sx: 0, sy: 0 }).moved);

/* --------------------------------------------------------------------- */

section('נקודת הכנסה');

/* פריסה RTL: הפריט הראשון הוא הימני ביותר */
const row = [
  { left: 300, width: 40 }, // אינדקס 0 — הימני
  { left: 250, width: 40 },
  { left: 200, width: 40 },
];

check('הפלה מימין לכולם — נכנס ראשון', M.insertIndex(row, 400) === 0);
check('הפלה משמאל לכולם — נכנס אחרון', M.insertIndex(row, 100) === 3);
check('הפלה בין הראשון לשני', M.insertIndex(row, 290) === 1);
check('הפלה בין השני לשלישי', M.insertIndex(row, 240) === 2);
check('רשימה ריקה מחזירה אפס', M.insertIndex([], 123) === 0);

/* אותה רשימה בפריסת LTR — הכיוון הפוך */
const ltr = [
  { left: 200, width: 40 },
  { left: 250, width: 40 },
  { left: 300, width: 40 },
];
check('ב-LTR הפלה משמאל לכולם נכנסת ראשונה', M.insertIndex(ltr, 100, false) === 0);
check('ב-LTR הפלה מימין לכולם נכנסת אחרונה', M.insertIndex(ltr, 400, false) === 3);

/* --------------------------------------------------------------------- */

section('היסט אדפטיבי בערימה');

const fan = (piles, availableCqw) => M.fanOffset({
  availableCqw, cardH: 140, offsetDown: 11, piles, min: 22, max: 46,
});

check('ערימה קצרה מקבלת את ההיסט המרבי',
  fan([{ up: 2, down: 0 }], 600) === 46);
check('ערימה ארוכה מצטמצמת',
  fan([{ up: 13, down: 6 }], 400) < 46);
check('אף פעם לא מתחת למינימום',
  fan([{ up: 19, down: 0 }], 200) === 22);
check('אף פעם לא מעל המקסימום',
  fan([{ up: 1, down: 0 }], 5000) === 46);
check('הערימה הצפופה ביותר היא שקובעת', (() => {
  const both = fan([{ up: 2, down: 0 }, { up: 13, down: 6 }], 400);
  const only = fan([{ up: 13, down: 6 }], 400);
  return both === only;
})());
check('ערימות ריקות אינן משפיעות',
  fan([{ up: 0, down: 0 }, { up: 3, down: 1 }], 500) ===
  fan([{ up: 3, down: 1 }], 500));
check('בלי ערימות אין אילוץ, ולכן ההיסט הנוח ביותר', fan([], 500) === 46);

/* --------------------------------------------------------------------- */

section('שעון');

check('אפס', M.formatClock(0) === '00:00');
check('שניות בלבד', M.formatClock(7) === '00:07');
check('דקה', M.formatClock(60) === '01:00');
check('דקות ושניות', M.formatClock(125) === '02:05');
check('בדיוק שעה עוברת לפורמט ארוך', M.formatClock(3600) === '1:00:00');
check('מעל שעה', M.formatClock(3725) === '1:02:05');
check('59:59 עדיין קצר', M.formatClock(3599) === '59:59');
check('שבר שנייה נחתך כלפי מטה', M.formatClock(9.9) === '00:09');
check('ערך שלילי אינו שובר', M.formatClock(-5) === '00:00');
check('undefined אינו שובר', M.formatClock(undefined) === '00:00');

/* --------------------------------------------------------------------- */

console.log(`\n${passed} עברו, ${failed} נכשלו`);
process.exit(failed ? 1 : 0);
