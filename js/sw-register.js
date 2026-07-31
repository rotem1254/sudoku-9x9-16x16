/* =============================================================================
 * sw-register.js — רישום ה-Service Worker
 * -----------------------------------------------------------------------------
 * מופרד לקובץ משלו כדי ששלושת הדפים יטענו את אותו קוד ולא שלושה עותקים.
 *
 * Service Worker פועל רק ב-https (או ב-localhost). בפתיחה מקומית מ-file://
 * הדפדפן חוסם אותו, ולכן יש בדיקת פרוטוקול — אחרת הקונסולה מתמלאת שגיאות
 * בכל פתיחה של הקובץ מהמחשב.
 * =========================================================================== */
(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {
      /* נכשל => האתר פשוט ימשיך לעבוד רק עם רשת */
    });
  });
})();
