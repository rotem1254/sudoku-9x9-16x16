/* =============================================================================
 * chess/engine.js — חוקי השחמט
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM.
 *
 * ייצוג 0x88: הלוח הוא מערך של 128 תאים, שמתוכם 64 אמיתיים. אינדקס =
 * שורה*16 + טור, כששורה 0 היא שורה 8 (למעלה, הצד של השחור). היתרון: בדיקת
 * "יצאנו מהלוח" היא ביטוי אחד — (sq & 0x88) — בלי השוואות גבולות, וזה
 * הלב של יצירת מהלכים מהירה.
 *
 * כלים: אותיות FEN — גדולות ללבן (PNBRQK), קטנות לשחור.
 *
 * מהלכים חוקיים = מהלכים "פסאודו-חוקיים" שאחרי ביצועם המלך של המבצע לא
 * מאוים. כל החוקים המלאים כאן: הצרחה (כולל מעבר במשבצת מאוימת), הכאה
 * דרך הילוכו, הכתרה, ותיקו בפט, 50 מהלכים, שלוש חזרות וחומר לא מספיק.
 * =========================================================================== */
(function (global) {
  'use strict';

  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const FILES = 'abcdefgh';

  /* זכויות הצרחה כמסכת ביטים */
  const WK = 1, WQ = 2, BK = 4, BQ = 8;

  const N = -16, S = 16, E = 1, W = -1;
  const KNIGHT = [-33, -31, -18, -14, 14, 18, 31, 33];
  const KING = [-17, -16, -15, -1, 1, 15, 16, 17];
  const BISHOP = [-17, -15, 15, 17];
  const ROOK = [-16, -1, 1, 16];

  /** איזו זכות הצרחה נמחקת כשמשהו זז מ/אל המשבצת הזו */
  const CASTLE_MASK = new Array(128).fill(15);
  CASTLE_MASK[0x74] = 15 & ~(WK | WQ); // e1
  CASTLE_MASK[0x77] = 15 & ~WK;        // h1
  CASTLE_MASK[0x70] = 15 & ~WQ;        // a1
  CASTLE_MASK[0x04] = 15 & ~(BK | BQ); // e8
  CASTLE_MASK[0x07] = 15 & ~BK;        // h8
  CASTLE_MASK[0x00] = 15 & ~BQ;        // a8

  const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');
  const typeOf = (p) => p.toLowerCase();
  const other = (c) => (c === 'w' ? 'b' : 'w');

  /** 'e4' ↔ 0x88 */
  function sqIndex(name) {
    const f = FILES.indexOf(name[0]);
    const r = 8 - parseInt(name[1], 10);
    return r * 16 + f;
  }
  function sqName(i) {
    return FILES[i & 7] + (8 - (i >> 4));
  }

  /* --------------------------------------------------------------------- */
  /* מצב                                                                    */
  /* --------------------------------------------------------------------- */

  function Chess(fen) {
    this.load(fen || START);
  }

  const P = Chess.prototype;

  P.load = function (fen) {
    const parts = fen.trim().split(/\s+/);
    this.board = new Array(128).fill(null);
    this.kings = { w: -1, b: -1 };
    let r = 0, f = 0;
    for (const ch of parts[0]) {
      if (ch === '/') { r++; f = 0; continue; }
      if (/\d/.test(ch)) { f += parseInt(ch, 10); continue; }
      const sq = r * 16 + f;
      this.board[sq] = ch;
      if (ch === 'K') this.kings.w = sq;
      if (ch === 'k') this.kings.b = sq;
      f++;
    }
    this.turn = parts[1] || 'w';
    const c = parts[2] || '-';
    this.castling = (c.includes('K') ? WK : 0) | (c.includes('Q') ? WQ : 0) |
      (c.includes('k') ? BK : 0) | (c.includes('q') ? BQ : 0);
    this.ep = parts[3] && parts[3] !== '-' ? sqIndex(parts[3]) : -1;
    this.half = parseInt(parts[4] || '0', 10);
    this.full = parseInt(parts[5] || '1', 10);
    this.startFen = fen;
    /** מחסנית לביטול — כל רשומה מחזירה את המצב לפני המהלך */
    this.stack = [];
    /** המהלכים שבוצעו, עם SAN — להצגה */
    this.history = [];
    /** מפתחות העמדות — לזיהוי חזרה משולשת */
    this.keys = [this.key()];
  };

  /** מפתח עמדה: כלים, תור, הצרחה והכאה דרך הילוכו — בלי השעונים */
  P.key = function () {
    let s = '';
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      s += this.board[sq] || '.';
    }
    return s + this.turn + this.castling + (this.ep >= 0 ? this.ep : '-');
  };

  P.fen = function () {
    let out = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 16 + f];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += p;
      }
      if (empty) out += empty;
      if (r < 7) out += '/';
    }
    let c = '';
    if (this.castling & WK) c += 'K';
    if (this.castling & WQ) c += 'Q';
    if (this.castling & BK) c += 'k';
    if (this.castling & BQ) c += 'q';
    return out + ' ' + this.turn + ' ' + (c || '-') + ' ' +
      (this.ep >= 0 ? sqName(this.ep) : '-') + ' ' + this.half + ' ' + this.full;
  };

  P.get = function (name) { return this.board[sqIndex(name)] || null; };

  /* --------------------------------------------------------------------- */
  /* איום                                                                   */
  /* --------------------------------------------------------------------- */

  /** האם המשבצת sq מאוימת ע"י הצד by */
  P.attacked = function (sq, by) {
    const b = this.board;
    const white = by === 'w';

    // רגלים: רגלי לבן תוקף באלכסון למעלה, ולכן הוא יושב מתחת למשבצת
    const pawn = white ? 'P' : 'p';
    const pd = white ? [15, 17] : [-15, -17];
    for (let i = 0; i < 2; i++) {
      const s = sq + pd[i];
      if (!(s & 0x88) && b[s] === pawn) return true;
    }

    const knight = white ? 'N' : 'n';
    for (let i = 0; i < 8; i++) {
      const s = sq + KNIGHT[i];
      if (!(s & 0x88) && b[s] === knight) return true;
    }

    const king = white ? 'K' : 'k';
    for (let i = 0; i < 8; i++) {
      const s = sq + KING[i];
      if (!(s & 0x88) && b[s] === king) return true;
    }

    const bishop = white ? 'B' : 'b', rook = white ? 'R' : 'r', queen = white ? 'Q' : 'q';
    for (let i = 0; i < 4; i++) {
      let s = sq + BISHOP[i];
      while (!(s & 0x88)) {
        const p = b[s];
        if (p) { if (p === bishop || p === queen) return true; break; }
        s += BISHOP[i];
      }
    }
    for (let i = 0; i < 4; i++) {
      let s = sq + ROOK[i];
      while (!(s & 0x88)) {
        const p = b[s];
        if (p) { if (p === rook || p === queen) return true; break; }
        s += ROOK[i];
      }
    }
    return false;
  };

  P.inCheck = function (color) {
    const c = color || this.turn;
    return this.attacked(this.kings[c], other(c));
  };

  /* --------------------------------------------------------------------- */
  /* יצירת מהלכים                                                           */
  /* --------------------------------------------------------------------- */

  /*
   * מהלך: { from, to, piece, captured, promo, flag }
   * flag: '' רגיל, 'd' צעד כפול, 'e' הכאה דרך הילוכו, 'k' הצרחה קצרה, 'q' ארוכה
   */
  function mv(from, to, piece, captured, promo, flag) {
    return { from, to, piece, captured: captured || null, promo: promo || null, flag: flag || '' };
  }

  /** מהלכים פסאודו-חוקיים. capturesOnly — לחיפוש השקט של המחשב */
  P._pseudo = function (capturesOnly) {
    const b = this.board;
    const us = this.turn;
    const them = other(us);
    const out = [];

    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = b[sq];
      if (!p || colorOf(p) !== us) continue;
      const t = typeOf(p);

      if (t === 'p') {
        const dir = us === 'w' ? N : S;
        const startRow = us === 'w' ? 6 : 1;
        const promoRow = us === 'w' ? 0 : 7;
        const one = sq + dir;
        const addPawn = (to, cap, flag) => {
          if ((to >> 4) === promoRow) {
            const promos = us === 'w' ? ['Q', 'R', 'B', 'N'] : ['q', 'r', 'b', 'n'];
            promos.forEach((pr) => out.push(mv(sq, to, p, cap, pr, flag)));
          } else {
            out.push(mv(sq, to, p, cap, null, flag));
          }
        };
        if (!capturesOnly && !(one & 0x88) && !b[one]) {
          addPawn(one, null, '');
          const two = one + dir;
          if ((sq >> 4) === startRow && !b[two]) out.push(mv(sq, two, p, null, null, 'd'));
        } else if (capturesOnly && !(one & 0x88) && !b[one] && (one >> 4) === promoRow) {
          // הכתרה נחשבת "רועשת" — החיפוש השקט חייב לראות אותה
          addPawn(one, null, '');
        }
        for (const side of [W, E]) {
          const to = one + side;
          if (to & 0x88) continue;
          if (b[to] && colorOf(b[to]) === them) addPawn(to, b[to], '');
          else if (to === this.ep) out.push(mv(sq, to, p, us === 'w' ? 'p' : 'P', null, 'e'));
        }
        continue;
      }

      const step = (offsets, slide) => {
        for (let i = 0; i < offsets.length; i++) {
          let to = sq + offsets[i];
          while (!(to & 0x88)) {
            const q = b[to];
            if (q) {
              if (colorOf(q) === them) out.push(mv(sq, to, p, q));
              break;
            }
            if (!capturesOnly) out.push(mv(sq, to, p));
            if (!slide) break;
            to += offsets[i];
          }
        }
      };

      if (t === 'n') step(KNIGHT, false);
      else if (t === 'b') step(BISHOP, true);
      else if (t === 'r') step(ROOK, true);
      else if (t === 'q') { step(BISHOP, true); step(ROOK, true); }
      else if (t === 'k') {
        step(KING, false);
        if (!capturesOnly) this._castles(sq, p, out);
      }
    }
    return out;
  };

  P._castles = function (sq, p, out) {
    const us = this.turn;
    const them = other(us);
    const b = this.board;
    const home = us === 'w' ? 0x74 : 0x04;
    if (sq !== home) return;
    const kRight = us === 'w' ? WK : BK;
    const qRight = us === 'w' ? WQ : BQ;
    if (!(this.castling & (kRight | qRight))) return;
    if (this.attacked(sq, them)) return; // אין הצרחה מתוך שח
    // קצרה: f,g ריקות, והמלך לא עובר דרך משבצת מאוימת
    if ((this.castling & kRight) && !b[sq + 1] && !b[sq + 2] &&
        !this.attacked(sq + 1, them) && !this.attacked(sq + 2, them)) {
      out.push(mv(sq, sq + 2, p, null, null, 'k'));
    }
    // ארוכה: b,c,d ריקות; רק c,d צריכות להיות לא מאוימות
    if ((this.castling & qRight) && !b[sq - 1] && !b[sq - 2] && !b[sq - 3] &&
        !this.attacked(sq - 1, them) && !this.attacked(sq - 2, them)) {
      out.push(mv(sq, sq - 2, p, null, null, 'q'));
    }
  };

  /* --------------------------------------------------------------------- */
  /* ביצוע וביטול                                                           */
  /* --------------------------------------------------------------------- */

  /** מבצע מהלך בלי בדיקות — לשימוש פנימי ולחיפוש */
  P._make = function (m) {
    const b = this.board;
    const us = this.turn;
    this.stack.push({ m, castling: this.castling, ep: this.ep, half: this.half, full: this.full });

    b[m.to] = m.promo || m.piece;
    b[m.from] = null;

    if (m.flag === 'e') {
      // הרגלי שהוכה יושב מאחורי משבצת היעד
      b[m.to + (us === 'w' ? S : N)] = null;
    } else if (m.flag === 'k') {
      b[m.to - 1] = b[m.to + 1];
      b[m.to + 1] = null;
    } else if (m.flag === 'q') {
      b[m.to + 1] = b[m.to - 2];
      b[m.to - 2] = null;
    }

    if (typeOf(m.piece) === 'k') this.kings[us] = m.to;

    this.castling &= CASTLE_MASK[m.from] & CASTLE_MASK[m.to];
    this.ep = m.flag === 'd' ? (m.from + m.to) >> 1 : -1;
    this.half = typeOf(m.piece) === 'p' || m.captured ? 0 : this.half + 1;
    if (us === 'b') this.full++;
    this.turn = other(us);
  };

  P._unmake = function () {
    const st = this.stack.pop();
    if (!st) return null;
    const m = st.m;
    const b = this.board;
    this.turn = other(this.turn);
    const us = this.turn;

    b[m.from] = m.piece;
    b[m.to] = m.flag === 'e' ? null : m.captured;
    if (m.flag === 'e') b[m.to + (us === 'w' ? S : N)] = m.captured;
    else if (m.flag === 'k') { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = null; }
    else if (m.flag === 'q') { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = null; }

    if (typeOf(m.piece) === 'k') this.kings[us] = m.from;
    this.castling = st.castling;
    this.ep = st.ep;
    this.half = st.half;
    this.full = st.full;
    return m;
  };

  /** מהלכים חוקיים. opts.square — רק מהמשבצת הזו ('e2') */
  P.moves = function (opts) {
    const us = this.turn;
    const from = opts && opts.square ? sqIndex(opts.square) : -1;
    const out = [];
    const pseudo = this._pseudo(false);
    for (let i = 0; i < pseudo.length; i++) {
      const m = pseudo[i];
      if (from >= 0 && m.from !== from) continue;
      this._make(m);
      if (!this.attacked(this.kings[us], other(us))) out.push(m);
      this._unmake();
    }
    return out;
  };

  /** גרסה ציבורית של מהלך: שמות משבצות ו-SAN */
  P._public = function (m, san) {
    return {
      from: sqName(m.from), to: sqName(m.to), piece: m.piece,
      captured: m.captured, promotion: m.promo, flag: m.flag, san,
      color: colorOf(m.piece),
    };
  };

  /** רשימת מהלכים חוקיים בצורה ציבורית (עם SAN) */
  P.legal = function (opts) {
    const list = this.moves(opts);
    return list.map((m) => this._public(m, this._san(m, list)));
  };

  /**
   * מבצע מהלך. input: { from:'e2', to:'e4', promotion:'q' } או SAN ('Nf3').
   * @returns {object|null} המהלך שבוצע, או null אם אינו חוקי
   */
  P.move = function (input) {
    const list = this.moves();
    let m = null;
    if (typeof input === 'string') {
      const clean = input.replace(/[+#?!]/g, '');
      m = list.find((x) => this._san(x, list).replace(/[+#]/g, '') === clean) || null;
    } else {
      const from = sqIndex(input.from), to = sqIndex(input.to);
      const want = input.promotion ? input.promotion.toLowerCase() : 'q';
      m = list.find((x) => x.from === from && x.to === to &&
        (!x.promo || x.promo.toLowerCase() === want)) || null;
    }
    if (!m) return null;
    const san = this._san(m, list);
    this._make(m);
    const pub = this._public(m, san);
    this.history.push(pub);
    this.keys.push(this.key());
    return pub;
  };

  P.undo = function () {
    if (!this.history.length) return null;
    this._unmake();
    this.keys.pop();
    return this.history.pop();
  };

  /* --------------------------------------------------------------------- */
  /* רישום (SAN)                                                            */
  /* --------------------------------------------------------------------- */

  P._san = function (m, legalList) {
    let s;
    if (m.flag === 'k') s = 'O-O';
    else if (m.flag === 'q') s = 'O-O-O';
    else {
      const t = typeOf(m.piece);
      const cap = !!m.captured;
      if (t === 'p') {
        s = (cap ? FILES[m.from & 7] + 'x' : '') + sqName(m.to);
        if (m.promo) s += '=' + m.promo.toUpperCase();
      } else {
        // הבחנה: עוד כלי מאותו סוג שיכול להגיע לאותה משבצת
        const rivals = legalList.filter((x) => x !== m && x.piece === m.piece && x.to === m.to && x.from !== m.from);
        let dis = '';
        if (rivals.length) {
          const sameFile = rivals.some((x) => (x.from & 7) === (m.from & 7));
          const sameRank = rivals.some((x) => (x.from >> 4) === (m.from >> 4));
          if (!sameFile) dis = FILES[m.from & 7];
          else if (!sameRank) dis = String(8 - (m.from >> 4));
          else dis = sqName(m.from);
        }
        s = t.toUpperCase() + dis + (cap ? 'x' : '') + sqName(m.to);
      }
    }
    // שח / מט
    this._make(m);
    if (this.inCheck()) s += this.moves().length ? '+' : '#';
    this._unmake();
    return s;
  };

  /* --------------------------------------------------------------------- */
  /* סיום                                                                   */
  /* --------------------------------------------------------------------- */

  /** חומר לא מספיק למט: מלך מול מלך, או עם פרש/רץ יחיד, או רצים באותו צבע */
  P.insufficient = function () {
    const minors = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = this.board[sq];
      if (!p) continue;
      const t = typeOf(p);
      if (t === 'k') continue;
      if (t === 'p' || t === 'r' || t === 'q') return false;
      minors.push({ t, c: colorOf(p), shade: ((sq >> 4) + (sq & 7)) % 2 });
    }
    if (minors.length <= 1) return true;
    // כל הכלים הקלים הם רצים על אותו צבע משבצת
    return minors.every((m) => m.t === 'b') && minors.every((m) => m.shade === minors[0].shade);
  };

  P.repetitions = function () {
    const k = this.keys[this.keys.length - 1];
    return this.keys.filter((x) => x === k).length;
  };

  /**
   * @returns {{ over: boolean, result?: '1-0'|'0-1'|'1/2-1/2', reason?: string, winner?: 'w'|'b' }}
   * reason: mate, stalemate, fifty, repetition, material
   */
  P.status = function () {
    const moves = this.moves();
    if (!moves.length) {
      if (this.inCheck()) {
        const winner = other(this.turn);
        return { over: true, result: winner === 'w' ? '1-0' : '0-1', reason: 'mate', winner };
      }
      return { over: true, result: '1/2-1/2', reason: 'stalemate' };
    }
    if (this.half >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty' };
    if (this.repetitions() >= 3) return { over: true, result: '1/2-1/2', reason: 'repetition' };
    if (this.insufficient()) return { over: true, result: '1/2-1/2', reason: 'material' };
    return { over: false };
  };

  /** כל הכלים על הלוח — ל-UI: [{ square:'e4', piece:'P' }] */
  P.pieces = function () {
    const out = [];
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      if (this.board[sq]) out.push({ square: sqName(sq), piece: this.board[sq] });
    }
    return out;
  };

  /** המשבצת של המלך שבשח, אם יש */
  P.checkSquare = function () {
    return this.inCheck() ? sqName(this.kings[this.turn]) : null;
  };

  /** מספר הצמתים עד עומק — לבדיקת נכונות יצירת המהלכים */
  P.perft = function (depth) {
    if (depth === 0) return 1;
    const us = this.turn;
    const list = this._pseudo(false);
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      this._make(list[i]);
      if (!this.attacked(this.kings[us], other(us))) n += this.perft(depth - 1);
      this._unmake();
    }
    return n;
  };

  Chess.START = START;
  Chess.sqIndex = sqIndex;
  Chess.sqName = sqName;
  Chess.colorOf = colorOf;
  Chess.typeOf = typeOf;

  global.Chess = Chess;
})(typeof window !== 'undefined' ? window : globalThis);
