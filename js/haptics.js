/* =============================================================================
 * haptics.js — משוב מישושי מדורג
 * -----------------------------------------------------------------------------
 * המצב האמיתי בשטח, ולא מה שהיינו רוצים שיהיה:
 *
 *   אנדרואיד  — navigator.vibrate עובד, כולל דפוסים באורכים שונים. כאן
 *               אפשר באמת לדרג: נגיעה קלה, הנחה, דחייה.
 *
 *   אייפון    — navigator.vibrate פשוט לא קיים. הדרך היחידה שנשארה היא
 *               טריק: מאז Safari 17.4 יש <input type="checkbox" switch>,
 *               ושינוי מצבו מפעיל את ה-Taptic Engine. אין שליטה בעוצמה
 *               ואין דפוסים — רק "נקישה קרתה".
 *
 *               אפל סגרה את זה ב-iOS 26.5. בגרסאות חדשות זה כנראה כבר
 *               לא יעבוד, ואין תחליף. לכן הקוד לא מתיימר: הוא מנסה,
 *               ומדווח ב-supported() מה באמת זמין.
 *
 * המסקנה המעשית: **המשוב החזותי חייב לעמוד בפני עצמו.** הרטט הוא תוספת
 * שאולי תגיע ואולי לא, ואסור שמידע יעבור דרכו בלבד.
 * =========================================================================== */
(function (global) {
  'use strict';

  const nav = global.navigator || {};
  const canVibrate = typeof nav.vibrate === 'function';

  const isIOS =
    /iP(hone|ad|od)/.test(nav.platform || '') ||
    // אייפד מודרני מתחזה למק, ומסגיר את עצמו במסך מגע
    (/Mac/.test(nav.platform || '') && 'ontouchend' in global.document);

  /*
   * אוצר מילים של תחושות. המספרים במילישניות; מערך הוא רטט-הפסקה-רטט.
   * הרעיון שכל פעולה תרגיש אחרת מספיק כדי שהיד תדע מה קרה בלי להסתכל.
   */
  const PATTERNS = {
    pick: 8, // הרמת אבן — קליק כמעט לא מורגש
    move: 12, // הנחה במקום חוקי
    lock: [10, 28, 26], // צירוף נהיה חוקי — שתי פעימות, השנייה חזקה
    reject: [24, 44, 24], // מהלך שנדחה — שווה ומחוספס
    draw: 16, // משיכה מהבריכה
    opponent: 6, // היריב שיחק — רק כדי להרים את העין
    warn: [14, 70, 14], // הזמן אוזל
    win: [14, 40, 14, 40, 46], // סיום — מסתיים בפעימה ארוכה
  };

  /* ---------------------------- אייפון ---------------------------------- */

  let iosToggle = null;
  let iosWorks = null; // null = עוד לא נבדק

  function iosElement() {
    if (iosToggle) return iosToggle;
    const doc = global.document;
    if (!doc || !doc.body) return null;

    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', ''); // זה מה שמפעיל את ה-Taptic Engine
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    input.style.cssText =
      'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;' +
      'margin:-1px;padding:0;border:0;clip:rect(0 0 0 0);overflow:hidden';
    doc.body.appendChild(input);

    /*
     * אם הדפדפן לא מכיר את המאפיין, הוא מציג צ'קבוקס רגיל והטריק חסר
     * משמעות. זו הבדיקה הכי קרובה שיש ל"האם זה עובד"
     */
    iosWorks = input.matches(':is([switch])') && 'switch' in input;
    iosToggle = input;
    return input;
  }

  function iosPulse() {
    const el = iosElement();
    if (!el) return;
    el.checked = !el.checked;
  }

  /* ----------------------------- הפעלה ---------------------------------- */

  let enabled = true;

  /**
   * מפעיל תחושה בשם נתון.
   * @param {string} name מפתח מתוך PATTERNS
   */
  function fire(name) {
    if (!enabled) return;
    const pattern = PATTERNS[name];
    if (pattern == null) return;

    if (canVibrate) {
      try { nav.vibrate(pattern); } catch (e) { /* חסום ע"י המשתמש */ }
      return;
    }

    if (!isIOS) return;

    /*
     * באייפון אין עוצמה ואין אורך — יש רק נקישה. דפוס מרובה-פעימות
     * משוחזר כמספר נקישות בהפרשי הזמן המקוריים, וזה הקירוב הטוב ביותר
     * שאפשר. יותר משלוש נקישות מרגיש כמו תקלה, ולכן זה חסום
     */
    const pulses = Array.isArray(pattern)
      ? pattern.filter((_, i) => i % 2 === 0).slice(0, 3)
      : [pattern];

    let delay = 0;
    pulses.forEach((_, i) => {
      if (i === 0) iosPulse();
      else {
        delay += (pattern[i * 2 - 1] || 40) + 30;
        global.setTimeout(iosPulse, delay);
      }
    });
  }

  /** האם משוב מישושי בכלל אפשרי במכשיר הזה. */
  function supported() {
    if (canVibrate) return 'vibrate';
    if (isIOS) {
      iosElement();
      return iosWorks ? 'ios-switch' : 'none';
    }
    return 'none';
  }

  global.Haptics = {
    fire,
    supported,
    setEnabled(on) { enabled = !!on; },
    isEnabled() { return enabled; },
    PATTERNS,
  };
})(window);
