// Browser UI.
// Layout: left rail (run state) · board stage with the hand on top of it · right panel (the current step).
// The step panel walks the player through a round: Roll → Result → Build & trade → … → Tribute → Shop.
// Each step shows only what is possible right now; one main button moves the game forward.
// The UI also implements the engine's `io` interface (board clicks and choice dialogs).
import { Game, COSTS, BLINDS } from './game.js';
import { RES, TERRAIN_RES, pips } from './board.js';
import { ITEMS, ITEM_LIST, BOSS_BY_ID, ROLLS_PER_ROUND, LOADING, START_SETTLEMENTS, ECHO_BREAK } from './content.js';
import { BoardView } from './board-view.js?v=32';
import { figure, faceBody, primaryTrigger } from './figures.js?v=32';
import { Feel } from './feel.js?v=32';

const TERRAIN_COLOR = { hills: '#c8734a', forest: '#3f7d4a', pasture: '#9ccf6a', fields: '#e8c547', mountains: '#8e939c', desert: '#e3d3a4' };
const RES_ICON = { brick: 'B', lumber: 'L', wool: 'W', grain: 'G', ore: 'O' };
const FACE_LABEL = { mirror: 'M', robber: 'R7', blank: '?' };
const SETTER_ITEM = { mirror: 'mirror', robber: 'robberFace', blank: 'blank' };
const TRIG_LABEL = { lucky: 'L', knightFav: 'kF', knightLucky: 'kL', robberFav: 'rF', robberLucky: 'rL', hidden: 'H' };
// The guided tutorial: each step points at a real part of the screen (a missing target gets a centred card).
const TUTORIAL = [
  { title: 'Welcome to Hex & Dice', text: 'You run one island through an endless series of rounds. Each round you roll dice to earn resources, build, and then pay a <b>tribute</b>. Pay it every time and keep upgrading your dice and island; miss one and the run is over.' },
  { sel: '#board .world', pad: -30, title: 'Your island', text: 'Every hex pays out its resource when its number is rolled, to each of your buildings touching it (settlement 1 card, city 2). More dots under a number means it comes up more often; 6 and 8 are best. You start by placing free settlements and roads on the pulsing dots.' },
  { sel: '#hand .zone:first-child', title: 'Your hand', text: 'Resources you hold sit in stacks here. Roads, settlements, cities and cards cost resources. Careful: a rolled <b>7</b> makes you discard down to 7 cards and moves the robber, which blocks a hex.' },
  { sel: '#hand .zone:nth-child(2)', title: 'Cards and guilds', text: '<b>Cards</b> are single-use: click one to pick it, then press Play. <b>Guilds</b> are permanent bonuses. You find both in the shop. Hover anything for the details.', alsoSel: '#hand .zone.guilds' },
  { sel: '#panel .act-head', title: 'A round has three steps', text: '<b>Roll</b> the dice (up to 4 rolls per round), <b>build and trade</b> between rolls, then pay the <b>tribute</b>. The three bars below show whether this is the Small, Big or Boss round of the ante. This card always shows what you can do right now, and the big button moves you on.' },
  { sel: '#tribute', title: 'The boss and the tribute', text: 'At the top: this ante\'s <b>boss</b> and its drawback. Below it, the <b>tribute</b> you must hand over at the end of the round, one bar per resource. The tribute grows every ante, and the Boss round also needs three different resource types.' },
  { sel: '#panel .dice-stage', fallback: '#panel .panel-body', title: 'The dice', text: 'You roll two dice. The total decides which hexes pay. Drag a die to spin it and see every face; click it for a list of its faces and upgrades. Upgrading faces is how you bend the odds.' },
  { sel: '.vp-zone', alsoSel: '.stat-zone', title: 'Score and titles', text: '<b>Score</b> is your victory points: settlements 1, cities 2, VP cards, plus bonus for the <b>longest road</b> and the <b>largest army</b> (the two small cards, hover them for details). Unused rolls add VP too.' },
  { title: 'The shop', text: 'After the tribute is paid, whatever VP you have becomes your <b>shop budget</b> (unspent VP is lost). Buy upgrades for your dice faces, number tokens, hexes and ports, plus cards and guilds. Then the next round starts, and it is harder. Good luck!' },
];

const MOD_INFO = {
  nudge: ['Nudge', 'Change this die by ±1 (once per round).'],
  recast: ['Recast', 'Reroll this die (once per round).'],
  alchemist: ['Alchemist', 'Set this die to any value (once per round).'],
  twin: ['Twin Die · reroll', 'Reroll this die instead of keeping its result. Once per round, and the new result is final: there is no going back. To keep the current result, just use the roll.'],
};
const CAT_LABEL = { face: 'Dice · face', die: 'Dice · whole die', token: 'Field · number token', hex: 'Field · hex', port: 'Field · port', classic: 'Card · single use', edict: 'Edict · single use', guild: 'Guild · always on', charter: 'Charter · instant' };
const PRE_ROLL_CARDS = ['bumper', 'omen', 'monopoly'];
const STEPS = [['roll', 'Roll'], ['build', 'Build & trade'], ['tribute', 'Tribute']]; // the result of a roll is part of the Roll step
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const resDot = (r) => `<span class="res-dot" style="background:var(--${r})"></span>`;
const HL_MS = 3600; // how long a roll's highlights (pulses, +1 badges) stay lit
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Printed things sit a little off-axis. The tilt is steady: the same card always leans the same way.
const hs = (str) => [...String(str)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
const tilt = (n, amp) => { const r = Math.sin(n * 127.1 + 311.7) * 43758.5453; return +((r - Math.floor(r) - 0.5) * 2 * amp).toFixed(2); };

// Halftone art is printed straight onto the card stock: one cell of the 5 × 4 art sheet per subject.
const ART_CELL = { brick: 13, lumber: 14, wool: 15, grain: 16, ore: 17 };
const artPos = (i) => `${((i % 5) * 100) / 4}% ${(Math.floor(i / 5) * 100) / 3}%`;
const rcard = (r, cls = '', style = '') => `<div class="rcard ${cls}" style="--c:var(--${r});${style}"><i class="dot"></i><span class="art" style="background-position:${artPos(ART_CELL[r])}"></span><span class="nm">${cap(r)}</span></div>`;
// Art for the cards you hold, by item (falls back to the category).
const CARD_ART = { knight: 5, marshal: 5, cartographer: 4, roadBuilding: 4, townCharter: 4, royalCharter: 3, vpCard: 3, forgery: 3, yearOfPlenty: 8, monopoly: 12, granary: 8, mathematicians: 0, twinFortune: 1, longShot: 0, firePriests: 9, squatters: 4, monoculture: 6, deepPockets: 3, guildExpansion: 3, highwayCharter: 4, lostFound: 3, taxCollector: 3, robbersFriend: 5, moneylender: 3, tradeConsul: 3 };
const CAT_ART = { classic: 5, edict: 11, guild: 3, charter: 3, face: 0, die: 1, token: 0, hex: 7, port: 3 };
const CAT_DOT = { classic: '#d4a845', edict: '#a8b872', guild: '#8494ad', charter: '#b5593f' };
const CAT_SHORT = { classic: 'Card', edict: 'Edict', guild: 'Guild', charter: 'Charter' };
// A die face drawn as a face: pips for numbers, the special marks for mirror / robber / blank faces.
const PIP_AT = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]] };
const svgUrl = (body) => `url('data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>${body}</svg>`).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29')}')`;
// Triggers other than the one whose symbol is drawn on the face get a short label in the corner.
const extraTrg = (f) => { const p = f.setter ? null : primaryTrigger(f.triggers); return [...new Set(f.triggers)].filter((t) => t !== p).map((t) => TRIG_LABEL[t]).join(''); };
const faceArt = (f, loaded) => {
  const tone = loaded ? '#e6cf8c' : '#e9e4d6';
  let bg = tone, inner = '';
  if (f.setter === 'mirror') bg = `${svgUrl("<circle cx='50' cy='50' r='27' fill='#e9e4d6'/><circle cx='50' cy='50' r='17' fill='#17181b'/>")} center/100% 100% no-repeat, #17181b`;
  else if (f.setter === 'robber') { bg = '#17181b'; inner = '<span class="lbl">R</span>'; }
  else if (f.setter === 'blank') { bg = '#17181b'; inner = '<span class="lbl">?</span>'; }
  else if (f.triggers.length) bg = `${svgUrl(faceBody(f.value, f.triggers))} center/100% 100% no-repeat, ${tone}`;
  else bg = `${svgUrl(PIP_AT[f.value].map((q) => `<circle cx='${q[0]}' cy='${q[1]}' r='8.5' fill='#17181b'/>`).join(''))} center/100% 100% no-repeat, ${tone}`;
  const ex = f.triggers.length ? extraTrg(f) : '';
  const marks = ex ? `<i class="trg">${ex}</i>` : '';
  return `<span class="fa" style="background:${bg}">${inner}${marks}</span>`;
};
const UPGRADE_CATS = ['face', 'die', 'token', 'hex', 'port'];
const cardArt = (it) => artPos(CARD_ART[it.id] ?? CAT_ART[it.cat] ?? 3);

export class UI {
  constructor() {
    this.game = null;
    this.busy = false;
    this.boardReq = null;
    this.modal = null; // a pending choice from the engine
    this.dialog = null; // help / new run
    this.drawer = null; // 'log' | 'dev'
    this.tributeTypes = null;
    this.tradeGive = null;
    this.hoverCost = null;
    this.preBuild = false;
    this.tips = new Map(); // detail cards registered during the latest render, by key
    this.tipKey = null; // the detail card on screen
    this.pinnedTip = null; // a detail card opened by click stays until clicked again
    this.hlReport = null; // the roll report whose highlights are running
    this.hlStart = 0;
    this.hlMap = new Map(); // change key → highlight for that element
    this.$tip = document.createElement('div');
    this.$tip.className = 'card-tip';
    this.$tip.hidden = true;
    document.body.appendChild(this.$tip);
    this.dieSheet = null; // which die's face sheet is open (0 | 1 | null)
    this.$board = document.getElementById('board');
    this.view = new BoardView(this.$board);
    this.$prompt = document.getElementById('prompt');
    this.$overlay = document.getElementById('overlay');
    this.$panel = document.getElementById('panel');
    this.$hand = document.getElementById('hand');
    this.$hud = document.getElementById('hud');
    this.$stage = document.getElementById('stage');
    this.$tribute = document.getElementById('tribute');
    this.feel = new Feel({ board: this.$board, lamp: this.$stage.querySelector('.lamp') });
    this.shown = null; // what the last render showed, so changes can count up and drop in
    this.logSeen = 0;
    this.prevPhase = null;
    this.payout = null; // the roll payout whose drop-in animation is running
    this.stamp = null; // a "tribute paid" moment
    this.selCard = null;
    this.spin = [null, null]; // how far the player has turned each die by hand
    this.drag = null;
    this.tipsOpen = false;
    this.tipsSeen = false;
    this.tutSeen = false;
    this.tut = null;
    try { this.tutSeen = localStorage.getItem('hd-tutorial') === 'seen'; } catch { /* storage can be blocked */ }
    try { this.tipsSeen = localStorage.getItem('hd-tips') === 'seen'; } catch { /* storage can be blocked */ }
    this.$drawer = document.getElementById('drawer');
    this.$modal = document.getElementById('modal-root');
    this.bindEvents();
  }

  // ---------------------------------------------------------------- lifecycle
  newGame(seed) {
    Object.assign(this, { boardReq: null, modal: null, dialog: null, busy: false, tributeTypes: null, tradeGive: null, preBuild: false, shown: null, logSeen: 0, prevPhase: null, payout: null, stamp: null });
    this.feel.tw.clear();
    const g = new Game({ seed, io: this });
    this.game = g;
    g.onChange = () => this.render();
    try {
      const url = new URL(location.href);
      url.searchParams.set('seed', g.seed);
      history.replaceState(null, '', url);
    } catch { /* sandboxed frames may refuse URL changes */ }
    this.run(() => g.start());
  }

  async run(fn) {
    if (this.busy) return;
    this.busy = true;
    this.render();
    try {
      await fn();
    } catch (e) {
      console.error(e);
      this.game?.log(`Error: ${e.message}`, 'bad');
    } finally {
      this.busy = false;
      this.render();
    }
  }

  // ---------------------------------------------------------------- io interface
  requestBoard(kind, ids, prompt, opts = {}) {
    if (!ids || !ids.length) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.boardReq = { kind, ids: new Set(ids), prompt, cancel: opts.cancel !== false, resolve };
      this.render();
    });
  }
  chooseVertex(ids, p, o) { return this.requestBoard('vertex', ids, p, o); }
  chooseEdge(ids, p, o) { return this.requestBoard('edge', ids, p, o); }
  chooseHex(ids, p, o) { return this.requestBoard('hex', ids, p, o); }
  choosePort(ids, p, o) { return this.requestBoard('port', ids, p, o); }
  openModal(m) {
    return new Promise((resolve) => {
      this.modal = { ...m, resolve };
      this.render();
    });
  }
  chooseOption(options, prompt, o = {}) { return this.openModal({ type: 'options', options, prompt, cancel: !!o.cancel }); }
  chooseFace(options, prompt, o = {}) { return this.openModal({ type: 'face', options, prompt, cancel: !!o.cancel }); }
  chooseResources(n, prompt, o = {}) {
    return this.openModal({ type: 'resources', n, prompt, cancel: !!o.cancel, max: o.max || null, counts: Object.fromEntries(RES.map((r) => [r, 0])) });
  }
  discard(n, prompt, o = {}) {
    return this.openModal({ type: 'resources', n, prompt, cancel: false, max: o.max, counts: Object.fromEntries(RES.map((r) => [r, 0])), discard: true });
  }
  resolveModal(value) {
    const m = this.modal;
    this.modal = null;
    m?.resolve(value);
    this.render();
  }
  resolveBoard(value) {
    const b = this.boardReq;
    this.boardReq = null;
    b?.resolve(value);
    this.render();
  }

  // ---------------------------------------------------------------- which step is shown
  step() {
    const g = this.game;
    if (!g || g.phase === 'init' || g.phase === 'setup') return 'setup';
    if (g.phase !== 'turn') return g.phase; // tribute | shop | gameover
    if (g.pendingRoll) return 'adjust';
    if (g.report && g.report.stage === 'result' && !g.report.seen) return 'result';
    if (g.rollsUsed === 0 && !g.echoQueue.length && !this.preBuild) return 'roll';
    return 'build';
  }

  // ---------------------------------------------------------------- events
  bindEvents() {
    document.addEventListener('click', (ev) => {
      const t = ev.target.closest('[data-top]');
      if (t) return this.onTop(t.dataset.top);
      const a = ev.target.closest('[data-a]');
      if (a && !a.disabled) this.onAction(a.dataset.a, a.dataset);
    });
    // Detail cards: hover shows one, click keeps it open (buttons keep their own clicks).
    document.addEventListener('pointerover', (ev) => {
      const pf = ev.target.closest?.('[data-a="pick-face"]');
      if (pf) this.pickPreview(`${pf.dataset.die}-${pf.dataset.face}`);
      if (this.pinnedTip) return;
      const el = ev.target.closest?.('[data-tip]');
      if (el && el.dataset.tip !== this.tipKey) this.openTip(el.dataset.tip, el);
    });
    document.addEventListener('pointerout', (ev) => {
      if (ev.target.closest?.('[data-a="pick-face"]') && !ev.relatedTarget?.closest?.('[data-a="pick-face"]')) this.pickPreview(null);
      if (this.pinnedTip) return;
      if (!ev.relatedTarget?.closest?.('[data-tip]')) this.hideTip();
    });
    document.addEventListener('click', (ev) => {
      if (ev.target.closest('button, [data-a], [data-top]')) return;
      const el = ev.target.closest('[data-tip]');
      if (el) {
        if (this.pinnedTip === el.dataset.tip) this.unpinTip();
        else this.pinTip(el.dataset.tip, el);
      } else if (this.pinnedTip) this.unpinTip();
    });
    this.$board.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-k]');
      if (!el || !this.boardReq) return;
      const id = Number(el.dataset.id);
      if (el.dataset.k === this.boardReq.kind && this.boardReq.ids.has(id)) this.resolveBoard(id);
    });
    // Turn a die by hand: drag it. A drag never counts as a click, so it does not open the face sheet.
    document.addEventListener('pointerdown', (ev) => {
      const d = ev.target.closest?.('.die3d[data-cube]');
      if (!d || ev.button > 0) return;
      const i = Number(d.dataset.cube);
      this.drag = { i, x: ev.clientX, y: ev.clientY, moved: false, rx: this.spin[i]?.[0] ?? 0, ry: this.spin[i]?.[1] ?? 0 };
    });
    document.addEventListener('pointermove', (ev) => {
      const dr = this.drag;
      if (!dr) return;
      const dx = ev.clientX - dr.x, dy = ev.clientY - dr.y;
      if (!dr.moved && Math.hypot(dx, dy) < 5) return;
      dr.moved = true;
      this.spin[dr.i] = [dr.rx - dy * 0.7, dr.ry + dx * 0.7];
      const cube = document.querySelector(`.die3d[data-cube="${dr.i}"] .cube`);
      if (cube) { cube.style.transition = 'none'; cube.style.animation = 'none'; cube.style.transform = `rotateX(${this.spin[dr.i][0]}deg) rotateY(${this.spin[dr.i][1]}deg) ${cube.style.getPropertyValue('--final')}`; }
    });
    const endDrag = () => { if (this.drag?.moved) { this.dragMoved = true; setTimeout(() => { this.dragMoved = false; }, 0); } this.drag = null; };
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
    document.addEventListener('dblclick', (ev) => {
      const d = ev.target.closest?.('.die3d[data-cube]');
      if (d) { this.spin[Number(d.dataset.cube)] = null; this.render(); }
    });
    // A picked card is put back when you click anywhere else.
    document.addEventListener('click', (ev) => {
      if (this.selCard != null && !ev.target.closest('.slot-wrap')) { this.selCard = null; this.render(); }
    });
    // The ? tips popover closes when you click anywhere else.
    document.addEventListener('click', (ev) => {
      if (this.tipsOpen && !ev.target.closest('.tips-pop, .tip-btn')) { this.tipsOpen = false; this.render(); }
    });
    const mb = document.getElementById('menu-btn');
    const mp = document.getElementById('menu-pop');
    this.setMenu = (open) => { mp.hidden = !open; mb.setAttribute('aria-expanded', String(open)); };
    mb.addEventListener('click', (ev) => { ev.stopPropagation(); this.setMenu(mp.hidden); });
    document.addEventListener('click', (ev) => { if (!mp.hidden && (!ev.target.closest('.menu') || ev.target.closest('[data-top]'))) this.setMenu(false); });
    const sw = document.getElementById('opt-shake');
    if (sw) {
      sw.checked = this.feel.shakeOn;
      sw.disabled = this.feel.reduced;
      if (this.feel.reduced) sw.parentElement.title = 'Off: your system asks for reduced motion';
      sw.addEventListener('change', () => this.feel.setShake(sw.checked));
    }
    // Hovering a build option highlights the cards it would use in the hand.
    this.$panel.addEventListener('mouseover', (ev) => {
      const el = ev.target.closest('[data-cost]');
      const cost = el ? COSTS[el.dataset.cost] : null;
      if (cost !== this.hoverCost) { this.hoverCost = cost; this.renderHand(); }
    });
    this.$panel.addEventListener('mouseleave', () => { if (this.hoverCost) { this.hoverCost = null; this.renderHand(); } });
    document.addEventListener('keydown', (ev) => {
      if (ev.target.matches('input, select')) {
        if (ev.key === 'Enter' && ev.target.id === 'new-seed') this.onAction('start-seed', {});
        return;
      }
      if (this.tut) {
        if (ev.key === 'Escape') this.endTutorial();
        else if (ev.key === 'ArrowRight' || ev.key === 'Enter') this.tutStep(1);
        else if (ev.key === 'ArrowLeft') this.tutStep(-1);
        ev.preventDefault();
        return;
      }
      if (ev.key === 'Escape') {
        if (!document.getElementById('menu-pop').hidden) this.setMenu(false);
        else if (this.selCard != null) { this.selCard = null; this.render(); }
        else if (this.tipsOpen) { this.tipsOpen = false; this.render(); }
        else if (this.dieSheet != null) { this.dieSheet = null; this.render(); }
        else if (this.pinnedTip) this.unpinTip();
        else if (this.boardReq?.cancel) this.resolveBoard(null);
        else if (this.modal?.cancel) this.resolveModal(null);
        else if (this.dialog) { this.dialog = null; this.render(); }
        else if (this.drawer) { this.drawer = null; this.render(); }
        return;
      }
      if (this.busy || this.modal || this.dialog || this.boardReq) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        const btn = this.$panel.querySelector('[data-primary]:not([disabled])');
        if (btn) { ev.preventDefault(); btn.click(); }
      }
    });
  }

  onTop(k) {
    if (k === 'new') this.dialog = 'new';
    if (k === 'help') this.dialog = 'help';
    if (k === 'tutorial') return this.startTutorial();
    if (k === 'log' || k === 'dev') this.drawer = this.drawer === k ? null : k;
    this.render();
    if (k === 'new') setTimeout(() => document.getElementById('new-seed')?.focus(), 0);
  }

  onAction(a, d) {
    if (a === 'tips') {
      this.tipsOpen = !this.tipsOpen;
      this.tipsSeen = true;
      try { localStorage.setItem('hd-tips', 'seen'); } catch { /* ignore */ }
      return this.render();
    }
    if (a === 'pick-card') { this.selCard = this.selCard === Number(d.uid) ? null : Number(d.uid); this.tipsOpen = false; return this.render(); }
    this.selCard = null;
    this.tipsOpen = false;
    if (a !== 'die-sheet' && a !== 'die-open') this.dieSheet = null;
    if ((a === 'die-sheet' || a === 'pick-face') && this.dragMoved) return;
    if (a === 'pick-face') {
      const m = this.modal;
      const opt = m?.type === 'face' ? m.options.find((o) => o.die === Number(d.die) && o.face === Number(d.face)) : null;
      return opt ? this.resolveModal(opt) : undefined;
    }
    if (a === 'die-sheet') { this.dieSheet = this.dieSheet === Number(d.die) ? null : Number(d.die); return this.render(); }
    if (a === 'die-open') { this.dieSheet = Number(d.die); return this.render(); }
    if (a === 'die-close') return this.render();
    const g = this.game;
    switch (a) {
      // dialogs & choices
      case 'opt': return this.resolveModal(this.modal.options[Number(d.i)].value);
      case 'face': return this.resolveModal(this.modal.options[Number(d.i)]);
      case 'cancel-modal': return this.resolveModal(null);
      case 'cancel-board': return this.resolveBoard(null);
      case 'close-dialog': this.dialog = null; return this.render();
      case 'close-drawer': this.drawer = null; return this.render();
      case 'drawer-tab': this.drawer = d.tab; return this.render();
      case 'res-inc': case 'res-dec': {
        const m = this.modal;
        const total = RES.reduce((s, r) => s + m.counts[r], 0);
        if (a === 'res-inc' && total < m.n && (!m.max || m.counts[d.r] < m.max[d.r])) m.counts[d.r]++;
        if (a === 'res-dec' && m.counts[d.r] > 0) m.counts[d.r]--;
        return this.render();
      }
      case 'res-ok': return this.resolveModal({ ...this.modal.counts });
      case 'random-seed': this.dialog = null; return this.newGame(Math.floor(Math.random() * 1e9));
      case 'start-seed': {
        const v = Number(document.getElementById('new-seed')?.value);
        this.dialog = null;
        return this.newGame(v || Math.floor(Math.random() * 1e9));
      }
      // turn flow
      case 'roll': this.preBuild = false; return this.run(() => g.roll());
      case 'resolve': return this.run(() => g.resolveRoll());
      case 'tutorial': return this.startTutorial();
      case 'tut-next': return this.tutStep(1);
      case 'tut-back': return this.tutStep(-1);
      case 'tut-end': return this.endTutorial();
      case 'mod': return this.run(() => g.useModifier(Number(d.die), d.id));
      case 'seen': if (g.report) g.report.seen = true; return this.render();
      case 'prebuild': this.preBuild = true; return this.render();
      case 'end': this.preBuild = false; this.tradeGive = null; g.endRound(); return;
      case 'build': this.hoverCost = null; return this.run(() => g.build(d.kind));
      case 'play': return this.run(() => g.playCard(Number(d.uid)));
      case 'give': this.tradeGive = this.tradeGive === d.r ? null : d.r; return this.render();
      case 'get': {
        if (!this.tradeGive) return;
        g.trade(this.tradeGive, d.r);
        if (g.hand[this.tradeGive] < g.tradeRate(this.tradeGive)) this.tradeGive = null;
        return this.render();
      }
      case 'ship': g.ship(Number(d.port), d.r, d.mode); return;
      case 'ship-mixed': return this.run(() => g.shipMixed(Number(d.port)));
      // tribute
      case 'tpick': this.tributeTypes[Number(d.i)] = d.r; return this.render();
      case 'pay': if (g.payTribute(this.tributeTypes)) this.tributeTypes = null; return;
      case 'fail': g.failTribute(); return;
      // shop
      case 'buy': return this.run(() => g.buy(Number(d.i)));
      case 'reroll': g.rerollShop(); return;
      case 'reroll-boss': g.rerollBoss(); return;
      case 'leave': g.leaveShop(); return;
      // game over
      case 'again': return this.newGame(g.seed);
      case 'fresh': return this.newGame(Math.floor(Math.random() * 1e9));
      // dev
      case 'dev-res': g.devGive(d.r, Number(d.n)); return;
      case 'dev-budget': g.devBudget(10); return;
      case 'dev-force': {
        g.devForce = [Number(document.getElementById('dev-d1').value), Number(document.getElementById('dev-d2').value)];
        g.log(`Dev: next roll forced to ${g.devForce.join('+')}.`);
        return this.render();
      }
      case 'dev-item': {
        const id = document.getElementById('dev-item').value;
        return this.run(() => g.devItem(id));
      }
      case 'dev-shop': if (g.phase === 'turn' && !g.pendingRoll) { g.earned.unusedRolls = 0; g.finishTribute(true); } return;
    }
  }

  // ---------------------------------------------------------------- render
  render() {
    const g = this.game;
    if (!g || !g.board) { this.renderModal(); return; }
    this.tips = new Map();
    this.syncHighlights();
    this.detectMoments();
    this.renderTribute();
    this.renderBoard();
    this.renderPrompt();
    this.renderOverlay();
    this.renderPanel();
    this.renderHand();
    this.renderMood();
    this.renderDrawer();
    this.renderModal();
    this.refreshTip();
  }

  // ---------------------------------------------------------------- moments (drops, counting, shake)
  later(fn, ms) { setTimeout(fn, Math.max(0, ms)); }

  // Milliseconds until the dice of the current roll have landed (0 when none is tumbling).
  landIn() {
    const g = this.game;
    if (!(g.rollSeq > 0)) return 0;
    if (g.rollSeq !== this.seenSeq) return 880;
    return Math.max(0, 880 - (performance.now() - (this.rollStart || 0)));
  }

  // Runs once per render, before anything is drawn: spots what just happened and starts the matching effects.
  detectMoments() {
    const g = this.game;
    const now = performance.now();
    const land = this.landIn();

    // heavy hits from the log: the boss, the robber, a building lost
    const lines = g.logLines || [];
    if (this.logSeen > lines.length) this.logSeen = lines.length;
    let hit = 0;
    for (const l of lines.slice(this.logSeen)) {
      const bad = /\bbad\b/.test(l.cls || '');
      if (/burn|raze|sack|destroyed by lava/i.test(l.msg) || /^Tribute failed/.test(l.msg)) hit = 3;
      else if (bad && (g.blind === 2 || /robber|Discarded|Barbarian|ERUPTION/i.test(l.msg))) hit = Math.max(hit, 2);
      else if (bad) hit = Math.max(hit, 1);
    }
    this.logSeen = lines.length;
    if (hit) this.later(() => this.feel.hit(hit, 'bad'), land + 200);

    // the tribute is paid, or a boss round begins
    if (this.prevPhase === 'tribute' && g.phase === 'shop') {
      const boss = g.blind === 2;
      this.stamp = { start: now + 120, hold: now + (boss ? 2000 : 1400), boss }; // the shop opens after the stamp has landed
      this.later(() => this.feel.hit(boss ? 3 : 2, 'good'), 280);
      this.later(() => this.render(), (boss ? 2000 : 1400) + 30);
    } else if (this.prevPhase === 'shop' && g.phase === 'turn' && g.blind === 2) {
      this.later(() => this.feel.hit(2, 'bad'), 200);
    }
    this.prevPhase = g.phase;

    // numbers that change count up (cards in hand, score); a roll's payout waits for the dice to land
    const cur = { vp: g.vpBreakdown().total };
    for (const r of RES) cur[`hand-${r}`] = g.hand[r];
    const fresh = this.payout?.fresh;
    if (this.payout) this.payout.fresh = false;
    if (this.shown) {
      for (const [k, v] of Object.entries(cur)) {
        const old = this.shown[k];
        if (v > old) {
          const from = this.feel.value(k, old);
          if (fresh) {
            const gain = v - old;
            this.feel.count(k, from, v, k === 'vp' ? land + 560 : land + 330, k === 'vp' ? 360 + 110 * gain : 220 + 80 * gain);
          } else this.feel.count(k, from, v, 0, 380);
        } else if (v < old) this.feel.tw.delete(k);
      }
    }
    this.shown = cur;
  }

  // ---------------------------------------------------------------- roll highlights
  // A roll's report gets `changes` when it resolves; that starts the highlight clock.
  syncHighlights() {
    const rep = this.game.report;
    const key = rep && rep.changes ? rep : null;
    if (key === this.hlReport) return;
    this.hlReport = key;
    const land = key ? this.landIn() : 0;
    this.hlStart = performance.now() + land; // pulses and +n badges wait for the dice to land
    this.hlMap = new Map();
    this.payout = null;
    if (!key) return;
    for (const c of key.changes) this.hlMap.set(c.key, c);
    // The payout lands when the dice do: cards drop in, VP counts up, and a big one shakes the table.
    this.payout = { start: this.hlStart, until: this.hlStart + 1800, land, fresh: true };
    const cards = RES.reduce((n, r) => n + Math.max(0, this.hlMap.get(`hand:${r}`)?.delta || 0), 0);
    const vpGain = Math.max(0, this.hlMap.get('vp')?.delta || 0);
    const level = cards >= 10 || vpGain >= 4 ? 2 : cards >= 6 || vpGain >= 2 ? 1 : 0;
    if (level) this.later(() => this.feel.hit(level, 'good'), land + 360);
    for (const f of key.fired || []) {
      this.hlMap.set(`face:${f.die}:${f.face}`, { key: '', badge: '!' });
      this.hlMap.set(`die:${f.die}`, { key: '', badge: '!' });
    }
  }

  // Pulses every element the latest roll changed or fired, with a +n badge. Runs after the hand renders.
  applyHighlights() {
    const el = performance.now() - this.hlStart;
    if (!this.hlMap.size || el > HL_MS) return;
    const hd = `${-Math.round(el)}ms`;
    for (const node of document.querySelectorAll('[data-hl]')) {
      const hit = node.dataset.hl.split(' ').map((k) => this.hlMap.get(k)).find(Boolean);
      if (!hit) continue;
      node.classList.add('hl');
      node.style.setProperty('--hd', hd);
      if (node.querySelector(':scope > .delta')) continue;
      const b = document.createElement('i');
      let text = hit.badge ?? (hit.key.startsWith('card:') ? 'New' : `${hit.delta > 0 ? '+' : ''}${hit.delta}`);
      if (hit.key === 'vp') text += ' VP';
      b.className = `delta${hit.badge ? ' bang' : ''}`;
      b.textContent = text;
      b.style.setProperty('--hd', hd);
      node.appendChild(b);
    }
  }

  // ---------------------------------------------------------------- detail cards (hover, or click to keep open)
  // Registers a detail card for an element; returns the attribute that opens it.
  tipAttr(key, info) {
    this.tips.set(key, info);
    return `data-tip="${esc(key)}"`;
  }

  setRoadHl(on) {
    if (!!this.hlRoad === on) return;
    this.hlRoad = on;
    this.renderBoard();
  }

  openTip(key, el) {
    this.setRoadHl(key === 'stat:road');
    this.tipKey = key;
    this.$tip.hidden = false;
    this.fillTip(key, el);
  }

  fillTip(key, el) {
    const info = this.tips.get(key);
    if (!info || !el) { this.hideTip(); return; }
    const pinned = this.pinnedTip === key;
    this.$tip.classList.toggle('pinned', pinned);
    this.$tip.innerHTML = `${info.fig ? `<div class="tip-fig">${[].concat(info.fig).map((f) => figure(f, 0.7)).join('')}</div>` : ''}<div class="tip-kind">${esc(info.kind)}</div><div class="tip-title">${esc(info.title)}</div>
      ${info.desc ? `<p>${esc(info.desc)}</p>` : ''}
      ${info.now ? `<div class="tip-now">${esc(info.now)}</div>` : ''}
      ${info.lines && info.lines.length ? `<ul>${info.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}
      <div class="tip-hint">${pinned ? 'Click again to close' : 'Click to keep this open'}</div>`;
    const r = el.getBoundingClientRect();
    const w = this.$tip.offsetWidth;
    const h = this.$tip.offsetHeight;
    let top = r.top - h - 10;
    if (top < 8) top = r.bottom + 10;
    top = Math.max(8, Math.min(top, innerHeight - h - 8));
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8));
    this.$tip.style.left = `${left}px`;
    this.$tip.style.top = `${top}px`;
  }

  hideTip() {
    this.setRoadHl(false);
    this.tipKey = null;
    this.$tip.hidden = true;
  }

  pinTip(key, el) { this.pinnedTip = key; this.openTip(key, el); }
  unpinTip() { this.pinnedTip = null; this.hideTip(); }

  // Keeps an open detail card in step with re-renders, or closes it when its element is gone.
  refreshTip() {
    if (!this.tipKey) return;
    const el = document.querySelector(`[data-tip="${CSS.escape(this.tipKey)}"]`);
    if (!el || !this.tips.has(this.tipKey)) { this.pinnedTip = null; this.hideTip(); return; }
    this.fillTip(this.tipKey, el);
  }

  // ---------------------------------------------------------------- run card: ante, tribute and boss in one plaque
  // Which round the tribute below belongs to: the ante and the round you are in.
  anteRow() {
    const g = this.game;
    return `<div class="ante"><b>Ante ${g.ante}</b><span class="rnd ${g.blind === 2 && g.phase !== 'shop' ? 'boss' : ''}">${BLINDS[g.blind]} round</span><span class="surv" title="Rounds survived this run">${g.roundsSurvived} survived</span></div>`;
  }

  // Small / Big / Boss of the current ante, shown under the step flow in the action card.
  roundSegs() {
    const g = this.game;
    return `<span class="segs" title="The three rounds of ante ${g.ante}">${BLINDS.map((b, i) => `<span class="${i < g.blind || (g.phase === 'shop' && i === g.blind) ? 'done' : i === g.blind ? 'on' : ''}">${b}</span>`).join('')}</span>`;
  }

  // The boss of this round, or the next one while you shop.
  bossRow() {
    const g = this.game;
    if (!g.boss) return '';
    const bossNow = g.blind === 2 && g.phase !== 'shop';
    const boss = g.phase === 'shop' && g.blind === 2 ? BOSS_BY_ID[g.nextBossId] : g.boss;
    return `<div class="boss-row"><div class="name" ${this.tipAttr('boss', { kind: bossNow ? 'Boss · active' : 'Boss', title: boss.name, desc: boss.desc })}>${boss.name}<span class="eyebrow">${bossNow ? 'Boss this round' : g.phase === 'shop' && g.blind === 2 ? 'Next boss' : 'Boss of this ante'}</span></div><p>${boss.desc}</p></div>`;
  }

  // The tribute hangs over the board: what is due at the end of this round, and how close the hand is.
  renderTribute() {
    const g = this.game;
    const el = this.$tribute;
    if (g.phase === 'gameover' || !g.tribute) { el.hidden = true; return; }
    el.hidden = false;
    const boss = g.blind === 2 && g.phase !== 'shop';
    el.classList.toggle('boss', boss);
    if (g.phase === 'shop') {
      const st = this.stamp && performance.now() - this.stamp.start < 2600 ? this.stamp : null;
      const bossDown = g.blind === 2;
      el.innerHTML = `${this.bossRow()}${this.anteRow()}<div class="trib-head"><span class="eyebrow">${BLINDS[g.blind]} tribute</span></div>
        <div class="paid ${bossDown ? 'boss' : ''} ${st ? 'slam' : ''}" ${st ? `style="animation-delay:${-Math.round(performance.now() - st.start)}ms"` : ''}><b>Paid</b><span>${bossDown ? 'The boss is beaten.' : 'Spend your VP in the shop.'}</span></div>`;
      return;
    }
    const due = g.tributeDue();
    const assign = g.autoAssign();
    const ok = assign != null;
    const lines = [];
    const parts = due.map((p, i) => {
      const t = p.type || (ok ? assign[i] : null);
      const base = g.tribute[i] ? g.tribute[i].amount : p.amount;
      const why = [`${base} base`];
      if (i === 0 && g.oldBootExtra) why.push(`+${g.oldBootExtra} The Old Boot (dead rolls)`);
      if (p.amount < base + (i === 0 ? g.oldBootExtra : 0)) why.push(`−${base + (i === 0 ? g.oldBootExtra : 0) - p.amount} reductions`);
      lines.push(`${p.type ? cap(p.type) : 'Any type'}: ${p.amount} (${why.join(' ')})`);
      const have = t ? g.available(t) : Math.max(...RES.map((r) => g.available(r)));
      const pct = Math.min(100, Math.round((Math.min(have, p.amount) / p.amount) * 100));
      return `<div class="tpart"><div class="t-row">${t ? resDot(t) : '<span class="res-dot" style="background:var(--dim)"></span>'}<span>${t ? cap(t) : 'Any type'}</span><span class="have">${Math.min(have, p.amount)}<span> / ${p.amount}</span></span></div><div class="bar ${pct >= 100 ? 'full' : ''}"><i style="width:${pct}%;--c:${t ? `var(--${t})` : 'var(--muted)'}"></i></div></div>`;
    }).join('');
    const state = g.phase === 'setup' ? '' : ok ? '<b class="ok">Ready to pay</b>' : '<b class="no">Not yet</b>';
    el.innerHTML = `<div class="trib-head" ${this.tipAttr('tribute', { kind: 'Tribute', title: 'Due at round end', desc: 'Each part needs a different resource type. Storehouse cards count first, then your hand.', lines })}><span class="eyebrow">${BLINDS[g.blind]} tribute · due at round end</span>${state}</div><div class="trib-parts">${parts}</div>`;
    el.innerHTML = this.bossRow() + this.anteRow() + el.innerHTML;
  }

  // The score: a big number at the far right of the hand row.
  vpBig() {
    const g = this.game;
    const vp = g.vpBreakdown();
    const info = { kind: 'Score', title: `${vp.total} VP`, desc: 'Your score this round. Whatever you hold when the tribute is paid becomes your shop budget.', lines: [`Settlements ${vp.settlements} · Cities ${vp.cities}`, `VP cards ${vp.vpCards}`, `Longest road ${vp.road} (length ${vp.longestRoad})`, `Army ${vp.army} (${g.knights} knights)`] };
    const digits = String(vp.total).length;
    return `<section class="zone vp-zone" data-hl="vp" ${this.tipAttr('score', info)}><div class="zone-h">Score</div><div class="vp-body d${Math.min(digits, 4)}"><div class="num"><span data-ck="vp">${this.feel.value('vp', vp.total)}</span><small>VP</small></div></div></section>`;
  }

  // Rolls left, shown inside the roll buttons.
  rollsLeft() {
    const left = ROLLS_PER_ROUND - this.game.rollsUsed;
    return `<span class="rl" title="Rolls left this round">${Array.from({ length: ROLLS_PER_ROUND }, (_, i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('')}<b>${left} left</b></span>`;
  }

  // The ? button that opens the tips for the current step; it sits next to the secondary button at the bottom of the card.
  tipBtn() {
    return this._tip ? `<button class="tip-btn ${this.tipsOpen ? 'on' : ''} ${this.tipsSeen ? '' : 'new'}" data-a="tips" aria-expanded="${this.tipsOpen}" title="How this step works">?</button>` : '';
  }

  // Top of the action card: which step of the round you are on, and which of the ante's three rounds this is.
  actHead(step) {
    if (step === 'gameover') return '';
    let stepper = '';
    if (step === 'setup') stepper = `<nav class="stepper" aria-label="Round steps">${STEPS.map(([, l]) => `<span>${l}</span>`).join('')}</nav>`;
    else if (['roll', 'adjust', 'result', 'build', 'tribute'].includes(step)) {
      const current = step === 'adjust' || step === 'result' ? 'roll' : step;
      const idx = STEPS.findIndex(([k]) => k === current);
      stepper = `<nav class="stepper" aria-label="Round steps">${STEPS.map(([k, l], i) => `<span class="${i === idx ? 'on' : i < idx ? 'done' : ''}">${l}</span>`).join('')}</nav>`;
    }
    return `<div class="act-head">${stepper}${this.roundSegs()}</div>`;
  }

  // Active round effects: [label, 'bad' | 'good' | '', tooltip]
  effects() {
    const g = this.game;
    if (g.phase !== 'turn' && g.phase !== 'tribute') return [];
    const fx = [];
    if (g.oldBootExtra) fx.push([`Old Boot +${g.oldBootExtra}`, 'bad', 'The Old Boot: every roll that produces nothing for you adds 1 to the tribute.', 'oldBoot']);
    if (g.bossIs('barbarians')) fx.push([`Fleet ${g.fleet}/3`, 'bad', 'Barbarian Fleet: each 7 or double advances it; at 3 a random building is hit. Knights push it back.', 'fleet']);
    if (g.chain > 0) fx.push([`Echo chain ${g.chain}`, 'good', `Echo: each double gives a free roll of that die. The chain breaks the game at ${ECHO_BREAK}.`, 'chain']);
    if (g.bribe) fx.push([`Bribe −${g.bribe}`, 'good', 'Bribe: the tribute is reduced.']);
    const cities = g.counts().city;
    if (g.hasGuild('taxCollector') && cities) fx.push([`Tax −${cities}`, 'good', 'Tax Collector: each city reduces the tribute by 1.']);
    if (g.levyDelay) fx.push(['Levy Delay', 'good', 'This round\'s tribute is pushed to the next round at +50%.']);
    if (g.monopoly) fx.push([`Monopoly: ${g.monopoly}`, 'good', 'All your production this round becomes this resource.']);
    if (g.bumper) fx.push(['Bumper ×2', 'good', 'Your next roll produces double.']);
    if (g.omen != null) fx.push([`Omen ${g.omen}`, 'good', 'If the next roll hits this number, production is tripled.']);
    if (g.fireSale) fx.push(['Fire Sale 2:1', 'good', 'Bank trades are 2:1 for the rest of the round.']);
    if (g.phase === 'turn' && g.rollsUsed > 0 && g.roundProduced === 0 && !g.streakGiven) fx.push([`Dry ${g.rollsUsed}/${ROLLS_PER_ROUND}`, '', `Losing streak: no resources from ${g.rollsUsed} roll(s) so far. If all ${ROLLS_PER_ROUND} rolls come up empty, you get a free development card.`]);
    if (g.brokeGame) fx.push(['Game broken!', 'good', 'Echo chain of 10: this round\'s tribute counts as paid.']);
    return fx;
  }

  // ---------------------------------------------------------------- board
  renderPrompt() {
    const b = this.boardReq;
    this.$prompt.hidden = !b;
    if (!b) return;
    const rep = this.replaceMap();
    this.$prompt.innerHTML = `<span><b>Click the board:</b> ${esc(b.prompt)}${rep ? ' <em class="rep-note">Hexes marked “Replaces …” lose their old effect.</em>' : ''}</span>${b.cancel ? '<button data-a="cancel-board">Cancel</button>' : ''}`;
  }

  // The longest unbroken chain of roads (same rule as the engine's longestRoad), with the edges in order.
  roadPath() {
    const g = this.game;
    const adj = new Map();
    for (const e of g.roads) for (const v of g.board.edges[e].v) { if (!adj.has(v)) adj.set(v, []); adj.get(v).push(e); }
    let best = [];
    const used = new Set();
    const path = [];
    const dfs = (v) => {
      if (path.length > best.length) best = [...path];
      for (const e of adj.get(v) || []) {
        if (used.has(e)) continue;
        used.add(e); path.push(e);
        const [a, b] = g.board.edges[e].v;
        dfs(a === v ? b : a);
        used.delete(e); path.pop();
      }
    };
    for (const v of adj.keys()) dfs(v);
    return { len: best.length, edges: best };
  }

  // Two small title cards next to the score: Longest road and Largest army, with what they are worth.
  statCards() {
    const g = this.game;
    const vp = g.vpBreakdown();
    const lr = vp.longestRoad;
    const kn = g.knights;
    const carto = g.hasGuild('cartographer');
    const marshal = g.hasGuild('marshal');
    const next = (n, base, guild) => (n < base ? `${base - n} more to reach ${base}` : guild ? `next VP at ${n + 1}` : `next VP at ${base + 2 * (Math.floor((n - base) / 2) + 1)}`);
    const roadInfo = {
      kind: 'Title · longest road',
      title: `${lr} road segment${lr === 1 ? '' : 's'} in a row`,
      desc: 'Your longest unbroken chain of roads. It starts to score at 5 segments, and the chain is shown numbered on the island while you hover this card.',
      lines: [
        '5 segments in a row: 2 VP',
        carto ? 'Cartographer: every segment beyond 5 gives +1 VP' : 'Every 2 further segments beyond 5: +1 VP',
        `Now: ${lr} segments = ${vp.road} VP${vp.road ? ` (2 base + ${vp.road - 2} extra)` : ''}`,
        `Next: ${next(lr, 5, carto)}`,
      ],
    };
    const armyInfo = {
      kind: 'Title · largest army',
      title: `${kn} knight${kn === 1 ? '' : 's'} played`,
      desc: 'Every Knight card you play counts toward your army, and it starts to score at 3 knights.',
      lines: [
        '3 knights played: 2 VP',
        marshal ? 'Marshal: every knight beyond 3 gives +1 VP' : 'Every 2 further knights beyond 3: +1 VP',
        `Now: ${kn} knights = ${vp.army} VP${vp.army ? ` (2 base + ${vp.army - 2} extra)` : ''}`,
        `Next: ${next(kn, 3, marshal)}`,
      ],
    };
    const card = (cls, label, n, goal, val, key, info, hl) => `<div class="stat ${cls} ${val ? 'on' : ''}" ${this.tipAttr(key, info)} ${hl ? 'data-hlroad="1"' : ''}><span class="s-k">${label}</span><span class="s-n">${n}</span><span class="s-v">${val ? `+${val} VP` : n >= goal ? '0 VP' : `${goal - n} to go`}</span></div>`;
    return `<section class="zone stat-zone"><div class="zone-h">Titles</div><div class="stats">${card('road', 'Road', lr, 5, vp.road, 'stat:road', roadInfo, true)}${card('army', 'Army', kn, 3, vp.army, 'stat:army', armyInfo, false)}</div></section>`;
  }

  // The upgrade being placed (from the engine's prompt), and which targets already carry an effect it would replace.
  replaceMap() {
    const b = this.boardReq;
    if (!b || b.kind !== 'hex') return null;
    const it = ITEM_LIST.find((x) => (x.cat === 'hex' || x.cat === 'token') && x.kind !== 'setter' && b.prompt.startsWith(`${x.name}:`));
    if (!it) return null;
    const m = new Map();
    for (const h of this.game.board.hexes) {
      const cur = it.cat === 'hex' ? h.hexEffect : h.tokenEffect;
      if (cur && b.ids.has(h.id)) m.set(h.id, ITEMS[cur.id].name);
    }
    return m.size ? m : null;
  }

  renderBoard() {
    const g = this.game;
    this.$board.classList.toggle('dimmed', g.phase === 'tribute');
    const resultStep = this.step() === 'result';
    const paid = resultStep ? new Set(g.report?.hexes || []) : new Set();
    const rolled = resultStep && g.report?.final && !g.report.final.zero ? g.report.final.sum : null;
    const B = g.board;
    this.view.render(g, {
      req: this.boardReq,
      paid,
      rolled,
      volcano: g.volcanoHex,
      replace: this.replaceMap(),
      hlEdges: this.hlRoad ? this.roadPath().edges : null,
      tip: (h) => {
        const parts = [];
        if (h.hexEffect) parts.push(ITEMS[h.hexEffect.id]);
        if (h.tokenEffect) parts.push(ITEMS[h.tokenEffect.id]);
        if (!parts.length) return '';
        const it = parts[0];
        return this.tipAttr(`hx:${h.id}`, { kind: `${cap(h.terrain)} · ${parts.map((p) => CAT_LABEL[p.cat]).join(' + ')}`, title: parts.map((p) => p.name).join(' + '), desc: parts.map((p) => p.desc).join(' '), fig: parts.map((p) => p.id) });
      },
    });
  }

  // ---------------------------------------------------------------- step panel
  renderPanel() {
    const step = this.step();
    if (this.lastStep !== step) this.tipsOpen = false;
    this._tip = null;
    const pickingFace = this.modal?.type === 'face';
    const view = pickingFace ? this.viewPickFace() : {
      setup: () => this.viewSetup(),
      roll: () => this.viewRoll(),
      adjust: () => this.viewAdjust(),
      result: () => this.viewResult(),
      build: () => this.viewBuild(),
      tribute: () => this.viewTribute(),
      shop: () => this.viewShop(),
      gameover: () => this.viewGameOver(),
    }[step]();
    const scroll = this.$panel.querySelector('.panel-body')?.scrollTop || 0;
    const tips = this.tipsOpen && this._tip ? `<div class="tips-pop" role="dialog" aria-label="How this step works"><div class="eyebrow">${this._tip.title}</div><div class="tp-body">${this._tip.html}</div></div>` : '';
    const sec = view.sec || '';
    const tb = this.tipBtn();
    const footHtml = `${view.foot || ''}${sec || tb ? `<div class="foot-row">${sec}${tb}</div>` : ''}`;
    this.$panel.innerHTML = `${this.actHead(step)}<div class="panel-body">${view.body}</div>${pickingFace ? '' : this.diceArea(step)}${footHtml ? `<div class="panel-foot">${footHtml}</div>` : ''}${tips}`;
    if (this.lastStep === step) this.$panel.querySelector('.panel-body').scrollTop = scroll;
    for (const b of this.$panel.querySelectorAll('.panel-foot button.primary[data-primary]')) b.insertAdjacentHTML('beforeend', '<kbd>Space</kbd>');
    this.lastStep = step;
  }

  // The one place the dice live: both cubes, the roll's values, running effects, and a face sheet that opens on click.
  diceArea(step) {
    if (!['adjust', 'result'].includes(step)) return '';
    const g = this.game;
    let values = null, faces = null, opts = {};
    if (step === 'adjust') {
      const pr = g.pendingRoll;
      values = g.valuesOf(pr).v;
      faces = pr.faces;
      opts = { held: pr.hold.map((h) => h != null), notes: g.report?.dice.map((d) => d.notes) };
    } else if (step === 'result') {
      values = g.report.final.values;
      faces = g.lastRoll.faces;
      opts = { notes: g.report.dice.map((d) => d.notes) };
    } else if (g.lastRoll) faces = g.lastRoll.faces;
    const live = step === 'adjust' || step === 'result';
    const fx = this.effects();
    const fxHtml = fx.length ? `<div class="fx">${fx.map(([t, cls, tip, key]) => `<span class="fx-chip ${cls}" ${this.tipAttr(`fx:${t}`, { kind: 'Active this round', title: t, desc: tip })} data-hl="${key || ''}">${t}</span>`).join('')}</div>` : '';
    const dice = [0, 1].map((i) => {
      const held = opts.held && opts.held[i];
      const notes = opts.notes ? opts.notes[i] : [];
      const fi = faces ? faces[i] : 0;
      const face = g.dice[i].faces[fi];
      const shownNum = face.setter ? null : face.value;
      const diff = values && values[i] !== shownNum;
      return `<div class="die-box ${this.dieSheet === i ? 'open' : ''}" role="button" tabindex="0" data-a="die-sheet" data-die="${i}" title="Click to see this die's six faces">
        <div class="die-top">${this.cube(i, fi, held, live)}
          <div class="small muted">Die ${i + 1}${held ? '<br>held from last roll' : ''}${values ? `<div class="die-val ${diff ? 'changed' : ''}" title="${diff ? 'The face was changed by an upgrade' : ''}">${diff ? '= ' : ''}${values[i] || 0}</div>` : ''}<span class="faces-hint">faces ▴</span></div></div>
        ${notes && notes.length ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      </div>`;
    }).join('');
    return `<div class="dice-area">${fxHtml}<div class="dice2">${dice}</div>${this.dieSheet != null ? this.faceSheet(this.dieSheet) : ''}</div>`;
  }

  // Running round effects as chips.
  fxChips() {
    const fx = this.effects();
    return fx.length ? `<div class="fx">${fx.map(([t, cls, tip, key]) => `<span class="fx-chip ${cls}" ${this.tipAttr(`fx:${t}`, { kind: 'Active this round', title: t, desc: tip })} data-hl="${key || ''}">${t}</span>`).join('')}</div>` : '';
  }

  // The big dice shown in the Roll and Shop steps: no boxes, drag a die to spin it, click it for its six faces.
  diceStage(step) {
    const g = this.game;
    const fx = step === 'roll' ? this.effects() : [];
    const fxHtml = fx.length ? `<div class="fx">${fx.map(([t, cls, tip, key]) => `<span class="fx-chip ${cls}" ${this.tipAttr(`fx:${t}`, { kind: 'Active this round', title: t, desc: tip })} data-hl="${key || ''}">${t}</span>`).join('')}</div>` : '';
    const pick = step === 'pick';
    const dice = [0, 1].map((i) => pick
      ? `<div class="die-slot picking">${this.cube(i, 0, false, false, true)}<span class="die-cap">Die ${i + 1}</span></div>`
      : `<div class="die-slot ${this.dieSheet === i ? 'open' : ''}" data-a="die-sheet" data-die="${i}" title="Drag to spin · click for the six faces">${this.cube(i, g.lastRoll ? g.lastRoll.faces[i] : 0, false, false)}<span class="die-cap">Die ${i + 1}</span></div>`).join('');
    return `<div class="dice-stage ${pick ? 'choosing' : ''}">${fxHtml}<div class="ds-row">${dice}</div><div class="ds-hint">${pick ? 'Click a face to choose it' : 'Drag a die to spin it · click it for its faces'}</div>${!pick && this.dieSheet != null ? this.faceSheet(this.dieSheet) : ''}</div>`;
  }

  // All six faces of one die, with its upgrades. Opens above the dice on click.
  faceSheet(i) {
    const g = this.game;
    const shown = g.lastRoll ? g.lastRoll.faces[i] : null;
    return `<div class="die-sheet"><div class="ds-head"><span class="ds-tabs">${[0, 1].map((k) => `<button class="${k === i ? 'on' : ''}" data-a="die-open" data-die="${k}">Die ${k + 1}</button>`).join('')}</span><button class="small" data-a="die-close">Close</button></div>
      ${this.facesHtml(i, shown)}${this.dieTags(i)}
      <p class="small muted">Hover a face for what it does${shown != null ? '. The outlined one showed last' : ''}.</p></div>`;
  }

  // A CSS 3D cube showing the die's six real faces, turned to face `fi`. Tumbles after each new roll.
  cube(i, fi, held, live, pick = false) {
    const d = this.game.dice[i];
    const SIDE = ['front', 'right', 'top', 'bottom', 'left', 'back']; // physical face k → cube side (opposites: 0-5, 1-4, 2-3)
    const TURN = { front: 'rotateX(0deg) rotateY(0deg)', right: 'rotateY(-90deg)', top: 'rotateX(-90deg)', bottom: 'rotateX(90deg)', left: 'rotateY(90deg)', back: 'rotateY(180deg)' };
    const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
    const TONE = { front: '#e4dfd0', right: '#d6d0c0', top: '#efeadc', bottom: '#bdb7a7', left: '#d6d0c0', back: '#e4dfd0' };
    const PP = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]] };
    const u = (k) => `calc(var(--s, 56px) * ${k})`; // sizes scale with the cube
    const pipBg = (v, ink) => PP[v].map((q) => `radial-gradient(circle at ${q[0]}% ${q[1]}%, ${ink} 0 ${u(0.09)}, transparent ${u(0.105)})`).join(', ');
    const sides = d.faces.map((f, k) => {
      const loaded = d.loaded && d.loaded.face === k;
      const tone = loaded ? '#e6cf8c' : TONE[SIDE[k]];
      let bg = `${pipBg(f.value, '#17181b')}, ${tone}`;
      let inner = '';
      if (f.triggers.length && !f.setter) bg = `${svgUrl(faceBody(f.value, f.triggers))} center/100% 100% no-repeat, ${tone}`;
      if (f.setter === 'mirror') bg = `radial-gradient(circle at 50% 50%, #17181b 0 ${u(0.16)}, ${tone} ${u(0.18)} ${u(0.27)}, #17181b ${u(0.29)})`;
      else if (f.setter === 'robber') { bg = '#17181b'; inner = '<span class="lbl lt">R</span>'; }
      else if (f.setter === 'blank') { bg = '#17181b'; inner = '<span class="lbl lt">?</span>'; }
      const faceTip = f.triggers.map((t) => ITEMS[t].name).join(', ') || (f.setter ? ITEMS[SETTER_ITEM[f.setter]].name : `Shows ${f.value}`);
      return `<div class="side ${SIDE[k]}" style="background:${bg}" ${pick ? `data-a="pick-face" data-die="${i}" data-face="${k}" title="Die ${i + 1}, face ${k + 1}: ${esc(faceTip)}"` : ''}>${inner}${f.triggers.length && extraTrg(f) ? `<span class="trg">${extraTrg(f)}</span>` : ''}</div>`;
    }).join('');
    const final = TURN[SIDE[fi]];
    let cls = '';
    const sp = this.spin[i];
    const spun = sp ? `rotateX(${sp[0].toFixed(1)}deg) rotateY(${sp[1].toFixed(1)}deg) ` : '';
    let style = `--final:${final};transform:${spun}${final};`;
    const el = live ? this.rollElapsed() : null;
    const toss = el != null && !held ? ` toss" style="--td:${-Math.round(el)}ms` : '';
    if (el != null && !held) {
      const r = this.rollSpin[i];
      cls = 'rolling';
      style += `--rx0:${r[0]}deg;--ry0:${r[1]}deg;--rz0:${r[2]}deg;animation-delay:${-Math.round(el)}ms;`;
    }
    return `<div class="die3d ${held ? 'held' : ''}${toss}" data-hl="die:${i}" data-cube="${i}"><div class="tilt"><div class="cube ${cls}" style="${style}">${sides}</div></div></div>`;
  }

  // Milliseconds since the latest roll started, while its animation is still running (else null).
  rollElapsed() {
    const g = this.game;
    if (g.rollSeq !== this.seenSeq) {
      this.seenSeq = g.rollSeq;
      this.rollStart = performance.now();
      this.spin = [null, null];
      const spin = () => [720 + Math.floor(Math.random() * 360), 540 + Math.floor(Math.random() * 360), Math.floor(Math.random() * 180)];
      this.rollSpin = [spin(), spin()];
    }
    const el = performance.now() - (this.rollStart || 0);
    return g.rollSeq > 0 && el < 900 ? el : null;
  }

  // Inline style that fades content in once the dice have landed.
  revealStyle(extra = 0) {
    const el = this.game.rollSeq === this.seenSeq ? performance.now() - (this.rollStart || 0) : 9999;
    if (el > 1200) return '';
    return `style="animation:reveal .3s ease both;animation-delay:${Math.round(800 + extra - el)}ms"`;
  }

  facesHtml(i, shownFace) {
    const d = this.game.dice[i];
    return `<div class="faces">${d.faces.map((f, k) => {
      const loaded = d.loaded && d.loaded.face === k;
      return `<span class="face ${loaded ? 'loaded' : ''} ${shownFace === k ? 'shown' : ''}" ${this.tipAttr(`face:${i}:${k}`, this.faceInfo(i, k))} data-hl="face:${i}:${k}">${faceArt(f, loaded)}</span>`;
    }).join('')}</div>`;
  }

  // Triggers on a face as [id, count], so stacked copies show as ×2, ×3 …
  triggerCounts(face) {
    const counts = {};
    for (const t of face.triggers) counts[t] = (counts[t] || 0) + 1;
    return Object.entries(counts);
  }

  dieTags(i) {
    const g = this.game;
    const d = g.dice[i];
    const ups = g.dieUps(i);
    const lv = d.loaded ? d.loaded.level : 0;
    const meter = Array.from({ length: 10 }, (_, k) => `<i class="${k < lv ? 'on' : ''}"></i>`).join('');
    const loaded = d.loaded ? `<span class="tag loaded-tag" ${this.tipAttr(`load:${i}`, this.loadedInfo(i))} data-hl="loaded:${i}">Loaded L${lv}<span class="lvl">${meter}</span></span>` : '';
    const upTags = ups.map((u) => `<span class="tag" ${this.tipAttr(`up:${i}:${u}`, this.upgradeInfo(i, u))}>${ITEMS[u].name}${d.used[u] ? ' (used)' : ''}${!d.upgrades.includes(u) ? ' (copied)' : ''}</span>`).join('');
    return `<div class="tags">${loaded}${upTags}</div>`;
  }

  // ---- detail-card content (what each element says when hovered or clicked)
  dieInfo(i) {
    const g = this.game;
    const d = g.dice[i];
    const ups = g.dieUps(i);
    const lines = ups.map((u) => `${ITEMS[u].name}${d.used[u] ? ' · used this round' : ''}${!d.upgrades.includes(u) ? ' · copied from the other die' : ''}`);
    if (d.loaded) lines.unshift(`Loaded to level ${d.loaded.level} of 10`);
    return {
      kind: 'Die',
      title: `Die ${i + 1}`,
      desc: 'Each roll shows one face of this die. Its six faces are listed under it, with their labels.',
      lines: lines.length ? lines : ['No upgrades yet.'],
    };
  }

  loadedInfo(i) {
    const d = this.game.dice[i];
    const lv = d.loaded.level;
    const [fav, opp, side] = LOADING[lv - 1];
    const sum = fav + opp + 4 * side;
    const pct = (x) => Math.round((x / sum) * 100);
    return {
      kind: 'Dice · Loaded',
      title: `Loaded, level ${lv} of 10`,
      desc: 'Buy Loaded again to raise the level. The favoured face gets more likely, and its opposite face too.',
      now: `Favoured face ${pct(fav)}% · opposite ${pct(opp)}% · each other face ${pct(side)}%`,
      lines: [lv < 10 ? `Next level costs ${LOADING[lv][3]} VP` : 'Maximum level reached'],
    };
  }

  upgradeInfo(i, u) {
    const d = this.game.dice[i];
    return {
      kind: 'Dice · upgrade',
      fig: u,
      title: ITEMS[u].name,
      desc: ITEMS[u].desc,
      now: d.used[u] ? 'Used this round.' : null,
      lines: [!d.upgrades.includes(u) ? 'Copied from the other die (Copycat).' : 'Bought for this die.'],
    };
  }

  faceInfo(i, k) {
    const g = this.game;
    const d = g.dice[i];
    const f = d.faces[k];
    const fired = (g.report?.fired || []).some((x) => x.die === i && x.face === k);
    const lines = this.triggerCounts(f).map(([t, n]) => `${ITEMS[t].name}${n > 1 ? ` ×${n}` : ''}: ${ITEMS[t].desc}`);
    const loaded = d.loaded && d.loaded.face === k;
    const nows = [];
    if (fired) nows.push('Fired on the last roll');
    if (loaded) nows.push(`Loaded face (level ${d.loaded.level})`);
    return {
      kind: `Die ${i + 1} · face ${k + 1}`,
      title: f.setter ? ITEMS[SETTER_ITEM[f.setter]].name : `Shows ${f.value}`,
      desc: f.setter ? ITEMS[SETTER_ITEM[f.setter]].desc : (lines.length ? '' : 'A plain face.'),
      now: nows.length ? nows.join(' · ') : null,
      lines,
    };
  }

  // What a guild is doing right now, for guilds whose effect grows with the run.
  guildNow(id) {
    const g = this.game;
    const vp = g.vpBreakdown();
    const cities = g.counts().city;
    const owned = g.ownedPorts();
    const gen = owned.filter((p) => p.type === 'generic').length;
    const spec = owned.length - gen;
    switch (id) {
      case 'taxCollector': return `Now: −${cities} from every tribute (${cities} ${cities === 1 ? 'city' : 'cities'})`;
      case 'twinFortune': return `Now: ${g.earned.twinFortune} VP earned from doubles this run`;
      case 'cartographer': return vp.longestRoad >= 5 ? `Now: +${vp.longestRoad - 5} VP from road segments beyond 5` : 'Now: needs a road of 5 to count';
      case 'marshal': return g.knights >= 3 ? `Now: +${g.knights - 3} VP from knights beyond 3` : 'Now: needs 3 knights to count';
      case 'moneylender': return `Now: ${gen} generic port${gen === 1 ? '' : 's'} give each specific port +${gen}`;
      case 'tradeConsul': return `Now: generic ports need ${spec} less input (${spec} specific port${spec === 1 ? '' : 's'})`;
      default: return null;
    }
  }

  // The how-to text, folded away once you know it. The choice is remembered.
  // How-to text no longer sits in the card: it is kept for the ? button in the card's header.
  hint(title, html) {
    this._tip = { title, html };
    return '';
  }

  viewSetup() {
    const g = this.game;
    const n = Object.keys(g.buildings || {}).length;
    const roads = g.roads ? g.roads.size : 0;
    const what = n > roads ? 'a road next to your new settlement' : `settlement ${n + 1} of ${START_SETTLEMENTS}`;
    return {
      body: `<h2>Set up your island</h2>
        <p>Place <b>${what}</b> on one of the pulsing dots.</p>
        ${this.hint('Picking a good spot', `<ul class="small" style="margin:6px 0 0;padding-left:18px">
          <li>Each corner touches up to three hexes. Every hex pays its resource when its number is rolled.</li>
          <li>More dots under a number = rolled more often. 6 and 8 are best.</li>
          <li>Try to touch different resources: the Boss tribute needs three different types.</li>
          <li>Each starting settlement gives you one card per hex next to it.</li><li>Spread out: settlements need two edges of distance between them.</li></ul>`)}`,
      foot: '<div class="hint">Click a pulsing dot on the board to place it.</div>',
      sec: this.tutorialButton(),
    };
  }

  // Probability of each sum 2–12 for the two dice as they are (or with one face swapped), as fractions.
  // Mirror faces copy the other die, a Blank face is counted as an even spread, the Robber's Face counts as a 7.
  sumDist(swap) {
    const g = this.game;
    const probs = [0, 1].map((i) => g.faceProbs(i));
    const faces = [0, 1].map((i) => g.dice[i].faces.map((f, k) => (swap && swap.die === i && swap.face === k ? swap.to : f)));
    const out = Array(13).fill(0);
    const vals = (f) => (f.setter === 'blank' ? [1, 2, 3, 4, 5, 6] : f.setter === 'mirror' ? ['m'] : [f.value]);
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
      const pr = probs[0][a] * probs[1][b];
      const fa = faces[0][a], fb = faces[1][b];
      if (fa.setter === 'robber' || fb.setter === 'robber') { out[7] += pr; continue; }
      const va = vals(fa), vb = vals(fb);
      const w = pr / (va.length * vb.length);
      for (const x of va) for (const y of vb) {
        if (x === 'm' && y === 'm') continue; // two mirrors: the roll counts as 0
        out[(x === 'm' ? y : x) + (y === 'm' ? x : y)] += w;
      }
    }
    return out;
  }

  // The bell curve of the sum, before and (on hover) after the face change. Smooth path through the 11 points.
  curvePath(dist, W, H, top) {
    const pts = [];
    for (let s = 2; s <= 12; s++) pts.push([10 + ((s - 2) / 10) * (W - 20), H - 16 - (dist[s] / top) * (H - 30)]);
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return { d, area: `${d} L${pts[10][0].toFixed(1)} ${H - 16} L${pts[0][0].toFixed(1)} ${H - 16} Z` };
  }

  distStats(dist) {
    const tot = dist.reduce((a, b) => a + b, 0) || 1;
    let mean = 0;
    for (let s = 2; s <= 12; s++) mean += (s * dist[s]) / tot;
    return { p7: dist[7] / tot, mean, tot };
  }

  // What a face upgrade does to the face, as a face object (or a list of them when the result is random).
  faceAfter(item, f) {
    if (item.id === 'reforge') return [1, 2, 3, 4, 5, 6].filter((v) => v !== f.value).map((v) => ({ ...f, value: v, setter: null }));
    if (item.id === 'raise') return [{ ...f, value: f.value === 6 ? 1 : f.value + 1, setter: null }];
    if (item.id === 'lower') return [{ ...f, value: f.value === 1 ? 6 : f.value - 1, setter: null }];
    const setter = { mirror: 'mirror', robberFace: 'robber', blank: 'blank' }[item.id];
    return setter ? [{ ...f, setter }] : null;
  }

  pickChart(item) {
    const g = this.game;
    const W = 280, H = 92;
    const before = this.sumDist();
    const after = {};
    let top = Math.max(...before);
    for (const d of [0, 1]) for (let k = 0; k < 6; k++) {
      const alts = this.faceAfter(item, g.dice[d].faces[k]);
      const dists = alts.map((to) => this.sumDist({ die: d, face: k, to }));
      const avg = before.map((_, s) => dists.reduce((a, x) => a + x[s], 0) / dists.length);
      after[`${d}-${k}`] = { dist: avg, random: alts.length > 1 };
      top = Math.max(top, ...avg);
    }
    top *= 1.1;
    this._pick = { before, after, top, W, H };
    const bp = this.curvePath(before, W, H, top);
    const ticks = Array.from({ length: 11 }, (_, i) => `<text x="${(10 + (i / 10) * (W - 20)).toFixed(1)}" y="${H - 3}" text-anchor="middle" class="${i + 2 === 7 ? 'seven' : ''}">${i + 2}</text>`).join('');
    const st = this.distStats(before);
    return `<div class="pk-chart" aria-label="Chance of each roll total">
      <div class="pk-title">Chance of each total</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><path d="${bp.area}" class="pk-before-fill"/><path id="pk-after-fill" class="pk-after-fill" d=""/><path d="${bp.d}" class="pk-before"/><path id="pk-after" class="pk-after" d=""/>${ticks}</svg>
      <div id="pk-read" class="pk-read">Now: 7 comes up ${(st.p7 * 100).toFixed(1)}% · average total ${st.mean.toFixed(1)}. Hover a face to preview the change.</div></div>`;
  }

  pickPreview(key) {
    const c = this._pick;
    const path = document.querySelector('#pk-after');
    if (!c || !path) return;
    const fill = document.querySelector('#pk-after-fill');
    const read = document.querySelector('#pk-read');
    const bs = this.distStats(c.before);
    const a = key ? c.after[key] : null;
    if (!a) {
      path.setAttribute('d', ''); fill.setAttribute('d', '');
      read.textContent = `Now: 7 comes up ${(bs.p7 * 100).toFixed(1)}% · average total ${bs.mean.toFixed(1)}. Hover a face to preview the change.`;
      return;
    }
    const p = this.curvePath(a.dist, c.W, c.H, c.top);
    path.setAttribute('d', p.d); fill.setAttribute('d', p.area);
    path.classList.toggle('random', a.random);
    const as = this.distStats(a.dist);
    read.textContent = `${a.random ? 'Expected (the new value is random): ' : 'After: '}7 comes up ${(as.p7 * 100).toFixed(1)}% (now ${(bs.p7 * 100).toFixed(1)}%) · average total ${as.mean.toFixed(1)} (now ${bs.mean.toFixed(1)}).`;
  }

  // Choosing the face of a face upgrade: spin the dice in the action card and click the face itself.
  viewPickFace() {
    const m = this.modal;
    const item = ITEM_LIST.find((x) => x.cat === 'face' && x.kind === 'setter' && m.prompt.startsWith(`${x.name}:`));
    return {
      body: `<h2>${esc(m.prompt)}</h2>
        <p class="small muted">Drag a die to spin it, then click the face to upgrade.</p>
        ${this.diceStage('pick', m)}
        ${item ? this.pickChart(item) : ''}`,
      foot: m.cancel ? '<button class="big center" data-a="cancel-modal">Cancel</button>' : '',
    };
  }

  viewRoll() {
    const g = this.game;
    const pre = g.cards.filter((c) => PRE_ROLL_CARDS.includes(c.id));
    return {
      body: `<h2>${BLINDS[g.blind]} round · ante ${g.ante}</h2>
        ${this.diceStage('roll')}
        ${this.hint('How a round works', `You have <b>${ROLLS_PER_ROUND} rolls</b>. Each roll pays every hex with that number to your buildings next to it (settlement 1, city 2). Between rolls you can build and trade. At the end you pay the tribute shown at the top of the board.`)}
        ${pre.length ? `<div class="callout"><b>Before rolling:</b> you can play ${pre.map((c) => ITEMS[c.id].name).join(', ')} from your hand below.</div>` : ''}`,
      foot: `<button class="primary big" data-a="roll" data-primary ${this.busy ? 'disabled' : ''}>Roll the dice${this.rollsLeft()}</button>`,
      sec: `<button class="small ghost" data-a="end" ${this.busy ? 'disabled' : ''}>Skip all rolls (+${ROLLS_PER_ROUND} VP)</button>${this.tutorialOffered() ? this.tutorialButton() : ''}`,
    };
  }

  viewAdjust() {
    const g = this.game;
    const pr = g.pendingRoll;
    const { v } = g.valuesOf(pr);
    const mods = g.modifiersAvailable();
    return {
      body: `<h2>You rolled ${v[0] || '?'} + ${v[1] || '?'}</h2>
        <p class="lead">${mods.length ? 'Your dice upgrades can change this roll before it pays out.' : 'Nothing left to change. Use this roll when you are ready.'}</p>
        ${mods.length ? '<h3>Change the roll (optional)</h3>' : ''}
        <div class="tiles">${mods.map((m) => `<button class="tile-btn" data-a="mod" data-die="${m.die}" data-id="${m.id}" ${this.busy ? 'disabled' : ''}><span class="t-name">${MOD_INFO[m.id][0]} · die ${m.die + 1}</span><span class="t-desc">${MOD_INFO[m.id][1]}</span></button>`).join('')}</div>`,
      foot: `<button class="primary big" data-a="resolve" data-primary ${this.busy ? 'disabled' : ''}>Use this roll (${v[0] + v[1] || '?'})</button>`,
    };
  }

  viewResult() {
    const g = this.game;
    const rep = g.report;
    const f = rep.final;
    const gains = RES.filter((r) => rep.gains[r] > 0);
    const losses = RES.filter((r) => rep.gains[r] < 0);
    const store = RES.filter((r) => rep.storeGains[r] !== 0);
    const lines = rep.lines.filter((l) => l.cls !== 'roll');
    // Stacks and resources are shown under "You got"; this strip lists what else grew, fired or appeared.
    const fired = (rep.fired || []).map((f) => {
      const face = g.dice[f.die].faces[f.face];
      const names = face.setter ? [ITEMS[SETTER_ITEM[face.setter]].name] : this.triggerCounts(face).map(([t, n]) => `${ITEMS[t].name}${n > 1 ? ` ×${n}` : ''}`);
      return { cls: 'good', text: `Die ${f.die + 1} triggered: ${names.join(', ')}` };
    }).filter((c) => !c.text.endsWith(': '));
    const changes = [...fired, ...(rep.changes || []).filter((c) => c.delta !== 0 && !/^(hand|store):/.test(c.key))];
    const head = f.zero ? 'Mirror vs Mirror: 0' : f.robberFace ? "Robber's Face: counts as 7" : `${f.values[0]} + ${f.values[1]} = ${f.sum}`;
    const tags = [];
    if (f.isDouble) tags.push('<span class="pill">Double</span>');
    if (f.seven) tags.push('<span class="pill bad">7 · robber</span>');
    if (rep.echo) tags.push('<span class="pill">Echo roll</span>');
    const nothingWhy = !f.seven && !f.zero
      ? `No hex with a ${f.sum} touches your buildings${g.board.hexes.some((h) => h.token === f.sum && h.id === g.robber) ? ', or the robber blocks it' : ''}.`
      : '';
    const gainCards = [
      ...gains.map((r) => `<div class="pick" style="border:0;padding:0">${rcard(r, 'sm', '')}<b class="good">+${rep.gains[r]}</b></div>`),
      ...losses.map((r) => `<div class="pick" style="border:0;padding:0">${rcard(r, 'sm', 'opacity:.6')}<b class="bad">${rep.gains[r]}</b></div>`),
      ...store.map((r) => `<div class="pick" style="border:0;padding:0">${rcard(r, 'sm', '')}<b class="${rep.storeGains[r] > 0 ? 'good' : 'bad'}">${rep.storeGains[r] > 0 ? '+' : ''}${rep.storeGains[r]} store</b></div>`),
    ].join('');
    const echoNext = g.echoQueue.length > 0;
    return {
      body: `<div class="sum-line" ${this.revealStyle()}>${head} ${tags.join(' ')}</div>
        <div ${this.revealStyle(120)}>${changes.length ? `<h3>Changed by this roll</h3><div class="changes">${changes.map((c) => `<span class="chg ${c.cls}">${esc(c.text)}</span>`).join('')}</div>` : ''}<h3>You got</h3>
        ${gainCards ? `<div class="gains">${gainCards}</div>` : `<p class="muted">Nothing this time. ${nothingWhy}</p>`}
        ${lines.length ? `<h3>What happened</h3><ul class="events">${lines.map((l) => `<li class="${l.cls}">${esc(l.msg)}</li>`).join('')}</ul>` : ''}</div>
        <p class="small muted">Hexes that paid you are outlined on the board.</p>`,
      foot: `<button class="primary big" data-a="seen" data-primary>${echoNext ? 'Continue · free Echo roll waiting' : 'Continue to build & trade'}</button>`,
    };
  }

  viewBuild() {
    const g = this.game;
    const dis = this.busy;
    const rollsLeft = ROLLS_PER_ROUND - g.rollsUsed;
    const echo = g.echoQueue.length > 0;
    const c = g.counts();
    const pipRow = (cost) => `<span class="cost">${RES.flatMap((r) => Array.from({ length: cost[r] || 0 }, (_, i) => `<span class="pip ${g.hand[r] > i ? '' : 'missing'}" style="background:var(--${r})" title="${r}"></span>`)).join('')}</span>`;
    const tile = (kind, name, effect) => {
      const why = g.whyNot(kind);
      return `<button class="tile-btn ${why ? '' : 'ok'}" data-a="build" data-kind="${kind}" data-cost="${kind}" ${why ? `title="${esc(why)}"` : ''} ${why || dis ? 'disabled' : ''}>
        <span class="t-name">${name}</span>${pipRow(COSTS[kind])}
        <span class="${why ? 't-why' : 't-desc'}">${why ? esc(why) : effect}</span></button>`;
    };
    // trade
    const give = this.tradeGive;
    const rate = (r) => g.tradeRate(r);
    const giveRow = RES.map((r) => `<button class="rtile ${give === r ? 'sel' : ''}" data-a="give" data-r="${r}" ${g.hand[r] >= rate(r) && !dis ? '' : 'disabled'} title="Give ${rate(r)} ${r}"><span class="sw" style="background:var(--${r})"></span>${r}<b>${rate(r)}:1</b></button>`).join('');
    const getRow = RES.map((r) => `<button class="rtile" data-a="get" data-r="${r}" ${give && give !== r && !dis ? '' : 'disabled'} title="Get 1 ${r}"><span class="sw" style="background:var(--${r})"></span>${r}</button>`).join('');
    const tradeHint = !RES.some((r) => g.hand[r] >= rate(r))
      ? `You need ${Math.min(...RES.map(rate))} of one resource to trade.`
      : give ? `Giving ${rate(give)} ${give}. Now pick what you get.` : 'Pick what you give, then what you get.';
    // ship
    const ports = g.ownedPorts();
    let ship;
    if (g.bossIs('pirate')) ship = '<p class="small bad">The Pirate: no shipping this round.</p>';
    else if (!ports.length) ship = '<p class="small muted">Needs a port: build on a 3:1 or 2:1 circle on the coast.</p>';
    else {
      ship = ports.map((port) => {
        const { input, bonus } = g.storehouseRate(port);
        const rs = port.type === 'generic' ? RES : [port.type];
        return `<div class="port-row"><span class="small"><b>${port.type === 'generic' ? 'Generic port' : port.type + ' port'}</b>: ship ${input} → ${input + bonus} toward the tribute</span>
          <div class="row">${rs.map((r) => `<button class="small" data-a="ship" data-port="${port.id}" data-r="${r}" data-mode="batch" ${g.hand[r] >= input && !dis ? '' : 'disabled'}>${resDot(r)} ${input} ${r}</button>${port.up.overflow ? `<button class="small" data-a="ship" data-port="${port.id}" data-r="${r}" data-mode="overflow" ${g.hand[r] > 0 && g.hand[r] < input ? '' : 'disabled'}>leftover ${r}</button>` : ''}`).join('')}
          ${port.up.free ? `<button class="small" data-a="ship-mixed" data-port="${port.id}">Mixed batch</button>` : ''}</div></div>`;
      }).join('');
    }
    const payable = g.autoAssign() != null;
    const primary = echo
      ? `<button class="primary big" data-a="roll" data-primary ${dis ? 'disabled' : ''}>Free Echo roll (die ${g.echoQueue[0] + 1})</button>`
      : rollsLeft > 0
        ? `<button class="primary big" data-a="roll" data-primary ${dis ? 'disabled' : ''}>Roll again${this.rollsLeft()}</button>`
        : `<button class="primary big" data-a="end" data-primary ${dis ? 'disabled' : ''}>Go to the tribute</button>`;
    const secondary = rollsLeft > 0 || echo ? `<button data-a="end" ${dis ? 'disabled' : ''}>End round now${rollsLeft > 0 ? ` · +${rollsLeft} VP` : ''}</button>` : '';
    return {
      body: `${this.fxChips()}${this.hint('How building and trading work', `<p>${g.rollsUsed === 0 ? 'Before your first roll.' : `After roll ${g.rollsUsed} of ${ROLLS_PER_ROUND}.`} Do as much as you like between rolls. Hover an option to see the cards it uses. The tribute card above says whether you can pay it now; anything you build comes out of the rest.</p><p><b>Trade</b> gives you one card of any type for ${Math.min(...RES.map(rate))} of another (less with ports). <b>Ship</b> sends cards to the Storehouse from a port; they count toward the tribute with a bonus.</p>`)}
        <div class="tiles">
          ${tile('settlement', 'Settlement', `+1 VP · produces 1 · ${c.settlement}/${g.limits.settlement}`)}
          ${tile('city', 'City', `Upgrade: +1 VP · produces 2 · ${c.city}/${g.limits.city}`)}
          ${tile('road', 'Road', `Reach new corners · ${c.road}/${g.limits.road}`)}
          ${tile('dev', 'Development card', 'Random card for your hand')}
        </div>
        <h3>Trade with the bank</h3>
        <div class="trade-line"><span>Give</span><div class="trade-grid">${giveRow}</div></div>
        <div class="trade-line"><span>Get 1</span><div class="trade-grid">${getRow}</div></div>
        ${give || !RES.some((r) => g.hand[r] >= rate(r)) ? `<p class="small muted">${tradeHint}</p>` : ''}
        ${ports.length || g.bossIs('pirate') ? `<h3>Ship to the Storehouse</h3>${ship}` : ship}`,
      foot: primary,
      sec: secondary.replace('<button ', '<button class="small ghost" '),
    };
  }

  viewTribute() {
    const g = this.game;
    const due = g.tributeDue();
    if (!this.tributeTypes || this.tributeTypes.length !== due.length) this.tributeTypes = g.autoAssign() ?? due.map((p) => p.type);
    const types = this.tributeTypes;
    const check = g.checkAssignment(types);
    const canAny = g.autoAssign() != null;
    return {
      body: `<h2>Pay the tribute</h2>
        ${this.hint('How paying works', `${due.length > 1 ? 'Each part needs a different resource type. ' : ''}Storehouse cards are used first, then your hand. The best choice is pre-selected.`)}
        ${due.map((p, i) => `<div class="tribute-part"><span class="big-n">${p.amount}</span>
          ${p.fixed ? `<span class="row">${resDot(p.type)} <b>${p.type}</b> <span class="small muted">fixed by the boss</span></span>`
            : `<div class="choice-row">${RES.map((r) => `<button class="${types[i] === r ? 'sel' : ''}" data-a="tpick" data-i="${i}" data-r="${r}" ${g.available(r) >= p.amount ? '' : 'disabled'}>${resDot(r)} ${r} <span class="muted">${g.available(r)}</span></button>`).join('')}</div>`}
          ${p.carried ? '<span class="small muted">carried from Levy Delay</span>' : ''}</div>`).join('')}
        ${!check.ok && canAny ? `<div class="callout bad">${esc(check.msg)}</div>` : ''}
        ${!canAny ? '<div class="callout bad"><b>You can\'t pay this tribute.</b> The run ends here.</div>' : ''}`,
      foot: canAny
        ? `<button class="primary big" data-a="pay" data-primary ${check.ok ? '' : 'disabled'}>Pay tribute</button>`
        : '<button class="primary big" data-a="fail" data-primary>End the run</button>',
    };
  }

  // The shop itself is a popup over the board; the action card keeps the button for the next round in its usual place.
  viewShop() {
    const g = this.game;
    const next = g.blind === 2 ? `ante ${g.ante + 1}, Small round` : `${BLINDS[g.blind + 1]} round`;
    const nextBoss = g.blind === 2 ? BOSS_BY_ID[g.nextBossId] : g.boss;
    return {
      body: `${this.hint('How the shop works', 'Spend your VP on upgrades in the popup. Unspent VP is lost when you leave; buying never lowers your score.')}
        <h2>Shop</h2>
        <p class="lead">Budget <b>${g.budget} VP</b>. Spend it, then move on.</p>
        ${this.diceStage('shop')}`,
      foot: `<button class="primary big" data-a="leave" data-primary ${this.busy ? 'disabled' : ''}>Next: ${next}</button>`,
      sec: `<button class="small ghost" data-a="reroll-boss" ${g.budget >= g.bossRerollPrice ? '' : 'disabled'} title="Replace ${esc(nextBoss.name)} with another boss">Reroll boss · ${g.bossRerollPrice} VP</button>`,
    };
  }

  renderOverlay() {
    const g = this.game;
    const show = g.phase === 'shop' && !this.boardReq && !(this.stamp && performance.now() < this.stamp.hold);
    this.$overlay.hidden = !show;
    if (!show) { this.shopShown = false; return; }
    const priceTag = (price) => `<span class="price"><b>${price === Infinity ? '—' : price}</b><i>VP</i></span>`;
    const offers = g.shop.map((s, i) => {
      const price = g.slotPrice(s);
      const afford = g.budget >= price;
      const can = !s.sold && afford && !this.busy;
      const btn = `<button class="${can ? 'primary' : ''} buy" data-a="buy" data-i="${i}" ${can ? '' : 'disabled'}>${s.sold ? 'Bought' : afford ? `Buy · ${price === Infinity ? 'max' : price} VP` : `${price} VP · need ${price - g.budget} more`}</button>`;
      if (s.kind === 'pack') {
        return `<div class="offer pack ${s.sold ? 'sold' : ''}"><div class="o-top"><span>Pack · ${esc(s.group)}</span><span>Choose 1 of 3</span></div>
          <div class="o-stage"><div class="sealed"><i></i><i></i><i><b>?</b></i></div></div>
          <div class="o-name">A pack of three</div><div class="o-desc">Open it after you buy, then keep one.</div>${priceTag(price)}${btn}</div>`;
      }
      const it = s.item;
      const desc = `${it.desc}${it.id === 'loaded' ? ' Price rises with the level.' : ''}`;
      const top = `<div class="o-top"><span>${esc(CAT_LABEL[it.cat])}</span><span class="rarity-${it.rarity}">${it.rarity}</span></div>`;
      if (UPGRADE_CATS.includes(it.cat)) {
        return `<div class="offer obj ${it.rarity} ${s.sold ? 'sold' : ''}">${top}<div class="o-stage">${figure(it.id, 0.86)}</div><div class="o-name">${esc(it.name)}</div><div class="o-desc">${esc(desc)}</div>${priceTag(price)}${btn}</div>`;
      }
      return `<div class="offer card-o ${it.rarity} ${s.sold ? 'sold' : ''}"><div class="o-top" aria-hidden="true"></div><div class="o-stage"><div class="pcard big ${it.rarity}"><i class="dot" style="background:${CAT_DOT[it.cat] || '#a6a59e'}"></i><span class="k">${esc(CAT_SHORT[it.cat])}</span><span class="r rarity-${it.rarity}">${it.rarity}</span><span class="art" style="background-position:${cardArt(it)}"></span><span class="nm">${esc(it.name)}</span><span class="tx">${esc(desc)}</span></div></div>${priceTag(price)}${btn}</div>`;
    }).join('');
    const guilds = g.guilds.map((gd) => `<div class="pcard ${ITEMS[gd.id].rarity}" ${this.tipAttr(`sg:${gd.uid}`, { kind: 'Guild · always on', title: ITEMS[gd.id].name, desc: ITEMS[gd.id].desc })}><i class="dot" style="background:${CAT_DOT.guild}"></i><span class="art" style="background-position:${cardArt(ITEMS[gd.id])}"></span><span class="nm">${esc(ITEMS[gd.id].name)}</span></div>`).join('');
    const e = g.earned;
    const keep = this.$overlay.querySelector('.shop')?.scrollTop || 0;
    this.$overlay.innerHTML = `<div class="shop" role="dialog" aria-label="The Shop">
      <div class="shop-head"><div><div class="eyebrow">Between rounds</div><h2>The Shop</h2></div>
        <div class="budget-box"><div class="eyebrow">Budget · unspent VP is lost</div><div class="budget">${g.budget}<small>VP</small></div>
        <div class="small muted">Score ${g.vp} + unused rolls ${e.unusedRolls} + Storehouse ${e.storehouse}${e.river ? ` + River ${e.river}` : ''}${e.twinFortune ? ` + Twin Fortune ${e.twinFortune}` : ''}</div></div></div>
      <div class="shop-grid" style="--n:${g.shop.length}">${offers}</div>
      <div class="shop-foot"><button data-a="reroll" ${g.budget >= g.rerollPrice ? '' : 'disabled'}>Reroll offers · ${g.rerollPrice} VP</button>
        <span class="small muted sf-note">Dice, field and port upgrades ask you to pick their target after you buy.</span></div>
</div>`;
    const sh = this.$overlay.querySelector('.shop');
    if (sh && this.shopShown) sh.scrollTop = keep;
    this.shopShown = true;
  }

  viewGameOver() {
    const g = this.game;
    return {
      body: `<h2>Run over</h2><p>You survived <b>${g.roundsSurvived}</b> round(s) and reached ante ${g.ante} with a score of ${g.vp} VP.</p>
        <p class="small muted">Seed ${g.seed}. The same seed gives the same board and dice if you make the same choices.</p>`,
      foot: '<button class="primary big" data-a="fresh" data-primary>New run</button><button data-a="again">Replay this seed</button>',
    };
  }

  // ---------------------------------------------------------------- the table: lamp
  // One lamp over the board. Its colour drifts from amber toward ember over the antes, and the boss round turns it vermilion.
  renderMood() {
    const g = this.game;
    if (!g || !g.board) return;
    const t = Math.min(Math.max(g.ante - 1, 0) / 7, 1);
    const mix = (a, b) => a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',');
    const boss = g.blind === 2 && g.phase !== 'shop' && g.phase !== 'gameover';
    let rgb = mix([255, 168, 92], [236, 116, 66]), k = 1, vig = '12,13,15', va = (0.93 + t * 0.04).toFixed(2);
    if (g.phase === 'shop') { rgb = mix([255, 188, 110], [244, 150, 84]); k = 0.9; }
    if (g.phase === 'gameover') { rgb = '150,160,175'; k = 0.7; }
    if (boss) { rgb = '255,74,28'; k = 1.45; vig = '30,6,3'; va = '0.97'; }
    const s = this.$stage.style;
    s.setProperty('--lamp-rgb', rgb);
    s.setProperty('--lamp-k', k);
    s.setProperty('--vig-rgb', vig);
    s.setProperty('--vig-a', va);
    this.$stage.dataset.mood = boss ? 'boss' : g.phase;
  }

  // ---------------------------------------------------------------- hand
  renderHand() {
    const g = this.game;
    if (!g || !g.board) return;
    const cost = this.hoverCost;
    const now = performance.now();
    // resources
    const stacks = RES.map((r) => {
      const n = g.hand[r];
      const need = cost ? cost[r] || 0 : 0;
      let cards = '';
      const pay = this.payout && now < this.payout.until ? this.hlMap.get(`hand:${r}`) : null;
      const drop = pay && pay.delta > 0 ? Math.min(pay.delta, 4) : 0;
      const el = this.payout ? now - this.payout.start : 0;
      const wasEmpty = drop > 0 && pay.delta >= n;
      if (n === 0) cards = `<div class="rcard empty" style="--c:var(--${r})"><i class="dot"></i><span class="nm">No ${r}</span></div>`;
      else {
        const under = Math.min(n - 1, 4);
        const seed = hs(r);
        for (let k = under; k >= 1; k--) cards += `<div class="rcard under" style="left:${(-3 * k + tilt(seed + k * 7, .9)).toFixed(1)}px;top:${(-3 * k + tilt(seed + k * 13, .7)).toFixed(1)}px;z-index:${5 - k};--rot:${tilt(seed + k * 3, 1.2)}deg"></div>`;
        cards += rcard(r, need > 0 && n >= need ? 'need' : '', `z-index:10;--rot:${tilt(seed, .7)}deg;${wasEmpty ? `animation:cardIn .01s both;animation-delay:${Math.round(330 - el)}ms` : ''}`);
      }
      for (let k = 0; k < drop; k++) {
        const side = k % 2 ? 1 : -1;
        cards += rcard(r, 'fly', `--rot:${tilt(hs(r), .7)}deg;--fx:${side * (10 + k * 6)}px;--fr:${side * (6 + k * 3)}deg;z-index:${30 + k};animation-delay:${Math.round(k * 120 - el)}ms`);
      }
      const short = need > n;
      const store = g.storehouse[r];
      const info = {
        kind: 'Resource',
        title: cap(r),
        desc: `Your ${r} cards. Build costs and tribute spend them; hover a build option to see which cards it would use.`,
        now: `${n} in hand${store ? ` · ${store} stored` : ''}`,
        lines: short ? [`Missing ${need - n} for the option you are hovering`] : [],
      };
      return `<div class="stack ${short ? 'short' : ''}" ${this.tipAttr(`res:${r}`, info)} data-hl="hand:${r} store:${r}">
        <div class="stack-cards">${cards}${n > 0 ? `<span class="count${n >= 100 ? ' l3' : ''}" data-ck="hand-${r}">${this.feel.value(`hand-${r}`, n)}</span>` : ''}</div>
        <span class="stack-label">${short ? `<b class="bad">need ${need - n} more</b>` : ''}${g.storehouse[r] ? ` <span class="store">+${g.storehouse[r]} stored</span>` : ''}&nbsp;</span></div>`;
    }).join('');
    const stored = RES.filter((r) => g.storehouse[r] > 0);
    const storeBox = stored.length ? `<div class="storebox"><div class="eyebrow">Storehouse</div>${stored.map((r) => `<span data-hl="store:${r}">${resDot(r)}${g.storehouse[r]} ${r}</span>`).join('')}<small>counts toward the tribute</small></div>` : '';
    const total = RES.reduce((s, r) => s + g.hand[r], 0);
    const countable = g.handCountable();
    // card slots
    const canPlay = g.canAct() && !this.busy;
    const sel = g.cards.some((c) => c.uid === this.selCard) ? this.selCard : null;
    const pcard = (it, name, tipKey, info, extra = '', hl = '', cls = '') => `<div class="pcard ${it.rarity} ${cls}" style="rotate:${tilt(hs(tipKey), .8)}deg" ${this.tipAttr(tipKey, info)} ${hl}><i class="dot" style="background:${CAT_DOT[it.cat] || '#a6a59e'}"></i><span class="art" style="background-position:${cardArt(it)}"></span><span class="nm">${esc(name)}</span>${extra}</div>`;
    const cardSlots = Array.from({ length: g.limits.handSlots }, (_, i) => {
      const c = g.cards[i];
      if (!c) return `<div class="slot-wrap"><div class="slot empty">Empty<br>card slot</div></div>`;
      const it = ITEMS[c.id];
      const info = {
        kind: CAT_LABEL[it.cat] || 'Card',
        title: it.name,
        desc: it.desc,
        now: canPlay ? 'Playable now.' : 'Playable on your turn, when no roll is pending.',
        lines: [`Rarity: ${it.rarity}`],
      };
      const picked = sel === c.uid;
      return `<div class="slot-wrap ${picked ? 'picked' : ''}">${pcard(it, it.name, `card:${c.uid}`, info, '', `data-hl="card:${c.uid}" data-a="pick-card" data-uid="${c.uid}" role="button" tabindex="0"`, picked ? 'sel' : '')}${picked ? `<button class="small play ${canPlay ? 'primary' : ''}" data-a="play" data-uid="${c.uid}" ${canPlay ? '' : 'disabled'} title="${canPlay ? 'Play this card' : 'Cards can be played during your turn, when no roll is pending'}">Play</button>` : ''}</div>`;
    }).join('');
    const guildSlots = Array.from({ length: g.limits.guildSlots }, (_, i) => {
      const gd = g.guilds[i];
      if (!gd) return `<div class="slot-wrap"><div class="slot empty small-slot">Empty<br>guild slot</div></div>`;
      const it = ITEMS[gd.id];
      const now = this.guildNow(gd.id);
      const nm = `${it.name}${gd.data.terrain ? ` (${gd.data.terrain})` : ''}`;
      const info = { kind: 'Guild · always on', title: nm, desc: it.desc, now, lines: [`Rarity: ${it.rarity}`] };
      return `<div class="slot-wrap">${pcard(it, nm, `guild:${gd.uid}`, info)}</div>`;
    }).join('');
    this.$hand.innerHTML = `
      <section class="zone"><div class="zone-h">Hand <b>${total} card${total === 1 ? '' : 's'}${countable > 7 ? ' · <span class="bad">over 7: a 7 makes you discard</span>' : ' · safe from the robber up to 7'}</b></div><div class="res-row">${stacks}${storeBox}</div></section>
      <section class="zone"><div class="zone-h">Cards <b>${g.cards.length} of ${g.limits.handSlots}</b></div><div class="slots" style="--n:${g.limits.handSlots}">${cardSlots}</div></section>
      <section class="zone guilds"><div class="zone-h">Guilds <b>${g.guilds.length} of ${g.limits.guildSlots}</b></div><div class="slots" style="--n:${g.limits.guildSlots}">${guildSlots}</div></section>
      `;
    this.renderHud();
    this.fitHand();
    this.$stage.style.setProperty('--hand-h', `${this.$hand.offsetHeight}px`);
    const lz = this.$hand.firstElementChild;
    this.$stage.style.setProperty('--hand-l', `${lz ? lz.offsetHeight : 160}px`);
    if (this.view && this.$hand.offsetHeight !== this._handH) { this._handH = this.$hand.offsetHeight; this.view.fit(); }
    this.applyHighlights();
  }

  // Score and titles (longest road, largest army) live in the top left corner, next to the menu button.
  renderHud() {
    if (this.$hud) this.$hud.innerHTML = `${this.vpBig()}${this.statCards()}`;
  }

  // The bottom bar scales (--hz) so that Hand, Cards and Guilds fill all the width left of the action card.
  fitHand() {
    const h = this.$hand;
    if (!h) return;
    if (window.innerWidth <= 900) { h.style.removeProperty('--hz'); return; }
    const kids = [...h.children];
    if (!kids.length) return;
    const gap = parseFloat(getComputedStyle(h).columnGap) || 0;
    const width = (z) => { h.style.setProperty('--hz', z); return kids.reduce((a, k) => a + k.offsetWidth, 0) + gap * (kids.length - 1); };
    const avail = h.clientWidth - 36;
    const byH = (0.27 * window.innerHeight - 56) / 112; // the bar must not eat the board
    let lo = 0.5, hi = Math.max(0.5, Math.min(1.6, byH));
    if (width(hi) <= avail) lo = hi; // widest allowed already fits
    else for (let i = 0; i < 8; i++) { const mid = (lo + hi) / 2; if (width(mid) <= avail) lo = mid; else hi = mid; }
    const hz = lo;
    h.style.setProperty('--hz', hz.toFixed(3));
  }

  // ---------------------------------------------------------------- tutorial
  // True until the first roll of the run has been made: that is when the tutorial button is offered on the card.
  tutorialOffered() {
    const g = this.game;
    return !g.phase || g.phase === 'setup' || (g.ante === 1 && g.blind === 0 && g.rollsUsed === 0 && !g.lastRoll);
  }

  tutorialButton() {
    return `<button class="small ghost tut-btn ${this.tutSeen ? '' : 'new'}" data-a="tutorial">▶ Play tutorial</button>`;
  }

  startTutorial() {
    this.setMenu(false);
    this.tut = { i: 0 };
    this.renderTutorial();
  }

  endTutorial() {
    this.tut = null;
    this.tutSeen = true;
    try { localStorage.setItem('hd-tutorial', 'seen'); } catch { /* ignore */ }
    this.renderTutorial();
    this.render();
  }

  tutStep(d) {
    if (!this.tut) return;
    const i = this.tut.i + d;
    if (i >= TUTORIAL.length) return this.endTutorial();
    this.tut.i = Math.max(0, i);
    this.renderTutorial();
  }

  renderTutorial() {
    let el = this.$tut;
    if (!el) {
      el = this.$tut = document.createElement('div');
      el.id = 'tutorial';
      document.body.appendChild(el);
      addEventListener('resize', () => { this.fitHand(); this.$stage.style.setProperty('--hand-h', `${this.$hand.offsetHeight}px`); if (this.view) this.view.fit(); if (this.tut) this.renderTutorial(); });
    }
    if (!this.tut) { el.hidden = true; el.innerHTML = ''; return; }
    const s = TUTORIAL[this.tut.i];
    const q = (sel) => (sel ? document.querySelector(sel) : null);
    const target = q(s.sel) || q(s.fallback);
    let box = null;
    if (target) {
      const r = target.getBoundingClientRect();
      const r2 = s.alsoSel ? q(s.alsoSel)?.getBoundingClientRect() : null;
      const l = Math.min(r.left, r2 ? r2.left : r.left), t = Math.min(r.top, r2 ? r2.top : r.top);
      const rr = Math.max(r.right, r2 ? r2.right : r.right), b = Math.max(r.bottom, r2 ? r2.bottom : r.bottom);
      const pad = s.pad ?? 8;
      box = { l: l - pad, t: t - pad, w: rr - l + 2 * pad, h: b - t + 2 * pad };
    }
    const last = this.tut.i === TUTORIAL.length - 1;
    const dots = TUTORIAL.map((_, k) => `<i class="${k === this.tut.i ? 'on' : k < this.tut.i ? 'done' : ''}"></i>`).join('');
    el.hidden = false;
    el.innerHTML = `${box ? `<div class="tut-spot" style="left:${box.l}px;top:${box.t}px;width:${box.w}px;height:${box.h}px"></div>` : '<div class="tut-dim"></div>'}
      <div class="tut-card" role="dialog" aria-label="Tutorial"><div class="tut-step">Step ${this.tut.i + 1} of ${TUTORIAL.length}</div><h3>${s.title}</h3><p>${s.text}</p>
        <div class="tut-dots">${dots}</div>
        <div class="tut-nav"><button class="small ghost" data-a="tut-end">${last ? 'Close' : 'Skip'}</button><span class="sp"></span>${this.tut.i ? '<button class="small" data-a="tut-back">Back</button>' : ''}<button class="primary small" data-a="tut-next">${last ? 'Start playing' : 'Next'}</button></div></div>`;
    // place the card beside the highlighted part, inside the window
    const card = el.querySelector('.tut-card');
    const cw = card.offsetWidth, ch = card.offsetHeight, m = 14;
    let x = (innerWidth - cw) / 2, y = (innerHeight - ch) / 2;
    if (box) {
      const spots = [
        [box.l + box.w + m, box.t + box.h / 2 - ch / 2],
        [box.l - cw - m, box.t + box.h / 2 - ch / 2],
        [box.l + box.w / 2 - cw / 2, box.t - ch - m],
        [box.l + box.w / 2 - cw / 2, box.t + box.h + m],
      ];
      const fit = spots.find(([sx, sy]) => sx >= 8 && sy >= 8 && sx + cw <= innerWidth - 8 && sy + ch <= innerHeight - 8);
      if (fit) [x, y] = fit;
      else { x = Math.max(8, Math.min(innerWidth - cw - 8, box.l + 20)); y = Math.max(8, Math.min(innerHeight - ch - 8, box.t + 20)); }
    }
    card.style.left = `${Math.max(8, x)}px`;
    card.style.top = `${Math.max(8, y)}px`;
    card.querySelector('[data-a="tut-next"]').focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- drawer (log / dev tools)
  renderDrawer() {
    const g = this.game;
    if (!this.drawer) { this.$drawer.innerHTML = ''; return; }
    let body;
    if (this.drawer === 'log') {
      body = `<div class="log">${g.logLines.slice(-200).reverse().map((l) => `<div class="${l.cls}">${esc(l.msg)}</div>`).join('')}</div>`;
    } else {
      const opts = [1, 2, 3, 4, 5, 6].map((n) => `<option>${n}</option>`).join('');
      body = `<p class="small muted">Testing helpers. They change the run, so use them to set up situations, not to play.</p>
        <div><b class="small">Add resources</b><div class="row" style="margin-top:4px">${RES.map((r) => `<span class="row" style="gap:2px">${resDot(r)}<button class="small" data-a="dev-res" data-r="${r}" data-n="1">+1</button><button class="small" data-a="dev-res" data-r="${r}" data-n="5">+5</button></span>`).join('')}</div></div>
        <div><b class="small">Force next roll</b><div class="row" style="margin-top:4px"><select id="dev-d1">${opts}</select> + <select id="dev-d2">${opts}</select><button class="small" data-a="dev-force">Set</button>${g.devForce ? `<span class="small muted">${g.devForce.join('+')} queued</span>` : ''}</div></div>
        <div><b class="small">Give item</b><div class="row" style="margin-top:4px"><select id="dev-item" style="max-width:100%">${ITEM_LIST.map((i) => `<option value="${i.id}">${i.cat}: ${i.name}</option>`).join('')}</select><button class="small" data-a="dev-item" ${this.busy ? 'disabled' : ''}>Give</button></div></div>
        <div class="row"><button class="small" data-a="dev-shop" ${g.phase === 'turn' && !g.pendingRoll ? '' : 'disabled'}>Skip tribute → shop</button><button class="small" data-a="dev-budget" ${g.phase === 'shop' ? '' : 'disabled'}>+10 shop budget</button></div>
        <p class="small muted">Seed ${g.seed}</p>`;
    }
    this.$drawer.innerHTML = `<aside class="drawer"><div class="drawer-h"><button class="tab ${this.drawer === 'log' ? 'on' : ''}" data-a="drawer-tab" data-tab="log">Log</button><button class="tab ${this.drawer === 'dev' ? 'on' : ''}" data-a="drawer-tab" data-tab="dev">Dev tools</button><button class="small" style="margin-left:auto" data-a="close-drawer">Close</button></div><div class="drawer-b">${body}</div></aside>`;
  }

  // ---------------------------------------------------------------- dialogs
  renderModal() {
    let html = '';
    if (this.modal) html = this.renderIoModal(this.modal);
    else if (this.dialog === 'help') html = this.renderHelp();
    else if (this.dialog === 'new') html = this.renderNewRun();
    this.$modal.innerHTML = html ? `<div class="modal-back">${html}</div>` : '';
  }

  renderIoModal(m) {
    const cancel = m.cancel ? '<button data-a="cancel-modal">Cancel</button>' : '';
    if (m.type === 'options') {
      return `<div class="modal" role="dialog" aria-modal="true"><h2>${esc(m.prompt)}</h2><div class="opts">${m.options.map((o, i) => `<button data-a="opt" data-i="${i}" ${o.disabled ? 'disabled' : ''}>${esc(o.label)}</button>`).join('')}</div><div class="modal-foot">${cancel}</div></div>`;
    }
    if (m.type === 'face') return ''; // chosen on the dice in the action card
    if (m.type === 'resources') {
      const total = RES.reduce((s, r) => s + m.counts[r], 0);
      return `<div class="modal" role="dialog" aria-modal="true"><h2>${esc(m.prompt)}</h2><p class="muted">${m.discard ? 'Discard' : 'Choose'} ${m.n} · selected <b>${total}</b></p>
        <div class="picker">${RES.map((r) => `<div class="pick">${rcard(r, 'sm', '')}<span class="n">${m.counts[r]}</span><div class="pm"><button data-a="res-dec" data-r="${r}" aria-label="less ${r}">−</button><button data-a="res-inc" data-r="${r}" aria-label="more ${r}" ${total >= m.n || (m.max && m.counts[r] >= m.max[r]) ? 'disabled' : ''}>+</button></div>${m.max ? `<span class="small muted">have ${m.max[r]}</span>` : ''}</div>`).join('')}</div>
        <div class="modal-foot">${cancel}<button class="primary" data-a="res-ok" ${total === m.n ? '' : 'disabled'}>Confirm</button></div></div>`;
    }
    return '';
  }

  renderNewRun() {
    const g = this.game;
    const mid = g && g.phase !== 'gameover' && g.phase !== 'setup';
    return `<div class="modal" role="dialog" aria-modal="true"><h2>Start a new run</h2>
      ${mid ? '<p class="bad small">Your current run will end.</p>' : ''}
      <label class="small muted" for="new-seed">Seed (optional): the same seed gives the same board and dice.</label>
      <input id="new-seed" type="number" min="1" placeholder="leave empty for random">
      <div class="modal-foot"><button data-a="close-dialog">Cancel</button><button data-a="random-seed">Random run</button><button class="primary" data-a="start-seed">Start</button></div></div>`;
  }

  renderHelp() {
    return `<div class="modal help" role="dialog" aria-modal="true"><h2>How to play</h2>
      <p>Grow one island across an endless run. The panel on the right guides you through every round:</p>
      <ol><li><b>Roll</b> the dice. Every hex with that number pays its resource to your adjacent buildings (settlement 1, city 2).</li>
      <li><b>Result</b> shows what the dice did and what you got. On a 7 the robber strikes: discard half if you hold more than 7 cards, and one of your hexes gets blocked.</li>
      <li><b>Build & trade</b> between rolls: build, trade with the bank (cheaper with ports), ship to the Storehouse, play cards. You get 4 rolls per round.</li>
      <li><b>Tribute</b>: pay what the top bar shows, or the run ends. Each part needs a different resource type. Leftover cards stay in your hand.</li>
      <li><b>Losing streak:</b> if all 4 rolls of a round give you nothing, you get a free development card.</li>
      <li><b>Shop</b>: your score plus VP earned this round is your budget. Unspent VP is lost.</li></ol>
      <p>Each ante has three rounds: Small, Big and Boss. Bosses add a drawback for one round. Tributes grow every ante.</p>
      <p class="small muted">Keys: Enter or Space = the main button · Esc = cancel or close.</p>
      <div class="modal-foot"><button data-a="close-dialog" class="primary">Got it</button></div></div>`;
  }
}
