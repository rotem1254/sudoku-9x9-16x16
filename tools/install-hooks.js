/* =============================================================================
 * tools/install-hooks.js — התקנת git hook
 * -----------------------------------------------------------------------------
 * הרצה:  node tools/install-hooks.js
 * הסרה:  מוחקים את .git/hooks/pre-commit
 *
 * ה-hook מריץ את bump-version לפני כל קומיט ומוסיף מחדש לאינדקס את מה
 * שהשתנה. כך אי אפשר לדחוף קומיט שבו ה-?v= לא תואם לתוכן הקבצים.
 *
 * hooks יושבים ב-.git/hooks שאינו נשמר במאגר, ולכן הסקריפט הזה מתועד
 * ב-README — מי שמשכפל את המאגר מריץ אותו פעם אחת.
 * =========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HOOKS = path.join(ROOT, '.git', 'hooks');

if (!fs.existsSync(HOOKS)) {
  console.error('לא נמצאה תיקיית .git/hooks — האם זו תיקיית מאגר?');
  process.exit(1);
}

const hook = `#!/bin/sh
# נוצר ע"י tools/install-hooks.js — מסנכרן את ?v= לתוכן הקבצים
node tools/bump-version.js || exit 1
git add index.html sudoku.html solitaire.html sw.js
`;

const target = path.join(HOOKS, 'pre-commit');
fs.writeFileSync(target, hook, { mode: 0o755 });

console.log('הותקן: .git/hooks/pre-commit');
console.log('מעכשיו כל קומיט מסנכרן את גרסאות הנכסים אוטומטית.');
