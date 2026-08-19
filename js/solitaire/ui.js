/* =============================================================================
 * solitaire/ui.js — ממשק ואינטראקציה לסוליטר
 * -----------------------------------------------------------------------------
 * אינטראקציה מבוססת הקשה ולא גרירה: מקישים על קלף לבחירה ואז על היעד.
 * גרירה במסך מגע קטן היא מדויקת פחות ונוטה להתנגש עם גלילת הדף, בעוד
 * שהקשה עובדת זהה בטלפון ובעכבר. הקשה כפולה שולחת אוטומטית ליעד המתבקש.
 * =========================================================================== */
(function () {
  'use strict';

  const Solitaire = window.Solitaire;
  const Cards = window.SolitaireCards;
  const M = window.UIMath;

  const $ = (s) => document.querySelector(s);

  /* היסטים אנכיים בערימת משחק, ביחידות cqw (אחוז מרוחב העמודה) */
  const OFFSET_DOWN = 11; // קלף הפוך — מספיק כדי לראות שהוא שם
  const CARD_H = 140; // גובה קלף ביחס לרוחב (5:7)
  const WASTE_FAN = 26; // פריסה אופקית ב-waste

  /*
   * ההיסט של קלף גלוי הוא מה שקובע את גודל שטח ההקשה שלו: קלף בתוך ערימה
   * חשוף רק ברוחב ההיסט. בטלפון היסט קטן הופך את המשחק לקרב דיוק, ולכן
   * הוא מחושב דינמית — לוקחים את הגדול ביותר שעדיין מכניס את הערימה
   * הארוכה ביותר לגובה הפנוי, ומגבילים לטווח סביר.
   */
  const OFFSET_UP_MIN = 22;
  const OFFSET_UP_MAX = 46;
  let offsetUp = 34;

  const PREFS_KEY = 'solitaire.v1.prefs';
  const SAVE_KEY = 'solitaire.v1.save';
  const STATS_KEY = 'solitaire.v1.stats';

  /* --------------------------------------------------------------------- */
  /* אחסון                                                                  */
  /* --------------------------------------------------------------------- */

  const store = {
    ok: (() => {
      try {
        localStorage.setItem('__p', '1');
        localStorage.removeItem('__p');
        return true;
      } catch (e) {
        return false;
      }
    })(),
    read(key, fallback) {
      if (!this.ok) return fallback;
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    write(key, value) {
      if (!this.ok) return;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* מלא או חסום — ממשיכים בלי שמירה */
      }
    },
    remove(key) {
      if (!this.ok) return;
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    },
  };

  const DIFF_LABELS = { easy: 'קל', medium: 'בינוני', hard: 'קשה', expert: 'מומחה' };

  const DEFAULT_PREFS = {
    theme: 'auto',
    difficulty: 'easy',
    autoCollect: true,
    showTargets: true,
    tapToMove: true,
  };

  /* --------------------------------------------------------------------- */
  /* מצב                                                                    */
  /* --------------------------------------------------------------------- */

  const state = {
    prefs: Object.assign({}, DEFAULT_PREFS, store.read(PREFS_KEY, {})),
    game: null,
    selection: null, // { zone, pile, index }
    paused: false,
    animating: false,
    confirmAction: null,
    stuckShown: false,
  };

  const el = {
    board: $('#board'),
    tableau: $('#tableau'),
    stock: $('#pileStock'),
    waste: $('#pileWaste'),
    statTime: $('#statTime'),
    statMoves: $('#statMoves'),
    statScore: $('#statScore'),
    statFound: $('#statFound'),
    statusbar: $('.statusbar'),
    btnPause: $('#btnPause'),
    actions: $('#actions'),
    footerInfo: $('#footerInfo'),
    toast: $('#toast'),
    winModal: $('#winModal'),
    stuckModal: $('#stuckModal'),
    stuckStats: $('#stuckStats'),
    btnStuckUndo: $('#btnStuckUndo'),
    btnStuckNew: $('#btnStuckNew'),
    winSub: $('#winSub'),
    winStats: $('#winStats'),
    confetti: $('#confetti'),
    btnWinNew: $('#btnWinNew'),
    settingsModal: $('#settingsModal'),
    btnSettings: $('#btnSettings'),
    pills: $('#difficultyPills'),
    btnNew: $('#btnNew'),
    statsModal: $('#statsModal'),
    statsTable: $('#statsTable'),
    btnStats: $('#btnStats'),
    btnClearStats: $('#btnClearStats'),
    confirmModal: $('#confirmModal'),
    confirmText: $('#confirmText'),
    btnConfirmOk: $('#btnConfirmOk'),
    btnTheme: $('#btnTheme'),
  };

  /* --------------------------------------------------------------------- */
  /* עזרים                                                                  */
  /* --------------------------------------------------------------------- */

  const formatTime = (seconds) => M.formatClock(seconds);

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.hidden = true;
    }, 2000);
  }

  const openModal = (n) => { n.hidden = false; };
  const closeModal = (n) => { n.hidden = true; };

  function confirmAction(text, onOk) {
    el.confirmText.textContent = text;
    state.confirmAction = onOk;
    openModal(el.confirmModal);
  }

  function applyTheme() {
    const pref = state.prefs.theme;
    const dark =
      pref === 'dark' ||
      (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.prefs.theme === 'auto') applyTheme();
  });

  const savePrefs = () => store.write(PREFS_KEY, state.prefs);

  /* --------------------------------------------------------------------- */
  /* בניית ה-DOM                                                            */
  /* --------------------------------------------------------------------- */

  /**
   * אלמנט שנותן לערימה את גובהה. חייב להיות ילד של הערימה — ראה ההסבר
   * ב-solitaire.css ליד .pile-sizer.
   * @param {number} h גובה ביחידות cqw (אחוז מרוחב העמודה)
   */
  function makeSizer(h) {
    const s = document.createElement('div');
    s.className = 'pile-sizer';
    s.style.setProperty('--h', String(h));
    return s;
  }

  /** מנקה ערימה ומחזיר אותה עם sizer בגובה המבוקש. */
  function resetPile(host, h) {
    host.textContent = '';
    host.appendChild(makeSizer(h));
  }

  function buildTableau() {
    el.tableau.textContent = '';
    for (let i = 0; i < Solitaire.TABLEAU_COUNT; i++) {
      const pile = document.createElement('div');
      pile.className = 'pile tableau';
      pile.dataset.zone = 'tableau';
      pile.dataset.pile = String(i);
      pile.appendChild(makeSizer(CARD_H));
      el.tableau.appendChild(pile);
    }
    // ערימות הסיום: sizer קבוע בגובה קלף + סמל הצורה למקום ריק
    document.querySelectorAll('.pile.foundation').forEach((p) => {
      p.appendChild(makeSizer(CARD_H));
      const suit = Solitaire.SUITS[Number(p.dataset.pile)];
      const ghost = document.createElement('div');
      ghost.className = 'pile-ghost';
      ghost.textContent = Solitaire.SUIT_SYMBOL[suit];
      p.appendChild(ghost);
    });
  }

  /** יוצר אלמנט קלף. faceUp=false מצייר גב. */
  function makeCardEl(card, faceUp) {
    const d = document.createElement('div');
    d.className = 'card' + (faceUp ? (Cards.cardIsRed(card) ? ' is-red' : ' is-black') : ' is-down');
    d.dataset.card = String(card);

    if (faceUp) {
      const corner = document.createElement('span');
      corner.className = 'card-corner';
      const rank = document.createElement('span');
      rank.className = 'card-rank';
      rank.textContent = Cards.cardLabel(card);
      const suit = document.createElement('span');
      suit.className = 'card-suit';
      suit.textContent = Cards.cardSymbol(card);
      corner.appendChild(rank);
      corner.appendChild(suit);

      const pip = document.createElement('span');
      pip.className = 'card-pip';
      pip.textContent = Cards.cardSymbol(card);

      d.appendChild(corner);
      d.appendChild(pip);
      d.setAttribute('aria-label', Cards.cardLabel(card) + ' ' + Cards.cardSymbol(card));
    } else {
      d.setAttribute('aria-label', 'קלף הפוך');
    }
    return d;
  }

  /* --------------------------------------------------------------------- */
  /* רינדור                                                                 */
  /* --------------------------------------------------------------------- */

  /**
   * מחשב את ההיסט של קלף גלוי כך שהערימה הארוכה ביותר עדיין תיכנס
   * לגובה שנשאר על המסך. גדול ככל האפשר => שטח הקשה גדול ככל האפשר.
   */
  function computeOffsetUp() {
    const g = state.game;
    if (!g) return;

    const pileEl = el.tableau.firstElementChild;
    const colW = pileEl ? pileEl.getBoundingClientRect().width : 0;
    if (!colW) return;

    // כמה גובה נשאר לעמודות: מה שיש מתחת לראש הטבלאו ועד תחתית החלון,
    // פחות מקום לכפתורי הפעולה ולפוטר
    const top = el.tableau.getBoundingClientRect().top;
    const reserved = el.actions.offsetHeight + 34;
    const availablePx = Math.max(120, window.innerHeight - top - reserved);
    const availableCqw = (availablePx / colW) * 100;

    const piles = [];
    for (let i = 0; i < Solitaire.TABLEAU_COUNT; i++) {
      const total = g.tableau[i].length;
      if (!total) continue;
      const up = Math.min(g.faceUp[i], total);
      piles.push({ up, down: total - up });
    }

    offsetUp = M.fanOffset({
      availableCqw, cardH: CARD_H, offsetDown: OFFSET_DOWN, piles,
      min: OFFSET_UP_MIN, max: OFFSET_UP_MAX,
    });
  }

  function render() {
    const g = state.game;
    if (!g) return;

    computeOffsetUp();
    renderStock();
    renderWaste();
    renderFoundations();
    renderTableau();
    renderTargets();
    updateStatus();
  }

  function renderStock() {
    const g = state.game;
    resetPile(el.stock, CARD_H);
    el.stock.classList.toggle('has-cards', g.stock.length > 0);

    if (g.stock.length) {
      // מציגים גב אחד בלבד — אין ערך בערימה של 24 גבים זהים
      el.stock.appendChild(makeCardEl(0, false));
      const count = document.createElement('span');
      count.className = 'stock-count';
      count.textContent = String(g.stock.length);
      el.stock.appendChild(count);
    } else {
      const rec = document.createElement('div');
      rec.className = 'stock-recycle';
      rec.innerHTML =
        '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v4h-4"/></svg>';
      el.stock.appendChild(rec);
    }
  }

  function renderWaste() {
    const g = state.game;
    resetPile(el.waste, CARD_H);
    el.waste.classList.toggle('has-cards', g.waste.length > 0);

    // מציגים עד שלושה אחרונים, פרוסים — רק העליון ניתן ללקיחה
    const show = g.waste.slice(-Math.min(3, g.waste.length));
    show.forEach((card, i) => {
      const c = makeCardEl(card, true);
      c.style.setProperty('--fan', String(i * WASTE_FAN));
      c.style.zIndex = String(i + 1);
      const isTop = i === show.length - 1;
      if (!isTop) c.classList.add('is-dead');
      else {
        c.dataset.zone = 'waste';
        if (isSelected({ zone: 'waste' })) c.classList.add('is-selected');
      }
      el.waste.appendChild(c);
    });
  }

  function renderFoundations() {
    const g = state.game;
    document.querySelectorAll('.pile.foundation').forEach((p) => {
      const idx = Number(p.dataset.pile);
      const f = g.foundations[idx];
      // משאירים את ה-ghost ומסירים רק קלפים
      p.querySelectorAll('.card').forEach((c) => c.remove());
      p.classList.toggle('has-cards', f.length > 0);
      if (f.length) {
        const c = makeCardEl(f[f.length - 1], true);
        c.dataset.zone = 'foundation';
        c.dataset.pile = String(idx);
        if (isSelected({ zone: 'foundation', pile: idx })) c.classList.add('is-selected');
        p.appendChild(c);
      }
    });
  }

  function renderTableau() {
    const g = state.game;
    const piles = el.tableau.children;

    for (let i = 0; i < Solitaire.TABLEAU_COUNT; i++) {
      const host = piles[i];
      const cards = g.tableau[i];
      host.classList.toggle('has-cards', cards.length > 0);

      // גובה הערימה: ההיסט של הקלף האחרון + קלף שלם
      let total = CARD_H;
      for (let j = 0; j < cards.length - 1; j++) {
        total += g.isFaceUp(i, j) ? offsetUp : OFFSET_DOWN;
      }
      resetPile(host, total);

      let off = 0;
      for (let j = 0; j < cards.length; j++) {
        const faceUp = g.isFaceUp(i, j);
        const c = makeCardEl(cards[j], faceUp);
        c.style.setProperty('--off', String(off));
        c.style.zIndex = String(j + 1);
        c.dataset.zone = 'tableau';
        c.dataset.pile = String(i);
        c.dataset.index = String(j);

        if (!faceUp) c.classList.add('is-dead');
        if (isSelected({ zone: 'tableau', pile: i, index: j })) c.classList.add('is-selected');

        host.appendChild(c);
        off += faceUp ? offsetUp : OFFSET_DOWN;
      }
    }
  }

  /** מדגיש ערימות שהמהלך אליהן חוקי עבור הבחירה הנוכחית. */
  function renderTargets() {
    document.querySelectorAll('.pile.is-target').forEach((p) => p.classList.remove('is-target'));
    if (!state.selection || !state.prefs.showTargets) return;

    const g = state.game;
    const cards = g._takeableCards(state.selection);
    if (!cards || !cards.length) return;

    if (cards.length === 1) {
      const f = g.foundationFor(cards[0]);
      if (g.canPlaceOnFoundation(cards[0], f)) {
        const node = document.querySelector(`.pile.foundation[data-pile="${f}"]`);
        if (node) node.classList.add('is-target');
      }
    }
    for (let i = 0; i < Solitaire.TABLEAU_COUNT; i++) {
      if (state.selection.zone === 'tableau' && state.selection.pile === i) continue;
      if (g.canPlaceOnTableau(cards[0], i)) el.tableau.children[i].classList.add('is-target');
    }
  }

  function updateStatus() {
    const g = state.game;
    el.statTime.textContent = formatTime(g.currentSeconds());
    el.statMoves.textContent = String(g.moves);
    el.statScore.textContent = String(g.score);
    el.statFound.textContent = g.foundationCount() + '/52';

    const undoBtn = el.actions.querySelector('[data-action="undo"]');
    const redoBtn = el.actions.querySelector('[data-action="redo"]');
    const collectBtn = el.actions.querySelector('[data-action="collect"]');
    undoBtn.disabled = !g.canUndo();
    redoBtn.disabled = !g.canRedo();
    collectBtn.disabled = g.finished || g.foundationCount() === 52;
    // ברגע שכל הקלפים גלויים הכפתור הופך מ"אסוף" ל"סיים"
    collectBtn.classList.toggle('is-finish', g.canAutoFinish());
    const label = collectBtn.querySelector('span:not(.tool-badge)');
    if (label) label.textContent = g.canAutoFinish() ? 'סיים' : 'אסוף';

    const parts = [];
    if (g.difficulty) parts.push(DIFF_LABELS[g.difficulty]);
    parts.push(g.drawCount === 3 ? 'משיכת שלושה' : 'משיכת קלף');
    if (g.maxRecycles !== Infinity) {
      parts.push('סיבובים: ' + g.recycles + '/' + g.maxRecycles);
    } else if (g.recycles) {
      parts.push('סיבובים: ' + g.recycles);
    }
    el.footerInfo.textContent = parts.join(' · ');
  }

  /* --------------------------------------------------------------------- */
  /* בחירה והזזה                                                            */
  /* --------------------------------------------------------------------- */

  function isSelected(loc) {
    const s = state.selection;
    if (!s || !loc) return false;
    if (s.zone !== loc.zone) return false;
    if (s.zone === 'waste') return true;
    if (s.pile !== loc.pile) return false;
    if (s.zone === 'tableau') return s.index === loc.index;
    return true;
  }

  function clearSelection() {
    state.selection = null;
  }

  /** מזיז ומרנדר, כולל אנימציית נחיתה ובדיקת ניצחון. */
  function doMove(from, to) {
    const g = state.game;
    const res = g.move(from, to);
    if (!res.ok) return res;

    clearSelection();
    render();
    landAnimation(to);
    save();

    if (res.won) onWin();
    else afterAction();
    return res;
  }

  /**
   * מה שצריך לקרות אחרי כל שינוי במצב הלוח: קודם לבדוק אם אפשר לסיים
   * לבד, ורק אם לא — לבדוק מבוי סתום.
   *
   * נקרא גם בטעינת משחק שמור, ולא רק אחרי מהלך: אם סגרת את המשחק בדיוק
   * כשכל הקלפים כבר גלויים, הוא אמור לסיים את עצמו כשתחזור.
   */
  function afterAction() {
    const g = state.game;
    if (!g || g.finished || state.animating) return;

    if (state.prefs.autoCollect && g.canAutoFinish()) {
      runAutoFinish(true);
      return;
    }
    checkStuck();
  }

  function landAnimation(to) {
    let node = null;
    if (to.zone === 'foundation') {
      node = document.querySelector(`.pile.foundation[data-pile="${to.pile}"] .card`);
    } else if (to.zone === 'tableau') {
      const host = el.tableau.children[to.pile];
      node = host.lastElementChild;
    }
    if (!node) return;
    node.classList.add('is-land');
    setTimeout(() => node.classList.remove('is-land'), 260);
  }

  function rejectAnimation(node) {
    if (!node) return;
    node.classList.add('is-no');
    setTimeout(() => node.classList.remove('is-no'), 300);
  }

  /** מיקום הקלף מתוך אלמנט ה-DOM שלו. */
  function locOf(cardEl) {
    const zone = cardEl.dataset.zone;
    if (!zone) return null;
    const loc = { zone };
    if (cardEl.dataset.pile != null) loc.pile = Number(cardEl.dataset.pile);
    if (cardEl.dataset.index != null) loc.index = Number(cardEl.dataset.index);
    return loc;
  }

  const locKey = (l) => (l ? `${l.zone}:${l.pile != null ? l.pile : '-'}:${l.index != null ? l.index : '-'}` : '');

  /* -------------------------- מטפל ההקשות ---------------------------- */

  /*
   * הקשה אחת על קלף שולחת אותו ליעד הטוב ביותר — קודם ערימת סיום, אחרת
   * עמודה מתאימה. זה מקצר את רוב המשחק להקשה בודדת.
   *
   * אבל לפעמים *כן* צריך לבחור יעד: לרצף יכולות להיות כמה עמודות חוקיות,
   * ורק אחת מהן מקדמת. לכן לחיצה ארוכה עוברת למצב בחירה ידנית — הקלף
   * מסומן, היעדים החוקיים נצבעים, וההקשה הבאה קובעת לאן.
   */
  const LONG_PRESS_MS = 420;
  let pressTimer = null;
  let pressStart = null;
  let suppressClick = false;

  function cancelPress() {
    clearTimeout(pressTimer);
    pressTimer = null;
    pressStart = null;
  }

  el.board.addEventListener('pointerdown', (e) => {
    const g = state.game;
    if (!g || state.paused || g.finished) return;
    if (!state.prefs.tapToMove) return; // במצב הישן ההקשה כבר בוחרת

    const cardEl = e.target.closest('.card');
    if (!cardEl || cardEl.classList.contains('is-dead')) return;

    pressStart = { x: e.clientX, y: e.clientY };
    pressTimer = setTimeout(() => {
      const loc = locOf(cardEl);
      if (!loc || !g._takeableCards(loc)) return;
      state.selection = loc;
      suppressClick = true; // ה-click שאחרי השחרור אינו בחירת יעד
      render();
      toast('בחר יעד');
      cancelPress();
    }, LONG_PRESS_MS);
  });

  el.board.addEventListener('pointermove', (e) => {
    // גלילה או תזוזה מבטלות את הלחיצה הארוכה
    if (!pressStart) return;
    if (Math.abs(e.clientX - pressStart.x) > 10 || Math.abs(e.clientY - pressStart.y) > 10) {
      cancelPress();
    }
  });

  el.board.addEventListener('pointerup', cancelPress);
  el.board.addEventListener('pointercancel', cancelPress);

  el.board.addEventListener('click', (e) => {
    const g = state.game;
    if (!g || state.paused || state.animating || g.finished) return;

    if (suppressClick) {
      suppressClick = false;
      return;
    }

    const pileEl = e.target.closest('.pile');
    const cardEl = e.target.closest('.card');

    /* --- החפיסה: משיכה --- */
    if (pileEl && pileEl.dataset.zone === 'stock') {
      clearSelection();
      const r = g.draw();
      if (!r.ok) {
        toast(r.reason === 'no-more-redeals' ? 'נגמרו סיבובי החפיסה ברמה הזו' : 'אין קלפים למשיכה');
      }
      render();
      save();
      afterAction();
      return;
    }

    /* --- יש בחירה פעילה => ההקשה הזו היא היעד --- */
    if (state.selection) {
      const targetEl = pileEl;
      if (targetEl) {
        const zone = targetEl.dataset.zone;
        if (zone === 'tableau' || zone === 'foundation') {
          const res = doMove(state.selection, { zone, pile: Number(targetEl.dataset.pile) });
          if (res.ok) return;
          if (cardEl && isSelected(locOf(cardEl))) {
            // הקשה חוזרת על הקלף שנבחר => ביטול הבחירה
            clearSelection();
            render();
            return;
          }
          toast('מהלך לא חוקי');
        }
      }
      clearSelection();
      render();
      return;
    }

    /* --- הקשה על קלף --- */
    if (cardEl && !cardEl.classList.contains('is-dead')) {
      const loc = locOf(cardEl);
      if (!loc) return;

      if (!g._takeableCards(loc)) {
        rejectAnimation(cardEl);
        toast('אי אפשר להזיז את הקלף הזה');
        return;
      }

      if (state.prefs.tapToMove) {
        const target = g.findAutoTarget(loc);
        if (target) {
          doMove(loc, target);
        } else {
          rejectAnimation(cardEl);
          toast('אין לאן להזיז את הקלף');
        }
        return;
      }

      // מצב ידני: ההקשה בוחרת, וההקשה הבאה קובעת יעד
      state.selection = loc;
      render();
    }
  });

  /* --------------------------------------------------------------------- */
  /* פעולות                                                                 */
  /* --------------------------------------------------------------------- */

  el.actions.addEventListener('click', (e) => {
    const btn = e.target.closest('.tool');
    if (!btn || !state.game) return;
    const g = state.game;

    switch (btn.dataset.action) {
      case 'undo':
        if (g.undo()) {
          clearSelection();
          state.stuckShown = false;
          // הטיימר נעצר כשהוכרז מבוי סתום — ביטול מחזיר אותנו למשחק
          if (!g.isTimerRunning && !g.finished && !state.paused) {
            g.startTimer();
            startTimerLoop();
          }
          render();
          save();
        }
        break;

      case 'redo':
        if (g.redo()) {
          clearSelection();
          state.stuckShown = false;
          render();
          save();
        }
        break;

      case 'hint':
        showHint();
        break;

      case 'collect':
        if (g.canAutoFinish()) {
          toast('מסיים…');
          runAutoFinish(true);   // מותר גם לסובב את החפיסה
        } else if (runAutoFinish(false) === 0) {
          toast('אין קלף שאפשר לאסוף עכשיו');
        }
        break;

      case 'new':
        if (g.moves > 3 && !g.finished) {
          confirmAction('להתחיל משחק חדש? ההתקדמות הנוכחית תימחק.', newGame);
        } else {
          newGame();
        }
        break;
    }
  });

  /**
   * מסיים את המשחק אוטומטית, צעד אחרי צעד.
   *
   * לא רק אוסף לערימות הסיום אלא גם מסובב את החפיסה כשאין מה לאסוף, ולכן
   * הוא באמת מסיים גם כשנשארו קלפים ב-stock — וזה המצב הרגיל ברגע שכל
   * הקלפים בעמודות כבר גלויים.
   *
   * הצעדים מרווחים בזמן כדי שיהיה מה לראות; הלוח לא קופץ למצב מנוצח.
   */
  function runAutoFinish(allowDraw) {
    const g = state.game;
    if (!g || g.finished || state.animating) return 0;

    clearSelection();
    state.animating = true;

    let collected = 0;
    // מגן מפני סיבוב אינסופי: אם עברנו חפיסה שלמה בלי לאסוף כלום, עוצרים
    let drawsSinceCollect = 0;
    const drawLimit = g.stock.length + g.waste.length + 2;

    const step = () => {
      if (state.game !== g || g.finished) return finish();

      const did = allowDraw ? g.autoFinishStep() : g.collectOne();
      if (!did) return finish();

      if (did.type === 'collect') {
        collected++;
        drawsSinceCollect = 0;
      } else {
        drawsSinceCollect++;
        if (drawsSinceCollect > drawLimit) return finish();
      }

      render();
      if (did.type === 'collect') landAnimation({ zone: 'foundation', pile: did.to });

      if (g.checkWin()) {
        state.animating = false;
        save();
        onWin();
        return;
      }
      // איסוף מהיר יותר ממשיכה — משיכה היא "חיפוש" וכדאי שתיראה כזו
      setTimeout(step, did.type === 'collect' ? 110 : 190);
    };

    function finish() {
      state.animating = false;
      render();
      save();
      if (!g.finished) checkStuck();
    }

    // הצעד הראשון רץ מיד, כדי שהקורא יידע אם בכלל היה מה לעשות
    const first = allowDraw ? g.autoFinishStep() : g.collectOne();
    if (!first) {
      state.animating = false;
      return 0;
    }
    collected++;
    render();
    if (first.type === 'collect') landAnimation({ zone: 'foundation', pile: first.to });
    if (g.checkWin()) {
      state.animating = false;
      save();
      onWin();
      return 1;
    }
    setTimeout(step, 140);
    return 1;
  }

  function showHint() {
    const g = state.game;
    const sources = [{ zone: 'waste' }];
    for (let i = 0; i < Solitaire.TABLEAU_COUNT; i++) {
      const pile = g.tableau[i];
      for (let j = Math.max(0, pile.length - g.faceUp[i]); j < pile.length; j++) {
        sources.push({ zone: 'tableau', pile: i, index: j });
      }
    }

    for (const src of sources) {
      const target = g.findAutoTarget(src);
      if (!target) continue;
      state.selection = src;
      render();
      toast('נסה את הקלף המסומן');
      return;
    }

    toast(g.stock.length || g.waste.length ? 'אין מהלך — משוך מהחפיסה' : 'אין מהלכים אפשריים');
  }


  /* --------------------------------------------------------------------- */
  /* מבוי סתום                                                              */
  /* --------------------------------------------------------------------- */

  /**
   * בודק אם נגמרו המהלכים ומודיע לשחקן.
   *
   * מוצג פעם אחת בלבד לכל מצב תקוע: הדגל מתאפס ברגע שהמצב משתנה (ביטול
   * מהלך, חלוקה חדשה), אחרת המודל היה קופץ שוב אחרי כל הקשה על הלוח.
   */
  function checkStuck() {
    const g = state.game;
    if (!g || g.finished) return;

    if (g.hasAnyMove()) {
      state.stuckShown = false;
      return;
    }
    if (state.stuckShown) return;

    state.stuckShown = true;
    g.stopTimer();
    stopTimerLoop();
    saveNow();

    el.stuckStats.innerHTML = [
      statCard('זמן', formatTime(g.currentSeconds()), false),
      statCard('מהלכים', String(g.moves), false),
      statCard('נאספו', g.foundationCount() + '/52', false),
      statCard('ניקוד', String(g.score), false),
    ].join('');

    el.btnStuckUndo.disabled = !g.canUndo();
    setTimeout(() => openModal(el.stuckModal), 450);
  }

  /* --------------------------------------------------------------------- */
  /* ניצחון                                                                 */
  /* --------------------------------------------------------------------- */

  function onWin() {
    const g = state.game;
    g.finished = true;
    g.stopTimer();
    stopTimerLoop();
    save();

    const seconds = g.currentSeconds();
    const stats = store.read(STATS_KEY, {});
    const key = g.difficulty || 'medium';
    const rec = stats[key] || { played: 0, won: 0, best: null, bestScore: 0 };
    rec.won += 1;
    const isNewBest = rec.best == null || seconds < rec.best;
    if (isNewBest) rec.best = seconds;
    if (g.score > (rec.bestScore || 0)) rec.bestScore = g.score;
    stats[key] = rec;
    store.write(STATS_KEY, stats);

    flyAwayCards();

    el.winSub.textContent = (DIFF_LABELS[g.difficulty] || '') +
      ' · ' + (g.drawCount === 3 ? 'משיכת שלושה' : 'משיכת קלף');
    el.winStats.innerHTML = [
      statCard('זמן', formatTime(seconds), isNewBest),
      statCard('שיא אישי', rec.best != null ? formatTime(rec.best) : '—', false),
      statCard('מהלכים', String(g.moves), false),
      statCard('ניקוד', String(g.score), false),
    ].join('');

    setTimeout(() => openModal(el.winModal), 900);
  }

  function statCard(k, v, best) {
    return `<div class="win-stat${best ? ' is-best' : ''}">
      <span class="k">${k}${best ? ' 🏆' : ''}</span>
      <span class="v">${v}</span>
    </div>`;
  }

  /** הקלפים "עפים" מערימות הסיום — חגיגה קצרה לפני המודל. */
  function flyAwayCards() {
    const cards = document.querySelectorAll('.pile.foundation .card');
    cards.forEach((c, i) => {
      c.style.setProperty('--wd', i * 90 + 'ms');
      c.style.setProperty('--spin', (i % 2 ? 1 : -1) * (15 + i * 5) + 'deg');
      c.classList.add('is-winfly');
    });
  }

  function spawnConfetti() {
    const colors = ['#4f6ef7', '#23996b', '#e9a94e', '#e14b52', '#7f9bff'];
    let html = '';
    for (let i = 0; i < 14; i++) {
      html += `<i style="left:${Math.random() * 100}%;background:${
        colors[(Math.random() * colors.length) | 0]
      };animation-delay:${Math.random() * 400}ms"></i>`;
    }
    el.confetti.innerHTML = html;
  }

  /* --------------------------------------------------------------------- */
  /* טיימר, שמירה, השהיה                                                    */
  /* --------------------------------------------------------------------- */

  let timerInterval = null;

  function startTimerLoop() {
    stopTimerLoop();
    timerInterval = setInterval(() => {
      if (state.game && state.game.isTimerRunning) {
        el.statTime.textContent = formatTime(state.game.currentSeconds());
      }
    }, 250);
  }

  function stopTimerLoop() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (state.game) store.write(SAVE_KEY, state.game.serialize());
    }, 300);
  }
  function saveNow() {
    if (state.game) store.write(SAVE_KEY, state.game.serialize());
  }

  // סיבוב מסך או שינוי גודל חלון משנים את הגובה הפנוי => מחשבים היסט מחדש
  let resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (state.game) render(); }, 120);
  });

  window.addEventListener('pagehide', saveNow);
  window.addEventListener('beforeunload', saveNow);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.game && state.game.isTimerRunning) {
        state.game.stopTimer();
        saveNow();
      }
    } else if (state.game && !state.paused && !state.game.finished) {
      state.game.startTimer();
    }
  });

  function setPaused(p) {
    const g = state.game;
    if (!g || g.finished) return;
    state.paused = p;
    el.statusbar.classList.toggle('is-paused', p);
    el.board.style.visibility = p ? 'hidden' : '';
    if (p) {
      g.stopTimer();
      saveNow();
      toast('מושהה — הקש שוב להמשך');
    } else {
      g.startTimer();
    }
  }

  el.btnPause.addEventListener('click', () => setPaused(!state.paused));

  /* --------------------------------------------------------------------- */
  /* משחק חדש / טעינה                                                       */
  /* --------------------------------------------------------------------- */

  function newGame() {
    closeModal(el.winModal);
    const difficulty = state.prefs.difficulty || 'easy';
    state.game = new Solitaire({ difficulty });

    const stats = store.read(STATS_KEY, {});
    const rec = stats[difficulty] || { played: 0, won: 0, best: null, bestScore: 0 };
    rec.played += 1;
    stats[difficulty] = rec;
    store.write(STATS_KEY, stats);

    startGame();
    toast('חלוקה חדשה · ' + DIFF_LABELS[difficulty]);
  }

  /** מסמן את הגלולה הפעילה, ואופציונלית שומר את הבחירה. */
  function setActiveDifficulty(difficulty, persist) {
    el.pills.querySelectorAll('.pill').forEach((p) => {
      p.classList.toggle('is-active', p.dataset.difficulty === difficulty);
    });
    if (persist) {
      state.prefs.difficulty = difficulty;
      savePrefs();
    }
  }

  el.pills.addEventListener('click', (e) => {
    const pill = e.target.closest('.pill');
    if (!pill || state.animating) return;
    const difficulty = pill.dataset.difficulty;
    if (difficulty === state.prefs.difficulty) return;
    setActiveDifficulty(difficulty, true);
    newGame();
  });

  el.btnNew.addEventListener('click', () => {
    const g = state.game;
    if (g && !g.finished && g.moves > 3) {
      confirmAction('להתחיל חלוקה חדשה? ההתקדמות הנוכחית תימחק.', newGame);
    } else {
      newGame();
    }
  });

  function startGame() {
    clearSelection();
    state.stuckShown = false;
    closeModal(el.stuckModal);
    state.paused = false;
    el.statusbar.classList.remove('is-paused');
    el.board.style.visibility = '';
    render();
    if (!state.game.finished) {
      state.game.startTimer();
      startTimerLoop();
    } else {
      stopTimerLoop();
    }
    saveNow();

    // משחק שנטען כשכל הקלפים כבר גלויים — מסיים את עצמו מיד
    setTimeout(afterAction, 400);
  }

  /* --------------------------------------------------------------------- */
  /* מודלים והגדרות                                                         */
  /* --------------------------------------------------------------------- */

  el.btnTheme.addEventListener('click', () => {
    const order = { auto: 'light', light: 'dark', dark: 'auto' };
    state.prefs.theme = order[state.prefs.theme] || 'light';
    savePrefs();
    applyTheme();
    toast('ערכת נושא: ' + { auto: 'אוטומטי', light: 'בהיר', dark: 'כהה' }[state.prefs.theme]);
  });

  el.btnSettings.addEventListener('click', () => {
    el.settingsModal.querySelectorAll('[data-pref]').forEach((i) => {
      i.checked = !!state.prefs[i.dataset.pref];
    });
    openModal(el.settingsModal);
  });

  el.settingsModal.addEventListener('change', (e) => {
    const input = e.target.closest('[data-pref]');
    if (!input) return;
    const pref = input.dataset.pref;
    state.prefs[pref] = input.checked;
    savePrefs();

    if (pref === 'tapToMove') {
      clearSelection();
      render();
      return;
    }

    render();
  });

  el.btnWinNew.addEventListener('click', newGame);

  el.btnStuckNew.addEventListener('click', () => {
    closeModal(el.stuckModal);
    newGame();
  });

  el.btnStuckUndo.addEventListener('click', () => {
    closeModal(el.stuckModal);
    el.actions.querySelector('[data-action="undo"]').click();
  });

  el.btnConfirmOk.addEventListener('click', () => {
    const fn = state.confirmAction;
    state.confirmAction = null;
    closeModal(el.confirmModal);
    if (fn) fn();
  });

  document.querySelectorAll('[data-close-modal]').forEach((b) => {
    b.addEventListener('click', () => closeModal(b.closest('.modal')));
  });
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target === m) closeModal(m);
    });
  });

  el.btnStats.addEventListener('click', () => {
    renderStats();
    openModal(el.statsModal);
  });

  el.btnClearStats.addEventListener('click', () => {
    confirmAction('לאפס את כל הסטטיסטיקות?', () => {
      store.remove(STATS_KEY);
      renderStats();
      toast('הנתונים אופסו');
    });
  });

  function renderStats() {
    const stats = store.read(STATS_KEY, {});
    const rows = Solitaire.DIFFICULTY_ORDER.map((d) => [d, DIFF_LABELS[d]]);
    el.statsTable.innerHTML = rows
      .map(([key, name]) => {
        const r = stats[key] || { played: 0, won: 0, best: null, bestScore: 0 };
        return `<div class="stats-row">
          <span class="name">${name}</span>
          <span class="meta">${r.won} ניצחונות / ${r.played} משחקים</span>
          <span class="best">${r.best != null ? formatTime(r.best) : '—'}</span>
        </div>`;
      })
      .join('');
  }

  /* --------------------------------------------------------------------- */
  /* מקלדת                                                                  */
  /* --------------------------------------------------------------------- */

  document.addEventListener('keydown', (e) => {
    const g = state.game;
    if (!g) return;
    const t = e.target;
    if (t && typeof t.closest === 'function' && t.closest('input, textarea')) return;

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!state.paused && !g.finished) {
        clearSelection();
        g.draw();
        render();
        save();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (g.undo()) {
        clearSelection();
        render();
        save();
      }
      return;
    }
    if (e.key === 'Escape') {
      clearSelection();
      render();
      return;
    }
    if (e.key === 'a' || e.key === 'A') runAutoFinish(state.game.canAutoFinish());
    if (e.key === 'h' || e.key === 'H') showHint();
  });

  /* --------------------------------------------------------------------- */
  /* אתחול                                                                  */
  /* --------------------------------------------------------------------- */

  function init() {
    applyTheme();
    spawnConfetti();
    buildTableau();

    const saved = store.read(SAVE_KEY, null);
    const g = saved ? Solitaire.deserialize(saved) : null;
    if (g && !g.finished) {
      state.game = g;
      // ההעדפה מתיישרת לפי המשחק שנטען, לא להפך
      if (g.difficulty) state.prefs.difficulty = g.difficulty;
      setActiveDifficulty(state.prefs.difficulty, false);
      startGame();
    } else {
      setActiveDifficulty(state.prefs.difficulty || 'easy', false);
      newGame();
    }

    if (!store.ok) setTimeout(() => toast('אחסון מקומי חסום — ההתקדמות לא תישמר'), 900);
  }

  init();
})();
