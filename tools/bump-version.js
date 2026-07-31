/* =============================================================================
 * tools/bump-version.js — גרסאות נכסים אוטומטיות
 * -----------------------------------------------------------------------------
 * הרצה:  node tools/bump-version.js        (מעדכן)
 *        node tools/bump-version.js --check (בודק בלבד, יוצא 1 אם לא מעודכן)
 *
 * הבעיה: ה-?v= בדפי ה-HTML ו-VERSION ב-sw.js היו מספרים שצריך לזכור
 * להעלות ידנית. שכחה אחת = הגולש מקבל CSS ישן עם JS חדש.
 *
 * הפתרון: הגרסה של כל נכס היא 8 תווים מתוך ה-SHA-256 של תוכנו.
 *   - קובץ שלא השתנה שומר על אותה כתובת ולא נפסל מהמטמון לחינם
 *   - קובץ ששונה מקבל כתובת חדשה אוטומטית
 *   - הרצה חוזרת בלי שינויים אינה משנה כלום (אידמפוטנטי)
 *
 * בנוסף רשימת ה-PRECACHE ב-sw.js נבנית מהקבצים שקיימים בפועל, כך שקובץ
 * חדש נכנס לעבודה-ללא-רשת בלי לזכור לרשום אותו.
 * =========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CHECK_ONLY = process.argv.includes('--check');

/** דפי ה-HTML שמקבלים כתובות מגורסאות. */
const PAGES = ['index.html', 'sudoku.html', 'solitaire.html'];

/** תיקיות שאינן חלק מהאתר הפרוס. */
const SKIP_DIRS = new Set(['.git', '.vercel', 'node_modules', 'tools', 'test']);

/* --------------------------------------------------------------------- */

/** אוסף רקורסיבית את כל נכסי האתר, בנתיבים יחסיים עם קו נטוי קדימה. */
function collectAssets(dir, out, base) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    const rel = base ? base + '/' + entry.name : entry.name;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectAssets(abs, out, rel);
      continue;
    }
    // sw.js מנוהל ע"י הדפדפן ואינו נטען עם ?v=
    if (rel === 'sw.js') continue;
    if (/\.(css|js|svg|png|webmanifest)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const hashOf = (rel) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex').slice(0, 8);

/* --------------------------------------------------------------------- */

const assets = collectAssets(ROOT, [], '').sort();
const hashes = new Map(assets.map((a) => [a, hashOf(a)]));

/** גרסה כוללת — משתנה אם *משהו* השתנה. משמשת כשם המטמון ב-sw.js. */
const globalVersion = crypto
  .createHash('sha256')
  .update(assets.map((a) => a + ':' + hashes.get(a)).join('\n'))
  .digest('hex')
  .slice(0, 8);

const changes = [];

function write(rel, next) {
  const abs = path.join(ROOT, rel);
  const prev = fs.readFileSync(abs, 'utf8');
  if (prev === next) return false;
  changes.push(rel);
  if (!CHECK_ONLY) fs.writeFileSync(abs, next);
  return true;
}

/* ------------------------- עדכון דפי ה-HTML -------------------------- */

for (const page of PAGES) {
  let html = fs.readFileSync(path.join(ROOT, page), 'utf8');

  // כל href/src שמצביע לנכס מקומי מוכר מקבל את ה-hash שלו.
  // כתובות חיצוניות, data: ועוגנים אינם תואמים ולכן לא נגעים.
  html = html.replace(/(href|src)="([^":?#]+)(\?v=[^"]*)?"/g, (full, attr, file) => {
    const key = file.replace(/^\.\//, '');
    if (!hashes.has(key)) return full;
    return `${attr}="${file}?v=${hashes.get(key)}"`;
  });

  write(page, html);
}

/* ---------------------------- עדכון sw.js ---------------------------- */

let sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${globalVersion}';`);

// PRECACHE נבנה מהקבצים שקיימים בפועל. הנתיבים נשארים ללא ?v= בכוונה:
// ה-fetch handler משווה עם ignoreSearch, ולכן בקשה מגורסת מוצאת אותם.
const precache = ['./'].concat(PAGES).concat(assets);
const list = precache.map((p) => `  '${p}',`).join('\n');
sw = sw.replace(/const PRECACHE = \[[\s\S]*?\n\];/, `const PRECACHE = [\n${list}\n];`);

write('sw.js', sw);

/* -------------------------------- דיווח ------------------------------ */

console.log(`נכסים: ${assets.length} · גרסה כוללת: ${globalVersion}`);

if (!changes.length) {
  console.log('הכול מעודכן.');
  process.exit(0);
}

if (CHECK_ONLY) {
  console.error('לא מעודכן. יש להריץ: node tools/bump-version.js');
  changes.forEach((c) => console.error('  - ' + c));
  process.exit(1);
}

console.log('עודכנו:');
changes.forEach((c) => console.log('  - ' + c));
