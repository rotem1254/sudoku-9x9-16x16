/* =============================================================================
 * test/test-solitaire.js — בדיקות למנוע הסוליטר
 * -----------------------------------------------------------------------------
 *     node test/test-solitaire.js
 * =========================================================================== */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'js', 'solitaire', 'engine.js'));

const Solitaire = globalThis.Solitaire;
const C = globalThis.SolitaireCards;

let passed = 0;
let failed = 0;

function check(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
}
const section = (t) => console.log('\n' + t);

/* --------------------------------------------------------------------- */

section('קלפים');

check('4 צורות × 13 ערכים = 52 קלפים ייחודיים',
  new Set(C.shuffled(C.mulberry32(1))).size === 52);

const aceSpades = C.makeCard(0, 1);
const kingHearts = C.makeCard(1, 13);
check('קידוד/פענוח קלף',
  C.cardSuit(aceSpades) === 'spades' && C.cardRank(aceSpades) === 1 &&
  C.cardSuit(kingHearts) === 'hearts' && C.cardRank(kingHearts) === 13);
check('צבעים: לב ויהלום אדומים',
  C.cardIsRed(C.makeCard(1, 5)) && C.cardIsRed(C.makeCard(2, 5)) &&
  !C.cardIsRed(C.makeCard(0, 5)) && !C.cardIsRed(C.makeCard(3, 5)));
check('תוויות', C.cardLabel(aceSpades) === 'A' && C.cardLabel(kingHearts) === 'K' &&
  C.cardLabel(C.makeCard(0, 10)) === '10');

/* --------------------------------------------------------------------- */

section('חלוקה');

const g = new Solitaire({ seed: 12345 });
check('7 עמודות בגדלים 1..7',
  g.tableau.length === 7 && g.tableau.every((p, i) => p.length === i + 1));
check('רק הקלף העליון בכל עמודה גלוי', g.faceUp.every((n) => n === 1));
check('24 קלפים בחפיסה', g.stock.length === 24);
check('waste וערימות הסיום ריקות',
  g.waste.length === 0 && g.foundations.every((f) => f.length === 0));

const all = [].concat(...g.tableau, g.stock, g.waste, ...g.foundations);
check('כל 52 הקלפים קיימים בדיוק פעם אחת',
  all.length === 52 && new Set(all).size === 52);

check('אותו seed מחלק אותה חלוקה',
  JSON.stringify(new Solitaire({ seed: 777 }).tableau) ===
  JSON.stringify(new Solitaire({ seed: 777 }).tableau));

/* --------------------------------------------------------------------- */

section('משיכה מהחפיסה');

const d1 = new Solitaire({ seed: 5, drawCount: 1 });
d1.draw();
check('משיכת 1 מעבירה קלף אחד', d1.waste.length === 1 && d1.stock.length === 23);

const d3 = new Solitaire({ seed: 5, drawCount: 3 });
d3.draw();
check('משיכת 3 מעבירה שלושה', d3.waste.length === 3 && d3.stock.length === 21);

// מרוקנים את החפיסה ומוודאים מיחזור
while (d1.stock.length) d1.draw();
check('אחרי מיצוי החפיסה ה-waste מלא', d1.waste.length === 24 && d1.stock.length === 0);
const rec = d1.draw();
check('משיכה נוספת ממחזרת את ה-waste',
  rec.ok && rec.recycled && d1.stock.length === 24 && d1.waste.length === 0);
check('מונה המיחזורים עלה', d1.recycles === 1);

/* --------------------------------------------------------------------- */

section('חוקי הנחה');

const t = new Solitaire({ seed: 1 });
// בונים מצב ידני כדי לבדוק חוקים בבידוד
t.tableau = [[C.makeCard(0, 13)], [], [C.makeCard(1, 7)], [], [], [], []];
t.faceUp = [1, 0, 1, 0, 0, 0, 0];
t.foundations = [[], [], [], []];

check('מלך על עמודה ריקה — מותר', t.canPlaceOnTableau(C.makeCard(1, 13), 1));
check('לא-מלך על עמודה ריקה — אסור', !t.canPlaceOnTableau(C.makeCard(1, 12), 1));
check('אדום 6 על שחור 13 — אסור (פער ערכים)', !t.canPlaceOnTableau(C.makeCard(1, 6), 0));
check('אדום 12 על שחור 13 — מותר', t.canPlaceOnTableau(C.makeCard(1, 12), 0));
check('שחור 12 על שחור 13 — אסור (אותו צבע)', !t.canPlaceOnTableau(C.makeCard(3, 12), 0));
check('אדום 11 על שחור 13 — אסור (פער ערכים)', !t.canPlaceOnTableau(C.makeCard(1, 11), 0));
check('שחור 6 על אדום 7 — מותר', t.canPlaceOnTableau(C.makeCard(0, 6), 2));

check('אס על ערימת סיום ריקה — מותר', t.canPlaceOnFoundation(C.makeCard(0, 1), 0));
check('2 על ערימת סיום ריקה — אסור', !t.canPlaceOnFoundation(C.makeCard(0, 2), 0));
t.foundations[0] = [C.makeCard(0, 1)];
check('2 עלה על אס באותה צורה — מותר', t.canPlaceOnFoundation(C.makeCard(0, 2), 0));
check('צורה לא תואמת — אסור', !t.canPlaceOnFoundation(C.makeCard(1, 2), 0));

/* --------------------------------------------------------------------- */

section('הזזת רצף');

const r = new Solitaire({ seed: 2 });
// רצף חוקי: שחור9, אדום8, שחור7
r.tableau = [[C.makeCard(0, 9), C.makeCard(1, 8), C.makeCard(3, 7)], [C.makeCard(1, 10)], [], [], [], [], []];
r.faceUp = [3, 1, 0, 0, 0, 0, 0];
check('רצף יורד ומתחלף — ניתן להזזה', r.isMovableRun(0, 0));
check('גם תת-רצף ניתן להזזה', r.isMovableRun(0, 1));

r.tableau[0] = [C.makeCard(0, 9), C.makeCard(0, 8)]; // אותו צבע
r.faceUp[0] = 2;
check('רצף באותו צבע — לא ניתן להזזה', !r.isMovableRun(0, 0));

// הזזת רצף שלם לעמודה אחרת
const r2 = new Solitaire({ seed: 3 });
r2.tableau = [[C.makeCard(0, 9), C.makeCard(1, 8)], [C.makeCard(1, 10)], [], [], [], [], []];
r2.faceUp = [2, 1, 0, 0, 0, 0, 0];
const mv = r2.move({ zone: 'tableau', pile: 0, index: 0 }, { zone: 'tableau', pile: 1 });
check('רצף עבר לעמודה חוקית',
  mv.ok && r2.tableau[1].length === 3 && r2.tableau[0].length === 0 && r2.faceUp[1] === 3);

/* --------------------------------------------------------------------- */

section('חשיפת קלף וניקוד');

const rv = new Solitaire({ seed: 4 });
rv.tableau = [[C.makeCard(2, 5), C.makeCard(0, 13)], [], [], [], [], [], []];
rv.faceUp = [1, 0, 0, 0, 0, 0, 0]; // רק המלך גלוי
const before = rv.score;
const m2 = rv.move({ zone: 'tableau', pile: 0, index: 1 }, { zone: 'tableau', pile: 1 });
check('הזזת המלך חשפה את הקלף שמתחתיו', m2.ok && m2.revealed && rv.faceUp[0] === 1);
check('חשיפה מזכה בניקוד', rv.score > before);

/* --------------------------------------------------------------------- */

section('Undo');

const u = new Solitaire({ seed: 9 });
const snapshot = JSON.stringify(u.tableau);
u.draw();
check('משיכה שינתה את המצב', u.waste.length === 1);
u.undo();
check('Undo החזיר את המשיכה', u.waste.length === 0 && u.stock.length === 24);
check('העמודות לא נפגעו', JSON.stringify(u.tableau) === snapshot);
check('אין מה לבטל בהתחלה', !new Solitaire({ seed: 9 }).canUndo());

/* --------------------------------------------------------------------- */

section('איסוף אוטומטי וניצחון');

/** בונה משחק שכל הקלפים בו מסודרים ומוכנים לאיסוף. */
function nearlyWon() {
  const s = new Solitaire({ seed: 1 });
  s.stock = [];
  s.waste = [];
  s.foundations = [[], [], [], []];
  s.tableau = [[], [], [], [], [], [], []];
  s.faceUp = [0, 0, 0, 0, 0, 0, 0];
  // כל צורה בעמודה משלה, בסדר יורד כך שהעליון הוא האס
  for (let suit = 0; suit < 4; suit++) {
    const pile = [];
    for (let rank = 13; rank >= 1; rank--) pile.push(C.makeCard(suit, rank));
    s.tableau[suit] = pile;
    s.faceUp[suit] = 13;
  }
  return s;
}

const w = nearlyWon();
check('כל הקלפים גלויים => אפשר לסיים אוטומטית', w.canAutoFinish());
const collected = w.autoCollect();
check(`autoCollect אסף את כל 52 הקלפים (אסף ${collected})`, collected === 52);
check('ערימות הסיום מלאות', w.foundationCount() === 52);
check('המשחק סומן כמנוצח', w.finished && w.checkWin());
check('טיימר נעצר בניצחון', !w.isTimerRunning);

const notReady = new Solitaire({ seed: 11 });
check('חלוקה טרייה — אי אפשר לסיים אוטומטית', !notReady.canAutoFinish());

/* --------------------------------------------------------------------- */

section('שמירה ושחזור');

const sv = new Solitaire({ seed: 42, drawCount: 3 });
sv.draw();
sv.draw();
const round = Solitaire.deserialize(JSON.parse(JSON.stringify(sv.serialize())));
check('סריאליזציה שומרת על המצב',
  round &&
  JSON.stringify(round.tableau) === JSON.stringify(sv.tableau) &&
  JSON.stringify(round.stock) === JSON.stringify(sv.stock) &&
  JSON.stringify(round.waste) === JSON.stringify(sv.waste) &&
  round.drawCount === 3 && round.moves === sv.moves);
check('מצב פגום מוחזר כ-null', Solitaire.deserialize({ nonsense: true }) === null);

/* --------------------------------------------------------------------- */

section('שלמות אחרי סדרת מהלכים אקראיים');

let integrityOk = true;
for (let trial = 0; trial < 40; trial++) {
  const s = new Solitaire({ seed: trial * 31 + 7, drawCount: trial % 2 ? 3 : 1 });
  for (let step = 0; step < 120; step++) {
    // מנסים מהלך אוטומטי מאיזשהו מקור, אחרת מושכים
    const srcs = [{ zone: 'waste' }];
    for (let i = 0; i < 7; i++) {
      const pile = s.tableau[i];
      for (let j = Math.max(0, pile.length - s.faceUp[i]); j < pile.length; j++) {
        srcs.push({ zone: 'tableau', pile: i, index: j });
      }
    }
    let moved = false;
    for (const src of srcs) {
      if (s.autoMove(src).ok) { moved = true; break; }
    }
    if (!moved && !s.draw().ok) break;

    const cards = [].concat(...s.tableau, s.stock, s.waste, ...s.foundations);
    if (cards.length !== 52 || new Set(cards).size !== 52) { integrityOk = false; break; }
    for (let i = 0; i < 7; i++) {
      if (s.faceUp[i] > s.tableau[i].length || s.faceUp[i] < 0) { integrityOk = false; break; }
      if (s.tableau[i].length > 0 && s.faceUp[i] === 0) { integrityOk = false; break; }
    }
    if (!integrityOk) break;
  }
  if (!integrityOk) break;
}
check('52 קלפים ייחודיים ומוני הגלויים תקינים לאורך 40 משחקים', integrityOk);

/* --------------------------------------------------------------------- */

console.log(`\n${passed} עברו, ${failed} נכשלו`);
process.exit(failed ? 1 : 0);
