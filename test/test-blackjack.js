/* =============================================================================
 * test/test-blackjack.js — בדיקות לבלאקג'ק: סכומים, חוקים, תשלום, אסטרטגיה
 * -----------------------------------------------------------------------------
 *     node test/test-blackjack.js
 * =========================================================================== */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'js', 'blackjack', 'engine.js'));

const BJ = globalThis.Blackjack;

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

/** קלף מקיצור: 'A' 'K' 'Q' 'J' 'T' או ספרה, והצורה אופציונלית. */
const R = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
const card = (s) => ({ rank: R[s[0]] || Number(s[0]), suit: s[1] || 's' });
const cards = (str) => str.split(' ').map(card);

/**
 * שולחן עם חפיסה מסודרת מראש. סדר החלוקה: שחקן, דילר, שחקן, דילר, ואחר
 * כך כל קלף נוסף לפי הסדר. החפיסה ארוכה מספיק כדי שלא יהיה ערבוב.
 */
function rigged(order, opts) {
  const t = new BJ.Table(Object.assign({ level: 1, bankroll: 1000, rng: seeded(1) }, opts));
  const filler = BJ.buildShoe(t.rules.decks, seeded(7));
  t.shoe = filler.concat(cards(order).reverse());
  t.shoeSize = t.shoe.length;
  return t;
}

/* --------------------------------------------------------------------- */

section('סכום יד');

check('A + K = 21 רך', (() => { const v = BJ.handValue(cards('A K')); return v.total === 21 && v.soft; })());
check('A + A = 12 רך', (() => { const v = BJ.handValue(cards('A A')); return v.total === 12 && v.soft; })());
check('A + 6 + 9 = 16 קשה', (() => { const v = BJ.handValue(cards('A 6 9')); return v.total === 16 && !v.soft; })());
check('A + A + A + 8 = 21', BJ.handValue(cards('A A A 8')).total === 21);
check('K + Q + 5 = 25', BJ.handValue(cards('K Q 5')).total === 25);
check('בלאקג׳ק טבעי: A + J', BJ.isNatural(cards('A J')));
check('21 משלושה קלפים אינו בלאקג׳ק', !BJ.isNatural(cards('7 7 7')));

section('חפיסה');

{
  const shoe = BJ.buildShoe(6, seeded(3));
  check('6 חפיסות = 312 קלפים', shoe.length === 312);
  const aces = shoe.filter((c) => c.rank === 14).length;
  check('24 אסים ב-6 חפיסות', aces === 24);
  const t = new BJ.Table({ level: 3, rng: seeded(5) });
  check('רמה 3 משתמשת ב-6 חפיסות', t.shoe.length === 312);
}

section('הימור');

{
  const t = new BJ.Table({ level: 1, bankroll: 1000, rng: seeded(2) });
  check('מתחת למינימום נדחה', !t.canBet(5));
  check('לא כפולה של 10 נדחה', !t.canBet(15));
  check('מעל המקסימום נדחה', !t.canBet(600));
  check('הימור חוקי מתקבל', t.canBet(100));
  const t2 = new BJ.Table({ level: 4, bankroll: 50 });
  check('רמה 4 עם 50 בקופה = נגמר הכסף', t2.broke());
}

section('חלוקה ותשלום');

{
  const t = rigged('T 9 8 7 5');
  t.deal(100);
  check('אחרי חלוקה תור השחקן', t.phase === 'player');
  check('ההימור ירד מהקופה', t.bankroll === 900);
  t.act('stand'); // 18 מול 16 — הדילר מושך 5 = 21
  check('הדילר מושך עד 17 ומעלה', BJ.handValue(t.dealer).total === 21);
  check('18 מול 21 = הפסד', t.hands[0].result === 'lose' && t.bankroll === 900);
  check('סיבוב נגמר', t.phase === 'done');
}

{
  const t = rigged('T 9 9 8');
  t.deal(100);
  t.act('stand'); // 19 מול 17
  check('19 מול 17 = ניצחון 1:1', t.hands[0].result === 'win' && t.bankroll === 1100);
  check('lastNet = 100', t.lastNet === 100);
}

{
  const t = rigged('T 9 7 8');
  t.deal(100);
  t.act('stand');
  check('17 מול 17 = תיקו', t.hands[0].result === 'push' && t.bankroll === 1000);
}

{
  const t = rigged('A 9 K 7');
  t.deal(100);
  check('בלאקג׳ק נגמר מיד, בלי תור שחקן', t.phase === 'done');
  check('בלאקג׳ק משלם 3:2', t.hands[0].result === 'blackjack' && t.bankroll === 1150);
  check('הדילר לא מושך מול בלאקג׳ק', t.dealer.length === 2);
}

{
  const t = rigged('A 9 K 7', { level: 4, bankroll: 1000 });
  t.deal(100);
  check('ברמה 4 בלאקג׳ק משלם 6:5', t.bankroll === 1120);
}

{
  const t = rigged('T 6 8 5 9'); // 18 מול 11, והשחקן מושך 9
  t.deal(100);
  t.act('hit'); // שחקן מקבל 9 → 27
  check('מעל 21 = שרוף, הסיבוב נגמר', t.hands[0].result === 'bust' && t.phase === 'done');
  check('הדילר לא מושך כששרפת', t.dealer.length === 2);
}

{
  const t = rigged('T 6 6 T 8'); // שחקן 16, דילר 16, הדילר מושך 8 = 24
  t.deal(100);
  t.act('stand');
  check('הדילר שורף = ניצחון', t.hands[0].result === 'win' && t.bankroll === 1100);
}

section('17 רך');

{
  const s17 = rigged('T 6 8 A 5', { level: 1 });
  s17.deal(100);
  s17.act('stand');
  check('רמה 1: הדילר עומד על 17 רך', s17.dealer.length === 2);
  const h17 = rigged('T 6 8 A 3', { level: 3 });
  h17.deal(100);
  h17.act('stand');
  check('רמה 3: הדילר מושך על 17 רך', h17.dealer.length === 3 && BJ.handValue(h17.dealer).total === 20);
}

section('הכפלה');

{
  const t = rigged('6 9 5 7 T 4');
  t.deal(100); // 11 מול 9
  check('אפשר להכפיל על שני קלפים', t.allowed().double);
  t.act('double'); // מקבל T = 21; דילר 9+7=16 +4 = 20
  check('הכפלה מקבלת קלף אחד בלבד', t.hands[0].cards.length === 3);
  check('ההימור הוכפל ונוצח', t.hands[0].bet === 200 && t.bankroll === 1200);
}

{
  const t = rigged('6 9 5 7 2');
  t.deal(100);
  t.act('hit');
  check('אי אפשר להכפיל אחרי קלף שלישי', !t.allowed().double);
}

{
  const t = rigged('6 9 5 7', { bankroll: 150 });
  t.deal(100);
  check('אי אפשר להכפיל בלי מספיק כסף', !t.allowed().double);
}

section('פיצול');

{
  const t = rigged('8 T 8 7 3 2 T'); // 8,8 מול 17; ידיים: 8+3 (+2 בהכפלה), ואז 8+T
  t.deal(100);
  check('זוג אפשר לפצל', t.allowed().split);
  check('לפני פיצול יש כניעה', t.allowed().surrender);
  t.act('split');
  check('שתי ידיים', t.hands.length === 2);
  check('היד הראשונה קיבלה קלף שני', t.hands[0].cards.length === 2);
  check('השנייה מחכה לתורה', t.hands[1].cards.length === 1);
  check('נלקח הימור נוסף', t.bankroll === 800);
  check('אין כניעה אחרי פיצול', !t.allowed().surrender);
  check('הכפלה אחרי פיצול מותרת ברמה 1', t.allowed().double);
  t.act('double'); // 8+3+2 = 13
  check('אחרי הכפלה עוברים ליד השנייה, שמקבלת קלף', t.active === 1 && t.hands[1].cards.length === 2);
  t.act('stand'); // 18 מול 17 (10+7)
  check('שתי ידיים שולמו בנפרד', t.hands[0].result === 'lose' && t.hands[1].result === 'win');
  check('קופה: 1000 − 300 + 200 = 900', t.bankroll === 900 && t.lastNet === -100);
}

{
  const t = rigged('A T A 7 K Q');
  t.deal(100);
  t.act('split');
  check('אסים מפוצלים: קלף אחד לכל יד והסיבוב נגמר', t.phase === 'done' &&
    t.hands.every((h) => h.cards.length === 2));
  check('21 אחרי פיצול אסים אינו בלאקג׳ק (משלם 1:1)', t.hands[0].result === 'win' && t.bankroll === 1200);
}

{
  const t = rigged('8 9 8 7 8 8 8 8 8 8 8', { bankroll: 5000, level: 2 });
  t.deal(100);
  t.act('split');
  t.act('split');
  t.act('split');
  check('עד 4 ידיים', t.hands.length === 4 && !t.allowed().split);
}

{
  const t = rigged('8 T 8 7 3', { level: 4 });
  t.deal(100);
  t.act('split');
  check('ברמה 4 אין הכפלה אחרי פיצול', !t.allowed().double);
}

section('כניעה');

{
  const t = rigged('T T 6 7');
  t.deal(100);
  t.act('surrender');
  check('כניעה מחזירה חצי', t.hands[0].result === 'surrender' && t.bankroll === 950);
  const t4 = rigged('T T 6 7', { level: 4 });
  t4.deal(100);
  check('ברמה 4 אין כניעה', !t4.allowed().surrender);
}

section('ביטוח והצצה');

{
  const t = rigged('T A 9 K');
  t.deal(100);
  check('אס גלוי אצל הדילר = הצעת ביטוח', t.phase === 'insurance');
  t.resolveInsurance(true);
  check('ביטוח מול בלאקג׳ק של הדילר: ההפסד מתקזז', t.phase === 'done' && t.bankroll === 1000);
}

{
  const t = rigged('T A 9 7');
  t.deal(100);
  t.resolveInsurance(true);
  check('ביטוח בלי בלאקג׳ק לדילר: מפסידים את הביטוח וממשיכים', t.phase === 'player' && t.bankroll === 850);
}

{
  const t = rigged('T K 9 A');
  t.deal(100);
  check('10 גלוי עם בלאקג׳ק: הדילר מציץ והסיבוב נגמר', t.phase === 'done' && t.hands[0].result === 'lose');
}

{
  const t = rigged('A K K A');
  t.deal(100);
  check('בלאקג׳ק מול בלאקג׳ק = תיקו', t.phase === 'done' && t.hands[0].result === 'push' && t.bankroll === 1000);
}

section('אסטרטגיה בסיסית');

{
  const s17 = { h17: false, das: true };
  const h17 = { h17: true, das: true };
  const all = { double: true, split: true, surrender: true };
  const none = {};
  const a = (hand, up, rules, allowed) => BJ.advise(cards(hand), card(up), rules || s17, allowed || all);

  check('16 מול 10 = כניעה', a('T 6', 'T') === 'surrender');
  check('16 מול 10 בלי כניעה = קלף', a('T 6', 'T', s17, none) === 'hit');
  check('16 מול 6 = עומד', a('T 6', '6') === 'stand');
  check('12 מול 2 = קלף', a('T 2', '2') === 'hit');
  check('12 מול 4 = עומד', a('T 2', '4') === 'stand');
  check('11 מול 6 = הכפלה', a('6 5', '6') === 'double');
  check('11 מול A ב-S17 = קלף', a('6 5', 'A') === 'hit');
  check('11 מול A ב-H17 = הכפלה', a('6 5', 'A', h17) === 'double');
  check('10 מול 10 = קלף', a('6 4', 'T') === 'hit');
  check('9 מול 3 = הכפלה', a('5 4', '3') === 'double');
  check('A,7 מול 9 = קלף', a('A 7', '9') === 'hit');
  check('A,7 מול 4 = הכפלה', a('A 7', '4') === 'double');
  check('A,7 מול 4 בלי הכפלה = עומד', a('A 7', '4', s17, { split: true }) === 'stand');
  check('A,7 מול 2 ב-S17 = עומד', a('A 7', '2') === 'stand');
  check('A,7 מול 2 ב-H17 = הכפלה', a('A 7', '2', h17) === 'double');
  check('A,8 מול 6 ב-H17 = הכפלה', a('A 8', '6', h17) === 'double');
  check('A,8 מול 6 ב-S17 = עומד', a('A 8', '6') === 'stand');
  check('8,8 מול A = פיצול', a('8 8', 'A') === 'split');
  check('8,8 מול A ב-H17 = כניעה', a('8 8', 'A', h17) === 'surrender');
  check('A,A = פיצול', a('A A', '6') === 'split');
  check('A,A כשאי אפשר לפצל = קלף', a('A A', '6', s17, { double: true }) === 'hit');
  check('T,T = עומד', a('K Q', '6') === 'stand');
  check('5,5 מול 6 = הכפלה ולא פיצול', a('5 5', '6') === 'double');
  check('9,9 מול 7 = עומד', a('9 9', '7') === 'stand');
  check('9,9 מול 8 = פיצול', a('9 9', '8') === 'split');
  check('4,4 מול 5 = פיצול (עם DAS)', a('4 4', '5') === 'split');
  check('4,4 מול 5 בלי DAS = קלף (8 קשה)', a('4 4', '5', { h17: true, das: false }) === 'hit');
  check('2,2 מול 2 בלי DAS = קלף', a('2 2', '2', { h17: true, das: false }) === 'hit');
  check('17 מול A ב-H17 = כניעה', a('T 7', 'A', h17) === 'surrender');
  check('17 מול A ב-H17 בלי כניעה = עומד', a('T 7', 'A', h17, none) === 'stand');
  check('18 קשה = עומד תמיד', a('T 8', 'A', h17) === 'stand');
  check('13 משלושה קלפים מול 2 = עומד', a('5 4 4', '2', s17, none) === 'stand');
  check('A,2,2 (15 רך) מול 5 בלי הכפלה = קלף', a('A 2 2', '5', s17, none) === 'hit');
}

section('הדמיה ארוכה — החשבון תמיד מתאזן');

for (const level of [1, 2, 3, 4]) {
  const rng = seeded(100 + level);
  const t = new BJ.Table({ level, bankroll: 100000, rng });
  let ok = true;
  let rounds = 0;
  let legal = true;
  for (let i = 0; i < 4000; i++) {
    const before = t.bankroll;
    const bet = t.rules.minBet;
    if (!t.deal(bet)) { ok = false; break; }
    if (t.phase === 'insurance') t.resolveInsurance(false);
    let guard = 0;
    while (t.phase === 'player' && guard++ < 30) {
      const move = t.advice();
      if (!t.allowed()[move]) legal = false;
      t.act(move);
    }
    if (t.phase !== 'done') { ok = false; break; }
    if (t.bankroll - before !== t.lastNet) { ok = false; break; }
    if (!Number.isInteger(t.bankroll)) { ok = false; break; }
    t.newRound();
    rounds++;
  }
  check('רמה ' + level + ': ' + rounds + ' סיבובים, כל סיבוב מסתיים והקופה תואמת', ok && rounds === 4000);
  check('רמה ' + level + ': ההמלצה תמיד פעולה חוקית', legal);
}

section('שמירה');

{
  const t = rigged('8 T 8 7 3 2 T');
  t.deal(100);
  t.act('split');
  const json = JSON.parse(JSON.stringify(t.toJSON()));
  const r = BJ.Table.fromJSON(json, seeded(9));
  check('שחזור באמצע סיבוב: אותו שלב ואותן ידיים', r.phase === 'player' && r.hands.length === 2 && r.active === 0);
  check('שחזור: אותה קופה', r.bankroll === t.bankroll);
  r.act('double');
  r.act('stand');
  check('אחרי שחזור החפיסה ממשיכה באותו סדר', r.hands[0].result === 'lose' && r.hands[1].result === 'win');
  const broken = BJ.Table.fromJSON({ level: 2, bankroll: 500, phase: 'player', hands: [] });
  check('שמירה פגומה חוזרת לשלב ההימור', broken.phase === 'bet' && broken.bankroll === 500);
}

/* --------------------------------------------------------------------- */

console.log('\n' + passed + ' עברו, ' + failed + ' נכשלו');
process.exit(failed ? 1 : 0);
