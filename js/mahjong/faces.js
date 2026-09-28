/* =============================================================================
 * mahjong/faces.js — ציורי האבנים
 * -----------------------------------------------------------------------------
 * כל פני אבן הם SVG קטן בתיבה 60×80. בלי תמונות ובלי תווי אמוג'י של
 * מהג'ונג (U+1F000): אלה מוצגים אחרת בכל מערכת, ובחלקן בכלל לא.
 *
 * עיגולים ובמבוק מצוירים כצורות. סימנים, רוחות, דרקונים, פרחים ועונות
 * נכתבים בתווים סיניים — הם קיימים בגופני המערכת בכל הפלטפורמות. לצד
 * התו מופיע סימן קטן בפינה (ספרה / אות), כדי שגם מי שלא קורא סינית יזהה.
 *
 * התוצאה נשמרת במטמון — כל פנים נבנות פעם אחת.
 * =========================================================================== */
(function (global) {
  'use strict';

  const CJK = "'Noto Serif SC','Noto Serif CJK SC','Songti SC','STSong','SimSun','Microsoft YaHei','PingFang SC',serif";

  const BLUE = '#1f4fa8';
  const GREEN = '#1c8a3c';
  const RED = '#c62828';
  const NAVY = '#1a2a6c';

  const NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

  /* ------------------------------ עיגולים ------------------------------ */

  function dot(x, y, r, color) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + color + '"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="' + (r * 0.62).toFixed(2) + '" fill="none" stroke="#fff" stroke-width="' + (r * 0.16).toFixed(2) + '"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="' + (r * 0.22).toFixed(2) + '" fill="#fff"/>';
  }

  const DOTS = {
    1: () =>
      '<circle cx="30" cy="40" r="22" fill="' + GREEN + '"/>' +
      '<circle cx="30" cy="40" r="17" fill="#fff"/>' +
      '<circle cx="30" cy="40" r="14" fill="' + BLUE + '"/>' +
      '<circle cx="30" cy="40" r="8" fill="' + RED + '"/>' +
      '<circle cx="30" cy="40" r="3" fill="#fff"/>',
    2: () => dot(30, 22, 10, GREEN) + dot(30, 58, 10, BLUE),
    3: () => dot(15, 16, 9, BLUE) + dot(30, 40, 9, RED) + dot(45, 64, 9, GREEN),
    4: () => dot(17, 22, 9, BLUE) + dot(43, 22, 9, GREEN) + dot(17, 58, 9, GREEN) + dot(43, 58, 9, BLUE),
    5: () => DOTS[4]() + dot(30, 40, 8, RED),
    6: () =>
      dot(18, 15, 8, GREEN) + dot(42, 15, 8, GREEN) +
      dot(18, 44, 8, RED) + dot(42, 44, 8, RED) + dot(18, 66, 8, RED) + dot(42, 66, 8, RED),
    7: () =>
      dot(14, 11, 7, GREEN) + dot(30, 20, 7, GREEN) + dot(46, 29, 7, GREEN) +
      dot(19, 50, 7, RED) + dot(41, 50, 7, RED) + dot(19, 69, 7, RED) + dot(41, 69, 7, RED),
    8: () => {
      let s = '';
      for (let r = 0; r < 4; r++) s += dot(19, 13 + r * 18, 7.5, BLUE) + dot(41, 13 + r * 18, 7.5, BLUE);
      return s;
    },
    9: () => {
      let s = '';
      const cols = [BLUE, RED, GREEN];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) s += dot(12 + c * 18, 16 + r * 24, 7.5, cols[r]);
      return s;
    },
  };

  /* ------------------------------ במבוק ------------------------------- */

  /** מקל במבוק במרכז (x, y), עם מפרק באמצע ובקצוות. */
  function stick(x, y, color, h) {
    h = h || 20;
    const w = 7;
    const top = y - h / 2;
    return '<rect x="' + (x - w / 2) + '" y="' + top + '" width="' + w + '" height="' + h + '" rx="3" fill="' + color + '"/>' +
      '<rect x="' + (x - w / 2 - 1) + '" y="' + (y - 1.3) + '" width="' + (w + 2) + '" height="2.6" rx="1.2" fill="' + color + '"/>' +
      '<rect x="' + (x - w / 2 - 1) + '" y="' + (top - 0.5) + '" width="' + (w + 2) + '" height="2.4" rx="1.2" fill="' + color + '"/>' +
      '<rect x="' + (x - w / 2 - 1) + '" y="' + (top + h - 1.9) + '" width="' + (w + 2) + '" height="2.4" rx="1.2" fill="' + color + '"/>' +
      '<line x1="' + x + '" y1="' + (top + 3) + '" x2="' + x + '" y2="' + (top + h - 3) + '" stroke="rgba(255,255,255,.55)" stroke-width="1.3"/>';
  }

  const BAMBOO = {
    // האחד המסורתי הוא ציפור — כאן ציפור מסוגננת על ענף
    1: () =>
      '<path d="M12 64 Q30 58 48 66" stroke="' + GREEN + '" stroke-width="3" fill="none" stroke-linecap="round"/>' +
      '<path d="M22 50 Q10 30 16 14 Q24 30 28 44 Z" fill="' + GREEN + '"/>' +
      '<path d="M26 48 Q22 26 32 12 Q34 32 32 46 Z" fill="' + BLUE + '"/>' +
      '<ellipse cx="33" cy="50" rx="11" ry="8" fill="' + RED + '"/>' +
      '<circle cx="43" cy="41" r="6" fill="' + RED + '"/>' +
      '<path d="M48 41 L55 43 L48 45 Z" fill="#e0a100"/>' +
      '<circle cx="44.5" cy="39.5" r="1.4" fill="#fff"/>' +
      '<path d="M30 58 L28 64 M36 58 L37 64" stroke="#e0a100" stroke-width="2" stroke-linecap="round"/>',
    2: () => stick(30, 22, GREEN, 24) + stick(30, 58, BLUE, 24),
    3: () => stick(30, 22, BLUE, 24) + stick(19, 58, GREEN, 24) + stick(41, 58, GREEN, 24),
    4: () => stick(19, 22, BLUE, 24) + stick(41, 22, GREEN, 24) + stick(19, 58, GREEN, 24) + stick(41, 58, BLUE, 24),
    5: () => BAMBOO[4]() + stick(30, 40, RED, 24),
    6: () =>
      stick(14, 22, GREEN, 24) + stick(30, 22, GREEN, 24) + stick(46, 22, GREEN, 24) +
      stick(14, 58, BLUE, 24) + stick(30, 58, BLUE, 24) + stick(46, 58, BLUE, 24),
    7: () =>
      stick(30, 14, RED, 18) +
      stick(14, 40, GREEN, 18) + stick(30, 40, BLUE, 18) + stick(46, 40, GREEN, 18) +
      stick(14, 66, GREEN, 18) + stick(30, 66, BLUE, 18) + stick(46, 66, GREEN, 18),
    8: () => {
      let s = '';
      [9, 23, 37, 51].forEach((x, i) => {
        s += stick(x, 22, i % 3 ? GREEN : BLUE, 24) + stick(x, 58, i % 3 ? BLUE : GREEN, 24);
      });
      return s;
    },
    9: () => {
      let s = '';
      [14, 30, 46].forEach((x, i) => {
        const c = i === 1 ? RED : i === 0 ? BLUE : GREEN;
        s += stick(x, 14, c, 18) + stick(x, 40, c, 18) + stick(x, 66, c, 18);
      });
      return s;
    },
  };

  /* ----------------------------- תווים -------------------------------- */

  function text(ch, x, y, size, color, weight) {
    /* קו מתאר באותו צבע מעבה את התו. בלי זה גופני סרִיף סיניים נראים
       דקים ודהויים בגודל של אבן בטלפון */
    return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + color + '"' +
      ' stroke="' + color + '" stroke-width="' + (size * 0.045).toFixed(2) + '" stroke-linejoin="round"' +
      ' font-family="' + CJK + '" font-weight="' + (weight || 700) + '"' +
      ' text-anchor="middle" dominant-baseline="central">' + ch + '</text>';
  }

  /** סימן קטן בפינה השמאלית העליונה — לזיהוי בלי לקרוא סינית */
  function corner(label, color) {
    return '<text x="6" y="10" font-size="11" fill="' + (color || NAVY) + '" font-family="system-ui,sans-serif"' +
      ' font-weight="800" dominant-baseline="central">' + label + '</text>';
  }

  function flowerMark(x, y, color) {
    let s = '';
    for (let k = 0; k < 5; k++) {
      const a = (k * 2 * Math.PI) / 5 - Math.PI / 2;
      s += '<circle cx="' + (x + Math.cos(a) * 5).toFixed(2) + '" cy="' + (y + Math.sin(a) * 5).toFixed(2) + '" r="3.6" fill="' + color + '"/>';
    }
    return s + '<circle cx="' + x + '" cy="' + y + '" r="2.6" fill="#f0c000"/>';
  }

  const WINDS = { E: '東', S: '南', W: '西', N: '北' };
  const FLOWERS = [['梅', '#c2185b'], ['蘭', '#7b1fa2'], ['菊', '#e65100'], ['竹', GREEN]];
  const SEASONS = [['春', GREEN], ['夏', RED], ['秋', '#e65100'], ['冬', BLUE]];

  function body(face) {
    const kind = face[0];
    const v = face.slice(1);
    const n = parseInt(v, 10);
    switch (kind) {
      case 'd': return DOTS[n]();
      case 'b': return BAMBOO[n]();
      case 'c':
        return corner(String(n)) + text(NUM[n], 30, 25, 26, NAVY) + text('萬', 30, 57, 30, RED);
      case 'w':
        return corner(v) + text(WINDS[v], 30, 43, 42, NAVY);
      case 'r':
        if (v === 'R') return text('中', 30, 42, 46, RED);
        if (v === 'G') return text('發', 30, 42, 44, GREEN);
        // הדרקון הלבן — מסגרת כחולה כפולה
        return '<rect x="10" y="12" width="40" height="56" rx="3" fill="none" stroke="' + BLUE + '" stroke-width="3.5"/>' +
          '<rect x="16" y="18" width="28" height="44" rx="2" fill="none" stroke="' + BLUE + '" stroke-width="1.8"/>';
      case 'f': {
        const [ch, col] = FLOWERS[n - 1];
        return corner(String(n), col) + flowerMark(44, 14, col) + text(ch, 30, 48, 36, col);
      }
      case 's': {
        const [ch, col] = SEASONS[n - 1];
        return corner(String(n), col) +
          '<circle cx="44" cy="14" r="6" fill="none" stroke="' + col + '" stroke-width="2"/>' +
          text(ch, 30, 48, 36, col);
      }
    }
    return '';
  }

  const cache = new Map();

  function svg(face) {
    if (!cache.has(face)) {
      cache.set(face,
        '<svg class="mj-face" viewBox="0 0 60 80" aria-hidden="true" focusable="false">' + body(face) + '</svg>');
    }
    return cache.get(face);
  }

  /** שם בעברית — לקורא מסך ולהודעות */
  function name(face) {
    const kind = face[0];
    const v = face.slice(1);
    switch (kind) {
      case 'd': return v + ' עיגולים';
      case 'b': return v + ' במבוק';
      case 'c': return v + ' סימנים';
      case 'w': return 'רוח ' + { E: 'מזרח', S: 'דרום', W: 'מערב', N: 'צפון' }[v];
      case 'r': return 'דרקון ' + { R: 'אדום', G: 'ירוק', W: 'לבן' }[v];
      case 'f': return 'פרח ' + v;
      case 's': return 'עונה ' + v;
    }
    return face;
  }

  global.MahjongFaces = { svg, name };
})(typeof window !== 'undefined' ? window : globalThis);
