/* =============================================================================
 * tools/make-icons.js — מייצר את אייקוני האתר (PNG + SVG)
 * -----------------------------------------------------------------------------
 * הרצה:  node tools/make-icons.js
 *
 * למה סקריפט ולא קובץ תמונה סטטי:
 *   iOS לא תומך ב-SVG עבור apple-touch-icon, ולכן חייבים PNG אמיתי. במקום
 *   לגרור תלות בספריית גרפיקה, הסקריפט מקודד PNG בעצמו — zlib מובנה ב-Node,
 *   וכל מה שנשאר זה CRC32 ומבנה ה-chunks. אין תלויות חיצוניות בכלל.
 *
 * העיצוב: ארבעה ריבועים, אחד לכל משחק, בצבע שלו. קודם הייתה כאן רשת
 * סודוקו — וזה הפסיק להיות נכון ברגע שנוספו עוד שלושה משחקים.
 *
 * גיאומטרי בכוונה ובלי ספרות או אותיות: אייקון במסך הבית מוצג בסביבות
 * 60 פיקסלים, וכל פרט קטן יותר נמרח.
 * =========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ------------------------------- קידוד PNG ------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** מקודד RGB גולמי (w*h*3) ל-PNG תקין. */
function encodePNG(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // כל שורה מקבלת בייט filter (0 = None) לפני הפיקסלים
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const dst = y * (1 + width * 3);
    raw[dst] = 0;
    rgb.copy(raw, dst + 1, y * width * 3, (y + 1) * width * 3);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------- ציור --------------------------------- */

const BLUE = [0x4f, 0x6e, 0xf7];
const WHITE = [0xff, 0xff, 0xff];

/** תאים שיוצגו "מלאים" — פרוסים כך שייראו אקראיים אבל מאוזנים על הלוח. */
const FILLED = [
  [0, 0], [4, 1], [7, 2],
  [2, 3], [5, 4], [8, 5],
  [1, 6], [3, 7], [6, 8],
];

/* ------------------------------- העיצוב --------------------------------- */

/*
 * ארבעה ריבועים בפריסת 2×2, אחד לכל משחק. הרקע כהה כדי שהצבעים יקבלו
 * נוכחות, והוא גם תואם את הרקע הכהה של האתר עצמו.
 */
const GROUND = [22, 24, 29]; // #16181d
const TILES = [
  [0, 0, [47, 107, 255]],  // סודוקו   #2f6bff
  [1, 0, [18, 133, 92]],   // סוליטר   #12855c
  [0, 1, [194, 90, 36]],   // רמי קוב  #c25a24
  [1, 1, [106, 75, 208]],  // בלוק בלאסט #6a4bd0
];

/** יחסי הפריסה, משותפים ל-PNG ול-SVG כדי ששניהם לא יסטו זה מזה. */
function layout(S) {
  const pad = S * 0.17;
  const gap = S * 0.055;
  const tile = (S - pad * 2 - gap) / 2;
  return { pad, gap, tile, radius: tile * 0.22 };
}

function render(size) {
  const S = size;
  const buf = Buffer.alloc(S * S * 3);

  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 3;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  };
  const rect = (x, y, w, h, c) => {
    const x0 = Math.round(x), y0 = Math.round(y);
    const x1 = Math.round(x + w), y1 = Math.round(y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) put(xx, yy, c);
  };

  /* ריבוע עם פינות מעוגלות — נבדק לפי מרחק מהמרכז של רבע המעגל */
  const roundRect = (x, y, w, h, r, c) => {
    const x0 = Math.round(x), y0 = Math.round(y);
    const x1 = Math.round(x + w), y1 = Math.round(y + h);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        // כמה רחוק הפיקסל מהפינה הקרובה אליו
        const dx = Math.max(x0 + r - xx - 0.5, xx + 0.5 - (x1 - r), 0);
        const dy = Math.max(y0 + r - yy - 0.5, yy + 0.5 - (y1 - r), 0);
        if (dx * dx + dy * dy <= r * r) put(xx, yy, c);
      }
    }
  };

  // רקע מלא, בלי פינות מעוגלות: iOS ממסך את האייקון בעצמו
  rect(0, 0, S, S, GROUND);

  const L = layout(S);
  for (const [cx, cy, color] of TILES) {
    roundRect(
      L.pad + cx * (L.tile + L.gap),
      L.pad + cy * (L.tile + L.gap),
      L.tile, L.tile, L.radius, color
    );
  }

  return encodePNG(S, S, buf);
}

/* --------------------------------- SVG --------------------------------- */

/** אותו עיצוב בדיוק, לפאביקון ולמאניפסט. */
function renderSVG() {
  const S = 512;
  const L = layout(S);
  const r = (n) => +n.toFixed(2);
  const hex = (c) => '#' + c.map((n) => n.toString(16).padStart(2, '0')).join('');

  const lines = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + S + ' ' + S +
      '" width="' + S + '" height="' + S + '">',
    '  <rect width="' + S + '" height="' + S + '" fill="' + hex(GROUND) + '"/>',
  ];

  for (const [cx, cy, color] of TILES) {
    lines.push(
      '  <rect x="' + r(L.pad + cx * (L.tile + L.gap)) +
      '" y="' + r(L.pad + cy * (L.tile + L.gap)) +
      '" width="' + r(L.tile) + '" height="' + r(L.tile) +
      '" rx="' + r(L.radius) + '" fill="' + hex(color) + '"/>'
    );
  }

  lines.push('</svg>', '');
  return lines.join('\n');
}

/* --------------------------------- main -------------------------------- */

const root = path.join(__dirname, '..');
const iconsDir = path.join(root, 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const targets = [
  ['apple-touch-icon.png', 180], // iOS — חייב PNG
  ['icon-192.png', 192],
  ['icon-512.png', 512],
];

targets.forEach(([name, size]) => {
  const png = render(size);
  fs.writeFileSync(path.join(iconsDir, name), png);
  console.log(`icons/${name.padEnd(22)} ${size}x${size}  ${png.length} bytes`);
});

fs.writeFileSync(path.join(root, 'icon.svg'), renderSVG());
console.log('icon.svg               512x512  ' + fs.statSync(path.join(root, 'icon.svg')).size + ' bytes');
