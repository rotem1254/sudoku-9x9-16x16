/* =============================================================================
 * test/test-snake.js — בדיקות למנוע סנייק
 * -----------------------------------------------------------------------------
 *     node test/test-snake.js
 * =========================================================================== */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'js', 'snake', 'engine.js'));

const Snake = globalThis.Snake;

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

const at = (x, y) => ({ x, y });

/* --------------------------------------------------------------------- */

section('התחלה');

{
  const g = new Snake();
  check('נחש באורך 4', g.length() === 4);
  check('פונה ימינה', g.dir === 'right');
  check('התפוח הראשון מולו, באותה שורה', g.apple.y === g.head().y && g.apple.x > g.head().x);
  check('לוח 15×17', g.cols === 15 && g.rows === 17);
}

section('תנועה');

{
  const g = new Snake({ body: [at(5, 5), at(4, 5), at(3, 5)], dir: 'right', apple: at(0, 0) });
  const r = g.step();
  check('זז צעד ימינה', g.head().x === 6 && g.head().y === 5);
  check('האורך נשמר', g.length() === 3);
  check('הזנב שעזב מדווח', r.lastTail && r.lastTail.x === 3);
}

section('תור פניות');

{
  const g = new Snake({ body: [at(5, 5), at(4, 5), at(3, 5)], dir: 'right', apple: at(0, 0) });
  check('פנייה הפוכה נדחית', !g.turn('left'));
  check('פנייה לאותו כיוון נדחית', !g.turn('right'));
  check('למעלה נכנס', g.turn('up'));
  check('ואחריו שמאלה — הפוך ל"ימינה" המקורי, אבל לא לאחרון בתור', g.turn('left'));
  g.step();
  check('צעד ראשון — למעלה', g.head().x === 5 && g.head().y === 4);
  g.step();
  check('צעד שני — שמאלה (שתי הלחיצות בוצעו)', g.head().x === 4 && g.head().y === 4);
}

{
  const g = new Snake({ body: [at(5, 5), at(4, 5)], dir: 'right', apple: at(0, 0) });
  g.turn('up'); g.turn('left'); g.turn('down');
  check('התור מוגבל לשלוש', !g.turn('right'));
}

section('אכילה');

{
  const g = new Snake({ body: [at(5, 5), at(4, 5), at(3, 5)], dir: 'right', apple: at(6, 5), rng: seeded(1) });
  const r = g.step();
  check('אוכל את התפוח', r.ate && g.score === 1);
  check('גדל באחד', g.length() === 4);
  check('אין זנב שעוזב', r.lastTail === null);
  check('תפוח חדש בתא ריק', g.apple && !g.occupied(g.apple.x, g.apple.y));
}

section('מוות');

{
  const g = new Snake({ body: [at(14, 5), at(13, 5)], dir: 'right', apple: at(0, 0) });
  const r = g.step();
  check('קיר — מוות', r.died && g.over);
  check('אחרי מוות לא זזים', g.step().died === false && g.head().x === 14);
  check('ואי אפשר לפנות', !g.turn('up'));
}

{
  // לולאה: הראש פונה לתוך הגוף
  const g = new Snake({ body: [at(5, 5), at(5, 6), at(6, 6), at(6, 5), at(6, 4)], dir: 'up', apple: at(0, 0) });
  g.turn('right');
  const r = g.step();
  check('התנגשות בגוף — מוות', r.died);
}

{
  // הראש נכנס בדיוק לתא שהזנב עוזב — מותר
  const g = new Snake({ body: [at(5, 5), at(5, 6), at(6, 6), at(6, 5)], dir: 'up', apple: at(0, 0) });
  g.turn('right');
  const r = g.step();
  check('מותר להיכנס לתא שהזנב עוזב', !r.died && g.head().x === 6 && g.head().y === 5);
}

{
  // אותו מצב, אבל התפוח בתא הזנב — הזנב לא זז, ולכן זו התנגשות
  const g = new Snake({ body: [at(5, 5), at(5, 6), at(6, 6), at(6, 5)], dir: 'up', apple: at(6, 5) });
  g.turn('right');
  const r = g.step();
  check('כשאוכלים הזנב נשאר — ואז זו התנגשות', r.died);
}

section('מעבר דרך קירות');

{
  const g = new Snake({ body: [at(14, 5), at(13, 5)], dir: 'right', apple: at(7, 7), wrap: true });
  const r = g.step();
  check('יוצא מימין ונכנס משמאל', !r.died && g.head().x === 0 && g.head().y === 5);
  g.turn('up');
  for (let i = 0; i < 6; i++) g.step();
  check('וגם למעלה → למטה', !g.over && g.head().y === 16);
}

section('ניצחון');

{
  // לוח 3×1: נחש של 2 ותפוח בתא האחרון
  const g = new Snake({ cols: 3, rows: 1, body: [at(1, 0), at(0, 0)], dir: 'right', apple: at(2, 0) });
  const r = g.step();
  check('מילוי הלוח — ניצחון', r.won && g.won && g.over);
}

section('שמירה');

{
  const g = new Snake({ rng: seeded(4) });
  g.step(); g.turn('up'); g.step();
  const c = Snake.deserialize(JSON.parse(JSON.stringify(g.serialize())));
  check('שחזור שומר גוף, כיוון, תפוח וניקוד',
    JSON.stringify(c.body) === JSON.stringify(g.body) && c.dir === g.dir &&
    JSON.stringify(c.apple) === JSON.stringify(g.apple) && c.score === g.score);
}

section('שלמות לאורך משחקים אקראיים');

{
  let ok = true;
  const dirs = ['up', 'down', 'left', 'right'];
  for (let seed = 1; seed <= 50 && ok; seed++) {
    const rng = seeded(seed);
    const g = new Snake({ rng, wrap: seed % 2 === 0 });
    for (let i = 0; i < 2000 && !g.over; i++) {
      if (rng() < 0.3) g.turn(dirs[Math.floor(rng() * 4)]);
      const before = g.length();
      const r = g.step();
      if (r.died) break;
      const keys = new Set(g.body.map((p) => p.x + ',' + p.y));
      if (keys.size !== g.body.length) ok = false;
      if (g.body.some((p) => p.x < 0 || p.y < 0 || p.x >= g.cols || p.y >= g.rows)) ok = false;
      if (g.length() !== before + (r.ate ? 1 : 0)) ok = false;
      if (g.apple && g.occupied(g.apple.x, g.apple.y)) ok = false;
      if (!ok) break;
    }
  }
  check('50 משחקים אקראיים: אין חפיפה, אין יציאה מהלוח, האורך נכון, התפוח פנוי', ok);
}

/* --------------------------------------------------------------------- */

console.log('\n' + passed + ' עברו, ' + failed + ' נכשלו');
if (failed) process.exit(1);
