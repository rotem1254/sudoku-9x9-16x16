/* =============================================================================
 * table-fx.js — תנועה על השולחן: ז'יטונים, ערימות, קלפים שעפים, מונים
 * -----------------------------------------------------------------------------
 * משותף לבלאקג'ק ולפוקר. כל התנועות כאן בנויות על אותם עקרונות:
 *
 *   האצה והאטה, לא קו ישר  — שום דבר אמיתי לא זז במהירות קבועה. ז'יטון
 *                             שנזרק יוצא מהר ומתיישב לאט.
 *   קשת קלה                 — ז'יטון שעף לקופה עולה מעט באמצע הדרך, כמו
 *                             שזורקים אותו, ולא מחליק על הלבד.
 *   במינון                  — תנועה מחזקת את מה שקרה, לא מחליפה אותו. כל
 *                             מידע גלוי גם בלי הנפשה, וב"פחות תנועה" הכול
 *                             מיידי.
 *
 * הכול ב-Web Animations API, שמחזיר Promise ומשאיר את ה-DOM נקי אחרי.
 * =========================================================================== */
(function (global) {
  'use strict';

  const DENOMS = [1000, 500, 100, 50, 25, 10, 5];
  const EASE_OUT = 'cubic-bezier(.2, .8, .25, 1)';

  const still = () =>
    !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /** פירוק סכום לז'יטונים, מהגדול לקטן. */
  function breakdown(amount, denoms) {
    const list = denoms || DENOMS;
    const out = [];
    let left = Math.floor(amount);
    for (const d of list) {
      while (left >= d) { out.push(d); left -= d; }
    }
    if (left > 0 && list.length) out.push(list[list.length - 1]);
    return out;
  }

  /** ז'יטון בודד. */
  function chip(value, opts) {
    opts = opts || {};
    const c = document.createElement(opts.tag || 'span');
    c.className = 'chip chip-' + value;
    if (opts.size) c.style.setProperty('--chip-size', opts.size + 'px');
    const s = document.createElement('span');
    s.textContent = value >= 1000 ? (value / 1000) + 'K' : String(value);
    c.appendChild(s);
    return c;
  }

  /**
   * ערימת ז'יטונים לסכום — הגדולים בתחתית, עד max ז'יטונים (מעבר לזה
   * הערימה רק נראית גבוהה; הסכום עצמו מוצג בטקסט ליד).
   */
  function stack(amount, opts) {
    opts = opts || {};
    const max = opts.max || 8;
    const wrap = document.createElement('span');
    wrap.className = 'chip-stack';
    wrap.setAttribute('aria-hidden', 'true');
    if (opts.size) wrap.style.setProperty('--chip-size', opts.size + 'px');
    let chips = breakdown(amount, opts.denoms);
    if (chips.length > max) chips = chips.slice(0, max);
    wrap.style.setProperty('--n', Math.max(1, chips.length));
    chips.forEach((v, i) => {
      const c = chip(v);
      c.style.setProperty('--i', i);
      wrap.appendChild(c);
    });
    return wrap;
  }

  const rectOf = (x) => (x && x.getBoundingClientRect ? x.getBoundingClientRect() : x);
  const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  /**
   * FLIP: אלמנט שכבר במקומו הסופי "מגיע" מנקודה אחרת — למשל קלף שעף
   * מהחפיסה לידו של השחקן. ה-DOM לא משתנה; רק ההנפשה.
   * @param {HTMLElement} node
   * @param {HTMLElement|DOMRect} from
   * @param {object} [o] { duration, delay, rotate, scale, easing }
   */
  function flyIn(node, from, o) {
    o = o || {};
    if (still() || !node.animate) return Promise.resolve();
    const a = center(rectOf(from));
    const b = center(node.getBoundingClientRect());
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const anim = node.animate([
      { transform: `translate(${dx}px, ${dy}px) rotate(${o.rotate == null ? -14 : o.rotate}deg) scale(${o.scale || .82})`, opacity: o.fade ? 0 : 1 },
      { opacity: 1, offset: .2 },
      { transform: 'none', opacity: 1 },
    ], { duration: o.duration || 420, delay: o.delay || 0, easing: o.easing || EASE_OUT, fill: 'backwards' });
    return anim.finished.catch(() => {});
  }

  /**
   * רוח רפאים: עותק של אלמנט עף מנקודה לנקודה מעל הכול ונעלם — ז'יטונים
   * לקופה, קופה למנצח. המקור והיעד לא זזים.
   * @param {HTMLElement} ghost אלמנט חדש (לא בתוך הדף)
   * @param {HTMLElement|DOMRect} from
   * @param {HTMLElement|DOMRect} to
   * @param {object} [o] { duration, delay, arc, fadeOut, scaleTo }
   */
  function toss(ghost, from, to, o) {
    o = o || {};
    if (still() || !ghost.animate) return Promise.resolve();
    const a = center(rectOf(from));
    const b = center(rectOf(to));
    ghost.classList.add('fx-ghost');
    document.body.appendChild(ghost);
    const w = ghost.offsetWidth;
    const h = ghost.offsetHeight;
    ghost.style.left = (a.x - w / 2) + 'px';
    ghost.style.top = (a.y - h / 2) + 'px';
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lift = o.arc == null ? Math.min(60, Math.hypot(dx, dy) * .22) : o.arc;
    const anim = ghost.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx * .5}px, ${dy * .5 - lift}px) scale(1.08)`, opacity: 1, offset: .5 },
      { transform: `translate(${dx}px, ${dy}px) scale(${o.scaleTo || 1})`, opacity: o.fadeOut === false ? 1 : .0 },
    ], { duration: o.duration || 520, delay: o.delay || 0, easing: 'cubic-bezier(.35, .1, .25, 1)', fill: 'both' });
    return anim.finished.catch(() => {}).then(() => ghost.remove());
  }

  /**
   * מונה שמטפס לערך החדש (קופה, ניקוד). בזמן ההנפשה הטקסט מתעדכן,
   * ולקורא המסך מספיק הערך הסופי — שם הוא מוכרז בנפרד.
   */
  function countUp(el, from, to, ms, format) {
    format = format || ((n) => n.toLocaleString('en-US'));
    if (el._countRaf) cancelAnimationFrame(el._countRaf);
    if (still() || from === to || !ms) { el.textContent = format(to); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = format(Math.round(from + (to - from) * e));
      if (k < 1) el._countRaf = requestAnimationFrame(step);
      else el._countRaf = 0;
    };
    el._countRaf = requestAnimationFrame(step);
  }

  /** קפיצה קטנה לתשומת לב (ערך שהשתנה, כפתור שמומלץ). */
  function bump(el) {
    if (still() || !el || !el.animate) return;
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
      { duration: 320, easing: EASE_OUT });
  }

  global.TableFX = { breakdown, chip, stack, flyIn, toss, countUp, bump, still, DENOMS };
})(window);
