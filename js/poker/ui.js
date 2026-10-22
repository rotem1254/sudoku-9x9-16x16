/* =============================================================================
 * poker/ui.js — ממשק הפוקר
 * -----------------------------------------------------------------------------
 * שולחן, מושבים, קלפי שולחן, סרגל פעולות, תור היריבים, שמירה וסטטיסטיקות.
 *
 * הזרימה כולה עוברת דרך loop(): היא מציירת, ואז מחליטה מה הלאה — לחכות
 * לשחקן, לתת ליריב לפעול אחרי השהיה, או לפתוח את הרחוב הבא. יש טיימר אחד
 * בלבד, וכל פעולה שמשנה את המשחק מבטלת אותו לפני שהיא קוראת ל-loop שוב.
 * כך אי אפשר שתשובת יריב ישנה "תנחת" על יד חדשה.
 *
 * הציור אינו בונה את השולחן מחדש בכל צעד. ה-DOM של השולחן קבוע, ו-render
 * משווה את מצב המשחק למה שכבר מוצג (state.view) ומנפיש רק את ההבדל:
 *
 *   יד חדשה        — ערבוב, הכפתור מחליק למושב הבא, וקלפים עפים מהמרכז
 *                    לכל מושב בסדר החלוקה האמיתי
 *   הימור           — ערימת ז'יטונים עפה מהאווטאר אל מקום ההימור, והשם
 *                    מתחלף לרגע בפעולה ("קול 40")
 *   פולד            — הקלפים נזרקים למרכז ונעלמים
 *   סוף סיבוב       — ההימורים נאספים בקשת אל הקופה
 *   פלופ/טרן/ריבר   — קלף עף הפוך למקומו ואז מתהפך, אחד אחרי השני
 *   עימות           — קלפי היריבים מתהפכים, החמישייה המנצחת זוהרת, והקופה
 *                    עפה אל הזוכה שהערימה שלו מטפסת
 *
 * כל הנפשה נרשמת על ציר זמן (at), ו-busyUntil אומר ל-loop מתי היא נגמרת —
 * היריב הבא לא פועל באמצע חלוקה. ב"פחות תנועה" ובטעינה מחדש אותו קוד רץ
 * בלי הנפשות: at מבצע מיד, והמצב הסופי זהה.
 * =========================================================================== */
(function () {
  'use strict';

  const P = window.Poker;
  const AI = window.PokerAI;
  const PC = window.PlayingCards;
  const FX = window.TableFX;
  const SND = window.Sound;
  const H = window.Haptics;

  const $ = (s) => document.querySelector(s);

  const PREFS_KEY = 'poker.v1.prefs';
  const SAVE_KEY = 'poker.v1.save';
  const STATS_KEY = 'poker.v1.stats';

  const NAMES = ['דנה', 'יוסי', 'מיכל', 'אבי', 'רון', 'נועה', 'עומר', 'שירה'];
  /* צבעי אווטאר רגועים — שונים זה מזה, ולא מתחרים בזהב ובאדום של השולחן */
  const AV_COLORS = ['#5b7fb8', '#9a6bb0', '#3f9a8c', '#c0784a', '#6f8f4e', '#b85f7a', '#5d6f9e', '#a08a3c'];
  const LEVEL_NAMES = { 1: 'מתחיל', 2: 'קל', 3: 'בינוני', 4: 'קשה' };
  const LEVEL_DESC = {
    1: 'משווים כמעט כל הימור ונדיר שמעלים. מתאים ללמוד את החוקים.',
    2: 'משחקים לפי חוזק היד, כמעט בלי בלופים. צפויים למדי.',
    3: 'מחשבים סיכויים מול יחס הקופה, ומבלפים מדי פעם.',
    4: 'מחשבים יותר, מגוונים הימורים, עושים צ\'ק-רייז ולומדים את הסגנון שלך.',
  };
  const ACTION_LABEL = {
    fold: 'פולד', check: 'צ\'ק', call: 'קול', bet: 'הימור', raise: 'העלאה',
    allin: 'הכל-אין', sb: 'בליינד קטן', bb: 'בליינד גדול',
  };
  const STREET_NAMES = { flop: 'פלופ', turn: 'טרן', river: 'ריבר' };
  const SPEED = {
    slow: { ai: 1250, street: 1000, deal: 150 },
    normal: { ai: 850, street: 700, deal: 110 },
    fast: { ai: 420, street: 420, deal: 70 },
  };

  /*
   * מיקום היריבים (מרכז האווטאר), באחוזים מהלבד. הסדר הוא כיוון השעון
   * מנקודת המבט שלך: הראשון משמאלך, והאחרון מימינך — כמו שהתור עובר
   * בשולחן אמיתי. "רחב" למחשב: השולחן אובלי לרוחב, והצדדים נפתחים
   */
  const LAYOUT = {
    tall: {
      1: [[50, 9]],
      2: [[17, 19], [83, 19]],
      3: [[13, 21], [50, 8], [87, 21]],
      4: [[11, 65], [16, 19], [84, 19], [89, 65]],
      5: [[11, 66], [14, 21], [50, 8], [86, 21], [89, 66]],
    },
    wide: {
      1: [[50, 11]],
      2: [[30, 12], [70, 12]],
      3: [[9, 45], [50, 11], [91, 45]],
      4: [[12, 68], [24, 13], [76, 13], [88, 68]],
      5: [[11, 68], [16, 20], [50, 10], [84, 20], [89, 68]],
    },
  };
  /*
   * מקום ההימור מול כל מושב. בטלפון קלפי השולחן תופסים כמעט את כל הרוחב,
   * ולכן ההימורים לא יכולים פשוט "ללכת למרכז": של המושבים העליונים יושבים
   * מעל הקלפים, ושל התחתונים — מתחת להם, ליד הקופה. במחשב יש מקום, והם
   * בדרך למרכז
   */
  const BETS_TALL = {
    1: [[50, 30]],
    2: [[35, 30], [65, 30]],
    3: [[34, 32], [50, 28], [66, 32]],
    4: [[27, 77], [35, 31], [65, 31], [73, 77]],
    5: [[27, 78], [34, 32], [50, 28], [66, 32], [73, 78]],
  };
  const CENTER = [50, 47];

  /* --------------------------------------------------------------------- */
  /* אחסון                                                                  */
  /* --------------------------------------------------------------------- */

  const store = {
    ok: (() => {
      try { localStorage.setItem('__p', '1'); localStorage.removeItem('__p'); return true; }
      catch (e) { return false; }
    })(),
    read(k, d) {
      if (!this.ok) return d;
      try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : d; }
      catch (e) { return d; }
    },
    write(k, v) {
      if (!this.ok) return;
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
    },
    remove(k) { if (this.ok) { try { localStorage.removeItem(k); } catch (e) {} } },
  };

  const DEFAULT_PREFS = {
    theme: 'auto',
    haptics: true,
    sound: true,
    showHand: true,
    speed: 'normal',
    // אפשרויות הטורניר האחרון
    opponents: '3',
    level: '2',
  };

  const state = {
    prefs: Object.assign({}, DEFAULT_PREFS, store.read(PREFS_KEY, {})),
    game: null,
    level: 2,
    peak: 1000,
    recorded: false,
    timer: null,
    raiseTo: 0,
    sheet: false,
    /** מה שמוצג כרגע — render מנפיש רק את ההפרש מהמשחק */
    view: null,
    /** אלמנטי המושבים, לפי אינדקס שחקן (0 = את/ה) */
    seats: [],
    seatCount: -1,
    /** טיימרים של הנפשות — מבוטלים בטורניר חדש */
    fx: [],
    busyUntil: 0,
    strengthKey: '',
  };

  const el = {
    table: $('#table'),
    seats: $('#seats'),
    deck: $('#deck'),
    pot: $('#pot'),
    potStack: $('#potStack'),
    potAmount: $('#potAmount'),
    board: $('#board'),
    tableMsg: $('#tableMsg'),
    myBet: $('#myBet'),
    puck: $('#puck'),
    me: $('#me'),
    myCards: $('#myCards'),
    myPlate: $('#myPlate'),
    myAvatar: $('#myAvatar'),
    myStack: $('#myStack'),
    myHand: $('#myHand'),
    meter: $('#meter'),
    meterBar: $('#meterBar'),
    infoHand: $('#infoHand'),
    infoBlinds: $('#infoBlinds'),
    infoLevel: $('#infoLevel'),
    status: $('#status'),
    sheet: $('#raiseSheet'),
    presets: $('#presets'),
    range: $('#raiseRange'),
    amount: $('#raiseAmount'),
    btnLess: $('#btnLess'),
    btnMore: $('#btnMore'),
    btnRaiseGo: $('#btnRaiseGo'),
    btnRaiseCancel: $('#btnRaiseCancel'),
    buttons: $('#buttons'),
    btnFold: $('#btnFold'),
    btnCall: $('#btnCall'),
    btnRaise: $('#btnRaise'),
    callText: $('#callText'),
    raiseText: $('#raiseText'),
    nextRow: $('#nextRow'),
    btnNext: $('#btnNext'),
    btnNew: $('#btnNew'),
    footerInfo: $('#footerInfo'),
    toast: $('#toast'),
    newModal: $('#newModal'),
    levelDesc: $('#levelDesc'),
    btnStart: $('#btnStart'),
    overModal: $('#overModal'),
    overBadge: $('#overBadge'),
    overTitle: $('#overTitle'),
    overSub: $('#overSub'),
    overStats: $('#overStats'),
    confetti: $('#confetti'),
    btnOverNew: $('#btnOverNew'),
    settingsModal: $('#settingsModal'),
    btnSettings: $('#btnSettings'),
    hapticsNote: $('#hapticsNote'),
    helpModal: $('#helpModal'),
    btnHelp: $('#btnHelp'),
    statsModal: $('#statsModal'),
    statsTable: $('#statsTable'),
    btnStats: $('#btnStats'),
    btnClearStats: $('#btnClearStats'),
    btnTheme: $('#btnTheme'),
    confirmModal: $('#confirmModal'),
    confirmText: $('#confirmText'),
    btnConfirmOk: $('#btnConfirmOk'),
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --------------------------------------------------------------------- */
  /* עזרים                                                                  */
  /* --------------------------------------------------------------------- */

  const say = (msg, loud) => { if (window.Announce) window.Announce.say(msg, loud); };

  let toastTimer = null;
  function toast(msg) {
    say(msg);
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2200);
  }

  const openModal = (n) => window.Modal.open(n);
  const closeModal = (n) => window.Modal.close(n);

  let confirmAction = null;
  function askConfirm(text, onOk) {
    el.confirmText.textContent = text;
    confirmAction = onOk;
    openModal(el.confirmModal);
  }

  /*
   * לפני נגיעה ראשונה בדף הדפדפן חוסם רטט ומדפיס אזהרה. היריבים פועלים
   * מיד בטעינה, ולכן לא מנסים בכלל עד שהמשתמש נגע
   */
  function feel(name) {
    const ua = navigator.userActivation;
    if (ua && !ua.hasBeenActive) return;
    if (state.prefs.haptics && H) H.fire(name);
  }
  function snd(name) { if (state.prefs.sound && SND) SND.play(name); }

  const savePrefs = () => store.write(PREFS_KEY, state.prefs);
  const stats = () => store.read(STATS_KEY, {});
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const now = () => performance.now();

  function delay(kind) {
    const d = (SPEED[state.prefs.speed] || SPEED.normal)[kind];
    return reducedMotion ? Math.round(d * 0.6) : d;
  }

  /*
   * כמה לחכות לפני הצעד הבא. יריב "חושב" רק אחרי שההנפשות נגמרו — אחרת
   * הטבעת שלו לא הייתה מספיקה להסתובב. רחוב חדש נפתח אחרי ההשהיה הרגילה,
   * או קצת אחרי שהז'יטונים נחתו
   */
  function wait(kind) {
    const rest = Math.max(0, state.busyUntil - now());
    return kind === 'ai' ? rest + delay('ai') : Math.max(delay(kind), rest + 250);
  }

  function applyTheme() {
    const pref = state.prefs.theme;
    const dark = pref === 'dark' ||
      (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.prefs.theme === 'auto') applyTheme();
  });

  const me = () => state.game.players[0];

  function saveGame() {
    const g = state.game;
    if (!g) return;
    if (g.over && state.recorded) { store.remove(SAVE_KEY); return; }
    store.write(SAVE_KEY, {
      v: 1,
      over: !!g.over,
      hand: g.hand,
      // הערימה כולל מה שכבר הושקע ביד הנוכחית — כך המספר לא "קופץ" באמצע יד
      chips: me().stack + (g.h && g.h.street !== 'done' && g.h.seats[0] ? g.h.seats[0].total : 0),
      level: state.level,
      peak: state.peak,
      game: g,
    });
  }

  /* ----------------------------- ציר זמן ------------------------------ */

  /** מבצע fn אחרי ms — או מיד, כשאין הנפשה */
  function at(ms, fn, animate) {
    if (!animate || ms <= 0) { fn(); return; }
    state.fx.push(setTimeout(fn, ms));
  }
  function clearFx() {
    state.fx.forEach(clearTimeout);
    state.fx = [];
    state.busyUntil = 0;
  }
  function busy(ms) { state.busyUntil = Math.max(state.busyUntil, now() + ms); }

  /* --------------------------------------------------------------------- */
  /* מבנה השולחן                                                            */
  /* --------------------------------------------------------------------- */

  function shape() {
    return el.table.dataset.shape === 'wide' ? 'wide' : 'tall';
  }

  function seatXY(i) {
    if (i === 0) return [50, 104];
    const n = state.game.players.length - 1;
    const pos = LAYOUT[shape()][n] || LAYOUT[shape()][3];
    return pos[i - 1];
  }

  function betXY(i) {
    if (i === 0) return [50, 79];
    const n = state.game.players.length - 1;
    if (shape() === 'tall') return (BETS_TALL[n] || BETS_TALL[3])[i - 1];
    const [x, y] = seatXY(i);
    const t = 0.42;
    return [x + (CENTER[0] - x) * t, y + (CENTER[1] - y) * t];
  }

  function avatarOf(name, i) {
    const a = document.createElement('span');
    a.className = 'pk-avatar';
    a.setAttribute('aria-hidden', 'true');
    a.style.setProperty('--av-bg', AV_COLORS[(name.charCodeAt(0) + i) % AV_COLORS.length]);
    const t = document.createElement('span');
    t.textContent = name.slice(0, 1);
    a.appendChild(t);
    return a;
  }

  /** בונה את המושבים פעם אחת לטורניר (או כשמספר השחקנים השתנה) */
  function ensureSeats() {
    const g = state.game;
    const n = g.players.length;
    const names = g.players.map((p) => p.name).join('|');
    if (state.seatCount === n && state.seatNames === names) return;
    state.seatCount = n;
    state.seatNames = names;
    el.table.dataset.n = String(n - 1);
    el.seats.replaceChildren();
    el.table.querySelectorAll('.pk-bet-spot:not(#myBet)').forEach((b) => b.remove());

    state.seats = [{
      seat: null, avatar: el.myAvatar, plate: el.myPlate, stack: el.myStack,
      cards: el.myCards, bet: el.myBet, badge: null, action: null,
    }];
    for (let i = 1; i < n; i++) {
      const p = g.players[i];
      const seat = document.createElement('div');
      seat.className = 'pk-seat';
      seat.setAttribute('role', 'group');
      const avatar = avatarOf(p.name, i);
      const cards = document.createElement('div');
      cards.className = 'pk-seat-cards';
      const plate = document.createElement('div');
      plate.className = 'pk-plate';
      const name = document.createElement('span');
      name.className = 'pk-name';
      name.textContent = p.name;
      const action = document.createElement('span');
      action.className = 'pk-action';
      const stack = document.createElement('span');
      stack.className = 'pk-stack';
      plate.append(name, action, stack);
      const badge = document.createElement('span');
      badge.className = 'pk-badge';
      badge.hidden = true;
      seat.append(cards, avatar, plate, badge);
      el.seats.appendChild(seat);

      const bet = document.createElement('div');
      bet.className = 'pk-bet-spot';
      bet.dataset.seat = String(i);
      el.table.insertBefore(bet, el.puck);

      state.seats[i] = { seat, avatar, plate, stack, cards, bet, badge, action, name };
    }
    layout();
  }

  /*
   * מידות ומיקומים בפיקסלים — מחושבים מחדש בכל שינוי גודל. הקלפים של
   * היריב נשענים על הצד הפנימי של האווטאר, ובעימות זזים לכיוון המרכז
   * מספיק רחוק כדי לא לכסות את הלוחית
   */
  function layout() {
    const g = state.game;
    if (!g) return;
    const W = el.table.clientWidth;
    const Ht = el.table.clientHeight;
    el.table.dataset.shape = W / Math.max(1, Ht) > 1.5 ? 'wide' : 'tall';
    const wide = shape() === 'wide';
    const board = Math.round(Math.max(44, Math.min(wide ? 78 : 56, (W - (wide ? 200 : 40)) / 5.5)));
    el.table.style.setProperty('--board-w', board + 'px');
    const myW = Math.round(Math.max(62, Math.min(wide ? 92 : 78, W / 4.6)));
    el.me.style.setProperty('--my-w', myW + 'px');

    const av = wide ? 56 : 44;
    const seatW = wide ? 34 : 26;
    const showW = seatW * 1.45;
    const [cx, cy] = CENTER;

    for (let i = 1; i < state.seats.length; i++) {
      const s = state.seats[i];
      if (!s) continue;
      const [x, y] = seatXY(i);
      s.seat.style.left = x + '%';
      s.seat.style.top = y + '%';

      // כיוון פנימה, בפיקסלים
      const dx = (cx - x) * W / 100;
      const dy = (cy - y) * Ht / 100;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;

      const side = Math.abs(ux) < 0.25 ? 1 : Math.sign(ux);
      s.cards.style.setProperty('--cx', (side * av * 0.66) + 'px');
      s.cards.style.setProperty('--cy', (-av * 0.34) + 'px');
      // בעימות: לצד למושבי הצדדים, ומתחת ללוחית למושבים העליונים
      // בטלפון אין מקום פנוי סביב המושבים — הקלפים נפתחים על האווטאר עצמו
      const plateH = 30;
      const cardH = showW * 1.4;
      let sx = 0;
      let sy = -av * 0.12;
      if (wide && y < 32) {
        // שורה עליונה: מתחת ללוחית, לכיוון המרכז
        sx = 0;
        sy = av / 2 + plateH + cardH / 2 - 8;
      } else if (wide) {
        // צדדים: לצד האווטאר, לכיוון המרכז
        sx = Math.sign(ux) * (av / 2 + showW * 0.95 + 4);
        sy = -4;
      }
      s.cards.style.setProperty('--sx', sx + 'px');
      s.cards.style.setProperty('--sy', sy + 'px');

      const [bx, by] = betXY(i);
      s.bet.style.left = bx + '%';
      s.bet.style.top = by + '%';
      s.ux = ux;
      s.uy = uy;
    }
    placePuck();
  }

  /** כפתור הדילר: ליד המושב, קצת פנימה ולצד — מחליק כשהוא עובר */
  function placePuck() {
    const g = state.game;
    if (!g || g.button < 0 || !g.players[g.button] || g.players[g.button].out) {
      el.puck.hidden = true;
      return;
    }
    el.puck.hidden = false;
    const W = el.table.clientWidth;
    const Ht = el.table.clientHeight;
    if (g.button === 0) {
      el.puck.style.left = '37%';
      el.puck.style.top = '86%';
      return;
    }
    /*
     * ליד מקום ההימור של הדילר: מעליו למושבים העליונים, מתחתיו לתחתונים
     * (כלומר בצד שפונה למושב, הרחק מקלפי השולחן), ולמושב העליון במרכז —
     * לצידו
     */
    const [x, y] = seatXY(g.button);
    const [bx, by] = betXY(g.button);
    let px = bx / 100 * W;
    let py = by / 100 * Ht;
    if (Math.abs(x - 50) < 5) { px -= 42; py -= 8; }
    else py += (y < 50 ? -1 : 1) * 30;
    el.puck.style.left = (px / W * 100) + '%';
    el.puck.style.top = (py / Ht * 100) + '%';
  }

  /* --------------------------------------------------------------------- */
  /* ציור                                                                   */
  /* --------------------------------------------------------------------- */

  function freshView(g) {
    return {
      hand: g.hand,
      street: 'preflop',
      bets: g.players.map(() => 0),
      lasts: g.players.map(() => null),
      folded: g.players.map(() => false),
      board: 0,
      done: false,
      pot: 0,
      myTurn: false,
    };
  }

  function setBetSpot(i, amount) {
    const spot = state.seats[i].bet;
    spot.replaceChildren();
    if (!amount) spot.style.visibility = '';
    if (amount > 0) {
      spot.appendChild(FX.stack(amount, { max: 5 }));
      const amt = document.createElement('span');
      amt.className = 'pk-bet-amt';
      amt.textContent = fmt(amount);
      spot.appendChild(amt);
    }
  }

  function setPot(amount) {
    el.potAmount.textContent = fmt(amount);
    el.potStack.replaceChildren();
    if (amount > 0) el.potStack.appendChild(FX.stack(amount, { max: 6 }));
    el.pot.classList.toggle('is-empty', amount === 0);
  }

  function flashAction(i, label, cls) {
    const s = state.seats[i];
    if (!s || !s.action) return;
    s.action.textContent = label;
    s.action.className = 'pk-action ' + cls;
    s.seat.classList.remove('has-action');
    void s.seat.offsetWidth; // מאתחל את הנפשת ה"פופ"
    s.seat.classList.add('has-action');
    clearTimeout(s.actionTimer);
    s.actionTimer = setTimeout(() => s.seat.classList.remove('has-action'), 1700);
  }

  function actionText(s) {
    const base = ACTION_LABEL[s.last] || '';
    if (s.last === 'call' || s.last === 'bet' || s.last === 'raise' || s.last === 'allin') {
      return base + (s.last === 'raise' ? ' ל-' : ' ') + fmt(s.bet);
    }
    return base;
  }

  /** הקופה שנאספה — בלי ההימורים שעוד מונחים מול השחקנים */
  function collectedPot(h) {
    if (!h) return 0;
    if (h.street === 'done') return h.result.pots.reduce((a, p) => a + p.amount, 0);
    return P.potTotal(h) - h.seats.reduce((a, s) => a + (s ? s.bet : 0), 0);
  }

  function render(instant) {
    const g = state.game;
    if (!g) return;
    ensureSeats();
    renderInfo();

    const h = g.h;
    const anim = !instant && !reducedMotion;
    const pace = delay('deal');
    let t = 0;

    if (!state.view || state.view.hand !== g.hand) newHandView(anim);
    const v = state.view;
    if (!h) { renderStatic(); return; }

    /* ---- יד חדשה: חלוקה ---- */
    if (v.dealing) {
      v.dealing = false;
      if (anim) snd('shuffle');
      t = anim ? 260 : 0;
      /*
       * סדר החלוקה: מהבליינד הקטן סביב השולחן, פעמיים. לפי המושבים של היד
       * ולא לפי מי ש"עוד במשחק" — אחרי העימות שחקן שהודח כבר מסומן בחוץ,
       * אבל בטעינה מחדש של אותה יד הקלפים שלו עדיין צריכים להיות מצוירים
       */
      const order = [];
      const n = h.seats.length;
      for (let round = 0; round < 2; round++) {
        for (let k = 0; k < n; k++) {
          const i = (h.sbIdx + k) % n;
          if (h.seats[i]) order.push([i, round]);
        }
      }
      order.forEach(([i, k]) => {
        const s = h.seats[i];
        if (!s || !s.hole[k]) return;
        const card = PC.el(i === 0 ? s.hole[k] : null, { down: true });
        state.seats[i].cards.appendChild(card);
        if (anim) {
          FX.flyIn(card, el.deck, { delay: t, duration: 380, rotate: -20, scale: .6, fade: true });
          at(t, () => snd('deal'), anim);
          t += pace;
        }
      });
      // הקלפים שלך מתהפכים אחרי שהגיעו
      t += anim ? 120 : 0;
      v.mineHidden = true;
      el.myCards.querySelectorAll('.pc').forEach((c, k) => {
        at(t + k * 140, () => {
          PC.reveal(c, null, { instant: !anim });
          if (anim) snd('flip');
          if (k === 1) { v.mineHidden = false; renderStrength(); }
        }, anim);
      });
      t += anim ? 420 : 0;
    }

    /* ---- סוף סיבוב הימורים: ההימורים עפים לקופה ---- */
    const streetMoved = h.street !== v.street;
    if (streetMoved) {
      const moving = v.bets.some((b) => b > 0);
      if (moving) {
        v.bets.forEach((amount, i) => {
          if (!amount || !state.seats[i]) return;
          const spot = state.seats[i].bet;
          if (anim) {
            const ghost = FX.stack(amount, { max: 5, size: 22 });
            FX.toss(ghost, spot, el.pot, { delay: t, duration: 460, arc: 18 });
          }
          at(t, () => setBetSpot(i, 0), anim);
          v.bets[i] = 0;
        });
        at(t, () => snd('chips'), anim);
        t += anim ? 480 : 0;
      }
      v.street = h.street;
    }
    const potNow = collectedPot(h);
    if (potNow !== v.pot) {
      const from = v.pot;
      v.pot = potNow;
      at(t, () => {
        setPot(potNow);
        if (anim && potNow > from) FX.bump(el.pot);
      }, anim);
    }

    /* ---- הימורים ופעולות ---- */
    h.seats.forEach((s, i) => {
      const seat = state.seats[i];
      if (!seat) return;
      const amount = s ? s.bet : 0;
      if (amount !== v.bets[i]) {
        const grew = amount > v.bets[i];
        setBetSpot(i, amount);
        if (grew && anim) {
          // מוסתר עד שמגיע תורו לעוף — אחרת הוא "מחכה" על האווטאר
          const spot = seat.bet;
          if (t > 0) spot.style.visibility = 'hidden';
          at(t, () => {
            spot.style.visibility = '';
            const stackEl = spot.querySelector('.chip-stack');
            if (stackEl) FX.flyIn(stackEl, seat.avatar, { duration: 360, rotate: 0, scale: .7 });
            snd(amount >= 10 * h.bb ? 'chips' : 'chip');
          }, anim);
        }
        v.bets[i] = amount;
      }
      if (!s) return;
      if (s.last !== v.lasts[i]) {
        v.lasts[i] = s.last;
        if (s.last && i > 0 && h.street !== 'done') {
          const text = actionText(s);
          at(t, () => flashAction(i, text, 'is-' + s.last), anim);
        }
        if (s.last === 'check' && anim) at(t, () => snd('tick'), anim);
      }
      if (s.folded && !v.folded[i]) {
        v.folded[i] = true;
        muck(i, anim, t);
      }
    });

    /* ---- קלפי השולחן ---- */
    if (h.board.length > v.board) {
      const start = v.board;
      const slots = el.board.children;
      for (let k = start; k < h.board.length; k++) {
        const card = PC.el(h.board[k], { down: true });
        el.board.replaceChild(card, slots[k]);
        if (anim) FX.flyIn(card, el.deck, { delay: t + (k - start) * 90, duration: 320, rotate: -10, scale: .7, fade: true });
      }
      t += anim ? 300 + (h.board.length - start - 1) * 90 : 0;
      for (let k = start; k < h.board.length; k++) {
        const card = slots[k];
        at(t, () => { PC.reveal(card, null, { instant: !anim }); if (anim) snd('flip'); }, anim);
        t += anim ? 190 : 0;
      }
      t += anim ? 260 : 0;
      v.board = h.board.length;
    }

    /* ---- סוף היד ---- */
    if (h.street === 'done' && !v.done) {
      v.done = true;
      t = showdown(h, t, anim);
    }

    renderStatic();

    // תור: טבעת הטיימר על היריב, ופעימה וצליל כשהגיע תורך
    const myTurn = h.toAct === 0 && !g.over;
    at(t, () => {
      state.seats.forEach((s, i) => {
        if (!s || !s.seat) return;
        const turn = h.toAct === i && h.street !== 'done';
        s.seat.style.setProperty('--think', delay('ai') + 'ms');
        if (turn && !s.seat.classList.contains('is-turn')) {
          s.seat.classList.add('is-turn');
        } else if (!turn) s.seat.classList.remove('is-turn');
      });
      el.myPlate.classList.toggle('is-turn', myTurn);
      if (myTurn && !v.myTurn) { snd('turn'); feel('pick'); }
      v.myTurn = myTurn;
      renderActions();
    }, anim);

    if (t > 0 && anim) busy(t);
    renderActions();
  }

  /** פולד: הקלפים נזרקים למרכז ונעלמים */
  function muck(i, animate, t) {
    const box = state.seats[i].cards;
    const cards = Array.from(box.children);
    if (!cards.length) return;
    // הקלפים שלך נשארים מולך, מעומעמים — שתראה/י מה זרקת
    if (i === 0) {
      at(t, () => { cards.forEach((c) => c.classList.add('is-dim')); if (animate) snd('fold'); }, animate);
      return;
    }
    if (!animate) { box.replaceChildren(); return; }
    at(t, () => {
      snd('fold');
      cards.forEach((c, k) => {
        const ghost = PC.el(null, { size: c.offsetWidth || 26 });
        ghost.classList.add('pc-backs-red');
        FX.toss(ghost, c, el.deck, { delay: k * 60, duration: 420, arc: 10, scaleTo: .7 });
      });
      box.replaceChildren();
    }, true);
  }

  /**
   * עימות וחלוקת הקופה. מחזיר את הזמן שבו הכול נגמר.
   */
  function showdown(h, t, anim) {
    const g = state.game;
    const res = h.result;
    const winners = new Set();
    res.pots.forEach((p) => Object.keys(p.paid).forEach((w) => winners.add(Number(w))));

    // הערימות של הזוכים מוצגות בלי הזכייה, עד שהקופה נוחתת
    const paidTo = {};
    res.pots.forEach((p) => Object.keys(p.paid).forEach((w) => { paidTo[w] = (paidTo[w] || 0) + p.paid[w]; }));
    Object.keys(paidTo).forEach((w) => {
      const s = state.seats[w];
      if (s) s.stack.textContent = fmt(g.players[w].stack - paidTo[w]);
    });
    state.holdStacks = paidTo;

    if (res.showdown) {
      // קלפי היריבים מתהפכים, אחד אחרי השני
      t += anim ? 200 : 0;
      Object.keys(res.hands).map(Number).forEach((i) => {
        if (i === 0) return;
        const box = state.seats[i].cards;
        at(t, () => { box.classList.add('is-show'); state.seats[i].seat.classList.add('is-showing'); }, anim);
        h.seats[i].hole.forEach((c, k) => {
          const node = box.children[k];
          if (!node) return;
          at(t + 80 + k * 150, () => { PC.reveal(node, c, { instant: !anim }); if (anim) snd('flip'); }, anim);
        });
        t += anim ? 240 : 0;
      });
      t += anim ? 260 : 0;

      // החמישייה המנצחת זוהרת; כל השאר מתעמעם
      at(t, () => {
        const win = new Set();
        winners.forEach((w) => { if (res.hands[w]) res.hands[w].cards.forEach((c) => win.add(c.rank + c.suit)); });
        const all = Array.from(el.board.querySelectorAll('.pc'))
          .concat(Array.from(el.table.querySelectorAll('.pk-seat-cards .pc')))
          .concat(Array.from(el.myCards.querySelectorAll('.pc')));
        all.forEach((node) => {
          const c = node._card;
          if (!c) return;
          if (win.has(c.rank + c.suit)) node.classList.add('is-glow', 'is-pulse');
          else node.classList.add('is-dim');
        });
        Object.keys(res.hands).forEach((i) => {
          const s = state.seats[i];
          if (!s || !s.badge) return;
          s.badge.textContent = res.hands[i].name;
          s.badge.className = 'pk-badge is-hand' + (winners.has(Number(i)) ? ' is-win' : '');
          s.badge.hidden = false;
        });
      }, anim);
      t += anim ? 520 : 0;
    } else {
      t += anim ? 250 : 0;
    }

    // הקופה עפה לזוכים, והערימה שלהם מטפסת
    at(t, () => {
      setPot(0);
      el.tableMsg.textContent = resultText(res);
      el.tableMsg.classList.toggle('is-me', !!res.won[0]);
      winners.forEach((w) => {
        const target = state.seats[w].avatar;
        const amount = paidTo[w];
        if (anim) FX.toss(FX.stack(amount, { max: 6, size: 24 }), el.pot, target, { duration: 620, arc: 30 });
        const s = state.seats[w];
        s.seat && s.seat.classList.add('is-winner');
        if (w === 0) el.myPlate.classList.add('is-winner');
        at(anim ? 600 : 0, () => {
          FX.countUp(s.stack, g.players[w].stack - amount, g.players[w].stack, anim ? 650 : 0, fmt);
          if (anim) FX.bump(s.stack);
        }, anim);
      });
      state.holdStacks = null;
      if (anim) {
        snd('chips');
        const big = res.won[0] && res.won[0] >= 10 * h.bb;
        setTimeout(() => snd(res.won[0] ? (big ? 'bigwin' : 'win') : (winners.has(0) ? 'push' : 'lose')), 420);
      }
    }, anim);
    t += anim ? 1050 : 0;
    return t;
  }

  function newHandView(anim) {
    const g = state.game;
    clearFx();
    state.view = freshView(g);
    state.view.dealing = !!g.h;
    state.view.pot = 0;
    state.strengthKey = '';
    closeSheet();
    for (let i = 0; i < state.seats.length; i++) {
      const s = state.seats[i];
      if (!s) continue;
      s.cards.replaceChildren();
      if (s.cards.classList) s.cards.classList.remove('is-show');
      setBetSpot(i, 0);
      if (s.badge) s.badge.hidden = true;
      if (s.seat) s.seat.classList.remove('is-winner', 'is-turn', 'has-action', 'is-folded', 'is-showing');
    }
    el.myPlate.classList.remove('is-winner', 'is-turn');
    el.tableMsg.textContent = '';
    setPot(0);
    el.board.replaceChildren();
    for (let k = 0; k < 5; k++) {
      const slot = document.createElement('div');
      slot.className = 'pc-slot';
      slot.setAttribute('aria-hidden', 'true');
      el.board.appendChild(slot);
    }
    placePuck();
    if (!anim) el.puck.style.transition = 'none';
    requestAnimationFrame(() => { el.puck.style.transition = ''; });
  }

  /** מה שאינו הנפשה: ערימות, מצבים, תגיות, שם היד וחוזקה */
  function renderStatic() {
    const g = state.game;
    const h = g.h;
    const n = g.players.length;
    for (let i = 1; i < n; i++) {
      const s = state.seats[i];
      const p = g.players[i];
      const hs = h && h.seats[i];
      if (!state.holdStacks || state.holdStacks[i] == null) {
        if (!s.stack._countRaf) s.stack.textContent = p.out ? 'בחוץ' : fmt(p.stack);
      }
      s.seat.classList.toggle('is-out', !!p.out);
      s.seat.classList.toggle('is-folded', !!(hs && hs.folded));
      if (h && h.street !== 'done' || !h) {
        if (hs && hs.allIn && !hs.folded) {
          s.badge.textContent = 'הכל-אין';
          s.badge.className = 'pk-badge is-allin';
          s.badge.hidden = false;
        } else if (hs && hs.folded) {
          s.badge.textContent = 'פולד';
          s.badge.className = 'pk-badge is-fold';
          s.badge.hidden = false;
        } else if (!p.out) s.badge.hidden = true;
        if (p.out) {
          s.badge.textContent = 'בחוץ';
          s.badge.className = 'pk-badge is-fold';
          s.badge.hidden = false;
        }
      }
      let aria = p.name + ', ' + (p.out ? 'בחוץ' : fmt(p.stack) + ' ז\'יטונים');
      if (hs && hs.bet) aria += ', הימר ' + fmt(hs.bet);
      if (hs && hs.folded) aria += ', פולד';
      else if (hs && hs.allIn) aria += ', הכל-אין';
      if (g.button === i) aria += ', דילר';
      if (h && h.toAct === i) aria += ', בתור';
      s.seat.setAttribute('aria-label', aria);
    }

    const p = me();
    const s = h && h.seats[0];
    if (!state.holdStacks || state.holdStacks[0] == null) {
      if (!el.myStack._countRaf) el.myStack.textContent = p.out ? 'בחוץ' : fmt(p.stack);
    }
    el.myPlate.classList.toggle('is-allin', !!(s && s.allIn && !s.folded && h.street !== 'done'));

    // קלפי השולחן לקורא מסך
    el.board.setAttribute('aria-label', h && h.board.length
      ? 'קלפי השולחן: ' + h.board.map(PC.name).join(', ')
      : 'קלפי השולחן: עוד לא נפתחו');
    el.pot.setAttribute('aria-label', 'קופה ' + fmt(collectedPot(h)));

    renderStrength();
    const left = g.players.filter((q) => !q.out).length;
    el.footerInfo.textContent = left + ' שחקנים בשולחן · רמה ' + LEVEL_NAMES[state.level];
  }

  function renderInfo() {
    const g = state.game;
    const [sb, bb] = P.blindsFor(g, Math.max(1, g.hand));
    el.infoHand.textContent = 'יד ' + Math.max(1, g.hand);
    const toUp = g.handsPerLevel - ((Math.max(1, g.hand) - 1) % g.handsPerLevel);
    el.infoBlinds.textContent = 'בליינדים ' + sb + '/' + bb + (g.over ? '' : ' · עולים בעוד ' + toUp);
    el.infoLevel.textContent = LEVEL_NAMES[state.level];
  }

  /*
   * שם היד שלך ומד חוזק. לפני הפלופ — הערכת שתי הקלפים; אחרי — סיכויי
   * ניצחון בסימולציה קצרה (עד ~20ms) מול מי שעוד ביד. מחושב פעם אחת לכל
   * רחוב, לא בכל ציור
   */
  function renderStrength() {
    const g = state.game;
    const h = g.h;
    const s = h && h.seats[0];
    let hand = '';
    const hidden = state.view && state.view.mineHidden;
    if (hidden) {
      el.myHand.textContent = '';
      el.meter.classList.add('is-off');
      return;
    }
    if (state.prefs.showHand && s && s.hole.length && !s.folded) {
      if (h.board.length) hand = P.evaluate(s.hole.concat(h.board)).desc;
      else {
        const [a, b] = s.hole;
        hand = a.rank === b.rank ? 'זוג ' + PC.label(a.rank)
          : PC.label(Math.max(a.rank, b.rank)) + '-' + PC.label(Math.min(a.rank, b.rank)) + (a.suit === b.suit ? ' באותה צורה' : '');
      }
      hand = 'יש לך: ' + hand;
    } else if (s && s.folded) hand = 'ויתרת ביד הזו';
    el.myHand.textContent = hand;

    const show = state.prefs.showHand && s && s.hole.length && !s.folded && h.street !== 'done';
    el.meter.classList.toggle('is-off', !show);
    if (!show) return;
    const opps = h.seats.filter((x, i) => x && i > 0 && !x.folded).length;
    const key = g.hand + ':' + h.board.length + ':' + opps;
    if (key === state.strengthKey) return;
    state.strengthKey = key;
    let p;
    if (!h.board.length) p = AI.chen(s.hole[0], s.hole[1]);
    else p = AI.equity(s.hole, h.board, Math.max(1, opps), 500, Math.random, 20);
    el.meterBar.style.setProperty('--p', Math.round(Math.max(.04, p) * 100) + '%');
    el.meter.title = 'חוזק היד: ' + Math.round(p * 100) + '%';
  }

  /** "דנה זוכה ב-480 עם זוג מלכים" */
  function resultText(res) {
    if (!res) return '';
    const g = state.game;
    const winners = Object.keys(res.won).map(Number);
    if (!winners.length) {
      // הכול חזר — כולם ויתרו על הבליינדים של עצמם
      const p = res.pots[0];
      return p ? (p.winners[0] === 0 ? 'הקופה חוזרת אליך' : nameOf(p.winners[0]) + ' לוקח/ת את הקופה') : '';
    }
    const parts = winners.map((w) => {
      const hand = res.showdown && res.hands[w] ? ' עם ' + res.hands[w].desc : '';
      return (w === 0 ? 'זכית' : nameOf(w) + ' זוכה') + ' ב-' + fmt(res.won[w]) + hand;
    });
    return parts.join(' · ');
    function nameOf(i) { return i === 0 ? 'את/ה' : g.players[i].name; }
  }

  /* --------------------------------------------------------------------- */
  /* סרגל הפעולות                                                           */
  /* --------------------------------------------------------------------- */

  function presetTo(L, kind) {
    const base = L.currentBet;
    const pot = L.pot + L.toCall;
    let to = kind === 'min' ? L.minTo
      : kind === 'half' ? base + Math.round(pot / 2)
        : kind === 'threeq' ? base + Math.round(pot * 0.75)
          : kind === 'pot' ? base + pot
            : L.maxTo;
    if (kind !== 'all') to = Math.round(to / 5) * 5;
    return Math.max(L.minTo, Math.min(L.maxTo, to));
  }

  function myLegal() {
    const g = state.game;
    const h = g && g.h;
    if (!h || h.toAct !== 0 || g.over || h.street === 'done') return null;
    if (state.busyUntil > now() + 30) return null;
    return P.legal(g);
  }

  function renderActions() {
    const g = state.game;
    if (!g) return;
    const h = g.h;
    const done = !h || h.street === 'done';
    const animating = state.busyUntil > now() + 30;

    // עד שהקופה נחתה אין "יד הבאה" — וגם לא "טורניר חדש" לפני חלון הסיום
    el.nextRow.hidden = !(done || g.over) || animating || (g.over && !state.overShown);
    el.buttons.hidden = done || g.over;
    el.btnNext.textContent = g.over ? 'טורניר חדש' : 'יד הבאה';

    const L = myLegal();
    el.btnFold.disabled = !L || L.canCheck;
    el.btnCall.disabled = !L;
    el.btnRaise.disabled = !L || !L.canRaise;
    if (!L) closeSheet();

    if (L) {
      el.callText.textContent = L.canCheck ? 'צ\'ק'
        : L.toCall >= L.stack ? 'הכל-אין ' + fmt(L.toCall) : 'קול ' + fmt(L.toCall);
      el.raiseText.textContent = L.currentBet === 0 ? 'הימור' : 'העלאה';
    } else if (!done) {
      el.callText.textContent = 'צ\'ק';
      el.raiseText.textContent = 'העלאה';
    }

    // שורת המצב: מי בתור ומה צריך
    let status = '';
    if (h && !done && !g.over) {
      if (h.toAct === 0 && L) status = L.canCheck ? '<b>תורך</b> · אפשר צ\'ק' : '<b>תורך</b> · להשוות ' + fmt(L.toCall);
      else if (h.toAct > 0) status = g.players[h.toAct].name + ' חושב/ת…';
      else if (h.toAct < 0 && !animating && h.seats[0] && h.seats[0].folded) status = '';
    }
    el.status.innerHTML = status;
    if (state.sheet && L) syncSheet(L);
  }

  /* ---- גיליון ההעלאה ---- */

  function openSheet() {
    const L = myLegal();
    if (!L || !L.canRaise) return;
    if (!(state.raiseTo >= L.minTo && state.raiseTo <= L.maxTo)) state.raiseTo = presetTo(L, 'min');
    state.sheet = true;
    el.sheet.hidden = false;
    el.btnRaise.setAttribute('aria-expanded', 'true');
    syncSheet(L);
    feel('pick');
    setTimeout(() => { try { el.btnRaiseGo.focus({ preventScroll: true }); } catch (e) { /* */ } }, 0);
  }

  function closeSheet() {
    if (!state.sheet) return;
    state.sheet = false;
    el.sheet.hidden = true;
    el.btnRaise.setAttribute('aria-expanded', 'false');
  }

  function syncSheet(L) {
    el.range.min = String(L.minTo);
    el.range.max = String(L.maxTo);
    el.range.step = '5';
    el.range.disabled = L.minTo >= L.maxTo;
    el.range.value = String(state.raiseTo);
    const to = state.raiseTo;
    el.amount.textContent = fmt(to);
    el.range.setAttribute('aria-valuetext', fmt(to));
    el.btnRaiseGo.textContent = to >= L.maxTo ? 'הכל-אין ' + fmt(L.maxTo)
      : (L.currentBet === 0 ? 'הימור ' : 'העלאה ל-') + fmt(to);
    el.btnLess.disabled = to <= L.minTo;
    el.btnMore.disabled = to >= L.maxTo;
    el.presets.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', presetTo(L, b.dataset.pre) === to ? 'true' : 'false');
    });
  }

  function setRaise(v) {
    const L = myLegal();
    if (!L) return;
    state.raiseTo = Math.max(L.minTo, Math.min(L.maxTo, v));
    syncSheet(L);
  }

  function humanAct(type) {
    const g = state.game;
    const L = myLegal();
    if (!L) return;
    let a = { type };
    if (type === 'call' && L.canCheck) a = { type: 'check' };
    if (type === 'fold' && L.canCheck) return;
    if (type === 'raise') {
      if (!L.canRaise) return;
      a = { type: 'raise', to: Math.max(L.minTo, Math.min(L.maxTo, state.raiseTo || L.minTo)) };
    }
    if (!P.act(g, a)) { feel('reject'); return; }
    feel('move');
    closeSheet();
    state.raiseTo = 0;
    const s = g.h.seats[0];
    say(ACTION_LABEL[s.last] + (s.bet ? ' ' + s.bet : ''));
    saveGame();
    loop();
  }

  el.btnFold.addEventListener('click', () => humanAct('fold'));
  el.btnCall.addEventListener('click', () => humanAct('call'));
  el.btnRaise.addEventListener('click', () => { if (state.sheet) closeSheet(); else openSheet(); });
  el.btnRaiseGo.addEventListener('click', () => humanAct('raise'));
  el.btnRaiseCancel.addEventListener('click', () => { closeSheet(); el.btnRaise.focus({ preventScroll: true }); });

  el.range.addEventListener('input', () => {
    const L = myLegal();
    if (!L) return;
    let v = Number(el.range.value);
    // הקצה העליון של הסרגל תמיד הכל-אין, גם אם אינו כפולה של 5
    if (v > L.maxTo - 5) v = L.maxTo;
    setRaise(v);
  });

  el.presets.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pre]');
    const L = myLegal();
    if (!b || !L || !L.canRaise) return;
    setRaise(presetTo(L, b.dataset.pre));
    snd('chip');
    feel('pick');
  });

  function stepRaise(dir) {
    const L = myLegal();
    if (!L) return;
    const step = state.game.h.bb;
    const cur = state.raiseTo || L.minTo;
    setRaise(dir > 0 ? cur + step : cur - step);
    snd('chip');
  }
  el.btnLess.addEventListener('click', () => stepRaise(-1));
  el.btnMore.addEventListener('click', () => stepRaise(1));

  /* --------------------------------------------------------------------- */
  /* הזרימה                                                                 */
  /* --------------------------------------------------------------------- */

  function stop() {
    clearTimeout(state.timer);
    state.timer = null;
  }

  function loop() {
    stop();
    const g = state.game;
    render();
    if (!g || !g.h) return;
    const h = g.h;

    if (h.street === 'done') { handDone(); return; }

    if (h.toAct < 0) {
      state.timer = setTimeout(() => {
        const before = h.board.length;
        P.proceed(g);
        if (h.board.length > before) {
          feel('draw');
          say(STREET_NAMES[h.street] + ': ' + h.board.slice(before).map(PC.name).join(', '));
        }
        saveGame();
        loop();
      }, wait('street'));
      return;
    }

    if (h.toAct === 0) {
      // הכפתורים נפתחים כשההנפשה נגמרת
      const rest = state.busyUntil - now();
      if (rest > 0) state.timer = setTimeout(() => { renderActions(); announceTurn(); }, rest + 20);
      else announceTurn();
      return;
    }

    // יריב: ההחלטה עצמה אחרי ההשהיה, כדי שהטבעת שלו תספיק להסתובב
    const seat = h.toAct;
    state.timer = setTimeout(() => {
      if (state.game !== g || g.h !== h || h.toAct !== seat) return;
      const a = AI.decide(g, { level: state.level });
      if (!a || !P.act(g, a)) P.act(g, { type: P.legal(g).canCheck ? 'check' : 'fold' });
      const s = h.seats[seat];
      feel('opponent');
      say(g.players[seat].name + ': ' + ACTION_LABEL[s.last] + (s.last !== 'fold' && s.last !== 'check' && s.bet ? ' ' + s.bet : ''));
      saveGame();
      loop();
    }, wait('ai'));
  }

  function announceTurn() {
    const L = P.legal(state.game);
    if (L && L.seat === 0) say('תורך. ' + (L.toCall ? 'להשוות ' + L.toCall : 'אפשר לבדוק'));
  }

  function handDone() {
    const g = state.game;
    const h = g.h;
    const res = h.result;
    if (!res.counted) {
      res.counted = true;
      if (res.won[0]) {
        const s = stats();
        const lv = s[state.level] || (s[state.level] = {});
        lv.hands = (lv.hands || 0) + 1;
        store.write(STATS_KEY, s);
      }
      state.peak = Math.max(state.peak, me().stack);
      say(resultText(res), true);
      if (res.won[0]) feel('win');
    }
    saveGame();
    const rest = Math.max(0, state.busyUntil - now());
    if (g.over) setTimeout(gameOver, rest + (reducedMotion ? 300 : 700));
    else {
      setTimeout(() => {
        renderActions();
        if (!el.nextRow.hidden && !window.Modal.top()) el.btnNext.focus({ preventScroll: true });
      }, rest + 40);
    }
  }

  function nextHand() {
    const g = state.game;
    if (!g || g.over || (g.h && g.h.street !== 'done')) return;
    state.raiseTo = 0;
    P.startHand(g);
    feel('draw');
    const [sb, bb] = P.blindsFor(g);
    if (g.hand > 1 && (g.hand - 1) % g.handsPerLevel === 0) toast('הבליינדים עלו: ' + sb + '/' + bb);
    saveGame();
    loop();
  }

  el.btnNext.addEventListener('click', () => {
    if (state.game && state.game.over) openNew();
    else nextHand();
  });

  /* --------------------------------------------------------------------- */
  /* סוף טורניר                                                             */
  /* --------------------------------------------------------------------- */

  function gameOver() {
    const g = state.game;
    if (!g.over) return;
    const won = !me().out;
    const total = g.players.length;
    const place = won ? 1 : (g.place || total);
    state.overShown = true;

    if (!state.recorded) {
      state.recorded = true;
      const s = stats();
      const lv = s[state.level] || (s[state.level] = {});
      lv.played = (lv.played || 0) + 1;
      if (won) lv.won = (lv.won || 0) + 1;
      lv.best = lv.best ? Math.min(lv.best, place) : place;
      store.write(STATS_KEY, s);
      saveGame();
    }

    el.overTitle.textContent = won ? 'ניצחת בטורניר!' : 'נגמרו הז\'יטונים';
    el.overSub.textContent = won
      ? 'כל הז\'יטונים אצלך, ברמה ' + LEVEL_NAMES[state.level] + '.'
      : 'סיימת במקום ' + place + ' מתוך ' + total + '.';
    el.overBadge.className = won ? 'win-badge' : 'stuck-badge';
    el.overBadge.innerHTML = won
      ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg>'
      : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.5 15.5s1.2-1.5 3.5-1.5 3.5 1.5 3.5 1.5M9 9.5h.01M15 9.5h.01"/></svg>';
    el.overStats.innerHTML =
      '<div class="win-stat"><span class="k">ידיים</span><span class="v">' + g.hand + '</span></div>' +
      '<div class="win-stat' + (won ? ' is-best' : '') + '"><span class="k">מקום</span><span class="v">' + place + '/' + total + '</span></div>' +
      '<div class="win-stat"><span class="k">ערימה מקסימלית</span><span class="v">' + fmt(state.peak) + '</span></div>' +
      '<div class="win-stat"><span class="k">בליינדים בסוף</span><span class="v">' + P.blindsFor(g).join('/') + '</span></div>';

    el.confetti.replaceChildren();
    if (won && !reducedMotion) {
      const colors = ['#f2c55c', '#2f6bff', '#23996b', '#e14b52', '#a855f7'];
      for (let i = 0; i < 14; i++) {
        const c = document.createElement('i');
        c.style.left = (5 + Math.random() * 90) + '%';
        c.style.background = colors[i % colors.length];
        c.style.animationDelay = (Math.random() * 400) + 'ms';
        el.confetti.appendChild(c);
      }
    }
    say(el.overTitle.textContent + ' ' + el.overSub.textContent, true);
    feel(won ? 'win' : 'reject');
    snd(won ? 'bigwin' : 'lose');
    renderActions();
    // אם כבר נלחץ "טורניר חדש" לפני שהחלון הספיק לקפוץ — לא מסתירים אותו
    if (!window.Modal.top()) openModal(el.overModal);
  }

  /* --------------------------------------------------------------------- */
  /* טורניר חדש                                                             */
  /* --------------------------------------------------------------------- */

  function newGame(opts) {
    stop();
    clearFx();
    const n = Math.max(1, Math.min(5, Number(opts.opponents) || 3));
    const pool = NAMES.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const list = [{ name: 'את/ה', human: true }].concat(pool.slice(0, n).map((name) => ({ name })));
    state.game = P.newGame(list);
    state.level = Number(opts.level) || 2;
    state.peak = 1000;
    state.recorded = false;
    state.overShown = false;
    state.view = null;
    state.raiseTo = 0;
    P.startHand(state.game);
    feel('draw');
    saveGame();
    loop();
  }

  const pick = { opponents: '3', level: '2' };

  function syncNewModal() {
    el.newModal.querySelectorAll('.opt-seg').forEach((seg) => {
      const opt = seg.dataset.opt;
      seg.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', b.dataset.val === pick[opt] ? 'true' : 'false');
      });
    });
    el.levelDesc.textContent = LEVEL_DESC[pick.level];
  }

  function openNew() {
    pick.opponents = String(state.prefs.opponents);
    pick.level = String(state.prefs.level);
    syncNewModal();
    openModal(el.newModal);
  }

  el.newModal.addEventListener('click', (e) => {
    const b = e.target.closest('.opt-seg button');
    if (!b) return;
    pick[b.closest('.opt-seg').dataset.opt] = b.dataset.val;
    syncNewModal();
  });

  el.btnStart.addEventListener('click', () => {
    closeModal(el.newModal);
    state.prefs.opponents = pick.opponents;
    state.prefs.level = pick.level;
    savePrefs();
    newGame(pick);
  });

  el.btnNew.addEventListener('click', () => {
    const g = state.game;
    if (g && !g.over && (g.hand > 1 || (g.h && g.h.history.length > 0))) {
      askConfirm('להתחיל טורניר חדש? הטורניר הנוכחי יימחק.', openNew);
      return;
    }
    openNew();
  });
  el.btnOverNew.addEventListener('click', () => { closeModal(el.overModal); openNew(); });

  /* --------------------------------------------------------------------- */
  /* חלונות והגדרות                                                         */
  /* --------------------------------------------------------------------- */

  el.btnTheme.addEventListener('click', () => {
    const order = { auto: 'light', light: 'dark', dark: 'auto' };
    state.prefs.theme = order[state.prefs.theme] || 'light';
    savePrefs();
    applyTheme();
  });

  el.btnHelp.addEventListener('click', () => openModal(el.helpModal));

  function renderStats() {
    const s = stats();
    el.statsTable.innerHTML = [1, 2, 3, 4].map((lv) => {
      const r = s[lv] || {};
      const meta = (r.played || 0) + ' טורנירים · ' + (r.hands || 0) + ' ידיים שנלקחו' +
        (r.best ? ' · מקום הכי טוב ' + r.best : '');
      return '<div class="stats-row"><span class="name">' + LEVEL_NAMES[lv] +
        '<br><span class="meta">' + meta + '</span></span><span></span>' +
        '<span class="best">' + (r.won || 0) + ' נצ׳</span></div>';
    }).join('');
  }

  el.btnStats.addEventListener('click', () => {
    renderStats();
    openModal(el.statsModal);
  });

  el.btnClearStats.addEventListener('click', () => {
    askConfirm('לאפס את כל הסטטיסטיקות? אי אפשר לשחזר.', () => {
      store.remove(STATS_KEY);
      renderStats();
      toast('הנתונים אופסו');
    });
  });

  function syncSettings() {
    el.settingsModal.querySelectorAll('[data-pref]').forEach((i) => {
      i.checked = !!state.prefs[i.dataset.pref];
    });
    el.settingsModal.querySelectorAll('[data-pref-seg]').forEach((seg) => {
      const key = seg.dataset.prefSeg;
      seg.querySelectorAll('button').forEach((b) => {
        b.setAttribute('aria-pressed', b.dataset.val === state.prefs[key] ? 'true' : 'false');
      });
    });
  }

  el.btnSettings.addEventListener('click', () => {
    syncSettings();
    const mode = H ? H.supported() : 'none';
    el.hapticsNote.textContent =
      mode === 'vibrate' ? 'משוב מישושי על פעולה, חלוקה וזכייה'
      : mode === 'ios-switch'
        ? 'באייפון הרטט מוגבל לנקישה אחידה, ובגרסאות iOS חדשות הוא עשוי לא לעבוד'
        : 'הדפדפן הזה אינו מאפשר רטט לדף. המשוב החזותי פועל כרגיל';
    const sw = document.getElementById('optHaptics');
    if (sw) sw.disabled = mode === 'none';
    const so = document.getElementById('optSound');
    if (so) so.disabled = !(SND && SND.supported());
    openModal(el.settingsModal);
  });

  el.settingsModal.addEventListener('change', (e) => {
    const input = e.target.closest && e.target.closest('[data-pref]');
    if (!input) return;
    const key = input.dataset.pref;
    state.prefs[key] = input.checked;
    savePrefs();
    if (key === 'haptics' && H) H.setEnabled(input.checked);
    if (key === 'sound' && SND) { SND.setEnabled(input.checked); if (input.checked) SND.play('chip'); }
    state.strengthKey = '';
    if (state.game) renderStatic();
  });

  el.settingsModal.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pref-seg] button');
    if (!b) return;
    state.prefs[b.closest('[data-pref-seg]').dataset.prefSeg] = b.dataset.val;
    savePrefs();
    syncSettings();
  });

  el.btnConfirmOk.addEventListener('click', () => {
    closeModal(el.confirmModal);
    const fn = confirmAction;
    confirmAction = null;
    if (fn) fn();
  });

  document.querySelectorAll('[data-close-modal]').forEach((b) => {
    b.addEventListener('click', () => closeModal(b.closest('.modal')));
  });
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(m); });
  });

  /* מקלדת: F/C/R, חיצים לסכום, Esc סוגר את הגיליון, Enter ליד הבאה */
  document.addEventListener('keydown', (e) => {
    if (window.Modal && window.Modal.top()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    const k = e.key.toLowerCase();
    if (k === 'escape' && state.sheet) { e.preventDefault(); closeSheet(); el.btnRaise.focus({ preventScroll: true }); return; }
    if (k === 'enter' && !el.nextRow.hidden && tag !== 'button') { e.preventDefault(); el.btnNext.click(); return; }
    if (tag === 'input' && (k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown')) return;
    if (k === 'f' || k === 'כ') humanAct('fold');
    else if (k === 'c' || k === 'ב') humanAct('call');
    else if (k === 'r' || k === 'ר') {
      if (state.sheet) humanAct('raise');
      else openSheet();
    } else if ((k === 'arrowup' || k === 'arrowdown') && state.sheet) {
      e.preventDefault();
      stepRaise(k === 'arrowup' ? 1 : -1);
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.game) { layout(); } }, 120);
  });

  window.addEventListener('pagehide', saveGame);

  /* --------------------------------------------------------------------- */
  /* אתחול                                                                  */
  /* --------------------------------------------------------------------- */

  function init() {
    applyTheme();
    if (H) H.setEnabled(!!state.prefs.haptics);
    if (SND) SND.setEnabled(!!state.prefs.sound);
    if (PC.ensureSprite) PC.ensureSprite();

    const saved = store.read(SAVE_KEY, null);
    if (saved && saved.game && Array.isArray(saved.game.players) && !saved.over) {
      state.game = saved.game;
      state.level = saved.level || 2;
      state.peak = saved.peak || 1000;
      state.recorded = false;
      const h = state.game.h;
      if (h && h.result) h.result.counted = true;
      if (!h) P.startHand(state.game);
      // אחרי טעינה הכול מצויר במצבו, בלי הנפשת חלוקה
      render(true);
      loop();
      return;
    }
    newGame({ opponents: state.prefs.opponents, level: state.prefs.level });
    if (!store.ok) setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
  }

  init();
})();
