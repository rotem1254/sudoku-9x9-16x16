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
 * ההשהיה לפני תור היריב מכוונת: בלי עיכוב, שלושה יריבים פועלים באותו
 * פריים והשחקן רואה רק את התוצאה, בלי להבין מי העלה ומי ויתר.
 * =========================================================================== */
(function () {
  'use strict';

  const P = window.Poker;
  const AI = window.PokerAI;
  const PC = window.PlayingCards;
  const H = window.Haptics;

  const $ = (s) => document.querySelector(s);

  const PREFS_KEY = 'poker.v1.prefs';
  const SAVE_KEY = 'poker.v1.save';
  const STATS_KEY = 'poker.v1.stats';

  const NAMES = ['דנה', 'יוסי', 'מיכל', 'אבי', 'רון', 'נועה', 'עומר', 'שירה'];
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
    slow: { ai: 1150, street: 1000 },
    normal: { ai: 750, street: 750 },
    fast: { ai: 320, street: 420 },
  };

  /*
   * מיקום היריבים סביב השולחן, לפי מספרם. (x, y) באחוזים מרוחב וגובה
   * הלבד. הסדר הוא כיוון השעון מנקודת המבט שלך: הראשון משמאלך למטה,
   * והאחרון מימינך — כמו שהתור עובר בשולחן אמיתי
   */
  const LAYOUT = {
    1: [[50, 3]],
    2: [[27, 4], [73, 4]],
    3: [[14, 30], [50, 3], [86, 30]],
    4: [[13, 33], [33, 3], [67, 3], [87, 33]],
    5: [[12, 35], [27, 3], [50, 3], [73, 3], [88, 35]],
  };

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
    /** קלפים שכבר צוירו ביד הזו — רק חדשים מקבלים הנפשת חלוקה */
    shown: new Set(),
    raiseTo: 0,
    paidAnim: 0,
  };

  const el = {
    table: $('#table'),
    seats: $('#seats'),
    pot: $('#pot'),
    potAmount: $('#potAmount'),
    board: $('#board'),
    tableMsg: $('#tableMsg'),
    myBet: $('#myBet'),
    me: $('#me'),
    myCards: $('#myCards'),
    myPlate: $('#myPlate'),
    myDealer: $('#myDealer'),
    myStack: $('#myStack'),
    myHand: $('#myHand'),
    infoHand: $('#infoHand'),
    infoBlinds: $('#infoBlinds'),
    infoLevel: $('#infoLevel'),
    raiseRow: $('#raiseRow'),
    presets: $('#presets'),
    range: $('#raiseRange'),
    buttons: $('#buttons'),
    btnFold: $('#btnFold'),
    btnCall: $('#btnCall'),
    btnRaise: $('#btnRaise'),
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

  const savePrefs = () => store.write(PREFS_KEY, state.prefs);
  const stats = () => store.read(STATS_KEY, {});
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');

  function delay(kind) {
    const d = (SPEED[state.prefs.speed] || SPEED.normal)[kind];
    return reducedMotion ? Math.round(d * 0.6) : d;
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

  /** ערך ז'יטון לצבע: הגדול ביותר שלא עולה על הסכום */
  function chipClass(n) {
    const d = [1000, 500, 100, 50, 25, 10, 5].find((v) => n >= v) || 5;
    return 'chip chip-' + d;
  }

  function betPill(amount) {
    const b = document.createElement('span');
    b.className = 'pk-chip';
    const c = document.createElement('span');
    c.className = chipClass(amount);
    c.setAttribute('aria-hidden', 'true');
    b.appendChild(c);
    b.appendChild(document.createTextNode(fmt(amount)));
    return b;
  }

  const cardKey = (c) => c.rank + c.suit;

  /** קלף עם הנפשת חלוקה רק בפעם הראשונה שהוא מופיע ביד */
  function cardEl(card, size, delayMs) {
    const key = card ? 'f' + cardKey(card) : null;
    const isNew = key && !state.shown.has(key);
    if (key) state.shown.add(key);
    return PC.el(card, { size, deal: isNew && !reducedMotion, delay: delayMs || 0 });
  }

  /* --------------------------------------------------------------------- */
  /* ציור                                                                   */
  /* --------------------------------------------------------------------- */

  function render() {
    const g = state.game;
    if (!g) return;
    const h = g.h;
    const n = g.players.length - 1;
    el.table.dataset.n = String(n);

    const [sb, bb] = P.blindsFor(g, Math.max(1, g.hand));
    el.infoHand.textContent = 'יד ' + Math.max(1, g.hand);
    const toUp = g.handsPerLevel - ((Math.max(1, g.hand) - 1) % g.handsPerLevel);
    el.infoBlinds.textContent = 'בליינדים ' + sb + '/' + bb + (g.over ? '' : ' · עולים בעוד ' + toUp);
    el.infoLevel.textContent = LEVEL_NAMES[state.level];

    renderSeats();
    renderCenter();
    renderMe();
    renderActions();

    const left = g.players.filter((p) => !p.out).length;
    el.footerInfo.textContent = left + ' שחקנים בשולחן · רמה ' + LEVEL_NAMES[state.level];
  }

  function seatState(i) {
    const g = state.game;
    const h = g.h;
    const p = g.players[i];
    const s = h ? h.seats[i] : null;
    return { p, s, h };
  }

  function renderSeats() {
    const g = state.game;
    const h = g.h;
    const n = g.players.length - 1;
    const pos = LAYOUT[n] || LAYOUT[3];
    const done = h && h.street === 'done';
    const res = done ? h.result : null;
    const wide = el.table.clientWidth > 520;
    const frag = document.createDocumentFragment();

    for (let i = 1; i <= n; i++) {
      const { p, s } = seatState(i);
      const [x, y] = pos[i - 1];
      const seat = document.createElement('div');
      seat.className = 'pk-seat';
      seat.dataset.seat = String(i);
      seat.style.left = x + '%';
      seat.style.top = y + '%';
      if (x < 35) seat.classList.add('is-left');
      else if (x > 65) seat.classList.add('is-right');

      const turn = h && h.toAct === i;
      if (turn) seat.classList.add('is-turn');
      if (p.out) seat.classList.add('is-out');
      if (s && s.folded) seat.classList.add('is-folded');
      if (res && res.won[i]) seat.classList.add('is-winner');

      // קלפים: גב בזמן היד, פנים בעימות
      const cards = document.createElement('div');
      cards.className = 'pk-seat-cards';
      if (s && !s.folded && s.hole.length) {
        const reveal = res && res.showdown;
        s.hole.forEach((c, k) => {
          const ce = reveal ? cardEl(c, wide ? 40 : 32)
            : PC.el(null, { size: wide ? 30 : 24, deal: !state.shown.has('b' + i + k) && !reducedMotion, delay: (i * 2 + k) * 50 });
          state.shown.add('b' + i + k);
          if (reveal) {
            const best = res.hands[i] && res.hands[i].cards;
            const win = res.won[i] && best && best.some((b) => cardKey(b) === cardKey(c));
            if (win) ce.classList.add('is-glow');
          }
          cards.appendChild(ce);
        });
      }
      seat.appendChild(cards);

      const plate = document.createElement('div');
      plate.className = 'pk-plate';
      const name = document.createElement('span');
      name.className = 'pk-name';
      name.textContent = p.name;
      if (g.button === i && !p.out) {
        const d = document.createElement('span');
        d.className = 'pk-dealer';
        d.textContent = 'D';
        d.title = 'כפתור הדילר';
        name.appendChild(d);
      }
      const stack = document.createElement('span');
      stack.className = 'pk-stack';
      stack.textContent = p.out ? 'בחוץ' : fmt(p.stack);
      plate.appendChild(name);
      plate.appendChild(stack);
      seat.appendChild(plate);

      // תווית הפעולה האחרונה, או "חושב…" בתורו, או שם היד בעימות
      let label = '';
      let cls = '';
      // בעימות התווית יורדת מתחת ללוחית, כדי לא להסתיר את הקלפים הפתוחים
      if (res && res.showdown && res.hands[i]) { label = res.hands[i].name; cls = 'is-below' + (res.won[i] ? ' is-win' : ''); }
      else if (turn) { label = 'חושב'; cls = 'is-thinking'; }
      else if (s && s.last) { label = ACTION_LABEL[s.last] || ''; cls = 'is-' + s.last; }
      if (label) {
        const tag = document.createElement('span');
        tag.className = 'pk-tag ' + cls;
        tag.textContent = label;
        seat.appendChild(tag);
      }

      if (s && s.bet > 0) {
        const b = betPill(s.bet);
        b.classList.add('pk-seat-bet');
        seat.appendChild(b);
      }

      // שם נגיש אחד לכל המושב
      let aria = p.name + ', ' + (p.out ? 'בחוץ' : fmt(p.stack) + ' ז\'יטונים');
      if (s && s.bet) aria += ', הימר ' + fmt(s.bet);
      if (label) aria += ', ' + label;
      seat.setAttribute('role', 'group');
      seat.setAttribute('aria-label', aria);

      frag.appendChild(seat);
    }
    el.seats.replaceChildren(frag);
  }

  function renderCenter() {
    const g = state.game;
    const h = g.h;
    el.board.replaceChildren();
    const size = boardCardSize();
    const res = h && h.street === 'done' ? h.result : null;

    // קלפי השולחן; בעימות — מדגישים את אלה שבחמישייה המנצחת
    let winCards = null;
    if (res && res.showdown) {
      const w = Object.keys(res.won).map(Number)[0];
      if (w !== undefined && res.hands[w]) winCards = new Set(res.hands[w].cards.map(cardKey));
    }
    for (let k = 0; k < 5; k++) {
      const c = h && h.board[k];
      if (c) {
        const ce = cardEl(c, size, (k % 3) * 90);
        if (winCards) ce.classList.add(winCards.has(cardKey(c)) ? 'is-glow' : 'is-dim');
        el.board.appendChild(ce);
      } else {
        const slot = document.createElement('div');
        slot.className = 'pc-slot';
        slot.style.setProperty('--card-w', size + 'px');
        slot.setAttribute('aria-hidden', 'true');
        el.board.appendChild(slot);
      }
    }
    el.board.setAttribute('aria-label', h && h.board.length
      ? 'קלפי השולחן: ' + h.board.map(PC.name).join(', ')
      : 'קלפי השולחן: עוד לא נפתחו');

    // בקופה: מה שכבר נאסף, בלי ההימורים שעוד מונחים מול השחקנים
    let pot = 0;
    if (h && h.street !== 'done') pot = P.potTotal(h) - h.seats.reduce((a, s) => a + (s ? s.bet : 0), 0);
    if (res) pot = res.pots.reduce((a, p) => a + p.amount, 0);
    el.potAmount.textContent = fmt(pot);
    el.pot.classList.toggle('is-empty', pot === 0);

    el.tableMsg.textContent = tableMessage();

    const mine = h && h.seats[0];
    el.myBet.replaceChildren();
    if (mine && mine.bet > 0) el.myBet.appendChild(betPill(mine.bet));
  }

  function tableMessage() {
    const g = state.game;
    const h = g.h;
    /*
     * רק תוצאת היד. "תורך" כבר נאמר בלוחית המודגשת ובכפתור "קול 20",
     * ושורה נוספת כאן התנגשה בז'יטון ההימור שלך שמתחתיה
     */
    if (!h || h.street !== 'done') return '';
    return resultText(h.result);
  }

  /** "דנה זוכה ב-480 עם זוג מלכים" */
  function resultText(res) {
    if (!res) return '';
    const g = state.game;
    const winners = Object.keys(res.won).map(Number);
    if (!winners.length) {
      // הכול חזר — כולם ויתרו על הבליינדים של עצמם
      const p = res.pots[0];
      return p ? nameOf(p.winners[0]) + ' לוקח/ת את הקופה' : '';
    }
    const parts = winners.map((w) => {
      const hand = res.showdown && res.hands[w] ? ' עם ' + res.hands[w].desc : '';
      return (w === 0 ? 'זכית' : nameOf(w) + ' זוכה') + ' ב-' + fmt(res.won[w]) + hand;
    });
    return parts.join(' · ');
    function nameOf(i) { return i === 0 ? 'את/ה' : g.players[i].name; }
  }

  function boardCardSize() {
    const w = el.table.clientWidth || 340;
    return Math.max(38, Math.min(60, Math.floor((w - 60) / 5.6)));
  }

  function renderMe() {
    const g = state.game;
    const h = g.h;
    const p = me();
    const s = h && h.seats[0];
    const res = h && h.street === 'done' ? h.result : null;
    el.myCards.replaceChildren();
    const size = Math.max(54, Math.min(74, Math.floor((el.table.clientWidth || 340) / 5.2)));
    if (s && s.hole.length) {
      s.hole.forEach((c, k) => {
        const ce = cardEl(c, size, k * 110);
        if (s.folded) ce.classList.add('is-dim');
        if (res && res.won[0] && res.showdown && res.hands[0].cards.some((b) => cardKey(b) === cardKey(c))) ce.classList.add('is-glow');
        el.myCards.appendChild(ce);
      });
    } else {
      for (let k = 0; k < 2; k++) {
        const slot = document.createElement('div');
        slot.className = 'pc-slot';
        slot.style.setProperty('--card-w', size + 'px');
        el.myCards.appendChild(slot);
      }
    }
    el.myStack.textContent = p.out ? 'בחוץ' : fmt(p.stack);
    el.myDealer.hidden = g.button !== 0 || p.out;
    el.myPlate.classList.toggle('is-turn', !!h && h.toAct === 0);
    el.myPlate.classList.toggle('is-winner', !!res && !!res.won[0]);

    // שם היד שלך — רק אם ההגדרה פעילה
    let hand = '';
    if (state.prefs.showHand && s && s.hole.length && !s.folded) {
      const cards = s.hole.concat(h.board);
      if (h.board.length) hand = P.evaluate(cards).desc;
      else {
        const [a, b] = s.hole;
        hand = a.rank === b.rank ? 'זוג ' + PC.label(a.rank)
          : PC.label(Math.max(a.rank, b.rank)) + '-' + PC.label(Math.min(a.rank, b.rank)) + (a.suit === b.suit ? ' באותה צורה' : '');
      }
    } else if (s && s.folded) hand = 'ויתרת ביד הזו';
    el.myHand.textContent = hand ? (s && s.folded ? hand : 'יש לך: ' + hand) : '';
  }

  /* --------------------------------------------------------------------- */
  /* סרגל הפעולות                                                           */
  /* --------------------------------------------------------------------- */

  function presetTo(L, kind) {
    const base = L.currentBet;
    const pot = L.pot + L.toCall;
    let to = kind === 'min' ? L.minTo
      : kind === 'half' ? base + Math.round(pot / 2)
        : kind === 'pot' ? base + pot
          : L.maxTo;
    to = Math.round(to / 5) * 5;
    return Math.max(L.minTo, Math.min(L.maxTo, to));
  }

  function renderActions() {
    const g = state.game;
    const h = g.h;
    const done = !h || h.street === 'done';
    // בסוף יד — "יד הבאה"; בסוף הטורניר אותו כפתור פותח טורניר חדש
    el.nextRow.hidden = !done && !g.over;
    el.buttons.hidden = done || g.over;
    el.raiseRow.hidden = done || g.over;
    el.btnNext.textContent = g.over ? 'טורניר חדש' : 'יד הבאה';

    const mine = h && h.toAct === 0 && !g.over;
    const L = mine ? P.legal(g) : null;

    el.btnFold.disabled = !L || L.canCheck;
    el.btnCall.disabled = !L;
    el.btnRaise.disabled = !L || !L.canRaise;
    el.raiseRow.classList.toggle('is-off', !L || !L.canRaise);
    el.range.disabled = !L || !L.canRaise || L.minTo >= L.maxTo;
    el.presets.querySelectorAll('button').forEach((b) => { b.disabled = !L || !L.canRaise; });

    if (!L) {
      el.btnCall.textContent = 'צ\'ק';
      el.btnRaise.textContent = 'העלאה';
      return;
    }

    el.btnCall.textContent = L.canCheck ? 'צ\'ק'
      : L.toCall >= L.stack ? 'הכל-אין ' + fmt(L.toCall) : 'קול ' + fmt(L.toCall);

    if (L.canRaise) {
      el.range.min = String(L.minTo);
      el.range.max = String(L.maxTo);
      el.range.step = '5';
      if (!(state.raiseTo >= L.minTo && state.raiseTo <= L.maxTo)) state.raiseTo = L.minTo;
      el.range.value = String(state.raiseTo);
      updateRaiseLabel(L);
    }
  }

  function updateRaiseLabel(L) {
    const to = state.raiseTo;
    el.btnRaise.textContent = to >= L.maxTo ? 'הכל-אין ' + fmt(L.maxTo)
      : (L.currentBet === 0 ? 'הימור ' : 'העלאה ל-') + fmt(to);
    el.range.setAttribute('aria-valuetext', fmt(to));
    el.presets.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', presetTo(L, b.dataset.pre) === to ? 'true' : 'false');
    });
  }

  function humanAct(type) {
    const g = state.game;
    const L = g && P.legal(g);
    if (!L || L.seat !== 0 || g.over) return;
    let a = { type };
    if (type === 'call' && L.canCheck) a = { type: 'check' };
    if (type === 'fold' && L.canCheck) return;
    if (type === 'raise') {
      if (!L.canRaise) return;
      a = { type: 'raise', to: Math.max(L.minTo, Math.min(L.maxTo, state.raiseTo || L.minTo)) };
    }
    if (!P.act(g, a)) { feel('reject'); return; }
    feel('move');
    state.raiseTo = 0;
    const s = g.h.seats[0];
    say(ACTION_LABEL[s.last] + (s.bet ? ' ' + s.bet : ''));
    saveGame();
    loop();
  }

  el.btnFold.addEventListener('click', () => humanAct('fold'));
  el.btnCall.addEventListener('click', () => humanAct('call'));
  el.btnRaise.addEventListener('click', () => humanAct('raise'));

  el.range.addEventListener('input', () => {
    const L = P.legal(state.game);
    if (!L) return;
    let v = Number(el.range.value);
    // הקצה העליון של הסרגל תמיד הכל-אין, גם אם אינו כפולה של 5
    if (v > L.maxTo - 5) v = L.maxTo;
    state.raiseTo = Math.max(L.minTo, Math.min(L.maxTo, v));
    updateRaiseLabel(L);
  });

  el.presets.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pre]');
    const L = P.legal(state.game);
    if (!b || !L || !L.canRaise) return;
    state.raiseTo = presetTo(L, b.dataset.pre);
    el.range.value = String(state.raiseTo);
    updateRaiseLabel(L);
    feel('pick');
  });

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
      }, delay('street'));
      return;
    }

    if (h.toAct === 0) {
      const L = P.legal(g);
      say('תורך. ' + (L.toCall ? 'להשוות ' + L.toCall : 'אפשר לבדוק'));
      return;
    }

    // יריב: ההחלטה עצמה אחרי ההשהיה, כדי שהציור של "חושב" יופיע קודם
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
    }, delay('ai'));
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
      animatePot(res);
    }
    saveGame();
    if (g.over) setTimeout(gameOver, reducedMotion ? 300 : 1300);
    else setTimeout(() => { if (!el.nextRow.hidden && !window.Modal.top()) el.btnNext.focus({ preventScroll: true }); }, 50);
  }

  /** ז'יטונים עפים מהקופה אל הזוכים */
  function animatePot(res) {
    if (reducedMotion) return;
    const from = el.pot.getBoundingClientRect();
    Object.keys(res.won).map(Number).forEach((w, k) => {
      const target = w === 0 ? el.myPlate : el.seats.querySelector('[data-seat="' + w + '"] .pk-plate');
      if (!target) return;
      const to = target.getBoundingClientRect();
      for (let c = 0; c < 4; c++) {
        const chip = document.createElement('span');
        chip.className = chipClass(res.won[w]) + ' pk-fly';
        chip.style.left = (from.left + from.width / 2 - 9) + 'px';
        chip.style.top = (from.top + from.height / 2 - 9) + 'px';
        document.body.appendChild(chip);
        const dx = to.left + to.width / 2 - (from.left + from.width / 2);
        const dy = to.top + to.height / 2 - (from.top + from.height / 2);
        setTimeout(() => {
          chip.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
          chip.style.opacity = '0';
        }, 30 + c * 70 + k * 120);
        setTimeout(() => chip.remove(), 900 + c * 70 + k * 120);
      }
    });
  }

  function nextHand() {
    const g = state.game;
    if (!g || g.over || (g.h && g.h.street !== 'done')) return;
    state.shown.clear();
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
    render();
    // אם כבר נלחץ "טורניר חדש" לפני שהחלון הספיק לקפוץ — לא מסתירים אותו
    if (!window.Modal.top()) openModal(el.overModal);
  }

  /* --------------------------------------------------------------------- */
  /* טורניר חדש                                                             */
  /* --------------------------------------------------------------------- */

  function newGame(opts) {
    stop();
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
    state.shown.clear();
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
    openModal(el.settingsModal);
  });

  el.settingsModal.addEventListener('change', (e) => {
    const input = e.target.closest && e.target.closest('[data-pref]');
    if (!input) return;
    const key = input.dataset.pref;
    state.prefs[key] = input.checked;
    savePrefs();
    if (key === 'haptics' && H) H.setEnabled(input.checked);
    render();
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

  /* מקלדת: F/C/R, חיצים לסכום, Enter ליד הבאה */
  document.addEventListener('keydown', (e) => {
    if (window.Modal && window.Modal.top()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    const k = e.key.toLowerCase();
    if (k === 'enter' && !el.nextRow.hidden && tag !== 'button') { e.preventDefault(); el.btnNext.click(); return; }
    if (tag === 'input' && (k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown')) return;
    if (k === 'f' || k === 'כ') humanAct('fold');
    else if (k === 'c' || k === 'ב') humanAct('call');
    else if (k === 'r' || k === 'ר') humanAct('raise');
    else if (k === 'arrowup' || k === 'arrowdown') {
      const L = state.game && P.legal(state.game);
      if (!L || L.seat !== 0 || !L.canRaise) return;
      e.preventDefault();
      const step = state.game.h.bb;
      const cur = state.raiseTo || L.minTo;
      state.raiseTo = Math.max(L.minTo, Math.min(L.maxTo, cur + (k === 'arrowup' ? step : -step)));
      el.range.value = String(state.raiseTo);
      updateRaiseLabel(L);
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 120);
  });

  window.addEventListener('pagehide', saveGame);

  /* --------------------------------------------------------------------- */
  /* אתחול                                                                  */
  /* --------------------------------------------------------------------- */

  function init() {
    applyTheme();
    if (H) H.setEnabled(!!state.prefs.haptics);

    const saved = store.read(SAVE_KEY, null);
    if (saved && saved.game && Array.isArray(saved.game.players) && !saved.over) {
      state.game = saved.game;
      state.level = saved.level || 2;
      state.peak = saved.peak || 1000;
      state.recorded = false;
      // אחרי טעינה אין הנפשת חלוקה לקלפים שכבר היו על השולחן
      const h = state.game.h;
      if (h) {
        h.board.forEach((c) => state.shown.add('f' + cardKey(c)));
        h.seats.forEach((s, i) => {
          if (!s) return;
          s.hole.forEach((c, k) => { state.shown.add('f' + cardKey(c)); state.shown.add('b' + i + k); });
        });
        if (h.result) h.result.counted = true;
      }
      if (!h) P.startHand(state.game);
      loop();
      return;
    }
    newGame({ opponents: state.prefs.opponents, level: state.prefs.level });
    if (!store.ok) setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
  }

  init();
})();
