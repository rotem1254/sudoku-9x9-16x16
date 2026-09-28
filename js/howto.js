/* =============================================================================
 * howto.js — "איך משחקים" בכניסה הראשונה
 * -----------------------------------------------------------------------------
 * לכל משחק יש חלון הסבר (#helpModal) שנפתח בכפתור ❓. מי שנכנס למשחק
 * בפעם הראשונה לא תמיד יודע שהכפתור קיים — ולכן בכניסה הראשונה לכל משחק
 * ההסבר נפתח לבד, פעם אחת. אחר כך הוא זמין רק דרך הכפתור.
 *
 * "נראה" נשמר לכל דף בנפרד, כך שכל משחק מציג את ההסבר שלו פעם אחת.
 * אם האחסון חסום — לא מציגים בכלל, כדי שההסבר לא יקפוץ בכל כניסה.
 * =========================================================================== */
(function () {
  'use strict';

  const modal = document.getElementById('helpModal');
  if (!modal || !window.Modal) return;

  const page = (location.pathname.split('/').pop() || 'index').replace(/\.html$/, '') || 'index';
  const KEY = 'howto.seen.' + page;

  let seen = true;
  try {
    seen = localStorage.getItem(KEY) === '1';
  } catch (e) {
    return;
  }
  if (seen) return;

  // מחכים שהמשחק יסיים לעלות, ולא דורסים חלון אחר שכבר פתוח (משחק שמור
  // שהסתיים, מסך טעינה של סודוקו וכו') — מנסים שוב עד כמה שניות
  let tries = 0;
  function show() {
    if (window.Modal.top()) {
      if (++tries < 20) setTimeout(show, 400);
      return;
    }
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* אין שמירה — מציגים בכל זאת */ }
    window.Modal.open(modal);
  }
  setTimeout(show, 700);
})();
