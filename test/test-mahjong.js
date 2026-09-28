/* =============================================================================
 * test/test-mahjong.js — בדיקות למנוע מהג'ונג
 * -----------------------------------------------------------------------------
 *     node test/test-mahjong.js
 * =========================================================================== */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'js', 'mahjong', 'engine.js'));

const Mahjong = globalThis.Mahjong;

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

/** משחק על פריסה ידנית קטנה */
const custom = (tiles) => new Mahjong({ tiles: tiles.map((t) => Object.assign({ alive: true }, t)) });

/* --------------------------------------------------------------------- */

section('אבנים ופריסה');

{
  const faces = Mahjong.allFaces();
  check('144 אבנים', faces.length === 144);
  const counts = {};
  faces.forEach((f) => { const k = Mahjong.matchKey(f); counts[k] = (counts[k] || 0) + 1; });
  check('36 מפתחות התאמה (34 רגילים, פרחים, עונות)', Object.keys(counts).length === 36);
  check('כל מפתח מופיע 4 פעמים', Object.values(counts).every((n) => n === 4));
  check('פרח מתאים לכל פרח', Mahjong.matchKey('f1') === Mahjong.matchKey('f4'));
  check('פרח לא מתאים לעונה', Mahjong.matchKey('f1') !== Mahjong.matchKey('s1'));

  const pos = Mahjong.LAYOUTS.turtle();
  check('פריסת הצב — 144 מקומות', pos.length === 144);
  const perLayer = [0, 0, 0, 0, 0];
  pos.forEach((p) => perLayer[p.z]++);
  check('שכבות 87/36/16/4/1', perLayer.join() === '87,36,16,4,1');

  let overlap = false;
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) {
      const a = pos[i], b = pos[j];
      if (a.z === b.z && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2) overlap = true;
    }
  }
  check('אין שתי אבנים חופפות באותה שכבה', !overlap);

  // כל אבן בשכבה עליונה נתמכת במלואה ע"י השכבה שמתחתיה
  let floating = false;
  pos.filter((p) => p.z > 0).forEach((p) => {
    const under = pos.filter((q) => q.z === p.z - 1 && Math.abs(q.x - p.x) < 2 && Math.abs(q.y - p.y) < 2);
    if (!under.length) floating = true;
  });
  check('אין אבן שמרחפת באוויר', !floating);
}

section('חופש');

{
  // שורה של שלוש: הקצוות חופשיים, האמצעית לא
  const g = custom([
    { x: 0, y: 0, z: 0, face: 'd1' },
    { x: 2, y: 0, z: 0, face: 'd1' },
    { x: 4, y: 0, z: 0, face: 'd2' },
  ]);
  check('אבן קצה שמאלית חופשית', g.isFree(0));
  check('אבן קצה ימנית חופשית', g.isFree(2));
  check('אבן חסומה משני הצדדים — לא חופשית', !g.isFree(1));
}

{
  const g = custom([
    { x: 0, y: 0, z: 0, face: 'd1' },
    { x: 1, y: 1, z: 1, face: 'd1' },
  ]);
  check('אבן שמשהו מונח עליה (אפילו חלקית) — לא חופשית', !g.isFree(0));
  check('האבן העליונה חופשית', g.isFree(1));
}

{
  // אבן בחצי שורה חוסמת את שתי השכנות שלה
  const g = custom([
    { x: 0, y: 1, z: 0, face: 'b1' },
    { x: 2, y: 0, z: 0, face: 'b2' },
    { x: 2, y: 2, z: 0, face: 'b3' },
    { x: 4, y: 0, z: 0, face: 'b4' },
    { x: 4, y: 2, z: 0, face: 'b5' },
  ]);
  check('אבן בחצי שורה חוסמת את השכנה העליונה', !g.isFree(1));
  check('וגם את התחתונה', !g.isFree(2));
}

section('הוצאה וביטול');

{
  const g = custom([
    { x: 0, y: 0, z: 0, face: 'c5' },
    { x: 2, y: 0, z: 0, face: 'c7' },
    { x: 4, y: 0, z: 0, face: 'c5' },
    { x: 0, y: 4, z: 0, face: 'f1' },
    { x: 4, y: 4, z: 0, face: 'f3' },
  ]);
  check('זוג זהה וחופשי יוצא', g.remove(0, 2));
  check('ונרשם בהיסטוריה', g.history.length === 1 && g.remaining() === 3);
  check('אבן לא יכולה להתאים לעצמה', !g.remove(1, 1));
  check('פרח ופרח שונה יוצאים יחד', g.remove(3, 4));
  const u = g.undo();
  check('ביטול מחזיר את הזוג האחרון', u && g.tiles[3].alive && g.tiles[4].alive);
  check('לא מוציאים זוג לא תואם', !g.remove(1, 3));
}

{
  const g = custom([
    { x: 0, y: 0, z: 0, face: 'd1' },
    { x: 2, y: 0, z: 0, face: 'd1' },
    { x: 4, y: 0, z: 0, face: 'd9' },
  ]);
  check('לא מוציאים אבן חסומה גם אם יש לה זוג', !g.remove(0, 1));
  check('תקוע — אין זוגות', g.isStuck());
}

section('חלוקה פתירה');

{
  let ok = true;
  for (let seed = 1; seed <= 60; seed++) {
    const g = new Mahjong({ rng: seeded(seed) });
    // מאמתים שהפתרון שהמחולל בנה אכן חוקי — צעד אחרי צעד
    if (!g.solution || g.solution.length !== 72) { ok = false; break; }
    for (const [a, b] of g.solution) {
      if (!g.remove(a, b)) { ok = false; break; }
    }
    if (!ok || !g.isWon()) { ok = false; break; }
  }
  check('60 חלוקות — כולן נפתרות לפי הפתרון שנבנה', ok);
}

{
  const g = new Mahjong({ rng: seeded(5) });
  const faces = g.tiles.map((t) => t.face).sort();
  check('החלוקה משתמשת בכל 144 האבנים בדיוק', faces.join() === Mahjong.allFaces().sort().join());
}

section('רמז וערבוב');

{
  const g = new Mahjong({ rng: seeded(9) });
  const h = g.hint();
  check('יש רמז בתחילת משחק', !!h);
  check('הרמז הוא מהלך חוקי', h && g.isFree(h[0]) && g.isFree(h[1]) && g.matches(h[0], h[1]));
  check('ונספר', g.hints === 1);
}

{
  let ok = true;
  for (let seed = 1; seed <= 20 && ok; seed++) {
    const rng = seeded(seed * 7);
    const g = new Mahjong({ rng });
    // משחקים כמה מהלכים אקראיים ואז מערבבים
    for (let i = 0; i < 25; i++) {
      const pairs = g.availablePairs();
      if (!pairs.length) break;
      const p = pairs[Math.floor(rng() * pairs.length)];
      g.remove(p[0], p[1]);
    }
    const before = g.tiles.filter((t) => t.alive).map((t) => t.face).sort().join();
    const alivePos = g.tiles.map((t) => t.alive).join();
    g.shuffle();
    const after = g.tiles.filter((t) => t.alive).map((t) => t.face).sort().join();
    if (before !== after) ok = false;
    if (g.tiles.map((t) => t.alive).join() !== alivePos) ok = false;
    // הערבוב פתיר
    for (const [a, b] of g.solution || []) if (!g.remove(a, b)) { ok = false; break; }
    if (!g.isWon()) ok = false;
  }
  check('ערבוב שומר על האבנים ועל המקומות, ומשאיר לוח פתיר', ok);
}

section('שמירה');

{
  const g = new Mahjong({ rng: seeded(11) });
  const [a, b] = g.hint();
  g.remove(a, b);
  g.elapsed = 42;
  const copy = Mahjong.deserialize(JSON.parse(JSON.stringify(g.serialize())));
  check('שחזור שומר אבנים ומצב', JSON.stringify(copy.tiles) === JSON.stringify(g.tiles));
  check('ואת ההיסטוריה, הזמן והרמזים', copy.history.length === 1 && copy.elapsed === 42 && copy.hints === 1);
  check('ביטול עובד אחרי שחזור', copy.undo() && copy.remaining() === 144);
}

/* --------------------------------------------------------------------- */

console.log('\n' + passed + ' עברו, ' + failed + ' נכשלו');
if (failed) process.exit(1);
