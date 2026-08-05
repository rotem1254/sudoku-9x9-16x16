/* =============================================================================
 * test/test-rummikub.js — בדיקות למנוע רמי קוב
 * -----------------------------------------------------------------------------
 *     node test/test-rummikub.js
 * =========================================================================== */
'use strict';

const path = require('path');
require(path.join(__dirname, '..', 'js', 'rummikub', 'engine.js'));
require(path.join(__dirname, '..', 'js', 'rummikub', 'ai.js'));

const Rummikub = globalThis.Rummikub;
const T = globalThis.RummikubTiles;
const AI = globalThis.RummikubAI;

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name); }
};
const section = (t) => console.log('\n' + t);

/** קיצור: אבן לפי צבע ומספר. c=0 שחור, 1 אדום, 2 כחול, 3 כתום. */
const t = (c, n, copy) => T.makeTile(c, n, copy);
const J = T.JOKER;

/* --------------------------------------------------------------------- */

section('אבנים וחפיסה');

const deck = T.fullDeck();
check('106 אבנים בחפיסה', deck.length === 106);
check('2 ג\'וקרים', deck.filter(T.isJoker).length === 2);
check('104 אבנים ממוספרות', deck.filter((x) => !T.isJoker(x)).length === 104);

const numbered = deck.filter((x) => !T.isJoker(x));
check('כל אבן ממוספרת ייחודית', new Set(numbered).size === 104);

// שני עותקים מכל שילוב צבע+מספר
let pairsOk = true;
for (let c = 0; c < 4; c++) {
  for (let n = 1; n <= 13; n++) {
    const found = numbered.filter((x) => T.tileColorIndex(x) === c && T.tileNumber(x) === n);
    if (found.length !== 2) pairsOk = false;
  }
}
check('שני עותקים לכל צבע+מספר', pairsOk);

check('פענוח אבן',
  T.tileColor(t(1, 7)) === 'red' && T.tileNumber(t(1, 7)) === 7 &&
  T.tileColor(t(3, 13)) === 'orange' && T.tileNumber(t(3, 13)) === 13);
check('שני העותקים נבדלים זה מזה', t(0, 5, 0) !== t(0, 5, 1));
check('לשני העותקים אותו צבע ומספר',
  T.tileNumber(t(0, 5, 0)) === T.tileNumber(t(0, 5, 1)) &&
  T.tileColor(t(0, 5, 0)) === T.tileColor(t(0, 5, 1)));
check('תווית ג\'וקר', T.tileLabel(J) === '★' && T.tileLabel(t(2, 9)) === '9');

/* --------------------------------------------------------------------- */

section('קבוצה — אותו מספר, צבעים שונים');

check('שלושה צבעים שונים', T.isGroup([t(0, 7), t(1, 7), t(2, 7)]));
check('ארבעה צבעים שונים', T.isGroup([t(0, 7), t(1, 7), t(2, 7), t(3, 7)]));
check('שתי אבנים — קצר מדי', !T.isGroup([t(0, 7), t(1, 7)]));
check('חמש אבנים — ארוך מדי (רק 4 צבעים)',
  !T.isGroup([t(0, 7), t(1, 7), t(2, 7), t(3, 7), t(0, 7, 1)]));
check('צבע כפול — פסול', !T.isGroup([t(0, 7), t(0, 7, 1), t(1, 7)]));
check('מספרים שונים — פסול', !T.isGroup([t(0, 7), t(1, 8), t(2, 7)]));
check('קבוצה עם ג\'וקר', T.isGroup([t(0, 9), t(1, 9), J]));
check('קבוצה של 4 עם ג\'וקר', T.isGroup([t(0, 9), t(1, 9), t(2, 9), J]));
check('ג\'וקר בלי מקום לצבע — פסול',
  !T.isGroup([t(0, 9), t(1, 9), t(2, 9), t(3, 9), J]));
check('שני ג\'וקרים בקבוצה', T.isGroup([t(0, 4), J, J]));
check('ג\'וקרים בלבד — אינו צירוף', !T.isGroup([J, J]));

/* --------------------------------------------------------------------- */

section('סדרה — אותו צבע, מספרים עוקבים');

check('שלושה עוקבים', T.isRun([t(2, 4), t(2, 5), t(2, 6)]));
check('סדרה ארוכה', T.isRun([t(1, 1), t(1, 2), t(1, 3), t(1, 4), t(1, 5)]));
check('סדר קלט לא ממוין עדיין תקין', T.isRun([t(2, 6), t(2, 4), t(2, 5)]));
check('שתי אבנים — קצר מדי', !T.isRun([t(2, 4), t(2, 5)]));
check('צבעים מעורבים — פסול', !T.isRun([t(2, 4), t(1, 5), t(2, 6)]));
check('פער בלי ג\'וקר — פסול', !T.isRun([t(2, 4), t(2, 6), t(2, 7)]));
check('אותה אבן פעמיים — פסול', !T.isRun([t(2, 4), t(2, 4, 1), t(2, 5)]));

check('ג\'וקר סוגר פער באמצע', T.isRun([t(2, 4), J, t(2, 6)]));
check('ג\'וקר בקצה', T.isRun([t(2, 4), t(2, 5), J]));
check('שני ג\'וקרים בשני פערים', T.isRun([t(2, 3), J, t(2, 5), J, t(2, 7)]));
// 12,13 + שני ג'וקרים = 10-11-12-13, הג'וקרים יורדים למטה
check("ג'וקרים בקצה יורדים למטה כשאין מקום למעלה",
  T.isRun([t(2, 12), t(2, 13), J, J]));
check("פער גדול מדי לג'וקר אחד — פסול", !T.isRun([t(2, 1), t(2, 13), J]));
check('סדרה ארוכה מ-13 — פסול',
  !T.isRun([1,2,3,4,5,6,7,8,9,10,11,12,13].map((n) => t(2, n)).concat([J])));
check('12-13 עם ג\'וקר אחד למטה', T.isRun([t(2, 12), t(2, 13), J]));
check('1-2-3 חוקי', T.isRun([t(0, 1), t(0, 2), t(0, 3)]));
check('13 לא מתחבר ל-1', !T.isRun([t(0, 12), t(0, 13), t(0, 1)]));

/* --------------------------------------------------------------------- */

section('ניקוד צירוף');

check('קבוצה 7×3 = 21', T.setValue([t(0, 7), t(1, 7), t(2, 7)]) === 21);
check('קבוצה 10×4 = 40', T.setValue([t(0, 10), t(1, 10), t(2, 10), t(3, 10)]) === 40);
check('קבוצה עם ג\'וקר: 9×3 = 27', T.setValue([t(0, 9), t(1, 9), J]) === 27);
check('סדרה 4+5+6 = 15', T.setValue([t(2, 4), t(2, 5), t(2, 6)]) === 15);
check('סדרה עם ג\'וקר בפער: 4+5+6 = 15', T.setValue([t(2, 4), J, t(2, 6)]) === 15);
check('סדרה 11+12+13 = 36', T.setValue([t(1, 11), t(1, 12), t(1, 13)]) === 36);
check('צירוף פסול = 0', T.setValue([t(0, 3), t(1, 8)]) === 0);

// ג'וקר בקצה נדחף כלפי מעלה, כי זה שווה יותר
check('ג\'וקר בקצה נספר בערך הגבוה: 5+6+7 = 18',
  T.setValue([t(2, 5), t(2, 6), J]) === 18);

check('קנס יד: ג\'וקר שווה 30',
  T.rackValue([J, t(0, 5), t(1, 3)]) === 38);

/* --------------------------------------------------------------------- */

section('אימות השולחן');

const goodTable = [
  [t(0, 7), t(1, 7), t(2, 7)],
  [t(2, 4), t(2, 5), t(2, 6)],
];
check('שולחן תקין', T.validateTable(goodTable).ok);

const badTable = [
  [t(0, 7), t(1, 7), t(2, 7)],
  [t(2, 4), t(2, 6)],
];
const bad = T.validateTable(badTable);
check('שולחן עם צירוף פסול נתפס', !bad.ok && bad.badIndex === 1);

/* --------------------------------------------------------------------- */

section('חלוקה');

const g = new Rummikub({ seed: 42, players: 4 });
check('4 מגשים של 14 אבנים',
  g.racks.length === 4 && g.racks.every((r) => r.length === 14));
check('הבריכה מחזיקה את השאר', g.pool.length === 106 - 4 * 14);
check('השולחן ריק', g.table.length === 0);
check('אף אחד עוד לא פתח', g.melded.every((m) => m === false));

const allTiles = [].concat(...g.racks, g.pool, ...g.table);
check('כל 106 האבנים מחולקות', allTiles.length === 106);
check('אותו seed מחלק אותה חלוקה',
  JSON.stringify(new Rummikub({ seed: 7 }).racks) ===
  JSON.stringify(new Rummikub({ seed: 7 }).racks));
check('מספר שחקנים נכפה לטווח 2..4',
  new Rummikub({ seed: 1, players: 9 }).playerCount === 4 &&
  new Rummikub({ seed: 1, players: 1 }).playerCount === 2);

/* --------------------------------------------------------------------- */

section('חוק הפתיחה (30 נקודות)');

/** בונה משחק שבו יד השחקן הראשון ידועה מראש. */
function staged(rack0, table) {
  const game = new Rummikub({ seed: 3, players: 2 });
  const used = rack0.concat(...(table || []));
  const rest = T.fullDeck().filter((x) => {
    const i = used.indexOf(x);
    if (i >= 0) { used.splice(i, 1); return false; }
    return true;
  });
  game.racks[0] = rack0.slice();
  game.racks[1] = rest.splice(0, 14);
  game.table = (table || []).map((s) => s.slice());
  game.pool = rest;
  game.turn = 0;
  game.melded = [false, false];
  return game;
}

// 11+12+13 = 36 -> פתיחה חוקית
const openOk = staged([t(1, 11), t(1, 12), t(1, 13), t(0, 2), t(3, 5)]);
const r1 = openOk.commitTurn(
  [[t(1, 11), t(1, 12), t(1, 13)]],
  [t(0, 2), t(3, 5)]
);
check('פתיחה של 36 מתקבלת', r1.ok);
check('השחקן סומן כמי שפתח', openOk.melded[0] === true);
check('התור עבר', openOk.turn === 1);

// 1+2+3 = 6 -> נמוך מדי
const openLow = staged([t(1, 1), t(1, 2), t(1, 3), t(0, 2), t(3, 5)]);
const r2 = openLow.commitTurn([[t(1, 1), t(1, 2), t(1, 3)]], [t(0, 2), t(3, 5)]);
check('פתיחה של 6 נדחית', !r2.ok && r2.reason === 'meld-too-low');
check('אחרי דחייה השחקן עדיין לא פתח', openLow.melded[0] === false);
check('אחרי דחייה השולחן לא השתנה', openLow.table.length === 0);

// אסור להיעזר באבנים שכבר על השולחן בפתיחה
const existing = [[t(0, 7), t(1, 7), t(2, 7)]];
const leaning = staged([t(3, 7), t(0, 2), t(3, 5)], existing);
const r3 = leaning.commitTurn(
  [[t(0, 7), t(1, 7), t(2, 7), t(3, 7)]],
  [t(0, 2), t(3, 5)]
);
check('פתיחה שנשענת על השולחן נדחית',
  !r3.ok && (r3.reason === 'meld-too-low' || r3.reason === 'meld-touches-table'));

// אחרי שפתח — מותר להשתמש בשולחן
const after = staged([t(3, 7), t(0, 2)], existing);
after.melded = [true, false];
const r4 = after.commitTurn([[t(0, 7), t(1, 7), t(2, 7), t(3, 7)]], [t(0, 2)]);
check('אחרי פתיחה מותר להוסיף לצירוף קיים', r4.ok);

/* --------------------------------------------------------------------- */

section('שלמות התור');

const cheat = staged([t(1, 11), t(1, 12), t(1, 13), t(0, 2)]);
// מנסים להמציא אבן שלא הייתה ביד
const r5 = cheat.commitTurn([[t(1, 11), t(1, 12), t(1, 13)], [t(2, 5), t(2, 6), t(2, 7)]], [t(0, 2)]);
check('אבנים שלא היו ביד נדחות', !r5.ok && r5.reason === 'tiles-mismatch');

const r6 = cheat.commitTurn([[t(1, 11), t(1, 12)]], [t(1, 13), t(0, 2)]);
check('צירוף פסול על השולחן נדחה', !r6.ok && r6.reason === 'invalid-set');

const r7 = cheat.commitTurn([], [t(1, 11), t(1, 12), t(1, 13), t(0, 2)]);
check('תור בלי הנחה נדחה', !r7.ok && r7.reason === 'nothing-placed');

/* --------------------------------------------------------------------- */

section('משיכה וסיום');

const dr = new Rummikub({ seed: 11, players: 2 });
const poolBefore = dr.pool.length;
const rackBefore = dr.racks[0].length;
const d = dr.drawTile();
check('משיכה מוסיפה אבן ליד',
  d.ok && dr.racks[0].length === rackBefore + 1 && dr.pool.length === poolBefore - 1);
check('משיכה מעבירה תור', dr.turn === 1);

const empty = new Rummikub({ seed: 12, players: 2 });
empty.pool = [];
const d2 = empty.drawTile();
check('בריכה ריקה — התור עובר בלי משיכה', d2.ok && d2.empty && empty.turn === 1);

// ניצחון: מרוקנים את היד
const win = staged([t(1, 11), t(1, 12), t(1, 13)]);
const rw = win.commitTurn([[t(1, 11), t(1, 12), t(1, 13)]], []);
check('ריקון היד מסיים את המשחק', rw.ok && rw.won && win.finished && win.winner === 0);

const scores = win.finalScores();
check('המנצח מקבל את סכום הקנסות',
  scores[0] === T.rackValue(win.racks[1]) && scores[1] === -T.rackValue(win.racks[1]));

/* --------------------------------------------------------------------- */

section('שמירה ושחזור');

const sv = new Rummikub({ seed: 99, players: 3 });
sv.drawTile();
const round = Rummikub.deserialize(JSON.parse(JSON.stringify(sv.serialize())));
check('סריאליזציה שומרת על המצב',
  round &&
  JSON.stringify(round.racks) === JSON.stringify(sv.racks) &&
  JSON.stringify(round.pool) === JSON.stringify(sv.pool) &&
  round.turn === sv.turn && round.playerCount === 3);
check('מצב פגום מוחזר כ-null', Rummikub.deserialize({ junk: 1 }) === null);

/* --------------------------------------------------------------------- */

section('שלמות אחרי סדרת משיכות');

let intact = true;
for (let trial = 0; trial < 20; trial++) {
  const game = new Rummikub({ seed: trial * 13 + 5, players: 4 });
  for (let i = 0; i < 60; i++) {
    game.drawTile();
    const tiles = [].concat(...game.racks, game.pool, ...game.table);
    if (tiles.length !== 106) { intact = false; break; }
  }
  if (!intact) break;
}
check('106 אבנים נשמרות לאורך 20 משחקים', intact);

/* --------------------------------------------------------------------- */

section('מסירות ותיקו');

const stale = new Rummikub({ seed: 4, players: 2 });
stale.pool = [];
stale.drawTile();
check('מסירה ראשונה אינה מסיימת', !stale.finished && stale.passes === 1);
stale.drawTile();
check('כשכל השחקנים מסרו — המשחק נגמר', stale.finished && stale.passes >= 2);
check('מנצח התיקו הוא בעל היד הזולה',
  T.rackValue(stale.racks[stale.winner]) ===
  Math.min(...stale.racks.map((r) => T.rackValue(r))));

const notStale = new Rummikub({ seed: 4, players: 2 });
notStale.drawTile();
check('משיכה אמיתית מאפסת את מונה המסירות', notStale.passes === 0);

/* --------------------------------------------------------------------- */

section('היריב הממוחשב');

const perfect = [t(0,7), t(1,7), t(2,7), t(2,4), t(2,5), t(2,6)];
const pk = AI.bestPacking(perfect);
check('פתרן מוצא את שני הצירופים', pk.used === 6 && pk.sets.length === 2);
check('הערך מחושב נכון (21+15)', pk.value === 36);

const junk = [t(0,1), t(1,4), t(2,9), t(3,12)];
check('יד בלי צירוף — אין מה להניח', AI.bestPacking(junk).used === 0);

const low = [t(0,1), t(1,1), t(2,1)];
check('פתרון מתחת לסף הפתיחה נדחה',
  AI.bestPacking(low, { minValue: 30 }).sets.length === 0);
check('אותו פתרון מתקבל בלי סף', AI.bestPacking(low).used === 3);

const ext = AI.extendTable([[t(0,7), t(1,7), t(2,7)]], [t(3,7), t(0,2)]);
check('extendTable מוסיף צבע רביעי',
  ext.placed.length === 1 && ext.table[0].length === 4 && ext.rack.length === 1);
check('extendTable אינו נוגע במה שלא מתאים', ext.rack[0] === t(0,2));

const bigRack = new Rummikub({ seed: 5, players: 2 });
for (let i = 0; i < 20; i++) bigRack.racks[0].push(bigRack.pool.pop());
const tAI = Date.now();
AI.bestPacking(bigRack.racks[0]);
const aiMs = Date.now() - tAI;
check(`פתרן על יד של ${bigRack.racks[0].length} אבנים ב-${aiMs}ms`, aiMs < 500);

/* --------------------------------------------------------------------- */

section('משחקים מלאים בין יריבים');

let finished = 0;
let integrity = true;
let legalTables = true;
let maxTurns = 0;

for (let s = 0; s < 25; s++) {
  const game = new Rummikub({ seed: s * 31 + 11, players: s % 3 === 0 ? 3 : 2 });
  let turns = 0;
  while (!game.finished && turns < 500) { AI.playTurn(game); turns++; }
  maxTurns = Math.max(maxTurns, turns);
  if (game.finished) finished++;

  const tiles = [].concat(...game.racks, game.pool, ...game.table);
  if (tiles.length !== 106) integrity = false;
  if (tiles.filter((x) => T.isJoker(x)).length !== 2) integrity = false;
  if (new Set(tiles.filter((x) => !T.isJoker(x))).size !== 104) integrity = false;
  if (!T.validateTable(game.table).ok) legalTables = false;
}

check(`כל 25 המשחקים הסתיימו (מקס ${maxTurns} תורות)`, finished === 25);
check('106 אבנים נשמרות בכל משחק', integrity);
check('השולחן נשאר חוקי לאורך כל משחק', legalTables);

/* --------------------------------------------------------------------- */

console.log(`\n${passed} עברו, ${failed} נכשלו`);
process.exit(failed ? 1 : 0);
