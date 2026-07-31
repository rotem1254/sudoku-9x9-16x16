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
 * ההתאמה מתעלמת מ-query string, ולכן היא עמידה לסכמת ה-?v= שבדפים:
 * theme.css?v=8 ו-theme.css?v=9 מוצאים את אותה רשומה במטמון.
 * =========================================================================== */
'use strict';

/* חייב לעלות בכל פריסה, אחרת גולשים ותיקים יישארו על נכסים ישנים.
   מיושר בכוונה למספר ה-?v= שבדפי ה-HTML. */
const VERSION = 'v9';
const CACHE = 'games-' + VERSION;

/** כל מה שנדרש כדי לשחק בשני המשחקים ללא רשת. */
const PRECACHE = [
  './',
  'index.html',
  'sudoku.html',
  'solitaire.html',
  'manifest.webmanifest',
  'icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'css/theme.css',
  'css/hub.css',
  'css/sudoku.css',
  'css/solitaire.css',
  'js/core.js',
  'js/storage.js',
  'js/game.js',
  'js/ui.js',
  'js/solitaire/engine.js',
  'js/solitaire/ui.js',
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

  // --- נכסים: קודם מטמון, ורענון ברקע ---
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
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
