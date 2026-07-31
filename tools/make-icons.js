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
 * העיצוב גיאומטרי בכוונה (רשת + תאים מלאים, בלי ספרות): אייקון במסך הבית
 * מוצג בסביבות 60px, וספרות בגודל כזה נמרחות ללא קריאוּת.
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

function render(S) {
  const buf = Buffer.alloc(S * S * 3);

  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const o = (y * S + x) * 3;
    buf[o] = c[0];
    buf[o + 1] = c[1];
    buf[o + 2] = c[2];
  };

  const rect = (x, y, w, h, c) => {
    const x0 = Math.round(x), y0 = Math.round(y);
    const x1 = Math.round(x + w), y1 = Math.round(y + h);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) put(xx, yy, c);
  };

  // מיזוג צבע עם הרקע — מאפשר "קווים דקים" בהירים בלי ערוץ אלפא
  const blend = (c, a) => [
    Math.round(BLUE[0] + (c[0] - BLUE[0]) * a),
    Math.round(BLUE[1] + (c[1] - BLUE[1]) * a),
    Math.round(BLUE[2] + (c[2] - BLUE[2]) * a),
  ];

  // רקע מלא, בלי פינות מעוגלות: iOS ממסך את האייקון בעצמו
  rect(0, 0, S, S, BLUE);

  const pad = S * 0.135;
  const inner = S - pad * 2;
  const cell = inner / 9;
  const thin = Math.max(1, Math.round(S / 180));
  const thick = Math.max(2, Math.round((S / 180) * 3));

  // תאים מלאים — מצוירים לפני הקווים כדי שהרשת תישאר למעלה
  const soft = blend(WHITE, 0.92);
  FILLED.forEach(([cx, cy]) => {
    const g = cell * 0.16;
    rect(pad + cx * cell + g, pad + cy * cell + g, cell - g * 2, cell - g * 2, soft);
  });

  // קווים דקים (בין תאים) ואז עבים (בין תיבות ומסגרת)
  for (let i = 0; i <= 9; i++) {
    const isBox = i % 3 === 0;
    const w = isBox ? thick : thin;
    const c = isBox ? WHITE : blend(WHITE, 0.45);
    const p = pad + i * cell - w / 2;
    rect(p, pad - thick / 2, w, inner + thick, c);        // אנכי
    rect(pad - thick / 2, p, inner + thick, w, c);        // אופקי
  }

  return encodePNG(S, S, buf);
}

/* --------------------------------- SVG --------------------------------- */

/** גרסת SVG של אותו עיצוב, לפאביקון ולמאניפסט. */
function renderSVG() {
  const S = 512;
  const pad = S * 0.135;
  const inner = S - pad * 2;
  const cell = inner / 9;
  const r = (n) => +n.toFixed(2);

  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">\n`;
  out += `  <rect width="${S}" height="${S}" fill="#4f6ef7"/>\n`;

  out += '  <g fill="#ffffff" opacity=".92">\n';
  FILLED.forEach(([cx, cy]) => {
    const g = cell * 0.16;
    out += `    <rect x="${r(pad + cx * cell + g)}" y="${r(pad + cy * cell + g)}" width="${r(cell - g * 2)}" height="${r(cell - g * 2)}" rx="${r(cell * 0.14)}"/>\n`;
  });
  out += '  </g>\n';

  const lines = (step, width, opacity) => {
    let s = `  <g stroke="#ffffff" stroke-width="${width}" opacity="${opacity}">\n`;
    for (let i = 0; i <= 9; i += 1) {
      if (step === 3 ? i % 3 !== 0 : i % 3 === 0) continue;
      const p = r(pad + i * cell);
      s += `    <path d="M${p} ${r(pad)}V${r(pad + inner)}M${r(pad)} ${p}H${r(pad + inner)}"/>\n`;
    }
    return s + '  </g>\n';
  };

  out += lines(1, r(S / 180), '.45');
  out += lines(3, r((S / 180) * 3), '1');
  out += '</svg>\n';
  return out;
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
