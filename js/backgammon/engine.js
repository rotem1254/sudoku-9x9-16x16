/* =============================================================================
 * backgammon/engine.js — חוקי השש-בש
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM, ולכן נבדק ב-Node וגם משמש את האימון של הרשת.
 *
 * ייצוג: Int8Array באורך 50. כל צד מחזיק 25 תאים *מנקודת המבט שלו*:
 *   pos[s*25 + i]   — כמה אבנים של צד s יש על הנקודה i+1 שלו (i = 0..23)
 *   pos[s*25 + 24]  — כמה אבנים שלו על הבר
 * אבנים שהוצאו = 15 פחות כל השאר. הנקודה i של צד אחד היא הנקודה 23-i של
 * היריב, ולכן החלפת צדדים היא רק החלפת שני חצאי המערך — כל הקוד כתוב פעם
 * אחת, "מנקודת המבט של מי שמשחק".
 *
 * כל צד נע מהנקודה 24 שלו אל 1 ומשם החוצה. כניסה מהבר במספר d נוחתת על
 * הנקודה 25-d — כלומר הבר הוא פשוט "נקודה 25" (אינדקס 24), ואותה נוסחה
 * (to = from - d) עובדת גם לכניסה.
 *
 * חוקי התור:
 *   - חייבים לשחק כמה שיותר מהקוביות (שתיים, או ארבע בדאבל)
 *   - אם אפשר לשחק רק אחת מהשתיים — חייבים את הגבוהה, אם היא אפשרית
 *   - אבן על הבר חייבת להיכנס לפני כל מהלך אחר
 *   - הוצאה רק כשכל האבנים בבית; מספר גבוה מהנדרש מותר רק לאבן הרחוקה
 * =========================================================================== */
(function (global) {
  'use strict';

  const BAR = 24;
  const OFF = -1;

  /* 2 על 24, 5 על 13, 3 על 8, 5 על 6 — לכל צד, מנקודת המבט שלו */
  function initial() {
    const p = new Int8Array(50);
    for (let s = 0; s < 2; s++) {
      const b = s * 25;
      p[b + 23] = 2;
      p[b + 12] = 5;
      p[b + 7] = 3;
      p[b + 5] = 5;
    }
    return p;
  }

  function onBoard(pos, s) {
    const b = s * 25;
    let n = 0;
    for (let i = 0; i < 25; i++) n += pos[b + i];
    return n;
  }
  const offCount = (pos, s) => 15 - onBoard(pos, s);

  /** ספירת פיפס: כמה צעדים נשארו לצד s כדי להוציא הכול */
  function pips(pos, s) {
    const b = s * 25;
    let n = 0;
    for (let i = 0; i < 25; i++) n += pos[b + i] * (i + 1);
    return n;
  }

  /** האם כל האבנים של s בבית (נקודות 1–6) או בחוץ */
  function allHome(pos, s) {
    const b = s * 25;
    for (let i = 6; i < 25; i++) if (pos[b + i]) return false;
    return true;
  }

  /** האם עוד יש מגע — אבן של מישהו שעדיין צריכה לעבור אבן של היריב */
  function isContact(pos) {
    // האבן הרחוקה של צד 0, בקואורדינטות שלו
    let back0 = -1;
    for (let i = 24; i >= 0; i--) if (pos[i]) { back0 = i; break; }
    let back1 = -1;
    for (let i = 24; i >= 0; i--) if (pos[25 + i]) { back1 = i; break; }
    if (back0 < 0 || back1 < 0) return false;
    // הנקודה הרחוקה של צד 1, בקואורדינטות של צד 0, היא 23-back1
    // מגע קיים אם האבן הרחוקה של 0 עוד לא עברה את האבן הרחוקה של 1
    return back0 > 23 - back1;
  }

  /**
   * בודק מהלך בודד. מחזיר את יעד המהלך (0..23, או OFF) או null אם אסור.
   * לא בודק את חוק הבר עבור from — את זה עושה הקורא.
   */
  function target(pos, s, from, d) {
    const b = s * 25;
    if (pos[b + from] <= 0) return null;
    if (from !== BAR && pos[b + BAR] > 0) return null;
    const to = from - d;
    if (to >= 0) {
      return pos[(1 - s) * 25 + 23 - to] >= 2 ? null : to;
    }
    // הוצאה
    if (!allHome(pos, s)) return null;
    if (to === -1) return OFF;
    for (let i = from + 1; i < 6; i++) if (pos[b + i]) return null;
    return OFF;
  }

  /** מבצע מהלך (משנה את pos). מחזיר true אם הייתה הכאה. */
  function apply(pos, s, from, to) {
    const b = s * 25;
    pos[b + from]--;
    if (to === OFF) return false;
    pos[b + to]++;
    const oi = (1 - s) * 25 + 23 - to;
    if (pos[oi] === 1) {
      pos[oi] = 0;
      pos[(1 - s) * 25 + BAR]++;
      return true;
    }
    return false;
  }

  function key(pos) {
    return String.fromCharCode.apply(null, pos);
  }

  /* --------------------------------------------------------------------- */
  /* יצירת תורות                                                            */
  /* --------------------------------------------------------------------- */

  /*
   * תור הוא רצף של 0–4 מהלכים. מחוללים את כל הרצפים, ושומרים מכל מצב סופי
   * רק אחד (רצפים שונים שמגיעים לאותה עמדה הם אותו תור).
   *
   * בדאבל כל הקוביות זהות, ולכן מספיק לחולל את המהלכים בסדר יורד של נקודת
   * המוצא: סדר אחר של אותם מהלכים מגיע לאותה עמדה, ומהלך מנקודה גבוהה
   * קודם רק מרחיב את מה שמותר אחריו (מכניס אבנים הביתה, מפנה את הבר).
   */
  function turns(pos, s, d1, d2) {
    const out = new Map();
    let best = 0;
    const seq = [];

    function record(p) {
      const n = seq.length;
      if (n < best) return;
      if (n > best) { best = n; out.clear(); }
      const k = key(p);
      if (!out.has(k)) out.set(k, { moves: seq.slice(), pos: p });
    }

    if (d1 === d2) {
      const rec = (p, left, maxFrom) => {
        let moved = false;
        if (left > 0) {
          for (let from = maxFrom; from >= 0; from--) {
            const to = target(p, s, from, d1);
            if (to === null) continue;
            moved = true;
            const q = new Int8Array(p);
            const hit = apply(q, s, from, to);
            seq.push([from, to, hit, d1]);
            rec(q, left - 1, from);
            seq.pop();
          }
        }
        if (!moved) record(p);
      };
      rec(pos, 4, BAR);
    } else {
      const rec = (p, dice) => {
        let moved = false;
        for (let k = 0; k < dice.length; k++) {
          const d = dice[k];
          for (let from = BAR; from >= 0; from--) {
            const to = target(p, s, from, d);
            if (to === null) continue;
            moved = true;
            const q = new Int8Array(p);
            const hit = apply(q, s, from, to);
            seq.push([from, to, hit, d]);
            rec(q, dice.length === 2 ? [dice[1 - k]] : []);
            seq.pop();
          }
        }
        if (!moved) record(p);
      };
      rec(pos, [d1, d2]);

      // רק קובייה אחת אפשרית — חייבים את הגבוהה אם היא אפשרית
      if (best === 1) {
        const hi = Math.max(d1, d2);
        const withHi = [...out.values()].filter((t) => t.moves[0][3] === hi);
        if (withHi.length) {
          out.clear();
          withHi.forEach((t) => out.set(key(t.pos), t));
        }
      }
    }
    return [...out.values()];
  }

  /**
   * המהלכים הבודדים שמותר לשחק עכשיו, באמצע תור.
   *
   * @param {Int8Array} start העמדה בתחילת התור
   * @param {number[]} dice הקוביות שהוטלו
   * @param {Array} played המהלכים ששוחקו עד עכשיו [from, to, hit, die]
   * @param {Array} legal תוצאת turns() לעמדת ההתחלה
   * @returns {{pos, left:number[], moves:Array, done:boolean}}
   *
   * מהלך מותר אם אחריו עדיין אפשר להגיע לאחד התורות החוקיים. כך כל חוקי
   * "חייבים לשחק כמה שיותר" נשמרים גם כשהשחקן מזיז אבן-אבן, ובכל סדר.
   */
  function partial(start, s, dice, played, legal) {
    const pos = new Int8Array(start);
    const left = dice[0] === dice[1] ? [dice[0], dice[0], dice[0], dice[0]] : dice.slice();
    played.forEach((m) => {
      apply(pos, s, m[0], m[1]);
      const i = left.indexOf(m[3]);
      if (i >= 0) left.splice(i, 1);
    });
    const need = legal.length ? legal[0].moves.length : 0;
    const goal = new Set(legal.map((t) => key(t.pos)));
    const done = played.length >= need;
    const moves = [];
    if (done) return { pos, left, moves, done };

    const remaining = need - played.length;
    // אפשר להגיע ליעד מ-p עם הקוביות dl, ב-k מהלכים בדיוק?
    const reach = (p, dl, k) => {
      if (k === 0) return goal.has(key(p));
      const tried = new Set();
      for (let i = 0; i < dl.length; i++) {
        const d = dl[i];
        if (tried.has(d)) continue;
        tried.add(d);
        const rest = dl.slice(0, i).concat(dl.slice(i + 1));
        for (let from = BAR; from >= 0; from--) {
          const to = target(p, s, from, d);
          if (to === null) continue;
          const q = new Int8Array(p);
          apply(q, s, from, to);
          if (reach(q, rest, k - 1)) return true;
        }
      }
      return false;
    };

    const seen = new Set();
    left.forEach((d, i) => {
      if (seen.has(d)) return;
      seen.add(d);
      const rest = left.slice(0, i).concat(left.slice(i + 1));
      for (let from = BAR; from >= 0; from--) {
        const to = target(pos, s, from, d);
        if (to === null) continue;
        const q = new Int8Array(pos);
        const hit = apply(q, s, from, to);
        if (reach(q, rest, remaining - 1)) moves.push([from, to, hit, d]);
      }
    });
    return { pos, left, moves, done };
  }

  /* --------------------------------------------------------------------- */
  /* סיום                                                                   */
  /* --------------------------------------------------------------------- */

  /** מי ניצח (0/1) או -1 אם המשחק עוד נמשך */
  function winner(pos) {
    if (onBoard(pos, 0) === 0) return 0;
    if (onBoard(pos, 1) === 0) return 1;
    return -1;
  }

  /**
   * ערך הניצחון של w: 1 רגיל, 2 גמון (המפסיד לא הוציא אף אבן),
   * 3 בקגמון (גמון, ועוד יש למפסיד אבן על הבר או בבית של המנצח).
   */
  function resultValue(pos, w) {
    const l = 1 - w;
    if (offCount(pos, l) > 0) return 1;
    const b = l * 25;
    // הבית של המנצח = הנקודות 19–24 של המפסיד (אינדקסים 18..23), ועוד הבר
    for (let i = 18; i < 25; i++) if (pos[b + i]) return 3;
    return 2;
  }

  /* --------------------------------------------------------------------- */
  /* רישום                                                                  */
  /* --------------------------------------------------------------------- */

  const ptName = (i) => (i === BAR ? 'bar' : i === OFF ? 'off' : String(i + 1));

  /**
   * רישום מקובל: "13/7* 8/7", "bar/22", "6/off(2)". אבן שממשיכה לזוז
   * מתחברת לשרשרת אחת (24/18 ואז 18/13 → "24/13", עם כוכבית על נקודת הכאה), ומהלכים זהים מקובצים עם (n).
   */
  function notation(moves) {
    if (!moves || !moves.length) return '—';
    const chains = [];
    moves.forEach((m) => {
      const last = chains.find((c) => c.path[c.path.length - 1] === m[0] && !c.closed);
      if (last && m[0] !== BAR) {
        last.path.push(m[1]);
        last.hits.push(m[2]);
      } else {
        chains.push({ path: [m[0], m[1]], hits: [false, m[2]] });
      }
    });
    const parts = chains.map((c) =>
      c.path.map((p, i) => ptName(p) + (c.hits[i] ? '*' : '')).join('/'));
    const counted = [];
    parts.forEach((p) => {
      const e = counted.find((x) => x.t === p);
      if (e) e.n++;
      else counted.push({ t: p, n: 1 });
    });
    return counted.map((x) => (x.n > 1 ? x.t + '(' + x.n + ')' : x.t)).join(' ');
  }

  /* --------------------------------------------------------------------- */
  /* קוביות                                                                 */
  /* --------------------------------------------------------------------- */

  /** 21 ההטלות השונות, עם המשקל שלהן מתוך 36 */
  const ROLLS = [];
  for (let a = 1; a <= 6; a++) {
    for (let b = a; b <= 6; b++) ROLLS.push([a, b, a === b ? 1 : 2]);
  }

  function roll(rng) {
    const r = rng || Math.random;
    return [1 + Math.floor(r() * 6), 1 + Math.floor(r() * 6)];
  }

  global.Backgammon = {
    BAR, OFF, ROLLS,
    initial, onBoard, offCount, pips, allHome, isContact,
    target, apply, key, turns, partial,
    winner, resultValue, notation, roll,
  };
})(typeof window !== 'undefined' ? window : globalThis);
