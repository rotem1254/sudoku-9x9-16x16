/* =============================================================================
 * sw.js — Service Worker
 * -----------------------------------------------------------------------------
 * בלי הקובץ הזה הטענה "עובד גם בלי חיבור לאינטרנט" פשוט לא נכונה: האתר
 * נשען היה על מטמון הדפדפן בלבד, ו-vercel.json מגדיר must-revalidate —
 * כלומר בלי רשת הדפדפן דווקא נכשל.
 *
 * אסטרטגיה:
 *   ניווט (בקשת דף)  — קודם רשת, ובנפילה מהמטמון. כך עדכון נתפס מיד,
 *                        ובלי רשת עדיין נכנסים למשחק.
 *   נכסים (css/js/…) — קודם מטמון, ורענון ברקע. טעינה מיידית, והגרסה
 *                        הבאה נקלטת לפעם הבאה.
 *
 * כתובת עם חותם ?v= נבדקת במדויק, כדי שחותם חדש לא ייענה מהמטמון של
 * החותם הישן. בלי זה חתימת התוכן חסרת משמעות. פירוט ליד הטיפול בנכסים.
 * =========================================================================== */
'use strict';

/* נוצר אוטומטית ע"י tools/bump-version.js — לא לערוך ידנית.
   ה-hash מחושב מתוכן כל הנכסים, ולכן הוא משתנה בדיוק כשמשהו משתנה. */
const VERSION = 'e6585819';
const CACHE = 'games-' + VERSION;

/** נוצר אוטומטית מהקבצים שקיימים בפועל — לא לערוך ידנית. */
const PRECACHE = [
  './',
  'blockblast.html',
  'index.html',
  'rummikub.html',
  'solitaire.html',
  'sudoku.html',
  'css/blockblast.css',
  'css/hub.css',
  'css/rummikub.css',
  'css/solitaire.css',
  'css/sudoku.css',
  'css/theme.css',
  'icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/announce.js',
  'js/blockblast/deal.js',
  'js/blockblast/engine.js',
  'js/blockblast/game.js',
  'js/blockblast/ui.js',
  'js/core.js',
  'js/game.js',
  'js/haptics.js',
  'js/modal.js',
  'js/rummikub/ai.js',
  'js/rummikub/engine.js',
  'js/rummikub/ui.js',
  'js/solitaire/engine.js',
  'js/solitaire/ui.js',
  'js/storage.js',
  'js/sw-register.js',
  'js/ui-math.js',
  'js/ui.js',
  'manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll נכשל כולו אם קובץ בודד נכשל, ולכן כל אחד נשמר בנפרד
      .then((cache) =>
        Promise.all(
          PRECACHE.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // רק GET ורק מאותו מקור — בקשות אחרות עוברות כרגיל
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // --- ניווט: קודם רשת, ובנפילה מהמטמון ---
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches
            .match(req, { ignoreSearch: true })
            .then((hit) => hit || caches.match('index.html', { ignoreSearch: true }))
        )
    );
    return;
  }

  /*
   * נכסים: קודם מטמון, ורענון ברקע.
   *
   * ההתאמה חייבת להיות מדויקת כשיש חותם גרסה בכתובת. עם ignoreSearch
   * בקשה ל-css/solitaire.css?v=חדש הייתה נענית מהמטמון של ?v=ישן — כלומר
   * כל מנגנון חתימת התוכן היה חסר משמעות, וכל פריסה הייתה נכנסת לתוקף רק
   * בטעינה השנייה. בלי ignoreSearch חותם חדש פשוט לא נמצא במטמון, נשלף
   * מהרשת, והמשתמש מקבל את הגרסה הנכונה מיד.
   *
   * לכתובות בלי חותם משאירים את ההתאמה הסלחנית, כי שם השאילתה אינה חלק
   * מזהות הקובץ
   */
  const versioned = new URL(req.url).searchParams.has('v');

  event.respondWith(
    caches.match(req, { ignoreSearch: !versioned }).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit);

      return hit || network;
    })
  );
});
