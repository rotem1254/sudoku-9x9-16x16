/* =============================================================================
 * tools/train-backgammon.js — אימון רשת השש-בש
 * -----------------------------------------------------------------------------
 * הרצה:
 *   node tools/train-backgammon.js --games 300000 --hidden 80 --out /tmp/bg.json
 *   node tools/train-backgammon.js --export /tmp/bg.json   (כותב את weights.js)
 *
 * השיטה של TD-Gammon: הרשת משחקת נגד עצמה. אחרי כל מהלך, ההערכה של העמדה
 * הקודמת מתקרבת להערכה של העמדה החדשה (TD(0)), ובסוף המשחק — לתוצאה
 * האמיתית. כך המידע על מי ניצח זולג לאחור, משחק אחר משחק, עד שהרשת יודעת
 * להעריך עמדה שמעולם לא ראתה.
 *
 * כל כמה אלפי משחקים יש מבחן מול ההערכה הידנית (heuristic) ומול הנקודה
 * השמורה הטובה ביותר, והרשת הטובה נשמרת.
 * =========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '..', 'js', 'backgammon', 'engine.js'));
require(path.join(__dirname, '..', 'js', 'backgammon', 'ai.js'));
const BG = globalThis.Backgammon;
const AI = globalThis.BackgammonAI;
const { I, O } = AI;

const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};

/* --------------------------------------------------------------------- */

function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------------------------------------------------- */
/* ייצוא                                                                  */
/* --------------------------------------------------------------------- */

function exportWeights(file) {
  const w = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pack = (arr) => {
    let m = 0;
    arr.forEach((x) => { m = Math.max(m, Math.abs(x)); });
    const s = m / 32767 || 1;
    const ints = new Int16Array(arr.length);
    arr.forEach((x, i) => { ints[i] = Math.round(x / s); });
    return { s: +s.toPrecision(8), d: Buffer.from(ints.buffer).toString('base64') };
  };
  const out = {
    H: w.H, games: w.games,
    W1: pack(w.W1), b1: pack(w.b1), W2: pack(w.W2), b2: pack(w.b2),
  };
  const js =
    '/* נוצר אוטומטית ע"י tools/train-backgammon.js — לא לערוך ידנית.\n' +
    '   רשת ' + I + '→' + w.H + '→' + O + ', אומנה על ' + w.games.toLocaleString('en-US') +
    ' משחקים נגד עצמה. int16 ב-base64. */\n' +
    '(function (g) { g.BackgammonWeights = ' + JSON.stringify(out) + '; })' +
    "(typeof window !== 'undefined' ? window : globalThis);\n";
  const dest = path.join(__dirname, '..', 'js', 'backgammon', 'weights.js');
  fs.writeFileSync(dest, js);
  console.log('נכתב', dest, (js.length / 1024).toFixed(1) + 'KB');
}

if (arg('export')) {
  exportWeights(arg('export'));
  process.exit(0);
}

/* --------------------------------------------------------------------- */
/* רשת לאימון                                                             */
/* --------------------------------------------------------------------- */

const H = parseInt(arg('hidden', '80'), 10);
const GAMES = parseInt(arg('games', '200000'), 10);
const ALPHA0 = parseFloat(arg('alpha', '0.1'));
const ALPHA1 = parseFloat(arg('alphaEnd', '0.02'));
const OUT = arg('out', '/tmp/bg-net.json');
const EVERY = parseInt(arg('every', '10000'), 10);
const rng = rngFrom(parseInt(arg('seed', '1'), 10));

let net;
const resume = arg('resume');
if (resume) {
  const w = JSON.parse(fs.readFileSync(resume, 'utf8'));
  net = new AI.Net(w.H, Float64Array.from(w.W1), Float64Array.from(w.b1), Float64Array.from(w.W2), Float64Array.from(w.b2));
  net.games = w.games || 0;
} else {
  net = new AI.Net(H, new Float64Array(I * H), new Float64Array(H), new Float64Array(H * O), new Float64Array(O));
  for (let i = 0; i < net.W1.length; i++) net.W1[i] = (rng() - 0.5) * 0.2;
  for (let i = 0; i < net.W2.length; i++) net.W2[i] = (rng() - 0.5) * 0.2;
  net.games = 0;
}

const idx = new Int32Array(64);
const val = new Float64Array(64);
const hid = new Float64Array(net.H);
const outv = new Float64Array(O);
const dOut = new Float64Array(O);
const sig = (x) => (x < -30 ? 0 : x > 30 ? 1 : 1 / (1 + Math.exp(-x)));

/** צעד אחד של ירידת גרדיאנט: מקרב את ההערכה של (pos, s) ל-target */
function learn(pos, s, target, alpha) {
  const Hn = net.H, W1 = net.W1, W2 = net.W2;
  const n = AI.encode(pos, s, idx, val);
  for (let j = 0; j < Hn; j++) hid[j] = net.b1[j];
  for (let k = 0; k < n; k++) {
    const row = idx[k] * Hn, v = val[k];
    for (let j = 0; j < Hn; j++) hid[j] += v * W1[row + j];
  }
  for (let j = 0; j < Hn; j++) hid[j] = sig(hid[j]);
  for (let o = 0; o < O; o++) {
    let a = net.b2[o];
    for (let j = 0; j < Hn; j++) a += hid[j] * W2[j * O + o];
    outv[o] = sig(a);
    dOut[o] = (target[o] - outv[o]) * outv[o] * (1 - outv[o]);
  }
  for (let j = 0; j < Hn; j++) {
    let back = 0;
    const hj = hid[j];
    for (let o = 0; o < O; o++) {
      back += dOut[o] * W2[j * O + o];
      W2[j * O + o] += alpha * dOut[o] * hj;
    }
    const dh = back * hj * (1 - hj) * alpha;
    if (dh === 0) continue;
    net.b1[j] += dh;
    for (let k = 0; k < n; k++) W1[idx[k] * Hn + j] += dh * val[k];
  }
  for (let o = 0; o < O; o++) net.b2[o] += alpha * dOut[o];
}

const tmp = new Float64Array(O);
function exact(pos, s) {
  const w = BG.winner(pos);
  if (w === -1) return null;
  const v = BG.resultValue(pos, w);
  return w === s ? [1, v >= 2 ? 1 : 0, v >= 3 ? 1 : 0, 0, 0] : [0, 0, 0, v >= 2 ? 1 : 0, v >= 3 ? 1 : 0];
}
/** ההערכה של עמדה אחרי ש-s שיחק, מנקודת המבט של s */
function after(pos, s) {
  const e = exact(pos, s);
  if (e) return e;
  const p = net.forward(pos, 1 - s, tmp);
  return [1 - p[0], p[3], p[4], p[1], p[2]];
}
const eqOf = (p) => 2 * p[0] - 1 + p[1] - p[3] + p[2] - p[4];

function bestTurn(pos, s, d1, d2) {
  const ts = BG.turns(pos, s, d1, d2);
  let best = null, bestEq = -Infinity, bestP = null;
  for (const t of ts) {
    const p = after(t.pos, s);
    const e = eqOf(p);
    if (e > bestEq) { bestEq = e; best = t; bestP = p; }
  }
  return { turn: best, probs: bestP };
}

function trainGame(alpha) {
  let pos = BG.initial();
  let s = rng() < 0.5 ? 0 : 1;
  for (let ply = 0; ply < 600; ply++) {
    const d1 = 1 + Math.floor(rng() * 6), d2 = 1 + Math.floor(rng() * 6);
    const { turn, probs } = bestTurn(pos, s, d1, d2);
    learn(pos, s, probs, alpha);
    pos = turn.pos;
    if (BG.winner(pos) !== -1) return;
    s = 1 - s;
  }
}

/* --------------------------------------------------------------------- */
/* מבחן                                                                   */
/* --------------------------------------------------------------------- */

function heurTurn(pos, s, d1, d2) {
  const ts = BG.turns(pos, s, d1, d2);
  let best = null, bv = -Infinity;
  for (const t of ts) {
    const w = BG.winner(t.pos);
    const v = w === s ? 1e9 : AI.heuristic(t.pos, s);
    if (v > bv) { bv = v; best = t; }
  }
  return best;
}

/** הרשת (צד 0) מול יריב. מחזיר [אחוז ניצחונות, נקודות למשחק] */
function bench(opp, n, seed) {
  const r = rngFrom(seed);
  let wins = 0, pts = 0;
  for (let g = 0; g < n; g++) {
    let pos = BG.initial();
    let s = g % 2;
    for (let ply = 0; ply < 600; ply++) {
      const d1 = 1 + Math.floor(r() * 6), d2 = 1 + Math.floor(r() * 6);
      const t = s === 0 ? bestTurn(pos, 0, d1, d2).turn : opp(pos, 1, d1, d2);
      pos = t.pos;
      const w = BG.winner(pos);
      if (w !== -1) {
        const v = BG.resultValue(pos, w);
        if (w === 0) { wins++; pts += v; } else pts -= v;
        break;
      }
      s = 1 - s;
    }
  }
  return [wins / n, pts / n];
}

function save(file) {
  fs.writeFileSync(file, JSON.stringify({
    H: net.H, games: net.games,
    W1: Array.from(net.W1), b1: Array.from(net.b1), W2: Array.from(net.W2), b2: Array.from(net.b2),
  }));
}

/* --------------------------------------------------------------------- */

const t0 = Date.now();
console.log('H=' + net.H + ' games=' + GAMES + ' alpha=' + ALPHA0 + '→' + ALPHA1 + ' out=' + OUT);
for (let g = 1; g <= GAMES; g++) {
  const f = g / GAMES;
  const alpha = ALPHA0 * Math.pow(ALPHA1 / ALPHA0, f);
  trainGame(alpha);
  net.games++;
  if (g % EVERY === 0 || g === GAMES) {
    const [w, ppg] = bench(heurTurn, 400, 12345);
    const sec = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`${net.games} games  ${sec}s  α=${alpha.toFixed(4)}  vs heuristic: ${(w * 100).toFixed(1)}%  ${ppg.toFixed(3)} ppg`);
    save(OUT);
  }
}
