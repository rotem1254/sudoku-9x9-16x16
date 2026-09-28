/* =============================================================================
 * mahjong/engine.js — מנוע מהג'ונג סוליטר
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM.
 *
 * 144 אבנים בפריסת "הצב" הקלאסית. מוציאים זוגות של אבנים זהות, ובתנאי
 * ששתיהן חופשיות: אין אבן מעליהן, ולפחות צד אחד (שמאל או ימין) פנוי.
 *
 * קואורדינטות בחצאי אבן: אבן תופסת x..x+2, y..y+2 בשכבה z. כך אפשר לתאר
 * אבנים שיושבות "בין" שורות — כמו שלוש אבני הקצה והאבן שבפסגה.
 *
 * כל חלוקה פתירה. החלוקה נבנית הפוך: מתחילים מלוח מלא של מקומות ריקים,
 * ומוציאים שוב ושוב שני מקומות אקראיים שחופשיים באותו רגע. סדר ההוצאה
 * הוא פתרון, ורק אחר כך משבצים לכל זוג מקומות זוג אבנים זהות. אותה שיטה
 * משמשת ל"ערבוב" כשנתקעים — היא מערבבת רק את האבנים שנשארו.
 * =========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------ אבנים ------------------------------- */

  /*
   * קוד האבן: אות סדרה + ערך.
   *   d — עיגולים, b — במבוק, c — סימנים (1–9)
   *   w — רוחות (E S W N),  r — דרקונים (R אדום, G ירוק, W לבן)
   *   f — פרחים (1–4),      s — עונות (1–4)
   * ארבעה עותקים מכל אבן רגילה. פרחים ועונות — עותק אחד מכל אחד, וכל פרח
   * מתאים לכל פרח (וכך גם עונות). זה החוק המקובל.
   */
  function allFaces() {
    const out = [];
    ['d', 'b', 'c'].forEach((s) => {
      for (let n = 1; n <= 9; n++) for (let k = 0; k < 4; k++) out.push(s + n);
    });
    ['E', 'S', 'W', 'N'].forEach((w) => { for (let k = 0; k < 4; k++) out.push('w' + w); });
    ['R', 'G', 'W'].forEach((d) => { for (let k = 0; k < 4; k++) out.push('r' + d); });
    for (let n = 1; n <= 4; n++) out.push('f' + n);
    for (let n = 1; n <= 4; n++) out.push('s' + n);
    return out;
  }

  /** המפתח שלפיו מתאימים: פרחים ועונות — לפי הקבוצה; כל השאר — אבן זהה. */
  const matchKey = (face) => (face[0] === 'f' || face[0] === 's' ? face[0] : face);

  /** מחלק רשימת אבנים לזוגות תואמים. מניח שכל מפתח מופיע מספר זוגי של פעמים. */
  function pairUp(faces, rng) {
    const groups = new Map();
    faces.forEach((f) => {
      const k = matchKey(f);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(f);
    });
    const pairs = [];
    groups.forEach((list) => {
      shuffle(list, rng);
      for (let i = 0; i + 1 < list.length; i += 2) pairs.push([list[i], list[i + 1]]);
    });
    return shuffle(pairs, rng);
  }

  /* ------------------------------ פריסה ------------------------------- */

  /**
   * פריסת "הצב" — 144 מקומות. השורות בשכבה 0 מתוארות כטווחי עמודות
   * באבנים שלמות; שלוש אבני הקצה יושבות בגובה חצי שורה (בין שורה 3 ל-4).
   */
  function turtle() {
    const pos = [];
    const add = (x, y, z) => pos.push({ x, y, z });

    // שכבה 0
    const rows = [[1, 12], [3, 10], [2, 11], [1, 12], [1, 12], [2, 11], [3, 10], [1, 12]];
    rows.forEach(([a, b], r) => { for (let c = a; c <= b; c++) add(c * 2, r * 2, 0); });
    add(0, 7, 0);   // קצה שמאלי
    add(26, 7, 0);  // קצה ימני
    add(28, 7, 0);  // הקצה הימני החיצוני

    // שכבות 1–3: ריבועים שהולכים וקטנים
    for (let r = 1; r <= 6; r++) for (let c = 4; c <= 9; c++) add(c * 2, r * 2, 1);
    for (let r = 2; r <= 5; r++) for (let c = 5; c <= 8; c++) add(c * 2, r * 2, 2);
    for (let r = 3; r <= 4; r++) for (let c = 6; c <= 7; c++) add(c * 2, r * 2, 3);

    // הפסגה — מעל מרכז הריבוע האחרון
    add(13, 7, 4);
    return pos;
  }

  const LAYOUTS = { turtle };

  /* ------------------------------ חופש -------------------------------- */

  /**
   * האם מקום i חופשי מבין המקומות החיים. פונקציה כללית על מערך מקומות,
   * כדי שגם המחולל וגם המשחק ישתמשו באותו חוק בדיוק.
   */
  function freeAmong(pos, alive, i) {
    const t = pos[i];
    let left = false, right = false;
    for (let j = 0; j < pos.length; j++) {
      if (j === i || !alive[j]) continue;
      const o = pos[j];
      const dy = Math.abs(o.y - t.y);
      if (o.z === t.z + 1 && Math.abs(o.x - t.x) < 2 && dy < 2) return false;
      if (o.z === t.z && dy < 2) {
        if (o.x === t.x - 2) left = true;
        else if (o.x === t.x + 2) right = true;
      }
    }
    return !(left && right);
  }

  /**
   * סדר הוצאה אקראי אך חוקי למקומות החיים — כלומר, פתרון.
   * @returns {number[][]|null} זוגות אינדקסים, או null אם נתקענו
   */
  function planOrder(pos, alive, rng) {
    const live = alive.slice();
    let left = live.filter(Boolean).length;
    const order = [];
    while (left > 0) {
      const free = [];
      for (let i = 0; i < pos.length; i++) if (live[i] && freeAmong(pos, live, i)) free.push(i);
      if (free.length < 2) return null;
      const a = free.splice(Math.floor(rng() * free.length), 1)[0];
      const b = free[Math.floor(rng() * free.length)];
      live[a] = false;
      live[b] = false;
      left -= 2;
      order.push([a, b]);
    }
    return order;
  }

  /** מנסה שוב ושוב עד שמתקבל סדר מלא. בפועל כמעט תמיד מצליח בניסיון הראשון. */
  function solvableOrder(pos, alive, rng) {
    for (let k = 0; k < 500; k++) {
      const order = planOrder(pos, alive, rng);
      if (order) return order;
    }
    return null;
  }

  /* ------------------------------ משחק -------------------------------- */

  /**
   * @param {object} [opts]
   * @param {string} [opts.layout='turtle']
   * @param {function} [opts.rng=Math.random]
   * @param {{x,y,z,face,alive}[]} [opts.tiles] לשחזור ולבדיקות
   */
  function Mahjong(opts) {
    opts = opts || {};
    this.rng = opts.rng || Math.random;
    this.layout = opts.layout || 'turtle';
    this.history = opts.history ? opts.history.map((p) => p.slice()) : [];
    this.hints = opts.hints || 0;
    this.shuffles = opts.shuffles || 0;
    this.elapsed = opts.elapsed || 0;

    if (opts.tiles) {
      this.tiles = opts.tiles.map((t, id) => ({
        id, x: t.x, y: t.y, z: t.z, face: t.face, alive: t.alive !== false,
      }));
      this.solution = null;
    } else {
      const pos = LAYOUTS[this.layout]();
      const alive = pos.map(() => true);
      const order = solvableOrder(pos, alive, this.rng);
      const pairs = pairUp(allFaces(), this.rng);
      const faces = new Array(pos.length);
      order.forEach(([a, b], k) => { faces[a] = pairs[k][0]; faces[b] = pairs[k][1]; });
      this.tiles = pos.map((p, id) => ({ id, x: p.x, y: p.y, z: p.z, face: faces[id], alive: true }));
      /** סדר פתרון אחד — לבדיקות בלבד */
      this.solution = order;
    }
  }

  const P = Mahjong.prototype;

  P._alive = function () { return this.tiles.map((t) => t.alive); };

  P.isFree = function (id) {
    const t = this.tiles[id];
    if (!t || !t.alive) return false;
    return freeAmong(this.tiles, this._alive(), id);
  };

  P.freeTiles = function () {
    const alive = this._alive();
    return this.tiles.filter((t) => t.alive && freeAmong(this.tiles, alive, t.id)).map((t) => t.id);
  };

  P.matches = function (a, b) {
    return a !== b && matchKey(this.tiles[a].face) === matchKey(this.tiles[b].face);
  };

  /** מוציא זוג. מחזיר false אם המהלך לא חוקי. */
  P.remove = function (a, b) {
    if (!this.isFree(a) || !this.isFree(b) || !this.matches(a, b)) return false;
    this.tiles[a].alive = false;
    this.tiles[b].alive = false;
    this.history.push([a, b]);
    return true;
  };

  P.undo = function () {
    const last = this.history.pop();
    if (!last) return null;
    this.tiles[last[0]].alive = true;
    this.tiles[last[1]].alive = true;
    return last;
  };

  P.remaining = function () { return this.tiles.filter((t) => t.alive).length; };
  P.isWon = function () { return this.remaining() === 0; };

  /** כל הזוגות האפשריים כרגע. */
  P.availablePairs = function () {
    const groups = new Map();
    this.freeTiles().forEach((id) => {
      const k = matchKey(this.tiles[id].face);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(id);
    });
    const out = [];
    groups.forEach((ids) => {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
    });
    return out;
  };

  P.isStuck = function () { return !this.isWon() && this.availablePairs().length === 0; };

  /**
   * רמז — זוג פנוי. מעדיף אבנים גבוהות ואבנים מקצות ארוכים, כי שם הוצאה
   * פותחת הכי הרבה. זה לא פתרון מלא, רק רמז סביר.
   */
  P.hint = function () {
    const pairs = this.availablePairs();
    if (!pairs.length) return null;
    const score = ([a, b]) => this.tiles[a].z + this.tiles[b].z;
    pairs.sort((p, q) => score(q) - score(p));
    this.hints++;
    return pairs[0];
  };

  /**
   * מערבב את האבנים שנשארו למצב פתיר. המקומות לא זזים — רק מה שעליהם.
   * ההיסטוריה נמחקת: ביטול אחרי ערבוב היה מחזיר אבנים שאולי כבר לא
   * משתלבות בפתרון החדש.
   */
  P.shuffle = function () {
    const alive = this._alive();
    const order = solvableOrder(this.tiles, alive, this.rng);
    const faces = this.tiles.filter((t) => t.alive).map((t) => t.face);
    if (!order) {
      // לא אמור לקרות; ערבוב פשוט עדיף על תקיעה
      shuffle(faces, this.rng);
      this.tiles.filter((t) => t.alive).forEach((t, i) => { t.face = faces[i]; });
    } else {
      const pairs = pairUp(faces, this.rng);
      order.forEach(([a, b], k) => {
        this.tiles[a].face = pairs[k][0];
        this.tiles[b].face = pairs[k][1];
      });
    }
    this.history = [];
    this.shuffles++;
    this.solution = order;
    return true;
  };

  /** מידות הפריסה בחצאי אבן — ל-UI. */
  P.bounds = function () {
    let maxX = 0, maxY = 0, maxZ = 0;
    this.tiles.forEach((t) => {
      maxX = Math.max(maxX, t.x + 2);
      maxY = Math.max(maxY, t.y + 2);
      maxZ = Math.max(maxZ, t.z);
    });
    return { w: maxX, h: maxY, layers: maxZ + 1 };
  };

  P.serialize = function () {
    return {
      layout: this.layout,
      tiles: this.tiles.map((t) => ({ x: t.x, y: t.y, z: t.z, face: t.face, alive: t.alive })),
      history: this.history.map((p) => p.slice()),
      hints: this.hints,
      shuffles: this.shuffles,
      elapsed: this.elapsed,
    };
  };

  Mahjong.deserialize = function (d) { return new Mahjong(d); };

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  Mahjong.allFaces = allFaces;
  Mahjong.matchKey = matchKey;
  Mahjong.LAYOUTS = LAYOUTS;

  global.Mahjong = Mahjong;
})(typeof window !== 'undefined' ? window : globalThis);
