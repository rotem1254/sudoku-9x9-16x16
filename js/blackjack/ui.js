/* =============================================================================
 * blackjack/ui.js — ממשק הבלאקג'ק
 * -----------------------------------------------------------------------------
 * המנוע (engine.js) מחזיק את כל המצב ומחשב הכול מיד: deal() כבר יודע מה
 * הדילר יקבל, ו-act('stand') כבר שילם. הממשק הוא זה שמותח את זה בזמן,
 * כמו דילר אמיתי:
 *
 *   1. כל קלף חדש עף מהחפיסה (shoe) למקומו, בסדר השליפה האמיתי — לכל
 *      קלף יש id לפי סדר השליפה, וקלף שעוד לא נראה מקבל את המעוף
 *   2. הקלף הסגור של הדילר נחלק הפוך, ובתורו מתהפך (הרמה, סיבוב, נחיתה)
 *      לפני שהדילר מושך — הרגע שהמתח נבנה אליו
 *   3. רק כשהכול נחת: סכומים, תוצאה לכל יד, וז'יטונים שזזים — רווח עף
 *      ממגש הבית אל היד ומשם לקופה, והפסד נאסף למגש
 *
 * בזמן ההנפשה (busy) הכפתורים נעולים, כדי שלחיצה מהירה לא תפעל על מצב
 * שהשחקן עוד לא ראה. ב"פחות תנועה" הכול מיידי, ושום מידע לא עובר רק דרך
 * הנפשה — הסכומים, התוצאות וההודעה תמיד נכתבים.
 * =========================================================================== */
(function () {
  'use strict';

  const BJ = window.Blackjack;
  const PC = window.PlayingCards;
  const FX = window.TableFX;
  const SND = window.Sound;
  const H = window.Haptics;

  const $ = (s) => document.querySelector(s);

  const PREFS_KEY = 'blackjack.v1.prefs';
  const SAVE_KEY = 'blackjack.v1.save';
  const STATS_KEY = 'blackjack.v1.stats';

  const CHIPS = [10, 50, 100, 500, 1000];
  const ACT_NAMES = { hit: 'קלף', stand: 'עומד', double: 'הכפלה', split: 'פיצול', surrender: 'כניעה' };
  const RESULT = {
    win: ['ניצחון', 'is-win'],
    blackjack: ["בלאקג'ק", 'is-bj'],
    push: ['תיקו', 'is-push'],
    lose: ['הפסד', 'is-lose'],
    bust: ['נשרף', 'is-lose'],
    surrender: ['כניעה', 'is-push'],
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

  const DEFAULT_PREFS = { theme: 'auto', haptics: true, sound: true, fast: false, level: 1 };

  const state = {
    prefs: Object.assign({}, DEFAULT_PREFS, store.read(PREFS_KEY, {})),
    table: null,
    /** הז'יטונים שהונחו בשלב ההימור, לפי הסדר — כדי שאפשר יהיה להוריד את האחרון */
    pending: [],
    lastBet: 0,
    rounds: 0,
    /** ids של קלפים שכבר צוירו */
    seen: new Set(),
    /** האם הקלף הסגור של הדילר כבר מוצג פתוח */
    holeOpen: false,
    busy: false,
    timers: [],
    /** הקופה שמוצגת — מתעדכנת רק כשהז'יטונים מגיעים אליה */
    shownBank: 0,
    /** מה שכתוב כרגע בקופה, כדי שהמונה יטפס ממנו */
    paintedBank: null,
    /** הפעולה שהרמז סימן, עד המהלך הבא */
    hinted: null,
    /** האם הסיבוב האחרון כבר נספר בסטטיסטיקה */
    recorded: false,
  };

  const el = {
    table: $('#table'),
    shoe: $('#shoe'),
    tray: $('#tray'),
    discard: $('#discard'),
    dealerCards: $('#dealerCards'),
    dealerTotal: $('#dealerTotal'),
    hands: $('#hands'),
    banner: $('#banner'),
    confetti: $('#confetti'),
    rulesMain: $('#rulesMain'),
    rulesSub: $('#rulesSub'),
    betSpot: $('#betSpot'),
    betStack: $('#betStack'),
    betAmount: $('#betAmount'),
    advice: $('#advice'),
    statBank: $('#statBank'),
    bankItem: $('.bj-hud-bank'),
    statBet: $('#statBet'),
    statLevel: $('#statLevel'),
    btnLevel: $('#btnLevel'),
    betControls: $('#betControls'),
    chipRack: $('#chipRack'),
    btnClear: $('#btnClear'),
    btnRebet: $('#btnRebet'),
    btnDeal: $('#btnDeal'),
    insControls: $('#insControls'),
    btnInsYes: $('#btnInsYes'),
    btnInsNo: $('#btnInsNo'),
    playControls: $('#playControls'),
    actSub: $('.bj-actions-sub'),
    actButtons: Array.from(document.querySelectorAll('.bj-act[data-act]')),
    btnHint: $('#btnHint'),
    doneControls: $('#doneControls'),
    btnChangeBet: $('#btnChangeBet'),
    btnAgain: $('#btnAgain'),
    againAmount: $('#againAmount'),
    footerInfo: $('#footerInfo'),
    toast: $('#toast'),
    levelModal: $('#levelModal'),
    levelSeg: $('#levelSeg'),
    levelDesc: $('#levelDesc'),
    btnLevelOk: $('#btnLevelOk'),
    brokeModal: $('#brokeModal'),
    brokeSub: $('#brokeSub'),
    btnBrokeLevel: $('#btnBrokeLevel'),
    btnRebuy: $('#btnRebuy'),
    settingsModal: $('#settingsModal'),
    btnSettings: $('#btnSettings'),
    hapticsNote: $('#hapticsNote'),
    soundNote: $('#soundNote'),
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

  function feel(name) { if (state.prefs.haptics && H) H.fire(name); }
  function sound(name) { if (SND) SND.play(name); }

  const savePrefs = () => store.write(PREFS_KEY, state.prefs);
  const stats = () => store.read(STATS_KEY, {});

  /*
   * מספר עם פסיקים, וסימן מינוס אמיתי ולא מקף. מספר עם סימן עטוף בבידוד
   * LTR (U+2066…U+2069): בתוך משפט עברי ה-+ וה-− הם תווים ניטרליים,
   * ובלי הבידוד "+160" מוצג כ-"160+"
   */
  const fmt = (n) => (n < 0 ? '⁦−' + Math.abs(n).toLocaleString('en-US') + '⁩'
    : n.toLocaleString('en-US'));
  const signed = (n) => (n > 0 ? '⁦+' + fmt(n) + '⁩' : fmt(n));
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  /** קצב ההנפשות: רגיל, מהיר, או כמעט מיידי כשמבקשים פחות תנועה */
  function pace() {
    if (reducedMotion) return { card: 30, fly: 0, flip: 40, dealer: 60, settle: 60, pay: 0 };
    return state.prefs.fast
      ? { card: 150, fly: 300, flip: 380, dealer: 330, settle: 200, pay: 380 }
      : { card: 260, fly: 430, flip: 560, dealer: 560, settle: 320, pay: 520 };
  }

  function later(fn, ms) {
    state.timers.push(setTimeout(fn, ms));
  }
  function clearTimers() {
    state.timers.forEach(clearTimeout);
    state.timers = [];
    state.busy = false;
  }

  function saveGame() {
    if (!state.table) return;
    store.write(SAVE_KEY, {
      table: state.table.toJSON(),
      pending: state.pending,
      lastBet: state.lastBet,
      rounds: state.rounds,
    });
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

  /** פירוק סכום לז'יטונים של המשחק, מהקטן לגדול — לערימה בעיגול ההימור */
  function toChips(amount) {
    return FX.breakdown(amount, CHIPS.slice().reverse()).reverse();
  }

  /** סכום היד לתצוגה: "7/17" ליד רכה שעוד משחקים בה */
  function totalText(cards, open) {
    const v = BJ.handValue(cards);
    if (v.soft && v.total < 21 && open) return (v.total - 10) + '/' + v.total;
    return String(v.total);
  }

  function totalClass(cards, natural) {
    const v = BJ.handValue(cards);
    if (natural) return 'bj-total is-bj';
    if (v.total > 21) return 'bj-total is-bust';
    if (v.total === 21) return 'bj-total is-21';
    return 'bj-total';
  }

  /** הקופה בראש המסך — מטפסת לערך החדש במקום לקפוץ אליו */
  function paintBank(value, animate) {
    const from = state.paintedBank == null ? value : state.paintedBank;
    state.paintedBank = value;
    if (animate && from !== value) {
      FX.countUp(el.statBank, from, value, 650, fmt);
      FX.bump(el.bankItem);
    } else {
      FX.countUp(el.statBank, value, value, 0, fmt);
    }
  }

  /* --------------------------------------------------------------------- */
  /* מידות                                                                  */
  /* --------------------------------------------------------------------- */

  /*
   * רוחב הקלף נגזר מרוחב השולחן — חמישה קלפים בערך ברוחב אחד — ומוגבל
   * גם לפי הגובה, כדי שבטלפון נמוך כל היד תיכנס בלי לגלול. בכמה ידיים כל
   * יד מקבלת חלק מהרוחב והקלפים בה חופפים יותר; אם גם אז לא נכנס, הקלף
   * עצמו קטן — עד שכל קלף עדיין מציג את הפינה שלו
   */
  function layout() {
    const t = state.table;
    const W = Math.max(240, el.table.clientWidth - 28);
    const byHeight = (window.innerHeight - 410) / 2.9;
    const base = Math.round(Math.max(48, Math.min(100, W / 5.1, byHeight)));
    el.table.style.setProperty('--card-w', base + 'px');

    const fit = (container, count, avail, cw, maxStep) => {
      let w = cw;
      let step = count > 1 ? Math.min(w * maxStep, (avail - w) / (count - 1)) : w;
      const minStep = w * 0.3;
      if (count > 1 && step < minStep) {
        w = Math.max(34, avail / (1 + 0.3 * (count - 1)));
        step = w * 0.3;
      }
      container.style.setProperty('--card-w', Math.floor(w) + 'px');
      container.style.setProperty('--step', Math.floor(step) + 'px');
    };

    fit(el.dealerCards, t.dealer.length, W * 0.8, base, 0.62);

    const handEls = el.hands.querySelectorAll('.bj-hand');
    const n = handEls.length;
    if (!n) return;
    // הקשת בתחתית מצמצמת את הרוחב השימושי — לידיים הקיצוניות יש פחות מקום
    const usable = n > 2 ? W * 0.94 : W * 0.86;
    const avail = (usable - (n - 1) * 10) / n - 10;
    const cw = n === 1 ? base : Math.min(base * 0.86, avail * 0.78);
    handEls.forEach((h, i) => {
      const hand = t.hands[i];
      if (!hand) return;
      h.style.maxWidth = n > 1 ? Math.floor(avail + 10) + 'px' : '';
      fit(h.querySelector('.bj-cards'), hand.cards.length, avail, cw, n === 1 ? 0.6 : 0.34);
    });
  }

  /* --------------------------------------------------------------------- */
  /* ציור                                                                   */
  /* --------------------------------------------------------------------- */

  /** ז'יטוני הבית במגש מול הדילר — קישוט קבוע, וגם היעד והמקור של הז'יטונים */
  function buildTray() {
    el.tray.innerHTML = '';
    [10, 50, 100, 500, 1000].forEach((v, i) => {
      el.tray.appendChild(FX.stack(v * (5 + (i % 3)), { denoms: [v], max: 7, size: 18 }));
    });
  }

  function renderStatus() {
    const t = state.table;
    const pendingSum = sum(state.pending);
    const onTable = t.phase === 'bet' ? pendingSum : sum(t.hands.map((h) => h.bet)) + t.insurance;
    if (t.phase === 'bet') paintBank(t.bankroll - pendingSum, false);
    else paintBank(state.shownBank, false);
    el.statBet.textContent = fmt(onTable);
    el.statLevel.textContent = t.rules.name;

    const r = t.rules;
    el.rulesMain.textContent = "בלאקג'ק משלם " + (r.bjPays === 1.5 ? '3:2' : '6:5');
    el.rulesSub.textContent = r.h17 ? 'הדילר מושך על 17 רך' : 'הדילר חייב לעמוד על 17 רך';

    const decks = r.decks === 1 ? 'חפיסה אחת' : r.decks + ' חפיסות';
    el.footerInfo.textContent = decks + ' · נשארו ' + t.shoe.length + ' קלפים · הימור ' +
      fmt(r.minBet) + '–' + fmt(r.maxBet);
    el.discard.style.setProperty('--used', Math.max(0, Math.min(1, 1 - t.shoe.length / t.shoeSize)).toFixed(3));
  }

  function renderControls() {
    const t = state.table;
    const busy = state.busy;
    el.betControls.hidden = t.phase !== 'bet';
    el.insControls.hidden = t.phase !== 'insurance' || busy;
    el.playControls.hidden = t.phase !== 'player';
    el.doneControls.hidden = t.phase !== 'done' || busy;
    el.betSpot.hidden = t.phase !== 'bet';

    if (t.phase === 'bet') {
      const pendingSum = sum(state.pending);
      const room = Math.min(t.bankroll, t.rules.maxBet) - pendingSum;
      el.chipRack.querySelectorAll('.chip').forEach((c) => {
        const v = Number(c.dataset.val);
        c.hidden = v > t.rules.maxBet;
        c.disabled = v > room;
      });
      el.btnClear.disabled = !pendingSum;
      el.btnRebet.disabled = !state.lastBet || state.lastBet === pendingSum || !t.canBet(state.lastBet);
      el.btnDeal.disabled = !t.canBet(pendingSum);
      renderSpot();
    }

    if (t.phase === 'insurance') {
      el.btnInsYes.textContent = 'ביטוח · ' + fmt(t.insuranceCost());
      el.btnInsYes.disabled = !t.canInsure();
    }

    if (t.phase === 'player') {
      const allowed = t.allowed();
      const advised = !busy && (t.rules.advice === 'auto' || state.hinted) ? t.advice() : null;
      el.actButtons.forEach((b) => {
        const a = b.dataset.act;
        b.disabled = busy || !allowed[a];
        b.classList.toggle('is-advised', a === advised);
      });
      const hasHint = t.rules.advice === 'hint';
      el.btnHint.hidden = !hasHint;
      el.btnHint.disabled = busy;
      el.actSub.classList.toggle('no-hint', !hasHint);
    }

    if (t.phase === 'done') {
      el.againAmount.textContent = fmt(state.lastBet);
      el.btnAgain.disabled = !t.bankroll || t.bankroll < t.rules.minBet;
    }

    renderAdvice();
  }

  /** עיגול ההימור: ערימה אמיתית של הז'יטונים שהונחו, והסכום מתחת */
  function renderSpot() {
    const t = state.table;
    const pendingSum = sum(state.pending);
    el.betStack.innerHTML = '';
    if (pendingSum) el.betStack.appendChild(FX.stack(pendingSum, { denoms: CHIPS.slice().reverse(), max: 9 }));
    el.betSpot.classList.toggle('has-bet', pendingSum > 0);
    el.betAmount.textContent = pendingSum
      ? fmt(pendingSum) + (pendingSum < t.rules.minBet ? ' · מינימום ' + fmt(t.rules.minBet) : '')
      : 'מינימום ' + fmt(t.rules.minBet);
  }

  function renderAdvice() {
    const t = state.table;
    let html = '';
    const show = t.rules.advice === 'auto' || state.hinted;
    if (!state.busy && show && t.phase === 'player') {
      const a = t.advice();
      const h = t.current();
      const up = BJ.cardValue(t.dealer[0]);
      html = 'המלצה: <b>' + ACT_NAMES[a] + '</b> — ' + totalText(h.cards, true) +
        ' מול ' + (up === 11 ? 'אס' : up);
    } else if (!state.busy && t.rules.advice === 'auto' && t.phase === 'insurance') {
      html = 'המלצה: <b>בלי ביטוח</b> — בטווח הארוך הביטוח מפסיד';
    }
    el.advice.innerHTML = html;
    el.advice.hidden = !html;
  }

  /**
   * מצייר את השולחן. קלפים חדשים עפים מהחפיסה בסדר שבו נשלפו; אם הגיע
   * הזמן — הקלף הסגור מתהפך והדילר מושך; ורק בסוף נחשפים הסכומים,
   * התוצאות והתשלום.
   */
  function render() {
    clearTimers();
    const t = state.table;
    const p = pace();
    const fresh = (c) => !state.seen.has(c.id);
    const holeHidden = t.phase === 'insurance' || t.phase === 'player';

    // תזמון: קודם הקלפים הראשונים/של השחקן לפי סדר השליפה
    const delays = new Map();
    let clock = 0;
    const early = [];
    t.hands.forEach((h) => h.cards.forEach((c) => { if (fresh(c)) early.push(c); }));
    t.dealer.slice(0, 2).forEach((c) => { if (fresh(c)) early.push(c); });
    early.sort((a, b) => a.id - b.id);
    early.forEach((c) => { delays.set(c.id, clock); clock += p.card; });
    if (early.length) clock += p.fly - p.card;

    // היפוך הקלף הסגור, ואחריו הקלפים שהדילר מושך
    let flipAt = -1;
    const hole = t.dealer[1];
    if (hole && !holeHidden && !state.holeOpen) {
      flipAt = clock + (clock ? p.card : 0);
      clock = flipAt + p.flip;
    }
    t.dealer.slice(2).forEach((c) => {
      if (fresh(c)) { delays.set(c.id, clock); clock += p.dealer; }
    });
    const revealAt = clock + (clock ? p.settle : 0);

    /* ---- הדילר ---- */
    el.dealerCards.innerHTML = '';
    const flying = [];
    let holeNode = null;
    t.dealer.forEach((c, i) => {
      const isHole = i === 1;
      const down = isHole && (holeHidden || !state.holeOpen);
      const node = PC.el(c, { down });
      el.dealerCards.appendChild(node);
      if (delays.has(c.id)) flying.push([node, delays.get(c.id)]);
      if (isHole && flipAt >= 0) holeNode = node;
    });

    /* ---- ידי השחקן ---- */
    el.hands.innerHTML = '';
    el.hands.classList.toggle('is-multi', t.hands.length > 1);
    const handNodes = t.hands.map((h, i) => {
      const box = document.createElement('div');
      box.className = 'bj-hand';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', t.hands.length > 1 ? 'יד ' + (i + 1) : 'היד שלך');
      if (t.phase === 'player') {
        if (i === t.active) box.classList.add('is-active');
        else box.classList.add('is-waiting');
      }
      const row = document.createElement('div');
      row.className = 'bj-cards';
      row.dir = 'ltr';
      h.cards.forEach((c) => {
        const node = PC.el(c);
        row.appendChild(node);
        if (delays.has(c.id)) flying.push([node, delays.get(c.id)]);
      });
      box.appendChild(row);

      const foot = document.createElement('div');
      foot.className = 'bj-hand-foot';
      foot.dir = 'rtl';
      box.appendChild(foot);
      el.hands.appendChild(box);
      return { box, foot, row };
    });

    [...early, ...t.dealer].forEach((c) => state.seen.add(c.id));
    if (flipAt >= 0) state.holeOpen = true;

    layout();

    // המעוף מהחפיסה — אחרי ה-layout, כדי שהיעד כבר במקומו הסופי
    flying.forEach(([node, delay]) => {
      FX.flyIn(node, el.shoe, { delay, duration: p.fly, rotate: -16, scale: 0.7, fade: true });
      later(() => sound('deal'), delay);
    });
    if (holeNode) {
      later(() => {
        PC.reveal(holeNode, null, { instant: reducedMotion });
        sound('flip');
        feel('draw');
      }, flipAt);
    }

    // ציור הסכומים מתעכב עד שהקלפים נחתו
    state.busy = revealAt > 0;
    renderStatus();
    renderControls();
    el.banner.hidden = true;
    el.table.classList.remove('has-banner');
    el.dealerTotal.hidden = true;
    handNodes.forEach(({ foot }) => { foot.innerHTML = ''; });
    if (!t.rules.totals || t.phase !== 'done') el.dealerTotal.hidden = true;
    // לפני שהסכומים נחשפים — ההימור כבר על היד
    handNodes.forEach(({ foot }, i) => foot.appendChild(betEl(t.hands[i].bet)));

    const reveal = () => {
      state.busy = false;
      paintTotals(handNodes);
      if (t.phase === 'done') roundOver(handNodes);
      renderStatus();
      renderControls();
      focusControls();
    };
    if (revealAt > 0) later(reveal, revealAt);
    else reveal();
  }

  function betEl(amount) {
    const bet = document.createElement('span');
    bet.className = 'bj-bet';
    bet.appendChild(FX.stack(amount, { denoms: CHIPS.slice().reverse(), max: 6, size: 22 }));
    bet.appendChild(document.createTextNode(fmt(amount)));
    return bet;
  }

  function paintTotals(handNodes) {
    const t = state.table;
    const done = t.phase === 'done';
    const showTotals = t.rules.totals || done;

    // הדילר: לפני ההיפוך רק הקלף הגלוי
    if (t.dealer.length && showTotals) {
      const cards = t.phase === 'insurance' || t.phase === 'player' ? [t.dealer[0]] : t.dealer;
      el.dealerTotal.textContent = totalText(cards, !done);
      el.dealerTotal.className = done ? totalClass(cards, BJ.isNatural(t.dealer)) : 'bj-total';
      el.dealerTotal.setAttribute('aria-label', 'סכום הדילר ' + BJ.handValue(cards).total);
      el.dealerTotal.hidden = false;
    }

    handNodes.forEach(({ foot }, i) => {
      const h = t.hands[i];
      foot.innerHTML = '';
      const natural = t.hands.length === 1 && BJ.isNatural(h.cards);
      const meta = document.createElement('span');
      meta.className = 'bj-hand-meta';
      if (showTotals) {
        const tot = document.createElement('span');
        tot.className = totalClass(h.cards, natural);
        tot.textContent = natural ? '21' : totalText(h.cards, !h.done);
        meta.appendChild(tot);
      }
      meta.appendChild(betEl(h.bet));
      foot.appendChild(meta);

      if (done && h.result) {
        const [label, cls] = RESULT[h.result];
        const res = document.createElement('span');
        res.className = 'bj-res ' + cls;
        res.textContent = label + (h.payout ? ' ' + signed(h.payout) : '');
        foot.appendChild(res);
      }
    });
  }

  /* --------------------------------------------------------------------- */
  /* סוף סיבוב                                                              */
  /* --------------------------------------------------------------------- */

  /** ז'יטון "רוח" לערימה מעופפת */
  function ghostStack(amount, size) {
    return FX.stack(amount, { denoms: CHIPS.slice().reverse(), max: 5, size: size || 26 });
  }

  /*
   * הז'יטונים זזים כמו על שולחן אמיתי: רווח מגיע ממגש הבית אל היד, ואז
   * כל מה שעל היד עובר לקופה; הפסד נאסף למגש. מחזיר מתי הכול נחת
   */
  function animatePayouts(handNodes) {
    const t = state.table;
    const p = pace();
    if (!p.pay) return 0;
    let end = 0;
    handNodes.forEach(({ foot }, i) => {
      const h = t.hands[i];
      const stackEl = foot.querySelector('.bj-bet .chip-stack') || foot;
      const start = i * 140;
      if (h.result === 'win' || h.result === 'blackjack') {
        FX.toss(ghostStack(h.payout), el.tray, stackEl, { delay: start, duration: p.pay });
        later(() => sound('chips'), start + p.pay * 0.7);
        FX.toss(ghostStack(h.bet + h.payout), stackEl, el.bankItem, { delay: start + p.pay + 120, duration: p.pay, scaleTo: 0.6 });
        end = Math.max(end, start + p.pay * 2 + 120);
      } else if (h.result === 'push' || h.result === 'surrender') {
        const back = h.bet + h.payout;
        FX.toss(ghostStack(back), stackEl, el.bankItem, { delay: start + 200, duration: p.pay, scaleTo: 0.6 });
        end = Math.max(end, start + 200 + p.pay);
      } else {
        FX.toss(ghostStack(h.bet), stackEl, el.tray, { delay: start + 200, duration: p.pay, scaleTo: 0.7 });
        later(() => sound('chip'), start + 200 + p.pay * 0.8);
        end = Math.max(end, start + 200 + p.pay);
      }
      // הערימה על היד נעלמת כשהיא יוצאת לדרך
      const leaveAt = (h.result === 'win' || h.result === 'blackjack') ? start + p.pay + 120 : start + 200;
      later(() => { const b = foot.querySelector('.bj-bet'); if (b) b.style.visibility = 'hidden'; }, leaveAt);
    });
    if (t.insurance && t.insuranceResult > 0) {
      FX.toss(ghostStack(t.insurance * 3), el.tray, el.bankItem, { delay: 300, duration: p.pay, scaleTo: 0.6 });
    }
    return end;
  }

  function confetti() {
    if (reducedMotion) return;
    el.confetti.innerHTML = '';
    const colors = ['#f2c55c', '#f7d77e', '#ffffff', '#d6a52a', '#7fe0a8'];
    for (let i = 0; i < 28; i++) {
      const c = document.createElement('i');
      c.style.left = (5 + Math.random() * 90) + '%';
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--d', Math.round(Math.random() * 350) + 'ms');
      c.style.setProperty('--dx', Math.round((Math.random() - 0.5) * 120) + 'px');
      c.style.setProperty('--r', Math.round(240 + Math.random() * 600) + 'deg');
      el.confetti.appendChild(c);
    }
    later(() => { el.confetti.innerHTML = ''; }, 2400);
  }

  /**
   * אחרי שהתוצאה נחשפה: הודעה, תשלום, קופה, סטטיסטיקה, ובדיקת "נגמר
   * הכסף". סיבוב משוחזר מהשמירה רק מוצג — הוא כבר נספר כשהסתיים
   */
  function roundOver(handNodes) {
    const t = state.table;
    const net = t.lastNet;
    const single = t.hands.length === 1 ? t.hands[0].result : null;
    const dealerBust = BJ.handValue(t.dealer).total > 21;
    const natural = single === 'blackjack';
    let text;
    let cls = net > 0 ? 'is-win' : net < 0 ? 'is-lose' : '';
    if (natural) { text = "בלאקג'ק! " + signed(net); cls = 'is-bj'; }
    else if (single === 'bust') text = 'נשרפת ' + signed(net);
    else if (single === 'surrender') text = 'נכנעת ' + signed(net);
    else if (net > 0 && dealerBust) text = 'הדילר נשרף! ' + signed(net);
    else if (net > 0) text = 'ניצחת ' + signed(net);
    else if (net < 0 && BJ.isNatural(t.dealer)) text = "לדילר בלאקג'ק " + signed(net);
    else if (net < 0) text = 'הדילר ניצח ' + signed(net);
    else text = 'תיקו';

    el.banner.textContent = text;
    el.banner.className = 'bj-banner ' + cls;
    el.banner.hidden = false;
    el.table.classList.add('has-banner');

    // הקלפים המנצחים מקבלים הילה; בלאקג'ק — הילה פועמת
    handNodes.forEach(({ row }, i) => {
      const r = t.hands[i].result;
      if (r === 'win' || r === 'blackjack') {
        row.querySelectorAll('.pc').forEach((c) => {
          c.classList.add('is-glow');
          if (r === 'blackjack') c.classList.add('is-pulse');
        });
      } else if (r === 'lose' || r === 'bust') {
        row.querySelectorAll('.pc').forEach((c) => c.classList.add('is-dim'));
      }
    });

    if (state.recorded) {
      state.shownBank = t.bankroll;
      paintBank(t.bankroll, false);
      return;
    }

    state.recorded = true;
    say(text, true);
    feel(net > 0 ? 'win' : net < 0 ? 'reject' : 'move');
    const big = natural || net >= 2 * state.lastBet;
    sound(net > 0 ? (big ? 'bigwin' : 'win') : net < 0 ? 'lose' : 'push');
    if (big && net > 0) confetti();
    if (t.insurance && t.insuranceResult > 0) setTimeout(() => toast('הביטוח שילם ' + fmt(t.insuranceResult)), 600);

    // הקופה מתעדכנת כשהז'יטונים מגיעים אליה
    const landAt = animatePayouts(handNodes);
    state.shownBank = t.bankroll;
    later(() => paintBank(t.bankroll, true), Math.max(0, landAt - 250));

    record(net, natural);
    saveGame();
    if (t.bankroll < t.rules.minBet) setTimeout(openBroke, 900 + landAt);
  }

  function record(net, natural) {
    const s = stats();
    s.levels = s.levels || {};
    const r = s.levels[state.table.level] || { rounds: 0, wins: 0, losses: 0, pushes: 0, bj: 0, net: 0 };
    r.rounds++;
    if (net > 0) r.wins++;
    else if (net < 0) r.losses++;
    else r.pushes++;
    if (natural) r.bj++;
    r.net += net;
    s.levels[state.table.level] = r;
    s.best = Math.max(s.best || 0, state.table.bankroll);
    s.bigWin = Math.max(s.bigWin || 0, net);
    store.write(STATS_KEY, s);
  }

  /** אחרי שהציור נגמר — הפוקוס עובר לכפתור שהגיוני ללחוץ עליו עכשיו */
  function focusControls() {
    if (window.Modal && window.Modal.top()) return;
    const a = document.activeElement;
    if (a && a !== document.body && !a.closest('[hidden]') && !a.disabled) return;
    const t = state.table;
    const target =
      t.phase === 'player' ? (el.actButtons.find((b) => b.classList.contains('is-advised') && !b.disabled) ||
        el.actButtons.find((b) => !b.disabled))
      : t.phase === 'insurance' ? el.btnInsNo
      : t.phase === 'done' ? el.btnAgain
      : null;
    if (target) { try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); } }
  }

  /* --------------------------------------------------------------------- */
  /* פעולות                                                                 */
  /* --------------------------------------------------------------------- */

  function addChip(v, from) {
    const t = state.table;
    if (t.phase !== 'bet' || state.busy) return;
    const room = Math.min(t.bankroll, t.rules.maxBet) - sum(state.pending);
    if (v > room) return;
    state.pending.push(v);
    feel('pick');
    sound('chip');
    // הז'יטון עף מהמתלה לעיגול, והערימה גדלה כשהוא נוחת
    if (from && !reducedMotion) {
      const target = el.betStack.querySelector('.chip-stack') || el.betStack;
      FX.toss(FX.chip(v, { size: 48 }), from, target, { duration: 340, arc: 40, fadeOut: false })
        .then(() => { if (state.table.phase === 'bet') renderSpot(); });
      renderStatus();
      renderControls();
      // עד הנחיתה מוצגת הערימה הקודמת
      const prevSum = sum(state.pending) - v;
      el.betStack.innerHTML = '';
      if (prevSum) el.betStack.appendChild(FX.stack(prevSum, { denoms: CHIPS.slice().reverse(), max: 9 }));
    } else {
      renderStatus();
      renderControls();
    }
    saveGame();
  }

  function removeChip() {
    if (state.table.phase !== 'bet' || !state.pending.length) return;
    const v = state.pending.pop();
    feel('pick');
    sound('chip');
    if (!reducedMotion) {
      const chipBtn = el.chipRack.querySelector('.chip-' + v);
      FX.toss(FX.chip(v, { size: 48 }), el.betStack, chipBtn || el.chipRack, { duration: 320, arc: 30 });
    }
    renderStatus();
    renderControls();
    saveGame();
  }

  function deal(amount) {
    const t = state.table;
    if (state.busy) return;
    if (!t.canBet(amount)) {
      if (amount < t.rules.minBet) toast('ההימור המינימלי ברמה הזו הוא ' + fmt(t.rules.minBet));
      else if (amount > t.bankroll) toast('אין מספיק בקופה');
      return;
    }
    state.lastBet = amount;
    state.pending = [];
    state.holeOpen = false;
    state.hinted = null;
    state.recorded = false;
    state.rounds++;
    state.shownBank = t.bankroll - amount;
    t.deal(amount);
    if (t.shuffled) {
      toast('החפיסה עורבבה');
      sound('shuffle');
    }
    feel('draw');
    saveGame();
    paintBank(state.shownBank, false);
    render();
  }

  function act(action) {
    const t = state.table;
    if (state.busy || t.phase !== 'player' || !t.allowed()[action]) return;
    const before = t.bankroll;
    t.act(action);
    state.hinted = null;
    // את הקופה אחרי תשלום חושפים רק בסוף ההנפשה
    state.shownBank = t.phase === 'done' ? bankBeforeSettle(t) : t.bankroll;
    if (t.bankroll < before) sound('chips');
    feel(action === 'stand' ? 'move' : 'draw');
    say(ACT_NAMES[action]);
    saveGame();
    render();
  }

  /** הקופה כפי שהייתה אחרי ההימורים ולפני התשלום — מה שמוצג בזמן שהדילר משחק */
  function bankBeforeSettle(t) {
    const back = t.hands.reduce((a, h) => a + h.bet + h.payout, 0);
    const ins = t.insurance && t.insuranceResult > 0 ? t.insurance * 3 : 0;
    return t.bankroll - back - ins;
  }

  function insurance(take) {
    const t = state.table;
    if (state.busy || t.phase !== 'insurance') return;
    t.resolveInsurance(take);
    state.shownBank = t.phase === 'done' ? bankBeforeSettle(t) : t.bankroll;
    if (take) sound('chips');
    feel('move');
    saveGame();
    render();
  }

  function again() {
    const t = state.table;
    if (state.busy || t.phase !== 'done') return;
    t.newRound();
    if (t.canBet(state.lastBet)) {
      deal(state.lastBet);
      return;
    }
    toBetting();
    if (t.bankroll >= t.rules.minBet) toast('אין מספיק להימור הקודם — בחרו סכום חדש');
  }

  function toBetting() {
    const t = state.table;
    if (t.phase === 'done') t.newRound();
    state.shownBank = t.bankroll;
    // מציעים מראש את ההימור הקודם, כל עוד אפשר להרשות אותו
    const prev = Math.min(state.lastBet, t.bankroll, t.rules.maxBet);
    state.pending = prev >= t.rules.minBet ? toChips(Math.floor(prev / 10) * 10) : [];
    saveGame();
    render();
    if (t.broke()) openBroke();
  }

  function hint() {
    const t = state.table;
    if (t.phase !== 'player' || state.busy) return;
    state.hinted = t.advice();
    renderControls();
    const b = el.actButtons.find((x) => x.dataset.act === state.hinted);
    if (b) FX.bump(b);
    say('המלצה: ' + ACT_NAMES[state.hinted]);
  }

  /* ----------------------------- רמה ----------------------------- */

  let pickLevel = 1;
  function syncLevelModal() {
    el.levelSeg.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', Number(b.dataset.val) === pickLevel ? 'true' : 'false');
    });
    el.levelDesc.textContent = BJ.LEVELS[pickLevel].desc;
  }

  function openLevel() {
    const t = state.table;
    if (t.phase === 'player' || t.phase === 'insurance' || state.busy) {
      toast('אפשר להחליף רמה בין סיבובים');
      return;
    }
    pickLevel = t.level;
    syncLevelModal();
    openModal(el.levelModal);
  }

  function setLevel(level) {
    const old = state.table;
    if (old.phase === 'done') old.newRound();
    state.table = new BJ.Table({ level, bankroll: old.bankroll });
    state.prefs.level = level;
    savePrefs();
    state.seen.clear();
    state.holeOpen = false;
    state.shownBank = state.table.bankroll;
    const t = state.table;
    const prev = Math.min(state.lastBet, t.bankroll, t.rules.maxBet);
    state.pending = prev >= t.rules.minBet ? toChips(prev) : [];
    saveGame();
    render();
    const r = t.rules;
    toast('שולחן ' + r.name + ' · ' + (r.decks === 1 ? 'חפיסה אחת' : r.decks + ' חפיסות'));
    if (t.broke()) setTimeout(openBroke, 400);
  }

  function openBroke() {
    const t = state.table;
    if (t.phase === 'done') toBetting();
    if (!t.broke()) return;
    if (window.Modal.top() === el.brokeModal) return;
    const lower = Object.keys(BJ.LEVELS).map(Number)
      .filter((lv) => lv !== t.level && BJ.LEVELS[lv].minBet <= t.bankroll);
    el.brokeSub.textContent = 'נשארו ' + fmt(t.bankroll) + ', וההימור המינימלי ברמה ' + t.rules.name +
      ' הוא ' + fmt(t.rules.minBet) + '.' + (lower.length ? ' אפשר לעבור לרמה נמוכה יותר,' : '') +
      ' או לקחת קופה חדשה של ' + fmt(BJ.START_BANKROLL) + '.';
    el.btnBrokeLevel.hidden = !lower.length;
    openModal(el.brokeModal);
  }

  /* --------------------------------------------------------------------- */
  /* אירועים                                                                */
  /* --------------------------------------------------------------------- */

  CHIPS.forEach((v) => {
    const c = FX.chip(v, { tag: 'button' });
    c.type = 'button';
    c.dataset.val = v;
    c.setAttribute('aria-label', "ז'יטון " + v);
    c.addEventListener('click', () => addChip(v, c));
    el.chipRack.appendChild(c);
  });

  el.betSpot.addEventListener('click', removeChip);
  el.btnClear.addEventListener('click', () => {
    if (!state.pending.length) return;
    if (!reducedMotion) FX.toss(FX.stack(sum(state.pending), { denoms: CHIPS.slice().reverse(), max: 6, size: 44 }), el.betStack, el.chipRack, { duration: 340, arc: 30 });
    sound('chips');
    state.pending = [];
    renderStatus();
    renderControls();
    saveGame();
  });
  el.btnRebet.addEventListener('click', () => {
    if (!state.table.canBet(state.lastBet)) return;
    state.pending = toChips(state.lastBet);
    sound('chips');
    renderStatus();
    renderControls();
    FX.bump(el.betStack);
    saveGame();
  });
  el.btnDeal.addEventListener('click', () => deal(sum(state.pending)));

  el.btnInsYes.addEventListener('click', () => insurance(true));
  el.btnInsNo.addEventListener('click', () => insurance(false));

  el.actButtons.forEach((b) => b.addEventListener('click', () => act(b.dataset.act)));
  el.btnHint.addEventListener('click', hint);

  el.btnAgain.addEventListener('click', again);
  el.btnChangeBet.addEventListener('click', () => { if (!state.busy) toBetting(); });

  el.btnLevel.addEventListener('click', openLevel);
  el.levelSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    pickLevel = Number(b.dataset.val);
    syncLevelModal();
  });
  el.btnLevelOk.addEventListener('click', () => {
    closeModal(el.levelModal);
    if (pickLevel !== state.table.level) setLevel(pickLevel);
  });

  el.btnRebuy.addEventListener('click', () => {
    closeModal(el.brokeModal);
    state.table.rebuy();
    state.shownBank = state.table.bankroll;
    const s = stats();
    s.rebuys = (s.rebuys || 0) + 1;
    store.write(STATS_KEY, s);
    toBetting();
    sound('chips');
    toast('קופה חדשה · ' + fmt(BJ.START_BANKROLL));
  });
  el.btnBrokeLevel.addEventListener('click', () => {
    closeModal(el.brokeModal);
    pickLevel = state.table.level;
    syncLevelModal();
    openModal(el.levelModal);
  });

  document.addEventListener('keydown', (e) => {
    if (window.Modal && window.Modal.top()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = state.table;
    const keys = { KeyH: 'hit', KeyS: 'stand', KeyD: 'double', KeyP: 'split', KeyR: 'surrender' };
    if (t.phase === 'player' && keys[e.code]) {
      e.preventDefault();
      act(keys[e.code]);
      return;
    }
    if (e.key === 'Enter' && !(e.target && e.target.closest && e.target.closest('button, a'))) {
      if (t.phase === 'bet') deal(sum(state.pending));
      else if (t.phase === 'done') again();
    }
  });

  el.btnTheme.addEventListener('click', () => {
    const order = { auto: 'light', light: 'dark', dark: 'auto' };
    state.prefs.theme = order[state.prefs.theme] || 'light';
    savePrefs();
    applyTheme();
  });

  el.btnHelp.addEventListener('click', () => openModal(el.helpModal));

  function renderStats() {
    const s = stats();
    const levels = s.levels || {};
    const rows = [];
    [1, 2, 3, 4].forEach((lv) => {
      const r = levels[lv];
      const name = BJ.LEVELS[lv].name;
      if (!r || !r.rounds) { rows.push([name, '—', '']); return; }
      const pct = Math.round((r.wins / r.rounds) * 100);
      rows.push([name, r.rounds + ' סיבובים · ' + pct + '% ניצחונות' + (r.bj ? ' · ' + r.bj + " בלאקג'ק" : ''), signed(r.net)]);
    });
    let html = rows
      .map(([name, meta, value]) =>
        '<div class="stats-row"><span class="name">' + name + '</span><span class="meta">' + meta +
        '</span><span class="best">' + value + '</span></div>')
      .join('');
    html += '<div class="stats-row"><span class="name">קופה הכי גבוהה</span><span class="meta"></span>' +
      '<span class="best">' + fmt(s.best || BJ.START_BANKROLL) + '</span></div>';
    html += '<div class="stats-row"><span class="name">הניצחון הגדול בסיבוב</span><span class="meta"></span>' +
      '<span class="best">' + fmt(s.bigWin || 0) + '</span></div>';
    if (s.rebuys) {
      html += '<div class="stats-row"><span class="name">קופות חדשות</span><span class="meta"></span>' +
        '<span class="best">' + s.rebuys + '</span></div>';
    }
    el.statsTable.innerHTML = html;
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

  el.btnSettings.addEventListener('click', () => {
    el.settingsModal.querySelectorAll('[data-pref]').forEach((i) => {
      i.checked = !!state.prefs[i.dataset.pref];
    });
    const mode = H ? H.supported() : 'none';
    el.hapticsNote.textContent =
      mode === 'vibrate' ? 'משוב מישושי על קלף, ניצחון והפסד'
      : mode === 'ios-switch'
        ? 'באייפון הרטט מוגבל לנקישה אחידה, ובגרסאות iOS חדשות הוא עשוי לא לעבוד'
        : 'הדפדפן הזה אינו מאפשר רטט לדף. המשוב החזותי פועל כרגיל';
    const sw = document.getElementById('optHaptics');
    if (sw) sw.disabled = mode === 'none';
    const snd = document.getElementById('optSound');
    if (snd && !(SND && SND.supported())) {
      snd.disabled = true;
      el.soundNote.textContent = 'הדפדפן הזה אינו תומך בצלילים';
    }
    openModal(el.settingsModal);
  });

  el.settingsModal.addEventListener('change', (e) => {
    const input = e.target.closest && e.target.closest('[data-pref]');
    if (!input) return;
    const key = input.dataset.pref;
    state.prefs[key] = input.checked;
    savePrefs();
    if (key === 'haptics' && H) H.setEnabled(input.checked);
    if (key === 'sound' && SND) {
      SND.setEnabled(input.checked);
      if (input.checked) sound('chip');
    }
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

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 120);
  });

  window.addEventListener('pagehide', saveGame);

  /* --------------------------------------------------------------------- */
  /* אתחול                                                                  */
  /* --------------------------------------------------------------------- */

  function init() {
    applyTheme();
    if (H) H.setEnabled(!!state.prefs.haptics);
    if (SND) SND.setEnabled(state.prefs.sound !== false);
    buildTray();

    const saved = store.read(SAVE_KEY, null);
    let t = null;
    if (saved && saved.table) {
      try { t = BJ.Table.fromJSON(saved.table); } catch (e) { t = null; }
    }
    if (t) {
      state.lastBet = saved.lastBet || 0;
      state.rounds = saved.rounds || 0;
      if (t.phase === 'bet' && Array.isArray(saved.pending)) {
        const room = Math.min(t.bankroll, t.rules.maxBet);
        state.pending = saved.pending.filter((v) => CHIPS.includes(v));
        while (sum(state.pending) > room) state.pending.pop();
      }
      // סיבוב משוחזר: לא מנפישים שוב את מה שכבר נראה
      t.hands.forEach((h) => h.cards.forEach((c) => state.seen.add(c.id)));
      t.dealer.forEach((c) => state.seen.add(c.id));
      state.holeOpen = t.phase === 'done';
      state.recorded = t.phase === 'done';
    } else {
      t = new BJ.Table({ level: state.prefs.level });
    }
    state.table = t;
    state.shownBank = t.bankroll;
    render();
    if (t.broke()) setTimeout(openBroke, 500);

    if (!store.ok) setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
  }

  init();
})();
