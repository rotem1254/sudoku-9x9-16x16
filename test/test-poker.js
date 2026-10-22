/* =============================================================================
 * test/test-poker.js — בדיקות לפוקר: הערכת ידיים, הימורים, קופות ויריבים
 * -----------------------------------------------------------------------------
 *     node test/test-poker.js
 * =========================================================================== */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'js', 'poker', 'engine.js'));
require(path.join(__dirname, '..', 'js', 'poker', 'ai.js'));

const P = globalThis.Poker;
const AI = globalThis.PokerAI;

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

/** "As Kh 10d" → קלפים */
const R = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
function cards(str) {
  return str.trim().split(/\s+/).map((t) => {
    const suit = t.slice(-1);
    const r = t.slice(0, -1);
    return { rank: R[r] || Number(r), suit };
  });
}
const ev = (s) => P.evaluate(cards(s));
const ranksOf = (cs) => cs.map((c) => c.rank).sort((a, b) => b - a).join(',');

/* --------------------------------------------------------------------- */

section('קטגוריות');

[
  ['As Ks Qs Js 10s 2d 3c', 9, 'רויאל פלאש'],
  ['9h 8h 7h 6h 5h Ad Ac', 8, 'סטרייט פלאש'],
  ['7c 7d 7h 7s Kd 2c 3c', 7, 'רביעייה'],
  ['Qc Qd Qh 4s 4d 2c 9h', 6, 'פול האוס'],
  ['Ad 9d 7d 4d 2d Kc Qh', 5, 'פלאש'],
  ['9c 8d 7h 6s 5d Ac Kh', 4, 'סטרייט'],
  ['8c 8d 8h Ks 2d 4c 6h', 3, 'שלישייה'],
  ['Jc Jd 4h 4s Ad 2c 6h', 2, 'שני זוגות'],
  ['10c 10d 4h 7s Ad 2c 6h', 1, 'זוג'],
  ['Ac Qd 9h 7s 4d 3c 2h', 0, 'קלף גבוה'],
].forEach(([s, cat, name]) => {
  const e = ev(s);
  check(name + ' — קטגוריה ' + cat, e.cat === cat && e.name === name && e.cards.length === 5);
});

{
  const scores = [
    'As Ks Qs Js 10s 2d 3c', '9h 8h 7h 6h 5h Ad Ac', '7c 7d 7h 7s Kd 2c 3c',
    'Qc Qd Qh 4s 4d 2c 9h', 'Ad 9d 7d 4d 2d Kc Qh', '9c 8d 7h 6s 5d Ac Kh',
    '8c 8d 8h Ks 2d 4c 6h', 'Jc Jd 4h 4s Ad 2c 6h', '10c 10d 4h 7s Ad 2c 6h',
    'Ac Qd 9h 7s 4d 3c 2h',
  ].map((s) => ev(s).score);
  check('הסדר בין הקטגוריות יורד כמו בטבלה', scores.every((s, i) => i === 0 || s < scores[i - 1]));
}

section('גלגל, קיקרים ושוברי שוויון');

{
  const wheel = ev('Ah 2d 3c 4s 5h Kd 9c');
  check('גלגל A-2-3-4-5 הוא סטרייט', wheel.cat === 4 && wheel.desc === 'סטרייט עד 5');
  check('גלגל — חמשת הקלפים כוללים את האס', ranksOf(wheel.cards) === '14,5,4,3,2');
  check('סטרייט עד 6 מנצח גלגל', ev('6h 2d 3c 4s 5h Kd 9c').score > wheel.score);
  check('סטרייט פלאש גלגל', ev('As 2s 3s 4s 5s Kd 9c').cat === 8);
  check('Q-K-A-2-3 אינו סטרייט', ev('Qh Kd Ac 2s 3h 8d 9c').cat === 0);
  check('הסטרייט הגבוה מבין שניים', ev('4c 5d 6h 7s 8d 9c 2h').desc === 'סטרייט עד 9');
}
{
  check('זוג זהה — קיקר מכריע', ev('Kh Kd 9c 7s 4h 3d 2c').score > ev('Kh Kd 8c 7s 4h 3d 2c').score);
  check('קיקר חמישי שלא נכנס לחמישייה אינו משנה', ev('Kh Kd Ac Qs Jh 3d 2c').score === ev('Kh Kd Ac Qs Jh 4d 2c').score);
  check('שני זוגות — זוג שלישי משמש כקיקר', ranksOf(ev('Ah Ad Kc Ks 9h 9d 2c').cards) === '14,14,13,13,9');
  check('שתי שלישיות — פול האוס מהגבוהה', ev('Ah Ad Ac 9s 9h 9d 2c').desc === 'פול האוס, אסים על 9');
  check('פול האוס עם שלישייה וזוג גבוה מהשלישייה השנייה', ev('Kh Kd Kc 5s 5h 9d 9c').desc === 'פול האוס, מלכים על 9');
  check('פלאש של שישה קלפים — חמשת הגבוהים', ranksOf(ev('Ah 9h 7h 4h 3h 2h Kc').cards) === '14,9,7,4,3');
  check('פלאש — השוואת קלף שני', ev('Ah Kh 7h 4h 2h 9c 8d').score > ev('Ah Qh 7h 4h 2h 9c 8d').score);
  check('רביעייה — הקיקר הגבוה', ranksOf(ev('7c 7d 7h 7s Kd Qc 3c').cards) === '13,7,7,7,7');
  check('שני זוגות זהים — קיקר', ev('Jc Jd 4h 4s Ad 2c 6h').score > ev('Jc Jd 4h 4s Kd 2c 6h').score);
  const sf = ev('9h 8h 7h 6h 5h 4d 10h');
  check('הטוב מתוך שבעה: סטרייט פלאש עד 10', sf.cat === 8 && sf.desc === 'סטרייט פלאש עד 10');
  check('הקלפים המנצחים בצבע הנכון', sf.cards.every((c) => c.suit === 'h'));
  check('תיאור זוג', ev('Qh Qd 9c 7s 4h 3d 2c').desc === 'זוג מלכות');
  check('תיאור שני זוגות', ev('Kh Kd 7c 7s 4h 3d 2c').desc === 'שני זוגות, מלכים ו-7');
  check('הערכה של שני קלפים בלבד (לפני הפלופ)', ev('Ah Ad').cat === 1 && ev('Ah Kd').cat === 0);
}

{
  // עקביות: הציון של חמשת הקלפים המנצחים שווה לציון של כל השבעה
  const rng = seeded(11);
  let ok = true;
  for (let t = 0; t < 3000 && ok; t++) {
    const d = P.shuffle(P.makeDeck(), rng).slice(0, 7);
    const e = P.evaluate(d);
    if (P.score(e.cards) !== e.score) ok = false;
    // ובדיקת מוח: אף תת-קבוצה של 5 אינה טובה יותר
    for (let a = 0; a < 7 && ok; a++) for (let b = a + 1; b < 7; b++) {
      const five = d.filter((_, k) => k !== a && k !== b);
      if (P.score(five) > e.score) { ok = false; break; }
    }
  }
  check('3000 ידיים אקראיות — החמישייה היא הטובה ביותר, והציון תואם', ok);
}

/* --------------------------------------------------------------------- */
/* כלי עזר: יד מבוימת                                                     */
/* --------------------------------------------------------------------- */

/** משחק שבו קובעים ערימות, כפתור וקלפים מראש */
function staged(stacks, opts) {
  opts = opts || {};
  const g = P.newGame(stacks.map((_, i) => ({ name: 'P' + i })), { stack: 1000 });
  stacks.forEach((s, i) => { g.players[i].stack = s; if (s === 0) g.players[i].out = true; });
  g.button = opts.button === undefined ? -1 : opts.button - 0; // startHand מקדם
  if (opts.button !== undefined) g.button = P.nextActive(g, opts.button) === opts.button ? opts.button : prevActive(g, opts.button);
  P.startHand(g, seeded(opts.seed || 1));
  if (opts.holes) {
    opts.holes.forEach((hs, i) => { if (hs && g.h.seats[i]) g.h.seats[i].hole = cards(hs); });
  }
  if (opts.board) {
    // החפיסה נשלפת מהסוף: שריפה, 3, שריפה, 1, שריפה, 1
    const b = cards(opts.board);
    const used = new Set([].concat(...g.h.seats.filter(Boolean).map((s) => s.hole), b).map((c) => c.rank + c.suit));
    const rest = P.makeDeck().filter((c) => !used.has(c.rank + c.suit));
    const tail = [rest.pop(), b[0], b[1], b[2], rest.pop(), b[3], rest.pop(), b[4]];
    g.h.deck = rest.concat(tail.reverse());
  }
  return g;
}
function prevActive(g, i) {
  const n = g.players.length;
  for (let k = 1; k <= n; k++) {
    const j = (i - k + n) % n;
    if (!g.players[j].out) return j;
  }
  return i;
}
/** מריץ את היד עד הסוף בלי פעולות נוספות (כשכולם הכל-אין) */
function runout(g) {
  let guard = 0;
  while (g.h.street !== 'done' && g.h.toAct < 0 && guard++ < 10) P.proceed(g);
}
const A = (g, type, to) => P.act(g, { type, to });

/* --------------------------------------------------------------------- */

section('בליינדים, כפתור וסדר פעולה');

{
  const g = staged([1000, 1000, 1000, 1000], { button: 0 });
  const h = g.h;
  check('כפתור במושב 0', g.button === 0);
  check('בליינד קטן 10 במושב 1, גדול 20 במושב 2', h.seats[1].bet === 10 && h.seats[2].bet === 20);
  check('ראשון לפעול: אחרי הגדול (מושב 3)', h.toAct === 3);
  check('לכל אחד שני קלפים, בחפיסה 44', h.seats.every((s) => s.hole.length === 2) && h.deck.length === 44);
  A(g, 'call'); A(g, 'call'); A(g, 'call');
  check('לגדול יש אופציה אחרי שכולם השוו', h.toAct === 2);
  const L = P.legal(g);
  check('הגדול יכול לבדוק או להעלות', L.canCheck && L.canRaise && L.minTo === 40);
  A(g, 'check');
  check('הסיבוב נגמר', h.toAct === -1);
  P.proceed(g);
  check('פלופ: שלושה קלפים, החפיסה ירדה ב-4', h.board.length === 3 && h.deck.length === 40);
  check('אחרי הפלופ פועל ראשון מי שמשמאל לכפתור', h.toAct === 1);
  check('הקופה 80', P.potTotal(h) === 80);
}

{
  const g = staged([1000, 1000], { button: 0 });
  const h = g.h;
  check('בשניים: הכפתור הוא הבליינד הקטן', h.sbIdx === 0 && h.seats[0].bet === 10 && h.seats[1].bet === 20);
  check('בשניים: הכפתור פועל ראשון לפני הפלופ', h.toAct === 0);
  A(g, 'call'); A(g, 'check');
  P.proceed(g);
  check('בשניים: אחרי הפלופ פועל הבליינד הגדול', h.toAct === 1);
}

{
  const g = P.newGame([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
  P.startHand(g, seeded(3));
  const b1 = g.button;
  A(g, 'fold'); A(g, 'fold');
  check('כולם ויתרו — הסיבוב נגמר מיד', g.h.toAct === -1);
  P.proceed(g);
  check('הבליינד הגדול זוכה בבליינדים', g.h.street === 'done' && g.players[g.h.bbIdx].stack === 1010);
  check('זה נרשם כזכייה (30), ולא כהחזר', g.h.result.won[g.h.bbIdx] === 30 && !g.h.result.showdown);
  P.startHand(g, seeded(4));
  check('הכפתור עבר למושב הבא', g.button === (b1 + 1) % 3);
  check('יד 2', g.hand === 2);
}

{
  const g = P.newGame([{ name: 'a' }, { name: 'b' }], { handsPerLevel: 10 });
  check('בליינדים ביד 1: 10/20', P.blindsFor(g, 1).join() === '10,20');
  check('ביד 11: 15/30', P.blindsFor(g, 11).join() === '15,30');
  check('ביד 31: 50/100', P.blindsFor(g, 31).join() === '50,100');
  check('אחרי הטבלה ממשיכים להכפיל', P.blindsFor(g, 101).join() === '800,1600');
}

section('העלאה מינימלית ופתיחה מחדש');

{
  const g = staged([1000, 1000, 1000, 1000], { button: 0 });
  const h = g.h;
  check('העלאה מינימלית לפני הפלופ: ל-40', P.legal(g).minTo === 40);
  check('העלאה ל-30 נדחית', !A(g, 'raise', 30));
  check('העלאה ל-60', A(g, 'raise', 60));
  check('המינימום הבא: 100 (60 + 40)', P.legal(g).minTo === 100);
  A(g, 'raise', 160);
  check('אחרי העלאה של 100: המינימום 260', P.legal(g).minTo === 260);
  check('הכל-אין מותר גם אם קטן מהמינימום', P.legal(g).maxTo === 1000);
}

{
  // A מהמר 100, B הכל-אין ל-150 (העלאה קצרה), A שכבר פעל — רק להשוות
  const g = staged([1000, 1000, 1000, 170], { button: 3 });
  const h = g.h;
  // כפתור 3 → קטן 0, גדול 1, ראשון 2
  A(g, 'call'); A(g, 'call'); A(g, 'call'); A(g, 'check'); // 2,3,0,1
  P.proceed(g);
  check('פלופ — מושב 0 ראשון', h.toAct === 0);
  A(g, 'raise', 100); // 0 מהמר
  A(g, 'fold');       // 1
  A(g, 'call');       // 2 משווה 100
  check('מושב 3 עם 150 בלבד', P.legal(g).maxTo === 150);
  A(g, 'raise', 150); // 3 הכל-אין קצר
  check('ההימור עלה ל-150, ההעלאה המינימלית לא השתנתה', h.currentBet === 150 && h.minRaise === 100);
  check('מושב 0 צריך להגיב', h.toAct === 0);
  const L = P.legal(g);
  check('מושב 0 — לא רשאי להעלות שוב, רק להשוות 50', !L.canRaise && L.toCall === 50);
  check('ניסיון העלאה נדחה', !A(g, 'raise', 400));
  A(g, 'call');
  check('גם מושב 2 רק משווה', !P.legal(g).canRaise);
  A(g, 'call');
  check('הסיבוב נגמר', h.toAct === -1);
}

{
  // העלאה קצרה לפני שמישהו אחר פעל: מי שלא פעל עדיין רשאי להעלות
  const g = staged([1000, 1000, 1000, 50], { button: 2 });
  // כפתור 2 → קטן 3, גדול 0, ראשון 1
  const h = g.h;
  check('ראשון לפעול: מושב 1', h.toAct === 1);
  A(g, 'raise', 40);  // 1 העלאה מלאה
  A(g, 'call');       // 2
  A(g, 'raise', 50);  // 3 (קטן) הכל-אין ל-50 — קצר
  check('הגדול (לא פעל עדיין) רשאי להעלות', h.toAct === 0 && P.legal(g).canRaise);
  A(g, 'call');       // 0
  check('מושב 1 שכבר פעל — רק להשוות', h.toAct === 1 && !P.legal(g).canRaise);
}

{
  // שתי העלאות קצרות שמצטברות להעלאה מלאה — פותחות מחדש
  const g = staged([130, 190, 1000, 1000], { button: 0 });
  // כפתור 0 → קטן 1, גדול 2, ראשון 3
  const h = g.h;
  A(g, 'raise', 100); // 3: העלאה מלאה ל-100 (התוספת 80)
  A(g, 'raise', 130); // 0: הכל-אין קצר ל-130
  check('הכל-אין קצר אינו משנה את ההעלאה המינימלית', h.currentBet === 130 && h.minRaise === 80);
  A(g, 'raise', 190); // 1: הכל-אין ל-190 — יחד מעל 100+80
  check('מצטבר להעלאה מלאה: הגדול רשאי להעלות', h.toAct === 2 && P.legal(g).canRaise);
  A(g, 'call');       // 2
  check('וגם מושב 3, שכבר פעל, רשאי שוב להעלות', h.toAct === 3 && P.legal(g).canRaise);
}

{
  // הכל-אין קצר אחד בלבד — מי שהעלה רק משווה
  const g = staged([1000, 1000, 130, 1000], { button: 0 });
  const h = g.h;
  A(g, 'raise', 100); A(g, 'call'); A(g, 'call');
  A(g, 'raise', 130); // 2 (הגדול) הכל-אין קצר
  check('מושב 3 שהעלה — רק משווה', h.toAct === 3 && !P.legal(g).canRaise);
  check('ניסיון העלאה נדחה', !A(g, 'raise', 300) && h.currentBet === 130);
}

section('קופות צד');

{
  // שלושה הכל-אין בגדלים שונים ושחקן רביעי שמכסה
  const g = staged([100, 300, 600, 1000], {
    button: 0,
    holes: ['As Ad', 'Ks Kd', 'Qs Qd', 'Js Jd'],
    board: '2c 7h 9d 3s 4c',
  });
  // כפתור 0 → קטן 1, גדול 2, ראשון 3
  A(g, 'raise', 1000); // 3
  A(g, 'call');        // 0 (100)
  A(g, 'call');        // 1 (300)
  A(g, 'call');        // 2 (600)
  check('כולם הכל-אין — אין מי שיפעל', g.h.toAct === -1);
  const pots = P.computePots(g.h);
  check('ארבע קומות: 400, 600, 600, 400', pots.map((p) => p.amount).join() === '400,600,600,400');
  check('הזכאים מצטמצמים בכל קומה', pots.map((p) => p.eligible.length).join() === '4,3,2,1');
  runout(g);
  const st = g.players.map((p) => p.stack);
  check('אסים זוכים בראשית (400)', st[0] === 400);
  check('מלכים בצד הראשון (600)', st[1] === 600);
  check('מלכות בצד השני (600)', st[2] === 600);
  check('העודף של הגדול מוחזר (400)', st[3] === 400);
  check('החזר אינו נספר כזכייה', !g.h.result.won[3] && g.h.result.won[0] === 400);
  check('שימור ז\'יטונים', st.reduce((a, b) => a + b, 0) === 2000);
  check('שלושה הודחו? לא — רק מי שנשאר בלי כלום', g.h.result.busted.length === 0);
}

{
  // הקצר מנצח, השניים האחרים חולקים את הצד
  const g = staged([200, 1000, 1000], {
    button: 0,
    holes: ['As Ad', 'Kh Qh', 'Kd Qd'],
    board: '2c 7s 9c Js 10c',
  });
  // כפתור 0 → קטן 1, גדול 2, ראשון 0
  A(g, 'raise', 200); // 0 הכל-אין
  A(g, 'call');       // 1
  A(g, 'call');       // 2
  P.proceed(g);
  check('אחרי הפלופ ממשיכים להמר בין השניים', g.h.toAct === 1);
  A(g, 'raise', 101); // 1 מהמר סכום אי-זוגי
  A(g, 'call');       // 2
  P.proceed(g); A(g, 'check'); A(g, 'check');
  P.proceed(g); A(g, 'check'); A(g, 'check');
  P.proceed(g);
  const st = g.players.map((p) => p.stack);
  // סטרייט עד A בריבר? לוח 2 7 9 J 10 + KQ = סטרייט K-9 לשניהם, אסים — זוג
  check('שני סטרייטים זהים חולקים הכול', st[1] === st[2] && st[0] === 0);
  check('שימור ז\'יטונים בחלוקה', st.reduce((a, b) => a + b, 0) === 2200);
  check('השחקן הקצר הודח', g.players[0].out && g.h.result.busted.join() === '0');
}

{
  // שבר ז'יטון: קופה אי-זוגית בין שני זוכים — הראשון משמאל לכפתור מקבל
  const g = staged([1000, 1000, 1000], {
    button: 0,
    holes: ['Ks Qs', 'Kh Qh', '2d 3c'],
    board: 'Ad Jc 10h 5s 4d',
  });
  // כפתור 0 → קטן 1 (10), גדול 2 (20), ראשון 0
  A(g, 'raise', 45);  // 0
  A(g, 'call');       // 1 → 45
  A(g, 'fold');       // 2 מוותר על 20
  // קופה: 45+45+20 = 110 → נשאר זוגי; נוסיף הימור אי-זוגי
  P.proceed(g);
  A(g, 'raise', 21); A(g, 'call');
  P.proceed(g); A(g, 'check'); A(g, 'check');
  P.proceed(g); A(g, 'check'); A(g, 'check');
  P.proceed(g);
  // 110 + 42 = 152 → 76/76. נעשה אי-זוגי אחרת: נבדוק את חלוקת השבר ישירות
  check('קופה זוגית מתחלקת שווה', g.players[0].stack === g.players[1].stack);
}

{
  // בדיקה ישירה של שבר: קופה 25 בין שני זוכים
  const h = {
    seats: [
      { total: 10, folded: false, hole: cards('Ks Qs') },
      { total: 10, folded: false, hole: cards('Kh Qh') },
      { total: 5, folded: true, hole: cards('2d 3c') },
    ],
    board: cards('Ad Jc 10h 5s 4d'),
  };
  const g = { players: [{ stack: 0 }, { stack: 0 }, { stack: 0 }].map((p) => Object.assign(p, { out: false })), button: 1, hand: 1, h };
  h.seats.forEach((s) => { s.bet = 0; });
  const pots = P.computePots(h);
  check('מי שוויתר תורם לקופה אבל אינו זכאי', pots.length === 1 && pots[0].amount === 25 && pots[0].eligible.join() === '0,1');
  // award דרך proceed: נסמלץ סוף יד
  h.toAct = -1; h.street = 'river';
  P.proceed(g);
  check('שבר הז\'יטון הולך לראשון משמאל לכפתור (מושב 2 ויתר → מושב 0)', g.players[0].stack === 13 && g.players[1].stack === 12);
}

section('הדחה וסיום');

{
  const g = staged([20, 1000, 1000], { button: 1, holes: ['2c 3d', 'As Ad', 'Ks Kd'], board: 'Qc Jh 9d 8s 4c' });
  // כפתור 1 → קטן 2, גדול 0 (הכל-אין מהבליינד)
  check('בליינד שאוכל את כל הערימה = הכל-אין', g.h.seats[0].allIn);
  A(g, 'call'); A(g, 'call');
  while (g.h.street !== 'done') {
    if (g.h.toAct >= 0) A(g, 'check'); else P.proceed(g);
  }
  check('הקצר הודח ויצא מהמשחק', g.players[0].out && g.players[0].bustHand === 1);
  P.startHand(g, seeded(9));
  check('ביד הבאה הוא לא מקבל קלפים', g.h.seats[0] === null);
  check('והכפתור מדלג עליו', g.button !== 0);
}

{
  const g = P.newGame([{ name: 'me', human: true }, { name: 'a' }, { name: 'b' }]);
  g.players[0].stack = 0;
  g.players[0].out = true;
  check('מי שבחוץ לא נספר', P.activeCount(g) === 2);
  const g2 = P.newGame([{ name: 'me', human: true }, { name: 'a' }]);
  g2.players[1].out = true;
  check('שחקן אחד — אין יד', P.startHand(g2) === false && g2.over);
}

/* --------------------------------------------------------------------- */

section('יריבים ממוחשבים');

{
  check('צ\'ן: AA הגבוה ביותר', AI.chen(cards('As Ad')[0], cards('As Ad')[1]) > AI.chen(cards('Ks Kd')[0], cards('Ks Kd')[1]));
  check('צ\'ן: 72 שונות חלשה מ-AK', AI.chen(...cards('7s 2d')) < AI.chen(...cards('As Kd')));
  const e1 = AI.equity(cards('As Ad'), [], 1, 3000, seeded(1));
  check('אסים מול יד אקראית — כ-85% (' + e1.toFixed(3) + ')', e1 > 0.82 && e1 < 0.88);
  const e2 = AI.equity(cards('7s 2d'), [], 1, 3000, seeded(2));
  check('7-2 מול יד אקראית — כ-35% (' + e2.toFixed(3) + ')', e2 > 0.31 && e2 < 0.39);
  const e3 = AI.equity(cards('As Ad'), [], 4, 3000, seeded(3));
  check('אסים מול ארבעה — פחות (' + e3.toFixed(3) + ')', e3 < e1 && e3 > 0.5);
  const e4 = AI.equity(cards('Ah Kh'), cards('Qh Jh 10h'), 2, 500, seeded(4));
  check('רויאל פלאש בפלופ — 100%', e4 === 1);
  const t0 = Date.now();
  AI.equity(cards('Ah Kh'), [], 5, 1e9, seeded(5), 80);
  check('הסימולציה נעצרת במגבלת הזמן', Date.now() - t0 < 200);
}

{
  // כל החלטה חוקית בכל רמה, בעמדות רבות
  let ok = true;
  for (let level = 1; level <= 4 && ok; level++) {
    const rng = seeded(100 + level);
    for (let t = 0; t < 120 && ok; t++) {
      const n = 2 + (t % 5);
      const g = P.newGame(Array.from({ length: n }, (_, i) => ({ name: 'P' + i })));
      g.players.forEach((p) => { p.stack = 50 + Math.floor(rng() * 1500); });
      P.startHand(g, rng);
      let guard = 0;
      while (g.h.street !== 'done' && guard++ < 200) {
        if (g.h.toAct < 0) { P.proceed(g); continue; }
        const a = AI.decide(g, { level, rng });
        if (!a || !P.act(g, a)) { ok = false; console.log('    פעולה לא חוקית', level, JSON.stringify(a), JSON.stringify(P.legal(g))); break; }
      }
    }
  }
  check('כל החלטות המחשב חוקיות — 4 רמות × 120 ידיים', ok);
}

{
  // טורניר שלם, מחשבים בלבד: מסתיים, וז'יטונים נשמרים בכל צעד
  for (const n of [2, 4, 6]) {
    const rng = seeded(200 + n);
    const g = P.newGame(Array.from({ length: n }, (_, i) => ({ name: 'P' + i })), { handsPerLevel: 5 });
    const total = P.totalChips(g);
    let conserved = true;
    let hands = 0;
    while (!g.over && hands < 2000) {
      if (!P.startHand(g, rng)) break;
      hands++;
      let guard = 0;
      while (g.h.street !== 'done' && guard++ < 300) {
        if (g.h.toAct < 0) P.proceed(g);
        else P.act(g, AI.decide(g, { level: 1 + (g.h.toAct % 4), rng }));
        if (P.totalChips(g) !== total) conserved = false;
      }
      if (g.h.street !== 'done') conserved = false;
    }
    const winner = g.players.filter((p) => !p.out);
    check(n + ' שחקנים — הטורניר הסתיים אחרי ' + hands + ' ידיים, מנצח אחד עם הכול',
      g.over && winner.length === 1 && winner[0].stack === total);
    check(n + ' שחקנים — שימור ז\'יטונים בכל פעולה', conserved);
  }
}

{
  // השחקן האנושי שנופל — המשחק נגמר, ומקום נרשם
  const rng = seeded(77);
  const g = P.newGame([{ name: 'me', human: true }, { name: 'a' }, { name: 'b' }]);
  g.players[0].stack = 30;
  let guard = 0;
  while (!g.over && guard++ < 500) {
    if (!P.startHand(g, rng)) break;
    while (g.h.street !== 'done') {
      if (g.h.toAct < 0) { P.proceed(g); continue; }
      const human = g.h.toAct === 0;
      P.act(g, human ? { type: 'raise', to: P.legal(g).maxTo } : AI.decide(g, { level: 2, rng }));
    }
  }
  check('המשחק נגמר כשהאנושי נופל או זוכה', g.over && (g.players[0].out ? g.place >= 2 : g.place === 1));
}

{
  const g = P.newGame([{ name: 'me', human: true }, { name: 'a' }]);
  P.startHand(g, seeded(8));
  const copy = JSON.parse(JSON.stringify(g));
  check('מצב המשחק עובר JSON בלי איבוד', JSON.stringify(copy) === JSON.stringify(g));
  P.act(copy, AI.decide(copy, { level: 3, rng: seeded(9) }));
  check('ואפשר להמשיך לשחק מהעותק', copy.h.history.length === 1);
}

/* --------------------------------------------------------------------- */

console.log('\n' + passed + ' עברו, ' + failed + ' נכשלו');
if (failed) process.exit(1);
