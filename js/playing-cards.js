/* =============================================================================
 * playing-cards.js — ציור קלף, משותף לבלאקג'ק ולפוקר
 * -----------------------------------------------------------------------------
 * קלף הוא { rank, suit }: rank בין 2 ל-14 (11 נסיך, 12 מלכה, 13 מלך,
 * 14 אס), ו-suit אחת מ-'s' 'h' 'd' 'c'. כאן רק הציור והשם לקורא מסך —
 * החוקים יושבים במנוע של כל משחק.
 *
 * הצורות (לב, יהלום, תלתן, עלה) הן ציורי SVG שלנו, שנטענים פעם אחת לדף
 * כ-<symbol> ומשוכפלים ב-<use>. תווי יוניקוד נראים אחרת בכל מערכת, ובחלק
 * מהטלפונים הופכים לאמוג'י צבעוני — SVG נראה זהה בכל מקום ובכל גודל.
 *
 * לכל קלף שני צדדים. el(card, { down: true }) יוצר קלף הפוך, ו-reveal()
 * הופך אותו בהנפשה. קלף שנוצר בלי card (null) הוא גב בלבד, עד ש-reveal
 * מקבל את הקלף ובונה לו פנים.
 * =========================================================================== */
(function (global) {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';

  const SUIT_NAME = { s: 'עלה', h: 'לב', d: 'יהלום', c: 'תלתן' };
  const SUIT_CHAR = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const RANK_NAME = { 11: 'נסיך', 12: 'מלכה', 13: 'מלך', 14: 'אס' };

  /* צורות ב-viewBox של 100×100 — ציורים מקוריים, מאוזנים לגודל חזותי דומה */
  const SUIT_PATH = {
    h: 'M50 90C22 68 5 51 5 31 5 16 16 6 29 6c10 0 17 6 21 14C54 12 61 6 71 6c13 0 24 10 24 25 0 20-17 37-45 59z',
    d: 'M50 4c10 15 22 30 38 46-16 16-28 31-38 46-10-15-22-30-38-46C28 34 40 19 50 4z',
    s: 'M50 5c10 16 44 32 44 56 0 13-10 22-22 22-8 0-15-4-19-10 1 10 5 17 13 23H34c8-6 12-13 13-23-4 6-11 10-19 10C16 83 6 74 6 61 6 37 40 21 50 5z',
    c: 'M50 7a19 19 0 0 1 16 29 19 19 0 1 1 1 38c-8 0-14-4-17-10 1 11 5 19 13 25H37c8-6 12-14 13-25-3 6-9 10-17 10a19 19 0 1 1 1-38A19 19 0 0 1 50 7z',
  };

  /*
   * סידור הצורות בקלפי המספר, באחוזים מתוך שטח הציור. f = הפוך (החצי
   * התחתון של הקלף). זה הסידור המסורתי: שתי עמודות, ועמודה אמצעית לחלק
   */
  const L = 0, C = 50, R = 100;
  const PIPS = {
    2: [[C, 0], [C, 100, 1]],
    3: [[C, 0], [C, 50], [C, 100, 1]],
    4: [[L, 0], [R, 0], [L, 100, 1], [R, 100, 1]],
    5: [[L, 0], [R, 0], [C, 50], [L, 100, 1], [R, 100, 1]],
    6: [[L, 0], [R, 0], [L, 50], [R, 50], [L, 100, 1], [R, 100, 1]],
    7: [[L, 0], [R, 0], [C, 25], [L, 50], [R, 50], [L, 100, 1], [R, 100, 1]],
    8: [[L, 0], [R, 0], [C, 25], [L, 50], [R, 50], [C, 75, 1], [L, 100, 1], [R, 100, 1]],
    9: [[L, 0], [R, 0], [L, 33.3], [R, 33.3], [C, 50], [L, 66.7, 1], [R, 66.7, 1], [L, 100, 1], [R, 100, 1]],
    10: [[L, 0], [R, 0], [C, 16.7], [L, 33.3], [R, 33.3], [L, 66.7, 1], [R, 66.7, 1], [C, 83.3, 1], [L, 100, 1], [R, 100, 1]],
  };

  const label = (rank) => RANK[rank] || String(rank);
  const isRed = (suit) => suit === 'h' || suit === 'd';

  /** שם הקלף בעברית, למשל "מלכה לב" או "7 תלתן". */
  function name(card) {
    return (RANK_NAME[card.rank] || String(card.rank)) + ' ' + SUIT_NAME[card.suit];
  }

  /** טקסט קצר לתצוגה, למשל "Q♥". */
  function short(card) {
    return label(card.rank) + SUIT_CHAR[card.suit] + '︎';
  }

  /* ---------------------------- SVG ---------------------------------- */

  let spriteReady = false;
  function ensureSprite() {
    if (spriteReady || !global.document || !document.body) return;
    spriteReady = true;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    Object.keys(SUIT_PATH).forEach((s) => {
      const sym = document.createElementNS(SVGNS, 'symbol');
      sym.id = 'pc-suit-' + s;
      sym.setAttribute('viewBox', '0 0 100 100');
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', SUIT_PATH[s]);
      sym.appendChild(p);
      svg.appendChild(sym);
    });
    document.body.insertBefore(svg, document.body.firstChild);
  }

  function suitSvg(suit, cls) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(SVGNS, 'use');
    use.setAttribute('href', '#pc-suit-' + suit);
    svg.appendChild(use);
    return svg;
  }

  /*
   * ציור קלף תמונה: חצי עליון (כתר, אות, צורה) והעתק הפוך בחצי התחתון,
   * עם פס מפריד. כל דרגה עם כתר משלה — מלך עם שלוש שיניים, מלכה עם נזר
   * מעוגל, נסיך עם כובע ונוצה. ציורים מקוריים ופשוטים בכוונה
   */
  const G = 'fill="#d4a640" stroke="rgba(80,50,0,.55)" stroke-width="1.2"';
  const CROWN = {
    13: '<path d="M30 30 L33 13 L42 22 L50 9 L58 22 L67 13 L70 30 Z" ' + G + '/>' +
      '<rect x="29" y="29" width="42" height="6" rx="1.5" ' + G + '/>' +
      '<circle cx="33" cy="12" r="2.4" ' + G + '/><circle cx="50" cy="8" r="2.6" ' + G + '/><circle cx="67" cy="12" r="2.4" ' + G + '/>' +
      '<circle cx="50" cy="32" r="1.8" fill="currentColor"/>',
    12: '<path d="M31 33 Q50 8 69 33 Z" ' + G + '/>' +
      '<rect x="30" y="31" width="40" height="5" rx="2.5" ' + G + '/>' +
      '<circle cx="50" cy="14" r="3" fill="currentColor"/><circle cx="39" cy="21" r="1.8" ' + G + '/><circle cx="61" cy="21" r="1.8" ' + G + '/>',
    11: '<path d="M30 34 Q30 18 52 17 Q70 17 72 30 Q73 35 66 35 L34 35 Q30 35 30 34 Z" ' + G + '/>' +
      '<path d="M62 19 Q76 6 84 8 Q74 12 66 22 Z" fill="currentColor"/>' +
      '<rect x="30" y="32" width="42" height="4" rx="2" ' + G + '/>',
  };

  function courtSvg(card) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 160');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('aria-hidden', 'true');
    const letter = label(card.rank);
    const half =
      '<g>' + CROWN[card.rank] +
      '<text x="40" y="73" text-anchor="middle" fill="currentColor" ' +
      'style="font:700 36px Georgia,\'Times New Roman\',serif">' + letter + '</text>' +
      '<use href="#pc-suit-' + card.suit + '" x="58" y="50" width="24" height="24"/>' +
      '</g>';
    svg.innerHTML =
      half +
      '<line x1="12" y1="80" x2="88" y2="80" stroke="currentColor" stroke-opacity=".35" stroke-width="1"/>' +
      '<g transform="rotate(180 50 80)">' + half + '</g>';
    return svg;
  }

  /* ---------------------------- קלף ---------------------------------- */

  function div(cls) {
    const d = document.createElement('div');
    d.className = cls;
    return d;
  }

  function buildFront(card) {
    const front = div('pc-face pc-front');
    const rank = label(card.rank);

    for (const end of [false, true]) {
      const c = document.createElement('span');
      c.className = 'pc-corner' + (end ? ' is-end' : '');
      c.setAttribute('aria-hidden', 'true');
      const r = document.createElement('span');
      r.className = 'pc-rank' + (card.rank === 10 ? ' is-ten' : '');
      r.textContent = rank;
      c.appendChild(r);
      c.appendChild(suitSvg(card.suit, 'pc-suit'));
      front.appendChild(c);
    }

    if (card.rank === 14) {
      if (card.suit === 's') front.appendChild(div('pc-ace-ring'));
      front.appendChild(suitSvg(card.suit, 'pc-ace' + (card.suit === 's' ? ' is-spade' : '')));
    } else if (card.rank >= 11) {
      const court = div('pc-court');
      court.appendChild(courtSvg(card));
      front.appendChild(court);
      front.appendChild(suitSvg(card.suit, 'pc-mini'));
    } else {
      const pips = div('pc-pips' + (card.rank >= 9 ? ' is-dense' : ''));
      for (const [x, y, flip] of PIPS[card.rank]) {
        const p = suitSvg(card.suit, 'pc-pip' + (flip ? ' is-flip' : ''));
        p.style.setProperty('--x', x + '%');
        p.style.setProperty('--y', y + '%');
        pips.appendChild(p);
      }
      front.appendChild(pips);
      front.appendChild(suitSvg(card.suit, 'pc-mini'));
    }
    return front;
  }

  function setIdentity(node, card) {
    node.classList.remove('is-red', 'is-black');
    if (card) {
      node.classList.add(isRed(card.suit) ? 'is-red' : 'is-black');
      node.setAttribute('aria-label', name(card));
    } else {
      node.setAttribute('aria-label', 'קלף הפוך');
    }
  }

  /**
   * בונה אלמנט קלף.
   * @param {{rank:number,suit:string}|null} card  null = גב בלבד
   * @param {object} [opts]
   *   size  — רוחב בפיקסלים (אחרת יורש --card-w מהמיכל)
   *   down  — להתחיל הפוך (גם כשהקלף ידוע — לחשיפה מאוחרת)
   *   deal  — הנפשת חלוקה, עם delay במילישניות
   */
  function el(card, opts) {
    opts = opts || {};
    ensureSprite();
    const d = div('pc');
    d.dir = 'ltr'; // קלף תמיד LTR, כמו קלף אמיתי, גם בדף RTL
    d.setAttribute('role', 'img');
    if (opts.size) d.style.setProperty('--card-w', opts.size + 'px');
    if (opts.deal) {
      d.classList.add('is-in');
      if (opts.delay) d.style.setProperty('--delay', opts.delay + 'ms');
    }

    const inner = div('pc-card');
    if (card) inner.appendChild(buildFront(card));
    inner.appendChild(div('pc-face pc-back'));
    d.appendChild(inner);

    const down = !card || opts.down;
    if (down) d.classList.add('is-down', 'is-back');
    setIdentity(d, down ? null : card);
    if (card) d._card = card;
    return d;
  }

  /**
   * הופך קלף הפוך לפנים, בהנפשה (הרמה, סיבוב, נחיתה).
   * @param {HTMLElement} node קלף מ-el()
   * @param {object} [card] הקלף, אם לא היה ידוע כשנבנה
   * @param {object} [opts] { delay, instant }
   * @returns {Promise} מתממש כשההיפוך נגמר
   */
  function reveal(node, card, opts) {
    opts = opts || {};
    card = card || node._card;
    return new Promise((resolve) => {
      const go = () => {
        const inner = node.querySelector('.pc-card');
        if (!node.querySelector('.pc-front') && card) inner.insertBefore(buildFront(card), inner.firstChild);
        node._card = card;
        setIdentity(node, card);
        const still = opts.instant ||
          (global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
        node.classList.remove('is-down', 'is-back');
        if (still) { resolve(); return; }
        node.classList.add('is-revealing');
        const done = () => { node.classList.remove('is-revealing'); resolve(); };
        inner.addEventListener('animationend', done, { once: true });
        setTimeout(done, 700); // אם האירוע לא הגיע (לשונית ברקע)
      };
      if (opts.delay) setTimeout(go, opts.delay); else go();
    });
  }

  global.PlayingCards = { el, reveal, name, short, label, isRed, SUIT: SUIT_CHAR, SUIT_NAME, suitSvg, ensureSprite };
})(window);
