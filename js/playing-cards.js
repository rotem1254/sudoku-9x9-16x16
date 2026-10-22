/* =============================================================================
 * playing-cards.js — ציור קלף, משותף לבלאקג'ק ולפוקר
 * -----------------------------------------------------------------------------
 * קלף בשני המשחקים הוא { rank, suit }: rank בין 2 ל-14 (11 נסיך, 12 מלכה,
 * 13 מלך, 14 אס), ו-suit אחת מ-'s' 'h' 'd' 'c'. כאן רק הציור והשם לקורא
 * מסך — החוקים יושבים במנוע של כל משחק.
 *
 * אחרי כל סימן צורה בא U+FE0E, שמבקש גרסה טקסטואלית: בלעדיו ♥ ו-♦
 * מופיעים באייפון ובאנדרואיד כאמוג'י צבעוני ולא בצבע של הקלף.
 * =========================================================================== */
(function (global) {
  'use strict';

  const VS = '︎';
  const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const SUIT_NAME = { s: 'עלה', h: 'לב', d: 'יהלום', c: 'תלתן' };
  const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const RANK_NAME = { 11: 'נסיך', 12: 'מלכה', 13: 'מלך', 14: 'אס' };

  const label = (rank) => RANK[rank] || String(rank);
  const isRed = (suit) => suit === 'h' || suit === 'd';

  /** שם הקלף בעברית, למשל "מלכה לב" או "7 תלתן". */
  function name(card) {
    return (RANK_NAME[card.rank] || String(card.rank)) + ' ' + SUIT_NAME[card.suit];
  }

  /** טקסט קצר לתצוגה, למשל "Q♥". */
  function short(card) {
    return label(card.rank) + SUIT[card.suit] + VS;
  }

  function span(cls, text) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  /**
   * בונה אלמנט קלף.
   * @param {{rank:number,suit:string}|null} card  null = גב הקלף
   * @param {object} [opts] { size: רוחב בפיקסלים, deal: הנפשת חלוקה, delay }
   */
  function el(card, opts) {
    opts = opts || {};
    const d = document.createElement('div');
    d.className = 'pc';
    if (opts.size) d.style.setProperty('--card-w', opts.size + 'px');
    if (opts.deal) {
      d.classList.add('is-in');
      if (opts.delay) d.style.setProperty('--delay', opts.delay + 'ms');
    }

    if (!card) {
      d.classList.add('is-back');
      d.setAttribute('role', 'img');
      d.setAttribute('aria-label', 'קלף הפוך');
      return d;
    }

    const suit = SUIT[card.suit] + VS;
    const rank = label(card.rank);
    d.classList.add(isRed(card.suit) ? 'is-red' : 'is-black');
    d.setAttribute('role', 'img');
    d.setAttribute('aria-label', name(card));

    // הקלף עצמו תמיד LTR, כמו קלף אמיתי, גם בתוך דף RTL
    d.dir = 'ltr';
    for (const end of [false, true]) {
      const c = document.createElement('span');
      c.className = 'pc-corner' + (end ? ' is-end' : '');
      c.setAttribute('aria-hidden', 'true');
      c.appendChild(span('pc-rank', rank));
      c.appendChild(span('pc-suit', suit));
      d.appendChild(c);
    }

    const center = document.createElement('span');
    center.className = 'pc-center';
    center.setAttribute('aria-hidden', 'true');
    if (card.rank >= 11 && card.rank <= 13) {
      d.classList.add('is-face');
      center.appendChild(span('', rank));
    } else {
      center.textContent = suit;
    }
    d.appendChild(center);
    return d;
  }

  global.PlayingCards = { el, name, short, label, isRed, SUIT, SUIT_NAME };
})(window);
