/* =============================================================================
 * test/test-backgammon.js — בדיקות לשש-בש: חוקים, מהלכים חלקיים ויריב
 * -----------------------------------------------------------------------------
 *     node test/test-backgammon.js
 * =========================================================================== */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'js', 'backgammon', 'engine.js'));
require(path.join(__dirname, '..', 'js', 'backgammon', 'weights.js'));
require(path.join(__dirname, '..', 'js', 'backgammon', 'ai.js'));

const BG = globalThis.Backgammon;
const AI = globalThis.BackgammonAI;

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

/** עמדה מתיאור: { 0: {6: 5, 8: 3, bar: 1}, 1: {...} } — מספרי נקודות 1..24 */
function make(spec) {
  const p = new Int8Array(50);
  [0, 1].forEach((s) => {
    Object.entries(spec[s] || {}).forEach(([k, n]) => {
      p[s * 25 + (k === 'bar' ? 24 : +k - 1)] = n;
    });
  });
  return p;
}
const notes = (ts) => ts.map((t) => BG.notation(t.moves)).sort();

/* --------------------------------------------------------------------- */

section('עמדת פתיחה');
{
  const p = BG.initial();
  check('15 אבנים לכל צד', BG.onBoard(p, 0) === 15 && BG.onBoard(p, 1) === 15);
  check('167 פיפס לכל צד', BG.pips(p, 0) === 167 && BG.pips(p, 1) === 167);
  check('יש מגע', BG.isContact(p));
  check('הנקודה 24 שלי היא הנקודה 1 של היריב', p[23] === 2 && p[25 + 0] === 0 && p[25 + 23] === 2);
  check('3-1 בפתיחה: 16 תורות שונים', BG.turns(p, 0, 3, 1).length === 16);
  check('3-1 כולל 8/5 6/5', notes(BG.turns(p, 0, 3, 1)).includes('8/5 6/5'));
  check('6-5 כולל 24/13 (דרך 18)', notes(BG.turns(p, 0, 6, 5)).includes('24/18/13'));
  const ts = BG.turns(p, 0, 4, 4);
  check('דאבל: ארבעה מהלכים בכל תור', ts.every((t) => t.moves.length === 4));
}

section('בר, חסימה והכאה');
{
  // אבן על הבר: חייבת להיכנס לפני כל דבר אחר
  const p = make({ 0: { bar: 1, 13: 14 }, 1: { 6: 2, 1: 13 } });
  const ts = BG.turns(p, 0, 6, 3);
  // 6 נוחת על הנקודה 19 שלי = הנקודה 6 של היריב, חסומה. 3 → 22, פנויה
  check('כניסה רק במספר הפתוח', ts.every((t) => t.moves[0][0] === BG.BAR && t.moves[0][1] === 21));
  check('אחרי הכניסה ממשיכים עם השנייה', ts.every((t) => t.moves.length === 2));

  const q = make({ 0: { bar: 2, 13: 13 }, 1: { 6: 2, 5: 2, 4: 2, 3: 2, 2: 2, 1: 5 } });
  check('בית סגור: אין מהלך', BG.turns(q, 0, 6, 5)[0].moves.length === 0);

  // אבן בודדת של היריב על ה-7 שלו = ה-18 שלי; 24/18 מכה אותה
  const hits = BG.turns(make({ 0: { 24: 1, 13: 14 }, 1: { 7: 1, 1: 14 } }), 0, 6, 1);
  check('הכאה מסומנת בכוכבית', notes(hits).some((n) => n.includes('*')));
  const after = hits.find((t) => t.moves.some((m) => m[2]));
  check('האבן שנאכלה עולה לבר', after && after.pos[25 + 24] === 1);
  check('גם בלי הכאה — הכאה אינה חובה', hits.some((t) => !t.moves.some((m) => m[2])));
}

section('חובה לשחק כמה שיותר');
{
  // אבן אחת על 24, היריב חוסם את 18 שלי: 6 לבד חסום, אבל 5 ואז 6 (24/19/13) אפשרי
  const p = make({ 0: { 24: 1, 6: 14 }, 1: { 7: 2, 1: 13 } });
  const ts = BG.turns(p, 0, 6, 5);
  check('חייבים את שתי הקוביות כשזה אפשרי', ts.every((t) => t.moves.length === 2));

  // אבן אחת ב-8, נקודות 2 ו-3 שלי (= 23 ו-22 של היריב) חסומות
  const t = make({ 0: { 8: 1, 1: 14 }, 1: { 22: 2, 23: 2, 24: 11 } });
  const t1 = BG.turns(t, 0, 6, 5);
  check('אין מהלך כשכל היעדים חסומים', t1.length === 1 && t1[0].moves.length === 0);
  const t2 = BG.turns(t, 0, 6, 4);
  check('6-4: 8/4 ואז הוצאה ב-6', t2.length === 1 && BG.notation(t2[0].moves) === '8/4/off');

  // 8 ו-2 שלי חסומות: מ-13 רק 6 אפשרי (13/7), ואחריו 5 נוחת על 2 — חסום
  const u = make({ 0: { 13: 1, 1: 14 }, 1: { 17: 2, 23: 2, 24: 11 } });
  const u1 = BG.turns(u, 0, 6, 5);
  check('רק אחת אפשרית — משחקים אותה', u1.length === 1 && BG.notation(u1[0].moves) === '13/7');

  // 2 ו-3 שלי חסומות: 13/7 לבד או 13/8 לבד, אבל לא שתיהן — חייבים את הגבוהה
  const w = make({ 0: { 13: 1, 1: 14 }, 1: { 23: 2, 22: 2, 24: 11 } });
  const w1 = BG.turns(w, 0, 6, 5);
  check('כל אחת לבד אפשרית — רק הגבוהה (6)', w1.length === 1 && BG.notation(w1[0].moves) === '13/7');
}

section('הוצאה');
{
  const p = make({ 0: { 6: 1, 2: 1, 1: 13 }, 1: { 24: 15 } });
  check('קובייה גבוהה מהרחוקה — מוציאה אותה', notes(BG.turns(make({ 0: { 3: 2, 1: 13 }, 1: { 24: 15 } }), 0, 6, 5)).includes('3/off(2)'));
  check('הוצאה עם 6 מ-6', notes(BG.turns(p, 0, 6, 1)).some((n) => n.includes('6/off')));
  check('קובייה גבוהה לא מוציאה כשיש אבן רחוקה יותר', BG.target(p, 0, 1, 5) === null);
  const q = make({ 0: { 7: 1, 6: 14 }, 1: { 24: 15 } });
  check('אין הוצאה לפני שכולן בבית', BG.target(q, 0, 5, 6) === null);
  check('אבל אחרי שהאחרונה נכנסת — אפשר באותו תור', notes(BG.turns(q, 0, 1, 6)).includes('7/6/off'));
}

section('סוף משחק');
{
  const p = make({ 0: {}, 1: { 1: 15 } });
  check('ניצחון — אין לי אבנים', BG.winner(p) === 0);
  check('ליריב אבן בבית שלי → בקגמון', BG.resultValue(make({ 0: {}, 1: { 20: 1, 6: 14 } }), 0) === 3);
  check('ליריב אבן על הבר → בקגמון', BG.resultValue(make({ 0: {}, 1: { bar: 1, 6: 14 } }), 0) === 3);
  check('היריב לא הוציא אף אבן → גמון', BG.resultValue(make({ 0: {}, 1: { 6: 15 } }), 0) === 2);
  check('היריב הוציא אבן → ניצחון רגיל', BG.resultValue(make({ 0: {}, 1: { 6: 14 } }), 0) === 1);
}

section('רישום');
{
  check('הכאה', BG.notation([[12, 6, true, 6], [7, 6, false, 1]]) === '13/7* 8/7');
  check('כפולים מקובצים', BG.notation([[5, 1, false, 4], [5, 1, false, 4]]) === '6/2(2)');
  check('בר והוצאה', BG.notation([[24, 20, false, 4], [2, -1, false, 3]]) === 'bar/21 3/off');
}

section('מהלכים חלקיים — אף פעם לא נתקעים באמצע תור');
{
  const rng = seeded(7);
  let games = 0, steps = 0, bad = 0, mismatch = 0;
  for (let g = 0; g < 40; g++) {
    let pos = BG.initial();
    let s = g % 2;
    for (let ply = 0; ply < 400; ply++) {
      const dice = BG.roll(rng);
      const legal = BG.turns(pos, s, dice[0], dice[1]);
      // משחקים מהלך-מהלך, בבחירה אקראית מתוך מה ש-partial מתיר
      const played = [];
      for (;;) {
        const part = BG.partial(pos, s, dice, played, legal);
        if (part.done) {
          if (!legal.some((t) => BG.key(t.pos) === BG.key(part.pos))) mismatch++;
          pos = part.pos;
          break;
        }
        if (!part.moves.length) { bad++; pos = legal[0].pos; break; }
        played.push(part.moves[Math.floor(rng() * part.moves.length)]);
        steps++;
      }
      if (BG.winner(pos) !== -1) break;
      s = 1 - s;
    }
    games++;
  }
  check(games + ' משחקים, ' + steps + ' מהלכים — אף פעם בלי המשך', bad === 0);
  check('כל תור שהושלם הוא תור חוקי', mismatch === 0);
}

section('קידוד ורשת');
{
  const idx = new Int32Array(64), val = new Float64Array(64);
  const n = AI.encode(BG.initial(), 0, idx, val);
  check('קידוד דליל: מעט קלטים פעילים', n > 10 && n < 40);
  check('כל האינדקסים בטווח', Array.from(idx.slice(0, n)).every((i) => i >= 0 && i < AI.I));
  check('המשקלים נטענו', !!AI.getNet());
  const p = AI.evaluate(BG.initial(), 0);
  check('עמדת פתיחה: סיכוי סביר (40%–65%) למי שמטיל', p[0] > 0.4 && p[0] < 0.65);
  check('הסתברויות עקביות (גמון ≤ ניצחון)', p[1] <= p[0] && p[2] <= p[1] && p[3] <= 1 - p[0]);
  const won = make({ 0: { 1: 1 }, 1: { 24: 2, 13: 13 } });
  check('כמעט ניצחון מוערך גבוה', AI.evaluate(won, 0)[0] > 0.9);
  check('ומנקודת המבט של היריב — נמוך', AI.evaluate(won, 1)[0] < 0.1);
}

section('בחירת מהלך');
{
  const rng = seeded(3);
  const p = BG.initial();
  [1, 3, 4, 5].forEach((lv) => {
    const t = AI.choose(p, 0, [3, 1], lv, rng);
    check('רמה ' + lv + ' בוחרת תור חוקי', BG.turns(p, 0, 3, 1).some((x) => BG.key(x.pos) === BG.key(t.pos)));
  });
  check('3-1 בפתיחה ברמה הגבוהה: 8/5 6/5', BG.notation(AI.choose(p, 0, [3, 1], 5).moves) === '8/5 6/5');
  // היריב על הבר מול בית עם חור אחד (נקודה 1); 1-1 סוגר אותו ב-2/1(2)
  const close = make({ 0: { 6: 3, 5: 2, 4: 2, 3: 2, 2: 4, 8: 2 }, 1: { bar: 1, 13: 14 } });
  const shut = AI.choose(close, 0, [1, 1], 5);
  check('סוגר את הבית כשהיריב על הבר', shut.pos[0] >= 2);
}

section('קוביית ההכפלה');
{
  check('טבלת משחקון: שוויון = 50%', Math.abs(AI.met(5, 5) - 0.5) < 1e-9);
  check('טבלת משחקון: מוביל עדיף', AI.met(2, 5) > 0.5 && AI.met(5, 2) < 0.5);
  const money = { value: 1, owner: -1, matchTo: 0, score: [0, 0], crawford: false };
  const start = BG.initial();
  check('אין הכפלה בעמדת פתיחה', !AI.shouldDouble(start, 0, money, 5));
  // מרוץ הוצאה, 30 מול 47 פיפס: הכפלה, והיריב מוותר
  const ahead = make({ 0: { 5: 2, 4: 2, 3: 2, 2: 2, 1: 2 }, 1: { 6: 3, 5: 3, 4: 2, 3: 2 } });
  check('מרוץ מוביל בהרבה: מכפיל', AI.shouldDouble(ahead, 0, money, 5));
  check('והיריב מוותר', !AI.shouldTake(ahead, 1, money, 5));
  const even = make({ 0: { 6: 2, 5: 2, 4: 2, 3: 2, 2: 2 }, 1: { 6: 2, 5: 2, 4: 2, 3: 2, 2: 2 } });
  check('מרוץ שווה: אין הכפלה', !AI.shouldDouble(even, 0, money, 5));
  // אבן אחת על 6 מול אבן על 1 — מטיל ראשון מנצח ב-27 מתוך 36 בדיוק
  check('מאגר הוצאה מדויק: 6 מול 1 = 75%', Math.abs(AI.evaluate(make({ 0: { 6: 1 }, 1: { 1: 1 } }), 0)[0] - 0.75) < 1e-9);
  check('ושתי אבנים על 1 מול אחת על 1 — 100% (כל הטלה מוציאה שתיים)', AI.evaluate(make({ 0: { 1: 2 }, 1: { 1: 1 } }), 0)[0] > 0.999);
  const crawford = { value: 1, owner: -1, matchTo: 5, score: [4, 2], crawford: true };
  check('משחק קרופורד: אין הכפלות', !AI.canDouble(crawford, 1));
  const owned = { value: 2, owner: 1, matchTo: 0, score: [0, 0], crawford: false };
  check('רק מי שמחזיק בקובייה מכפיל', !AI.canDouble(owned, 0) && AI.canDouble(owned, 1));
  const dead = { value: 2, owner: -1, matchTo: 5, score: [3, 0], crawford: false };
  check('קובייה מתה: 2 מספיק לי לנצח — אין טעם להכפיל', !AI.canDouble(dead, 0));
  // אחרי קרופורד: המפגר מכפיל כמעט תמיד, כי למוביל אין מה להפסיד
  const post = { value: 1, owner: -1, matchTo: 5, score: [1, 4], crawford: false };
  check('אחרי קרופורד: המפגר מכפיל כבר בפתיחה', AI.shouldDouble(start, 0, post, 5));
}

section('איכות: הרשת מול ההערכה הידנית');
{
  const rng = seeded(99);
  const heur = (pos, s, d) => {
    let best = null, bv = -Infinity;
    BG.turns(pos, s, d[0], d[1]).forEach((t) => {
      const v = BG.winner(t.pos) === s ? 1e9 : AI.heuristic(t.pos, s);
      if (v > bv) { bv = v; best = t; }
    });
    return best;
  };
  let pts = 0, wins = 0;
  const N = 60;
  for (let g = 0; g < N; g++) {
    let pos = BG.initial();
    let s = g % 2;
    for (let ply = 0; ply < 500; ply++) {
      const d = BG.roll(rng);
      const t = s === 0 ? AI.choose(pos, 0, d, 3, rng) : heur(pos, 1, d);
      pos = t.pos;
      const w = BG.winner(pos);
      if (w !== -1) { const v = BG.resultValue(pos, w); if (w === 0) { wins++; pts += v; } else pts -= v; break; }
      s = 1 - s;
    }
  }
  console.log('    ' + N + ' משחקים: ' + wins + ' ניצחונות, ' + (pts / N).toFixed(2) + ' נקודות למשחק');
  check('הרשת (רמה 3) מנצחת את ההערכה הידנית ברוב המשחקים', wins > N / 2);
}

console.log('\n' + passed + ' עברו, ' + failed + ' נכשלו');
process.exit(failed ? 1 : 0);
