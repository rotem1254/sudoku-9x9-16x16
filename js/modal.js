/* =============================================================================
 * modal.js — פתיחה וסגירה של חלונות, עם ניהול פוקוס
 * -----------------------------------------------------------------------------
 * עד עכשיו פתיחת מודל הייתה `node.hidden = false` וזהו. מי שגלש במקלדת
 * נשאר עם הפוקוס **מאחורי** החלון: Tab המשיך לרוץ על הכפתורים שברקע,
 * קורא מסך המשיך להקריא את הדף שמתחת, ו-Esc לא עשה כלום.
 *
 * שלושה דברים שחלון חייב לעשות:
 *   1. להעביר את הפוקוס פנימה בפתיחה
 *   2. לכלוא את Tab בתוכו כל עוד הוא פתוח
 *   3. להחזיר את הפוקוס למי שפתח אותו בסגירה
 *
 * ובנוסף Esc סוגר, כמו בכל חלון בעולם.
 * =========================================================================== */
(function (global) {
  'use strict';

  const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  /** מי היה בפוקוס לפני שהחלון נפתח, לכל חלון פתוח */
  const openers = new Map();
  /** מחסנית החלונות הפתוחים — התחתון נשאר כלוא גם הוא */
  const stack = [];

  function focusableIn(node) {
    return Array.prototype.filter.call(
      node.querySelectorAll(FOCUSABLE),
      (n) => n.offsetParent !== null || n === document.activeElement
    );
  }

  /**
   * פותח חלון.
   * @param {HTMLElement} node
   * @param {HTMLElement} [opener] מי לחזור אליו בסגירה
   */
  function open(node, opener) {
    if (!node || !node.hidden) return;

    openers.set(node, opener || document.activeElement);
    node.hidden = false;
    stack.push(node);

    /*
     * הפוקוס עובר לכפתור הראשי אם יש, ואחרת לראשון שאפשר. הכפתור הראשי
     * הוא מה שהמשתמש רוצה ב-95% מהמקרים, ולהתחיל ממנו חוסך Tab מיותר
     */
    const primary = node.querySelector('.btn-primary');
    const first = focusableIn(node)[0];
    const target = primary || first || node;
    if (target && target.focus) {
      /*
       * ההתמקדות נדחית כדי לא להתנגש עם ההקשה שפתחה את החלון —
       * ובכוונה ב-setTimeout ולא ב-requestAnimationFrame. rAF אינו רץ
       * בלשונית שאינה מציירת, ואז הפוקוס פשוט לא זז. זו אותה מלכודת
       * שעצרה בעבר את יצירת הפאזלים בסודוקו
       */
      global.setTimeout(() => {
        try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
      }, 0);
    }
  }

  /** סוגר חלון ומחזיר את הפוקוס למי שפתח אותו. */
  function close(node) {
    if (!node || node.hidden) return;

    node.hidden = true;
    const i = stack.indexOf(node);
    if (i >= 0) stack.splice(i, 1);

    const opener = openers.get(node);
    openers.delete(node);
    if (opener && opener.isConnected && opener.focus) {
      try { opener.focus({ preventScroll: true }); } catch (e) { opener.focus(); }
    }
  }

  /** החלון שנמצא כרגע למעלה, או null. */
  const top = () => (stack.length ? stack[stack.length - 1] : null);

  /* --------------------------------------------------------------------- */
  /* לכידת המקלדת                                                           */
  /* --------------------------------------------------------------------- */

  document.addEventListener('keydown', (e) => {
    const node = top();
    if (!node) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      close(node);
      return;
    }

    if (e.key !== 'Tab') return;

    const items = focusableIn(node);
    if (!items.length) { e.preventDefault(); return; }

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    /* גלגול: מהאחרון קדימה חוזרים לראשון, ומהראשון אחורה לאחרון */
    if (e.shiftKey && (active === first || !node.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !node.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }, true);

  global.Modal = { open, close, top, focusableIn };
})(window);
