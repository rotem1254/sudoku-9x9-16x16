/* =============================================================================
 * ui-math.js — החישובים של שכבת הממשק
 * -----------------------------------------------------------------------------
 * ללא תלות ב-DOM, ולכן נבדק ב-Node.
 *
 * למה הקובץ הזה קיים: שכבת הממשק היא החלק הגדול ביותר בקוד ולא הייתה
 * עליה ולו בדיקה אחת — בעוד שהמנועים מכוסים היטב. וזה לא היה תיאורטי.
 * ארבעת הבאגים האחרונים ישבו כאן:
 *
 *   - FLIP שמדד מול המסך במקום מול האזור, ולכן הנפיש 15 אבנים שלא זזו
 *   - הרמת החלק בגרירה שלא ניקתה את האצבע בחלקים גבוהים
 *   - נקודת ההכנסה ב-RTL
 *   - חישוב ההיסט האדפטיבי בעמודות הסוליטר
 *
 * כל אחד מהם הוא פונקציה שמקבלת מספרים ומחזירה מספרים. הם נשלפו לכאן
 * כדי שאפשר יהיה לבדוק אותם, והממשקים קוראים לפונקציות האלה עצמן —
 * לא להעתק שלהן. בדיקה שבודקת עותק אינה שווה כלום.
 * =========================================================================== */
(function (global) {
  'use strict';

  /* --------------------------------------------------------------------- */
  /* גרירה על רשת                                                           */
  /* --------------------------------------------------------------------- */

  /**
   * איפה לצייר חלק שנגרר, ולאיזה תא הוא ייפול.
   *
   * החלק מוצג **מעל** נקודת המגע, אחרת האצבע מסתירה בדיוק את מה שמנסים
   * למקם. הרמה בגובה קבוע אינה מספיקה — חלק בן ארבעה תאים הוא כ-200
   * פיקסלים, והרמה של תא אחד משאירה את חציו התחתון מתחת לאצבע (נמדד:
   * 40 פיקסלים מתחת). לכן מה שקבוע הוא **המרווח מהתחתית**, וההרמה
   * נגזרת מגובה החלק.
   *
   * @param {object} o
   *   pointerX, pointerY  — נקודת המגע
   *   boardLeft, boardTop — פינת הלוח על המסך
   *   pad                 — ריפוד פנימי של הלוח
   *   step                — גודל תא ועוד המרווח בין תאים
   *   gap                 — המרווח בין תאים
   *   rows, cols          — מידות החלק בתאים
   *   clearance           — מרווח מתחתית החלק עד האצבע, בפיקסלים
   *   size                — מספר התאים בשורה/עמודה של הלוח
   * @returns {{centerX:number, centerY:number, row:number, col:number,
   *            width:number, height:number, bottom:number, inRange:boolean}}
   */
  function dragPlacement(o) {
    const width = o.cols * o.step - o.gap;
    const height = o.rows * o.step - o.gap;

    // המרכז נגזר מהתחתית, ולכן המרווח מהאצבע קבוע בכל גובה חלק
    const centerY = o.pointerY - o.clearance - height / 2;
    const centerX = o.pointerX;

    const left = centerX - width / 2;
    const top = centerY - height / 2;

    const col = Math.round((left - o.boardLeft - o.pad) / o.step);
    const row = Math.round((top - o.boardTop - o.pad) / o.step);

    const inRange =
      row >= 0 && col >= 0 &&
      row + o.rows <= o.size && col + o.cols <= o.size;

    return {
      centerX, centerY, row, col, width, height,
      bottom: centerY + height / 2,
      inRange,
    };
  }

  /* --------------------------------------------------------------------- */
  /* FLIP — תנועת אלמנטים בין ציורים                                        */
  /* --------------------------------------------------------------------- */

  /**
   * ההפרש שממנו צריך להנפיש אלמנט שזז.
   *
   * המדידה היא **ביחס לאזור** ולא למסך, וזה לא פרט טכני: כשגובה אזור
   * אחד משתנה, כל האזור שמתחתיו זז כמה פיקסלים — ובמדידה מול המסך *כל*
   * אלמנט בו היה מונפש בלי שזז באמת. נמדד: 15 אבני שולחן שכולן זזות
   * בדיוק אותו הפרש, בלי ששום דבר בשולחן השתנה.
   *
   * אלמנט שעבר **בין אזורים** הוא המקרה ההפוך, ושם דווקא ההפרש על המסך
   * הוא הנכון, כי שני האזורים שונים זה מזה.
   *
   * @param {{zone:string, x:number, y:number, sx:number, sy:number}} prev
   * @param {{zone:string, x:number, y:number, sx:number, sy:number}} now
   * @param {number} [epsilon] תזוזה שקטנה ממנה נחשבת לאפס
   * @returns {{dx:number, dy:number, moved:boolean, crossedZones:boolean}}
   */
  function flipDelta(prev, now, epsilon) {
    const eps = epsilon == null ? 1 : epsilon;
    const sameZone = prev.zone === now.zone;
    const dx = sameZone ? prev.x - now.x : prev.sx - now.sx;
    const dy = sameZone ? prev.y - now.y : prev.sy - now.sy;
    return {
      dx, dy,
      moved: Math.abs(dx) >= eps || Math.abs(dy) >= eps,
      crossedZones: !sameZone,
    };
  }

  /* --------------------------------------------------------------------- */
  /* נקודת הכנסה בשורה                                                      */
  /* --------------------------------------------------------------------- */

  /**
   * לאיזה מקום ברשימה נכנס פריט שהופל בנקודה x.
   *
   * הספירה היא של הפריטים שמרכזם **מימין** ל-x, כי הפריסה היא RTL:
   * ככל שמפילים ימינה יותר, המקום קטן יותר. בפריסה LTR זה בדיוק הפוך,
   * ולכן הכיוון הוא פרמטר ולא הנחה.
   *
   * @param {Array<{left:number, width:number}>} rects מלבני הפריטים
   * @param {number} x נקודת ההפלה
   * @param {boolean} [rtl] ברירת מחדל true
   * @returns {number} אינדקס ההכנסה, בטווח 0..rects.length
   */
  function insertIndex(rects, x, rtl) {
    const isRtl = rtl !== false;
    let i = 0;
    for (const r of rects) {
      const center = r.left + r.width / 2;
      if (isRtl ? x < center : x > center) i++;
    }
    return i;
  }

  /* --------------------------------------------------------------------- */
  /* היסט אדפטיבי בערימה                                                    */
  /* --------------------------------------------------------------------- */

  /**
   * כמה להסיט קלף גלוי מעל זה שמתחתיו.
   *
   * ההיסט הוא גם שטח ההקשה של הקלף: קלף בתוך ערימה חשוף רק ברוחב
   * ההיסט. לכן לוקחים את ההיסט הגדול ביותר שעדיין מכניס את **הערימה
   * הצפופה ביותר** לגובה הפנוי, ומגבילים לטווח סביר.
   *
   * @param {object} o
   *   availableCqw — הגובה הפנוי, ביחידות רוחב עמודה
   *   cardH        — גובה קלף באותן יחידות
   *   offsetDown   — היסט של קלף הפוך
   *   piles        — [{ up, down }] לכל ערימה
   *   min, max     — גבולות ההיסט
   * @returns {number}
   */
  function fanOffset(o) {
    /*
     * **הערימה הצפופה ביותר היא שקובעת**, ולכן min ולא max.
     *
     * הקוד המקורי לקח את המקסימום, כלומר את הערימה הכי *פחות* לחוצה —
     * וההיסט שנבחר לפיה לא הכניס את הארוכה. מדידה על מצב אמיתי: גובה
     * פנוי 400, הערימה הארוכה הגיעה ל-758 במקום ל-470. הבאג נחשף ברגע
     * שהחישוב נשלף מה-UI ואפשר היה לבדוק אותו
     */
    let tightest = Infinity;
    for (const pile of o.piles) {
      if (!pile.up && !pile.down) continue;
      // (up - 1) כי הקלף האחרון תופס גובה קלף מלא, לא היסט
      const room =
        (o.availableCqw - o.cardH - pile.down * o.offsetDown) /
        Math.max(1, pile.up - 1);
      tightest = Math.min(tightest, room);
    }
    // בלי ערימות אין אילוץ, ואז ההיסט הנוח ביותר הוא הנכון
    if (tightest === Infinity) tightest = o.max;
    return Math.round(Math.min(o.max, Math.max(o.min, tightest)));
  }

  /* --------------------------------------------------------------------- */
  /* זמן                                                                    */
  /* --------------------------------------------------------------------- */

  /** שניות ל-mm:ss, או h:mm:ss כשעברה שעה. */
  function formatClock(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? h + ':' + pad(m) + ':' + pad(sec) : pad(m) + ':' + pad(sec);
  }

  global.UIMath = {
    dragPlacement,
    flipDelta,
    insertIndex,
    fanOffset,
    formatClock,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
