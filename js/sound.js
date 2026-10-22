/* =============================================================================
 * sound.js — צלילי שולחן, מסונתזים בדפדפן
 * -----------------------------------------------------------------------------
 * משחקי קלפים טובים נשמעים: קלף שמחליק, ז'יטון שנוקש, ערבוב. אין כאן
 * קובצי שמע — הכול נבנה ב-Web Audio מרעש לבן מסונן וטונים קצרים, ולכן
 * שוקל כלום ועובד גם בלי רשת.
 *
 *   ז'יטון  — שתי נקישות רעש קצרות (5–15ms) במסנן פס גבוה, ועוד צלצול
 *             קטן — הנקישה של חרסינה על חרסינה
 *   קלף     — "שוש" של רעש שמסנן הפס שלו עולה, כמו קלף שמחליק על לבד
 *   היפוך   — הצמדה קצרה וגבוהה
 *   ניצחון  — ארפג'ו רך ונמוך בעוצמתו; הפסד — שני צלילים יורדים, שקטים
 *
 * כללים: AudioContext אחד לכל הדף; נוצר רק אחרי נגיעה ראשונה (הדפדפנים
 * חוסמים צליל לפני כן); עוצמה כללית נמוכה — שולחן רגוע, לא קזינו רועש.
 * =========================================================================== */
(function (global) {
  'use strict';

  let ctx = null;
  let master = null;
  let noise = null;
  let enabled = true;
  let volume = 0.55;

  const AC = global.AudioContext || global.webkitAudioContext;

  function ready() {
    if (!enabled || !AC) return null;
    if (!ctx) {
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = volume * 0.5;
        master.connect(ctx.destination);
        const len = Math.floor(ctx.sampleRate * 1);
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      } catch (e) {
        ctx = null;
        return null;
      }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // נגיעה ראשונה בדף פותחת את השמע; עד אז play() פשוט שותק
  let unlocked = false;
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    ready();
  }
  ['pointerdown', 'keydown'].forEach((ev) =>
    global.addEventListener(ev, unlock, { once: true, capture: true }));

  /* ---------------------------- אבני בניין ---------------------------- */

  function burst(t, dur, freq, q, gain, type) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type || 'bandpass';
    f.frequency.value = freq * (0.92 + Math.random() * 0.16);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.004, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5, dur + 0.02);
    return f;
  }

  function tone(t, freq, dur, gain, type) {
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /* ------------------------------ הצלילים ----------------------------- */

  const SOUNDS = {
    chip(t) {
      burst(t, 0.012, 4200, 3, 0.7);
      burst(t + 0.028 + Math.random() * 0.01, 0.01, 5200, 3, 0.45);
      tone(t, 2650 + Math.random() * 200, 0.07, 0.06, 'triangle');
    },
    chips(t) {
      // כמה ז'יטונים שנערמים — נקישות בקצב יורד
      for (let i = 0; i < 4; i++) SOUNDS.chip(t + i * (0.045 + i * 0.012));
    },
    deal(t) {
      const f = burst(t, 0.13, 900, 1.2, 0.5);
      f.frequency.exponentialRampToValueAtTime(2600, t + 0.11);
    },
    flip(t) {
      burst(t, 0.035, 2400, 1, 0.55, 'highpass');
      burst(t + 0.01, 0.05, 500, 1, 0.25);
    },
    shuffle(t) {
      for (let i = 0; i < 14; i++) burst(t + i * 0.035 + Math.random() * 0.01, 0.025, 2000 + Math.random() * 1500, 1.4, 0.32);
    },
    tick(t) { tone(t, 1250, 0.035, 0.05); },
    turn(t) { tone(t, 880, 0.12, 0.05, 'triangle'); tone(t + 0.09, 1320, 0.16, 0.045, 'triangle'); },
    win(t) {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(t + i * 0.085, f, 0.42, 0.07, 'triangle'));
    },
    bigwin(t) {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(t + i * 0.075, f, 0.5, 0.075, 'triangle'));
      SOUNDS.chips(t + 0.3);
    },
    lose(t) { tone(t, 392, 0.26, 0.05); tone(t + 0.16, 311.1, 0.4, 0.045); },
    push(t) { tone(t, 587.3, 0.2, 0.045, 'triangle'); },
    fold(t) { burst(t, 0.09, 700, 0.8, 0.3, 'lowpass'); },
  };

  /** משמיע צליל בשם נתון. שקט אם השמע כבוי, לא נתמך או עוד לא נפתח. */
  function play(name) {
    if (!enabled || !unlocked) return;
    const c = ready();
    const fn = SOUNDS[name];
    if (!c || !fn) return;
    try { fn(c.currentTime + 0.005); } catch (e) { /* צליל שנכשל לא עוצר משחק */ }
  }

  global.Sound = {
    play,
    supported: () => !!AC,
    setEnabled(on) { enabled = !!on; },
    isEnabled: () => enabled,
    setVolume(v) { volume = v; if (master) master.gain.value = v * 0.5; },
    names: Object.keys(SOUNDS),
  };
})(window);
