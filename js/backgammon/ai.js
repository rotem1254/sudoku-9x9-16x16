/* =============================================================================
 * backgammon/ai.js — היריב הממוחשב
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM.
 *
 * הלב הוא רשת נוירונים קטנה, בשיטה של TD-Gammon: היא אומנה על מאות אלפי
 * משחקים שבהם שיחקה נגד עצמה (tools/train-backgammon.js), ולמדה לבד
 * להעריך עמדה. המשקלים יושבים ב-weights.js.
 *
 * הקלט: לכל צד, לכל נקודה, ארבע יחידות (יש ≥1, ≥2, ≥3, ועוד (n-3)/2),
 * ועוד הבר, היוצאים, דגל "יש מגע" והפרש הפיפס. הפלט — חמש הסתברויות
 * מנקודת המבט של מי שעומד להטיל: ניצחון, ניצחון בגמון, ניצחון בבקגמון,
 * הפסד בגמון, הפסד בבקגמון.
 *
 * בחירת מהלך:
 *   עומק 1 — כל תור חוקי מוערך ע"י הרשת, והטוב ביותר נבחר.
 *   עומק 2 — המועמדים הטובים נבדקים שוב: לכל אחת מ-21 ההטלות של היריב
 *            מוצאים את התשובה הטובה שלו, וממצעים. זה מה שמבדיל בין
 *            "נראה טוב" לבין "באמת טוב" — למשל אבן חשופה שרק נראית בטוחה.
 *
 * הרמות נבדלות בעומק וב"רעש" שמתווסף להערכה — רעש גדול = טעויות של מתחיל.
 * =========================================================================== */
(function (global) {
  'use strict';

  const BG = global.Backgammon;
  const I = 198;
  const O = 5;

  /* --------------------------------------------------------------------- */
  /* קידוד העמדה                                                            */
  /* --------------------------------------------------------------------- */

  /**
   * מקודד את העמדה מנקודת המבט של s (שעומד להטיל) לקלט דליל.
   * הרוב המוחלט של 198 הקלטים הם אפס, ולכן נשמרים רק האחרים —
   * זה מאיץ את השכבה הראשונה פי 5–6.
   * @returns {number} כמה קלטים לא-אפס נכתבו ל-idx/val
   */
  function encode(pos, s, idx, val) {
    let n = 0;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? s : 1 - s;
      const b = side * 25;
      const off = k * 98;
      for (let i = 0; i < 24; i++) {
        const c = pos[b + i];
        if (!c) continue;
        const u = off + i * 4;
        idx[n] = u; val[n++] = 1;
        if (c >= 2) { idx[n] = u + 1; val[n++] = 1; }
        if (c >= 3) { idx[n] = u + 2; val[n++] = 1; }
        if (c > 3) { idx[n] = u + 3; val[n++] = (c - 3) / 2; }
      }
      const bar = pos[b + 24];
      if (bar) { idx[n] = off + 96; val[n++] = bar / 2; }
      const out = BG.offCount(pos, side);
      if (out) { idx[n] = off + 97; val[n++] = out / 15; }
    }
    if (BG.isContact(pos)) { idx[n] = 196; val[n++] = 1; }
    const dp = (BG.pips(pos, 1 - s) - BG.pips(pos, s)) / 50;
    if (dp) { idx[n] = 197; val[n++] = dp; }
    return n;
  }

  /* --------------------------------------------------------------------- */
  /* הרשת                                                                   */
  /* --------------------------------------------------------------------- */

  const sig = (x) => (x < -30 ? 0 : x > 30 ? 1 : 1 / (1 + Math.exp(-x)));

  /**
   * רשת עם שכבה נסתרת אחת. W1 שמור לפי קלט (W1[i*H + j]) כדי שקלט דליל
   * ייגע רק בשורות שלו.
   */
  function Net(H, W1, b1, W2, b2) {
    this.H = H;
    this.W1 = W1 || new Float32Array(I * H);
    this.b1 = b1 || new Float32Array(H);
    this.W2 = W2 || new Float32Array(H * O);
    this.b2 = b2 || new Float32Array(O);
    this._idx = new Int32Array(64);
    this._val = new Float64Array(64);
    this._h = new Float64Array(H);
  }

  /** מחזיר [ני, נג, נב, הג, הב] מנקודת המבט של s שעומד להטיל */
  Net.prototype.forward = function (pos, s, out) {
    const H = this.H, W1 = this.W1, W2 = this.W2, h = this._h;
    const idx = this._idx, val = this._val;
    const n = encode(pos, s, idx, val);
    for (let j = 0; j < H; j++) h[j] = this.b1[j];
    for (let k = 0; k < n; k++) {
      const row = idx[k] * H, v = val[k];
      if (v === 1) for (let j = 0; j < H; j++) h[j] += W1[row + j];
      else for (let j = 0; j < H; j++) h[j] += v * W1[row + j];
    }
    for (let j = 0; j < H; j++) h[j] = sig(h[j]);
    const r = out || new Float64Array(O);
    for (let o = 0; o < O; o++) {
      let a = this.b2[o];
      for (let j = 0; j < H; j++) a += h[j] * W2[j * O + o];
      r[o] = sig(a);
    }
    return r;
  };

  /** טוען משקלים שנשמרו כ-int16 ב-base64 */
  function decode(w) {
    const tensor = (t, n) => {
      const bin = typeof atob === 'function' ? atob(t.d) : Buffer.from(t.d, 'base64').toString('binary');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ints = new Int16Array(bytes.buffer, 0, n);
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = ints[i] * t.s;
      return f;
    };
    const H = w.H;
    return new Net(H, tensor(w.W1, I * H), tensor(w.b1, H), tensor(w.W2, H * O), tensor(w.b2, O));
  }

  let net = null;
  function getNet() {
    if (net === null) {
      net = global.BackgammonWeights ? decode(global.BackgammonWeights) : false;
    }
    return net || null;
  }

  /* --------------------------------------------------------------------- */
  /* מאגר הוצאה — חישוב מדויק כשכל האבנים בבית                              */
  /* --------------------------------------------------------------------- */

  /*
   * כשכל האבנים של שני הצדדים בבית אין יותר מגע, וכל צד פשוט מוציא. אז
   * אפשר לחשב בדיוק: לכל צד, ההתפלגות של מספר ההטלות שיידרשו לו להוציא
   * הכול (כשהוא משחק כדי למזער את התוחלת), והסיכוי לנצח נגזר משתי
   * ההתפלגויות. רשתות נוירונים חלשות דווקא כאן — מרוץ צמוד בסוף הוא עניין
   * של חשבון, לא של "תחושה".
   *
   * עמדה של צד אחד = 6 מספרים (אבנים על 1..6), מקודדים כמספר בבסיס 16.
   * ההתפלגויות מחושבות לפי הצורך ונשמרות, כך שכל עמדה מחושבת פעם אחת.
   */
  const MAXR = 34;
  const boMemo = new Map();

  const P16 = [1, 16, 256, 4096, 65536, 1048576];
  const cnt = (code, i) => (code >> (i * 4)) & 15;

  /** מהלך בודד של אבן מ-i (0..5) בקובייה d: הקוד החדש, או -1 אם אסור */
  function boStep(code, i, d) {
    if (!cnt(code, i)) return -1;
    const to = i - d;
    if (to >= 0) return code - P16[i] + P16[to];
    if (to < -1) for (let j = i + 1; j < 6; j++) if (cnt(code, j)) return -1;
    return code - P16[i];
  }

  /*
   * כל העמדות שאפשר להגיע אליהן בהטלה. בהוצאה טהורה אין חסימות, ולכן כל
   * קובייה תמיד שמישה כל עוד נשארה אבן — אין צורך בחוק "כמה שיותר".
   */
  function boMoves(code, d1, d2) {
    const out = new Set();
    if (d1 !== d2) {
      for (let o = 0; o < 2; o++) {
        const a = o ? d2 : d1, b = o ? d1 : d2;
        for (let i = 5; i >= 0; i--) {
          const c1 = boStep(code, i, a);
          if (c1 < 0) continue;
          if (c1 === 0) { out.add(0); continue; }
          for (let j = 5; j >= 0; j--) {
            const c2 = boStep(c1, j, b);
            if (c2 >= 0) out.add(c2);
          }
        }
      }
      return out;
    }
    const rec = (c, left, maxFrom) => {
      if (!left || c === 0) { out.add(c); return; }
      for (let i = maxFrom; i >= 0; i--) {
        const n = boStep(c, i, d1);
        if (n >= 0) rec(n, left - 1, i);
      }
    };
    rec(code, 4, 5);
    return out;
  }

  /** התפלגות מספר ההטלות עד שהכול בחוץ: dist[n] = P(בדיוק n הטלות) */
  function boDist(code) {
    if (code === 0) {
      const z = new Float64Array(MAXR);
      z[0] = 1;
      z.mean = 0;
      return z;
    }
    let d = boMemo.get(code);
    if (d) return d;
    d = new Float64Array(MAXR);
    let mean = 0;
    for (const [a, b, w] of BG.ROLLS) {
      let best = null;
      boMoves(code, a, b).forEach((r) => {
        const rd = boDist(r);
        if (!best || rd.mean < best.mean) best = rd;
      });
      const pr = w / 36;
      for (let n = 0; n < MAXR - 1; n++) d[n + 1] += pr * best[n];
      mean += pr * (1 + best.mean);
    }
    d.mean = mean;
    boMemo.set(code, d);
    return d;
  }

  function boCode(pos, s) {
    const b = s * 25;
    let code = 0;
    for (let i = 0; i < 6; i++) code |= pos[b + i] << (i * 4);
    return code;
  }

  /** הסתברויות מדויקות במרוץ הוצאה, או null אם העמדה לא כזו */
  function bearoff(pos, s) {
    if (!BG.allHome(pos, 0) || !BG.allHome(pos, 1)) return null;
    /*
     * מאגר מלא ל-15 אבנים לוקח כ-2 שניות לחשב — יותר מדי לתור של מחשב.
     * עד 10 אבנים לצד זה לכל היותר ~150ms בפעם הראשונה (ואחר כך מהזיכרון),
     * ושם בדיוק — בסוף הצמוד — הרשת טועה הכי הרבה
     */
    if (BG.onBoard(pos, 0) > 10 || BG.onBoard(pos, 1) > 10) return null;
    const me = boDist(boCode(pos, s));
    const op = boDist(boCode(pos, 1 - s));
    // אני מטיל ראשון: מנצח אם אני צריך n הטלות והיריב צריך ≥ n
    let tail = 1, win = 0;
    for (let n = 0; n < MAXR; n++) {
      win += me[n] * tail;
      tail -= op[n];
    }
    win = Math.min(1, Math.max(0, win));
    return [win, 0, 0, 0, 0];
  }

  /* --------------------------------------------------------------------- */
  /* הערכה                                                                  */
  /* --------------------------------------------------------------------- */

  /** הסתברויות מנקודת המבט של s, שעומד להטיל. סוף משחק — ערך מדויק. */
  function evaluate(pos, s) {
    const w = BG.winner(pos);
    if (w !== -1) {
      const v = BG.resultValue(pos, w);
      return w === s
        ? [1, v >= 2 ? 1 : 0, v >= 3 ? 1 : 0, 0, 0]
        : [0, 0, 0, v >= 2 ? 1 : 0, v >= 3 ? 1 : 0];
    }
    const n = getNet();
    const bo = bearoff(pos, s);
    if (bo) {
      // גמון אפשרי רק אם מישהו עוד לא הוציא אף אבן — שם נשארים עם הרשת
      if (n && (BG.offCount(pos, 0) === 0 || BG.offCount(pos, 1) === 0)) {
        const p = n.forward(pos, s);
        bo[1] = BG.offCount(pos, 1 - s) === 0 ? Math.min(p[1], bo[0]) : 0;
        bo[3] = BG.offCount(pos, s) === 0 ? Math.min(p[3], 1 - bo[0]) : 0;
      }
      return bo;
    }
    if (!n) return heuristicProbs(pos, s);
    const p = Array.from(n.forward(pos, s));
    return sanitize(p);
  }

  /** הרשת לא יודעת שגמון ⊆ ניצחון; מיישרים כדי שההסתברויות יהיו עקביות */
  function sanitize(p) {
    if (p[1] > p[0]) p[1] = p[0];
    if (p[2] > p[1]) p[2] = p[1];
    if (p[3] > 1 - p[0]) p[3] = 1 - p[0];
    if (p[4] > p[3]) p[4] = p[3];
    // בלי מגע אין גמון אלא אם מישהו עוד לא התחיל להוציא — הרשת מעריכה זאת
    return p;
  }

  /** היפוך נקודת מבט: ההסתברויות של היריב → שלי */
  const flip = (p) => [1 - p[0], p[3], p[4], p[1], p[2]];

  /** שווי צפוי בנקודות (בלי קוביית הכפלה) */
  const equity = (p) => 2 * p[0] - 1 + p[1] - p[3] + p[2] - p[4];

  /** ההערכה של עמדה אחרי ש-s שיחק — כלומר היריב עומד להטיל */
  const afterMove = (pos, s) => flip(evaluate(pos, 1 - s));

  /* --------------------------------------------------------------------- */
  /* הערכה ידנית — גיבוי כשאין משקלים, ויריב השוואה לבדיקות                  */
  /* --------------------------------------------------------------------- */

  /* מספר ההטלות (מתוך 36) שפוגעות במרחק d, בלי חסימות */
  const SHOTS = [0, 11, 12, 14, 15, 15, 17, 6, 6, 5, 3, 2, 3, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1];
  const HOME_W = [1, 1.2, 1.6, 2, 2.6, 3];

  /** ציון לעמדה אחרי ש-s שיחק (גבוה = טוב ל-s). בפיפס, בערך */
  function heuristic(pos, s) {
    const me = s * 25, op = (1 - s) * 25;
    let score = BG.pips(pos, 1 - s) - BG.pips(pos, s);
    if (!BG.isContact(pos)) return score + 4 * (BG.offCount(pos, s) - BG.offCount(pos, 1 - s));

    // אבנים חשופות: כמה היריב יכול לפגוע, וכמה זה יעלה
    let worst = 0;
    for (let i = 0; i < 24; i++) {
      if (pos[me + i] !== 1) continue;
      let hit = 0;
      // אבן של היריב בנקודה k שלי (k < i) נעה אליי במרחק i-k; מהבר — i+1
      for (let k = -1; k < i; k++) {
        const c = k < 0 ? pos[op + 24] : pos[op + 23 - k];
        if (c > 0) hit = Math.max(hit, SHOTS[Math.min(24, i - k)] || 0);
      }
      worst = Math.max(worst, (hit / 36) * (24 - i + 10));
    }
    score -= worst * 1.4;

    // נקודות סגורות
    let run = 0, prime = 0, homeMade = 0;
    for (let i = 0; i < 24; i++) {
      const made = pos[me + i] >= 2;
      if (made) {
        if (i < 6) { score += HOME_W[i] * 2.2; homeMade++; }
        else if (i === 6) score += 4;
        else if (i >= 17 && i <= 20) score += 2.5;
        run++;
        prime = Math.max(prime, run);
      } else run = 0;
      if (pos[me + i] > 4) score -= (pos[me + i] - 4) * 0.8;
    }
    score += prime >= 3 ? (prime - 2) * 3 : 0;
    // היריב על הבר מול בית חזק
    score += pos[op + 24] * (2 + homeMade * 1.5);
    score -= pos[me + 24] * 4;
    return score;
  }

  function heuristicProbs(pos, s) {
    // s עומד להטיל; heuristic מניח שהיריב שיחק עכשיו
    const sc = -heuristic(pos, 1 - s) + 8;
    const pw = sig(sc / 18);
    return [pw, pw * pw * 0.25, 0, (1 - pw) * (1 - pw) * 0.25, 0];
  }

  /* --------------------------------------------------------------------- */
  /* בחירת מהלך                                                             */
  /* --------------------------------------------------------------------- */

  const LEVELS = {
    1: { name: 'מתחיל', plies: 1, noise: 0.16, cubeNoise: 0.16 },
    2: { name: 'קל', plies: 1, noise: 0.08, cubeNoise: 0.08 },
    3: { name: 'בינוני', plies: 1, noise: 0.02, cubeNoise: 0.03 },
    4: { name: 'קשה', plies: 2, top: 5, margin: 0.12, noise: 0, cubeNoise: 0 },
    5: { name: 'אלוף', plies: 2, top: 14, margin: 0.32, noise: 0, cubeNoise: 0 },
  };

  /** עומק 2: ממוצע על 21 ההטלות של היריב, כשהוא עונה במהלך הטוב לו */
  function twoPly(pos, s) {
    const w = BG.winner(pos);
    if (w !== -1) return afterMove(pos, s);
    const o = 1 - s;
    const acc = [0, 0, 0, 0, 0];
    for (const [a, b, wt] of BG.ROLLS) {
      const ts = BG.turns(pos, o, a, b);
      let best = null, bestEq = -Infinity;
      for (const t of ts) {
        const p = afterMove(t.pos, o);
        const e = equity(p);
        if (e > bestEq) { bestEq = e; best = p; }
      }
      // best — מנקודת המבט של היריב, כשאני עומד להטיל; הופכים אליי
      const mine = flip(best);
      for (let k = 0; k < 5; k++) acc[k] += mine[k] * wt;
    }
    for (let k = 0; k < 5; k++) acc[k] /= 36;
    return acc;
  }

  /**
   * מדרג את כל התורות החוקיים.
   * @returns {Array<{turn, probs, eq}>} מהטוב לגרוע
   */
  function rank(pos, s, dice, opts) {
    const o = Object.assign({ plies: 1 }, opts);
    const ts = BG.turns(pos, s, dice[0], dice[1]);
    let list = ts.map((t) => {
      const probs = afterMove(t.pos, s);
      return { turn: t, probs, eq: equity(probs) };
    });
    list.sort((a, b) => b.eq - a.eq);
    if (o.plies >= 2 && list.length > 1) {
      const top = list[0].eq;
      const deep = list.filter((x, i) => i < (o.top || 6) && top - x.eq <= (o.margin || 0.16));
      deep.forEach((x) => { x.probs = twoPly(x.turn.pos, s); x.eq = equity(x.probs); x.deep = true; });
      const rest = list.filter((x) => !x.deep);
      deep.sort((a, b) => b.eq - a.eq);
      list = deep.concat(rest);
    }
    return list;
  }

  /** גאוסיאני פשוט */
  function gauss(rng) {
    const u = 1 - rng(), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** בוחר תור לפי הרמה */
  function choose(pos, s, dice, level, rng) {
    const L = LEVELS[level] || LEVELS[3];
    const r = rng || Math.random;
    const list = rank(pos, s, dice, L);
    if (!list.length) return null;
    if (!L.noise) return list[0].turn;
    let best = null, bestV = -Infinity;
    list.forEach((x) => {
      const v = x.eq + gauss(r) * L.noise;
      if (v > bestV) { bestV = v; best = x; }
    });
    return best.turn;
  }

  /* --------------------------------------------------------------------- */
  /* קוביית ההכפלה                                                          */
  /* --------------------------------------------------------------------- */

  /*
   * טבלת סיכויי ניצחון במשחקון (MET): M(a, b) = הסיכוי של מי שחסרות לו a
   * נקודות לנצח את מי שחסרות לו b. נבנית ברקורסיה ממודל פשוט של משחק
   * בודד — חצי-חצי, כרבע מהמשחקים נגמרים בגמון. זה מספיק כדי להבין מתי
   * הכפלה "מתה" (הנקודות כבר לא משנות), ומתי המפגר חייב להכפיל אחרי קרופורד.
   */
  const MET = {};
  const GAME = [[1, 0.365], [2, 0.13], [3, 0.005]];
  function met(a, b) {
    if (a <= 0) return 1;
    if (b <= 0) return 0;
    const k = a + ',' + b;
    if (k in MET) return MET[k];
    let p = 0;
    GAME.forEach(([pts, pr]) => { p += pr * met(a - pts, b) + pr * met(a, b - pts); });
    MET[k] = p;
    return p;
  }

  /**
   * @param {object} cube { value, owner (-1 באמצע), matchTo (0 = משחק חופשי),
   *   score [s0, s1], crawford (המשחק הנוכחי הוא משחק קרופורד) }
   */
  function canDouble(cube, s) {
    if (!cube || cube.disabled) return false;
    if (cube.crawford) return false;
    if (cube.owner !== -1 && cube.owner !== s) return false;
    if (cube.matchTo) {
      // אין טעם להכפיל אם כבר הקובייה הנוכחית מספיקה לי לנצח
      if (cube.score[s] + cube.value >= cube.matchTo) return false;
    } else if (cube.value >= 64) return false;
    return true;
  }

  /** התועלת של s מתוצאה של +pts (או -pts) נקודות */
  function utility(cube, s, pts) {
    if (!cube.matchTo) return pts;
    const a = cube.matchTo - cube.score[s];
    const b = cube.matchTo - cube.score[1 - s];
    return pts > 0 ? met(a - pts, b) : met(a, b + pts);
  }

  /** ההכפלה במונחי תועלת: לא להכפיל / הכפלה וקבלה / הכפלה וויתור */
  function cubeOutcomes(p, cube, s) {
    const v = cube.value;
    const out = [
      [p[0] - p[1], 1], [p[1] - p[2], 2], [p[2], 3],
      [1 - p[0] - p[3], -1], [p[3] - p[4], -2], [p[4], -3],
    ];
    let nd = 0, dt = 0;
    out.forEach(([pr, k]) => {
      nd += pr * utility(cube, s, k * v);
      dt += pr * utility(cube, s, k * v * 2);
    });
    return { nd, dt, dp: utility(cube, s, v) };
  }

  /**
   * האם s (שעומד להטיל) מכפיל.
   * משחק חופשי: לפי סף שווי, כולל "טוב מדי להכפלה" — כשסיכויי הגמון גבוהים
   * עדיף להמשיך לשחק ולא לתת ליריב לוותר בנקודה אחת.
   * משחקון: לפי הטבלה, עם מרווח קטן לטובת "לא להכפיל" — ההערכה מתעלמת
   * מערך הבעלות על הקובייה, שהולך ליריב.
   */
  function shouldDouble(pos, s, cube, level, rng) {
    if (!canDouble(cube, s)) return false;
    const L = LEVELS[level] || LEVELS[3];
    const r = rng || Math.random;
    const p = evaluate(pos, s);
    const noise = L.cubeNoise ? gauss(r) * L.cubeNoise : 0;
    if (!cube.matchTo) {
      const e = equity(p) + noise;
      const centered = cube.owner === -1;
      const dp = centered ? 0.42 : 0.52;
      const raceBonus = BG.isContact(pos) ? 0 : -0.06; // במרוץ הסף נמוך יותר
      return e >= dp + raceBonus && e < 0.98;
    }
    const o = cubeOutcomes(p, cube, s);
    const gain = Math.min(o.dt, o.dp) - o.nd + noise * 0.3;
    return gain > 0.012;
  }

  /** האם s מקבל הכפלה (היריב הכפיל ועומד להטיל) */
  function shouldTake(pos, s, cube, level, rng) {
    const L = LEVELS[level] || LEVELS[3];
    const r = rng || Math.random;
    const d = 1 - s;
    const p = evaluate(pos, d);
    const noise = L.cubeNoise ? gauss(r) * L.cubeNoise : 0;
    if (!cube.matchTo) {
      // הקובייה תהיה שלי — ערך הבעלות שווה כמה אחוזים
      return equity(p) + noise < 0.56;
    }
    const o = cubeOutcomes(p, cube, d);
    return o.dt - 0.01 + noise * 0.3 < o.dp;
  }

  global.BackgammonAI = {
    I, O, LEVELS, Net, encode, decode, getNet,
    evaluate, afterMove, equity, flip, heuristic, rank, choose, twoPly,
    met, canDouble, shouldDouble, shouldTake, cubeOutcomes,
    setNet(n) { net = n; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
