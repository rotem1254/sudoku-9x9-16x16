/* =============================================================================
 * announce.js — הכרזות לקורא מסך
 * -----------------------------------------------------------------------------
 * הטוסטים באתר כבר נשאו `role="status"`, אבל הם `hidden` כשאין מה להציג —
 * ואלמנט עם `display: none` אינו נמצא בעץ הנגישות כלל. תוכן שנכתב לתוכו
 * בזמן שהוא מוסתר, ורק אחר כך נחשף, אינו מוכרז באופן אמין.
 *
 * לכן יש כאן אזור חי **נפרד מהתצוגה**: הוא תמיד בעץ, תמיד ריק כשאין מה
 * לומר, וקיים רק בשביל קוראי מסך. הטוסט נשאר מה שהוא — משוב ויזואלי.
 * =========================================================================== */
(function (global) {
  'use strict';

  let node = null;

  function region() {
    if (node && node.isConnected) return node;
    node = document.getElementById('live');
    if (!node) {
      node = document.createElement('p');
      node.id = 'live';
      node.className = 'sr-only';
      node.setAttribute('role', 'status');
      node.setAttribute('aria-live', 'polite');
      node.setAttribute('aria-atomic', 'true');
      document.body.appendChild(node);
    }
    return node;
  }

  let clearTimer = null;
  let last = '';

  /**
   * מכריז הודעה.
   *
   * @param {string} msg
   * @param {boolean} [assertive] להפריע למה שנקרא כרגע. שמור לסוף משחק
   *   ולשגיאות — הכרזה תוקפנית על כל מהלך היא רעש בלתי נסבל
   */
  function say(msg, assertive) {
    if (!msg) return;
    const r = region();
    r.setAttribute('aria-live', assertive ? 'assertive' : 'polite');

    /*
     * אותה הודעה פעמיים ברצף אינה מוכרזת שוב, כי התוכן לא השתנה.
     * תו רווח דק בסוף מייצר שינוי בלי לשנות את מה שנשמע
     */
    const text = msg === last ? msg + ' ' : msg;
    r.textContent = text;
    last = msg;

    // מנקים אחרי כמה שניות, כדי שהאזור לא יישאר עם טקסט ישן
    clearTimeout(clearTimer);
    clearTimer = global.setTimeout(() => { r.textContent = ''; last = ''; }, 4000);
  }

  global.Announce = { say, region };
})(window);
