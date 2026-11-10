// Browser UI.
// Layout: left rail (run state) · board stage with the hand on top of it · right panel (the current step).
// The step panel walks the player through a round: Roll → Result → Build & trade → … → Tribute → Shop.
// Each step shows only what is possible right now; one main button moves the game forward.
// The UI also implements the engine's `io` interface (board clicks and choice dialogs).
import { Game, COSTS, BLINDS } from './game.js';
import { RES, TERRAIN_RES, pips } from './board.js';
import { ITEMS, ITEM_LIST, BOSS_BY_ID, ROLLS_PER_ROUND, LOADING, START_SETTLEMENTS, ECHO_BREAK } from './content.js';
import { BoardView } from './board-view.js?v=4';
import { figure } from './figures.js?v=4';

const TERRAIN_COLOR = { hills: '#c8734a', forest: '#3f7d4a', pasture: '#9ccf6a', fields: '#e8c547', mountains: '#8e939c', desert: '#e3d3a4' };
const RES_ICON = { brick: 'B', lumber: 'L', wool: 'W', grain: 'G', ore: 'O' };
const FACE_LABEL = { mirror: 'M', robber: 'R7', blank: '?' };
const SETTER_ITEM = { mirror: 'mirror', robber: 'robberFace', blank: 'blank' };
const TRIG_LABEL = { lucky: 'L', knightFav: 'kF', knightLucky: 'kL', robberFav: 'rF', robberLucky: 'rL', hidden: 'H' };
const MOD_INFO = {
  nudge: ['Nudge', 'Change this die by ±1 (once per round).'],
  recast: ['Recast', 'Reroll this die (once per round).'],
  alchemist: ['Alchemist', 'Set this die to any value (once per round).'],
  twin: ['Twin Die', 'Switch to the other result you rolled.'],
};
const CAT_LABEL = { face: 'Dice · face', die: 'Dice · whole die', token: 'Field · number token', hex: 'Field · hex', port: 'Field · port', classic: 'Card · single use', edict: 'Edict · single use', guild: 'Guild · always on', charter: 'Charter · instant' };
const PRE_ROLL_CARDS = ['bumper', 'omen', 'monopoly'];
const STEPS = [['roll', 'Roll'], ['result', 'Result'], ['build', 'Build & trade'], ['tribute', 'Tribute'], ['shop', 'Shop']];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const resDot = (r) => `<span class="res-dot" style="background:var(--${r})"></span>`;
const HL_MS = 3600; // how long a roll's highlights (pulses, +1 badges) stay lit
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

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
const faceArt = (f, loaded) => {
  const tone = loaded ? '#e6cf8c' : '#e9e4d6';
  let bg = tone, inner = '';
  if (f.setter === 'mirror') bg = `${svgUrl("<circle cx='50' cy='50' r='27' fill='#e9e4d6'/><circle cx='50' cy='50' r='17' fill='#17181b'/>")} center/100% 100% no-repeat, #17181b`;
  else if (f.setter === 'robber') { bg = '#17181b'; inner = '<span class="lbl">R</span>'; }
  else if (f.setter === 'blank') { bg = '#17181b'; inner = '<span class="lbl">?</span>'; }
  else bg = `${svgUrl(PIP_AT[f.value].map((q) => `<circle cx='${q[0]}' cy='${q[1]}' r='8.5' fill='#17181b'/>`).join(''))} center/100% 100% no-repeat, ${tone}`;
  const marks = f.triggers.length ? `<i class="trg">${[...new Set(f.triggers)].map((t) => TRIG_LABEL[t]).join('')}</i>` : '';
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
    this.$status = document.getElementById('status');
    this.$eyebrow = document.getElementById('rail-eyebrow');
    this.$title = document.getElementById('rail-title');
    this.$stepper = document.getElementById('stepper');
    this.$guilds = document.getElementById('guilds');
    this.$board = document.getElementById('board');
    this.view = new BoardView(this.$board);
    this.$prompt = document.getElementById('prompt');
    this.$overlay = document.getElementById('overlay');
    this.$panel = document.getElementById('panel');
    this.$hand = document.getElementById('hand');
    this.$drawer = document.getElementById('drawer');
    this.$modal = document.getElementById('modal-root');
    this.bindEvents();
  }

  // ---------------------------------------------------------------- lifecycle
  newGame(seed) {
    Object.assign(this, { boardReq: null, modal: null, dialog: null, busy: false, tributeTypes: null, tradeGive: null, preBuild: false });
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
      if (this.pinnedTip) return;
      const el = ev.target.closest?.('[data-tip]');
      if (el && el.dataset.tip !== this.tipKey) this.openTip(el.dataset.tip, el);
    });
    document.addEventListener('pointerout', (ev) => {
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
      if (ev.key === 'Escape') {
        if (this.pinnedTip) this.unpinTip();
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
    if (k === 'log' || k === 'dev') this.drawer = this.drawer === k ? null : k;
    this.render();
    if (k === 'new') setTimeout(() => document.getElementById('new-seed')?.focus(), 0);
  }

  onAction(a, d) {
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
    this.renderStatus();
    this.renderStepper();
    this.renderBoard();
    this.renderPrompt();
    this.renderOverlay();
    this.renderPanel();
    this.renderHand();
    this.renderDrawer();
    this.renderModal();
    this.refreshTip();
  }

  // ---------------------------------------------------------------- roll highlights
  // A roll's report gets `changes` when it resolves; that starts the highlight clock.
  syncHighlights() {
    const rep = this.game.report;
    const key = rep && rep.changes ? rep : null;
    if (key === this.hlReport) return;
    this.hlReport = key;
    this.hlStart = performance.now();
    this.hlMap = new Map();
    if (!key) return;
    for (const c of key.changes) this.hlMap.set(c.key, c);
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

  openTip(key, el) {
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

  // ---------------------------------------------------------------- left rail (run state)
  renderStatus() {
    const g = this.game;
    const vp = g.vpBreakdown();
    const bossNow = g.blind === 2 && g.phase !== 'shop';
    const boss = g.phase === 'shop' && g.blind === 2 ? BOSS_BY_ID[g.nextBossId] : g.boss;
    this.$eyebrow.textContent = `Ante ${g.ante} · Round ${g.blind + 1} of 3`;
    this.$title.textContent = `${BLINDS[g.blind]} Tribute`;
    const out = [];

    // the tribute due at the end of the round
    if (g.phase === 'shop') {
      out.push(`<div class="rcard-box"><div class="eyebrow">Tribute <b class="ok">Paid</b></div><div class="note" style="margin:0">Spend your VP in the shop, then start the next round.</div></div>`);
    } else if (g.tribute) {
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
        return `<div class="tpart"><div class="t-row">${t ? resDot(t) : '<span class="res-dot" style="background:var(--dim)"></span>'}<span>${t ? cap(t) : 'Any type'}</span><span class="have">${Math.min(have, p.amount)}<span> / ${p.amount}</span></span></div><div class="bar"><i style="width:${pct}%;--c:${t ? `var(--${t})` : 'var(--muted)'}"></i></div></div>`;
      }).join('');
      const state = g.phase === 'setup' ? '' : ok ? '<b class="ok">Ready to pay</b>' : '<b class="no">Not yet</b>';
      out.push(`<div class="rcard-box" ${this.tipAttr('tribute', { kind: 'Tribute', title: 'Due at round end', desc: 'Each part needs a different resource type. Storehouse cards count first, then your hand.', lines })}><div class="eyebrow">Due at round end ${state}</div>${parts}<div class="note">Each part is a different type. Shipped cards count too.</div></div>`);
    }

    // rolls and score
    const left = ROLLS_PER_ROUND - g.rollsUsed;
    const rollsBox = g.phase === 'turn'
      ? `<div class="rcard-box"><div class="eyebrow">Rolls left</div><div class="rolls" title="Rolls left this round">${Array.from({ length: ROLLS_PER_ROUND }, (_, i) => `<span class="dot ${i < left ? 'left' : ''}"></span>`).join('')}<b>${left}</b></div></div>`
      : `<div class="rcard-box"><div class="eyebrow">Survived</div><div class="big-num">${g.roundsSurvived}<small>${g.roundsSurvived === 1 ? 'round' : 'rounds'}</small></div></div>`;
    out.push(`<div class="pair">${rollsBox}<div class="rcard-box" data-hl="vp" title="Settlements ${vp.settlements} · Cities ${vp.cities} · VP cards ${vp.vpCards} · Longest road ${vp.road} (length ${vp.longestRoad}) · Army ${vp.army} (${g.knights} knights)"><div class="eyebrow">Score</div><div class="big-num">${vp.total}<small>VP</small></div></div></div>`);

    // effects that are running this round
    const fx = this.effects();
    if (fx.length) out.push(`<div class="fx">${fx.map(([t, cls, tip, key]) => `<span class="fx-chip ${cls}" ${this.tipAttr(`fx:${t}`, { kind: 'Active this round', title: t, desc: tip })} data-hl="${key || ''}">${t}</span>`).join('')}</div>`);

    // storehouse
    const stored = RES.filter((r) => g.storehouse[r] > 0);
    if (stored.length) out.push(`<div class="rcard-box"><div class="eyebrow">Storehouse</div><div class="store-row" style="margin-top:0">${stored.map((r) => `<span data-hl="store:${r}">${resDot(r)}${g.storehouse[r]} ${r}</span>`).join('')}</div><div class="note">Shipped cards count toward the tribute.</div></div>`);

    // boss
    out.push(`<div class="rcard-box" ${this.tipAttr('boss', { kind: bossNow ? 'Boss · active' : 'Boss', title: boss.name, desc: boss.desc })}><div class="eyebrow">${bossNow ? 'Boss this round' : g.phase === 'shop' && g.blind === 2 ? 'Next boss' : 'Boss of this ante'}</div><div class="name">${boss.name}</div><p>${boss.desc}</p></div>`);

    // dice
    out.push(`<div class="rcard-box"><div class="eyebrow">Your dice <b class="muted" style="font-weight:400">hover for details</b></div><div class="mini-dice">${[0, 1].map((i) => `<div class="mini-die">${this.facesHtml(i, null)}${this.dieTags(i)}</div>`).join('')}</div></div>`);
    this.$status.innerHTML = out.join('');
  }

  renderStepper() {
    const g = this.game;
    const step = this.step();
    if (step === 'setup' || step === 'gameover') { this.$stepper.hidden = true; return; }
    this.$stepper.hidden = false;
    const current = step === 'adjust' ? 'roll' : step;
    const idx = STEPS.findIndex(([k]) => k === current);
    this.$stepper.innerHTML = STEPS.map(([k, l], i) => `<span class="${i === idx ? 'on' : i < idx ? 'done' : ''}">${l}</span>`).join('');
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

  bossCallout() {
    const g = this.game;
    if (g.blind !== 2) return '';
    return `<div class="callout bad"><b>Boss round: ${g.boss.name}</b><div class="small">${g.boss.desc} This applies for this round only.</div></div>`;
  }

  // ---------------------------------------------------------------- board
  renderPrompt() {
    const b = this.boardReq;
    this.$prompt.hidden = !b;
    if (!b) return;
    this.$prompt.innerHTML = `<span><b>Click the board:</b> ${esc(b.prompt)}</span>${b.cancel ? '<button data-a="cancel-board">Cancel</button>' : ''}`;
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
    const view = {
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
    this.$panel.innerHTML = `<div class="panel-body">${view.body}</div>${view.foot ? `<div class="panel-foot">${view.foot}</div>` : ''}`;
    if (this.lastStep === step) this.$panel.querySelector('.panel-body').scrollTop = scroll;
    for (const b of this.$panel.querySelectorAll('.panel-foot button.primary[data-primary]')) b.insertAdjacentHTML('beforeend', '<kbd>Space</kbd>');
    this.lastStep = step;
  }

  diceBlock(values, faces, opts = {}) {
    const g = this.game;
    return `<div class="dice2">${[0, 1].map((i) => {
      const d = g.dice[i];
      const ups = g.dieUps(i);
      const held = opts.held && opts.held[i];
      const notes = opts.notes ? opts.notes[i] : [];
      const fi = faces ? faces[i] : (g.lastRoll ? g.lastRoll.faces[i] : 0);
      const face = d.faces[fi];
      const shownNum = face.setter ? null : face.value;
      const diff = values && values[i] !== shownNum;
      return `<div class="die-box">
        <div class="die-top">${this.cube(i, fi, held, faces != null)}
          <div class="small muted">Die ${i + 1}${held ? '<br>held from last roll' : ''}${values ? `<div class="die-val ${diff ? 'changed' : ''}" title="${diff ? 'The face was changed by an upgrade' : ''}">${diff ? '= ' : ''}${values[i] || 0}</div>` : ''}</div></div>
        ${this.facesHtml(i, faces ? faces[i] : null)}
        ${ups.length || d.loaded ? this.dieTags(i) : ''}
        ${notes && notes.length ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  // A CSS 3D cube showing the die's six real faces, turned to face `fi`. Tumbles after each new roll.
  cube(i, fi, held, live) {
    const d = this.game.dice[i];
    const SIDE = ['front', 'right', 'top', 'bottom', 'left', 'back']; // physical face k → cube side (opposites: 0-5, 1-4, 2-3)
    const TURN = { front: 'rotateX(0deg) rotateY(0deg)', right: 'rotateY(-90deg)', top: 'rotateX(-90deg)', bottom: 'rotateX(90deg)', left: 'rotateY(90deg)', back: 'rotateY(180deg)' };
    const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
    const TONE = { front: '#e4dfd0', right: '#d6d0c0', top: '#efeadc', bottom: '#bdb7a7', left: '#d6d0c0', back: '#e4dfd0' };
    const PP = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]] };
    const pr = 4.6;
    const pipBg = (v, ink) => PP[v].map((q) => `radial-gradient(circle at ${q[0]}% ${q[1]}%, ${ink} 0 ${pr}px, transparent ${pr + 0.8}px)`).join(', ');
    const sides = d.faces.map((f, k) => {
      const loaded = d.loaded && d.loaded.face === k;
      const tone = loaded ? '#e6cf8c' : TONE[SIDE[k]];
      let bg = `${pipBg(f.value, '#17181b')}, ${tone}`;
      let inner = '';
      if (f.setter === 'mirror') bg = `radial-gradient(circle at 50% 50%, #17181b 0 9px, ${tone} 10px 15px, #17181b 16px)`;
      else if (f.setter === 'robber') { bg = '#17181b'; inner = '<span class="lbl lt">R</span>'; }
      else if (f.setter === 'blank') { bg = '#17181b'; inner = '<span class="lbl lt">?</span>'; }
      return `<div class="side ${SIDE[k]}" style="background:${bg}">${inner}${f.triggers.length ? `<span class="trg">${f.triggers.map((t) => TRIG_LABEL[t]).join('')}</span>` : ''}</div>`;
    }).join('');
    const final = TURN[SIDE[fi]];
    let cls = '';
    let style = `--final:${final};transform:${final};`;
    const el = live ? this.rollElapsed() : null;
    if (el != null && !held) {
      const r = this.rollSpin[i];
      cls = 'rolling';
      style += `--rx0:${r[0]}deg;--ry0:${r[1]}deg;--rz0:${r[2]}deg;animation-delay:${-Math.round(el)}ms;`;
    }
    return `<div class="die3d ${held ? 'held' : ''}" ${this.tipAttr(`die:${i}`, this.dieInfo(i))} data-hl="die:${i}"><div class="tilt"><div class="cube ${cls}" style="${style}">${sides}</div></div></div>`;
  }

  // Milliseconds since the latest roll started, while its animation is still running (else null).
  rollElapsed() {
    const g = this.game;
    if (g.rollSeq !== this.seenSeq) {
      this.seenSeq = g.rollSeq;
      this.rollStart = performance.now();
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

  viewSetup() {
    const g = this.game;
    const n = Object.keys(g.buildings || {}).length;
    const roads = g.roads ? g.roads.size : 0;
    const what = n > roads ? 'a road next to your new settlement' : `settlement ${n + 1} of ${START_SETTLEMENTS}`;
    return {
      body: `<h2>Set up your island</h2>
        <p>Place <b>${what}</b> on one of the white markers.</p>
        <div class="callout"><b>Picking a good spot</b><ul class="small" style="margin:6px 0 0;padding-left:18px">
          <li>Each corner touches up to three hexes. Every hex pays its resource when its number is rolled.</li>
          <li>More dots under a number = rolled more often. 6 and 8 are best.</li>
          <li>Try to touch different resources: the Boss tribute needs three different types.</li>
          <li>Each starting settlement gives you one card per hex next to it.</li><li>Spread out: settlements need two edges of distance between them.</li></ul></div>`,
      foot: '<div class="hint">Click a white marker on the board to place it.</div>',
    };
  }

  viewRoll() {
    const g = this.game;
    const pre = g.cards.filter((c) => PRE_ROLL_CARDS.includes(c.id));
    return {
      body: `<h2>${BLINDS[g.blind]} round · ante ${g.ante}</h2>
        <p class="lead">You have <b>${ROLLS_PER_ROUND} rolls</b>. Each roll pays every hex with that number to your buildings next to it (settlement 1, city 2). Between rolls you can build and trade. At the end you pay the tribute shown at the top.</p>
        ${this.diceBlock(null, null)}
        ${this.bossCallout()}
        ${pre.length ? `<div class="callout"><b>Before rolling:</b> you can play ${pre.map((c) => ITEMS[c.id].name).join(', ')} from your hand below.</div>` : ''}`,
      foot: `<button class="primary big" data-a="roll" data-primary ${this.busy ? 'disabled' : ''}>Roll the dice</button>
        <div class="row" style="justify-content:center"><button class="small ghost" data-a="prebuild" ${this.busy ? 'disabled' : ''}>Build or trade first</button>
        <button class="small ghost" data-a="end" ${this.busy ? 'disabled' : ''}>Skip all rolls (+${ROLLS_PER_ROUND} VP)</button></div>`,
    };
  }

  viewAdjust() {
    const g = this.game;
    const pr = g.pendingRoll;
    const { v } = g.valuesOf(pr);
    const mods = g.modifiersAvailable();
    return {
      body: `<h2>You rolled ${v[0] || '?'} + ${v[1] || '?'}</h2>
        <p class="lead">Your dice upgrades can change this roll before it pays out.</p>
        ${this.diceBlock(v, pr.faces, { held: pr.hold.map((h) => h != null), notes: g.report?.dice.map((d) => d.notes) })}
        <h3>Change the roll (optional)</h3>
        <div class="tiles">${mods.map((m) => `<button class="tile-btn" data-a="mod" data-die="${m.die}" data-id="${m.id}" ${this.busy ? 'disabled' : ''}><span class="t-name">${MOD_INFO[m.id][0]} · die ${m.die + 1}</span><span class="t-desc">${MOD_INFO[m.id][1]}${m.id === 'twin' ? ` Other result: ${g.dice[m.die].faces[pr.alt[m.die]].value}.` : ''}</span></button>`).join('')}</div>`,
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
      body: `${this.diceBlock(f.values, g.lastRoll.faces, { notes: rep.dice.map((d) => d.notes) })}
        <div class="sum-line" ${this.revealStyle()}>${head} ${tags.join(' ')}</div>
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
      return `<button class="tile-btn ${why ? '' : 'ok'}" data-a="build" data-kind="${kind}" data-cost="${kind}" ${why || dis ? 'disabled' : ''}>
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
    else if (!ports.length) ship = '<p class="small muted">Build on a port (3:1 or 2:1 circle on the coast) to trade cheaper and ship cards to the Storehouse for a tribute bonus.</p>';
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
        ? `<button class="primary big" data-a="roll" data-primary ${dis ? 'disabled' : ''}>Roll again · ${rollsLeft} left</button>`
        : `<button class="primary big" data-a="end" data-primary ${dis ? 'disabled' : ''}>Go to the tribute</button>`;
    const secondary = rollsLeft > 0 || echo ? `<button data-a="end" ${dis ? 'disabled' : ''}>End round now${rollsLeft > 0 ? ` · +${rollsLeft} VP` : ''}</button>` : '';
    return {
      body: `<h2>Build & trade</h2>
        <p class="lead">${g.rollsUsed === 0 ? 'Before your first roll.' : `After roll ${g.rollsUsed} of ${ROLLS_PER_ROUND}.`} Do as much as you like. Hover an option to see the cards it uses.</p>
        ${this.bossCallout()}
        <div class="callout ${payable ? 'good' : ''}">${payable ? '✓ You can already pay this round\'s tribute. Anything you build now comes out of the rest.' : '✗ You can\'t pay the tribute yet. Keep the cards it needs, or trade toward them.'}</div>
        <h3>Build</h3>
        <div class="tiles">
          ${tile('settlement', 'Settlement', `+1 VP · produces 1 · ${c.settlement}/${g.limits.settlement}`)}
          ${tile('city', 'City', `Upgrade: +1 VP · produces 2 · ${c.city}/${g.limits.city}`)}
          ${tile('road', 'Road', `Reach new corners · ${c.road}/${g.limits.road}`)}
          ${tile('dev', 'Development card', 'Random card for your hand')}
        </div>
        <h3>Trade with the bank</h3>
        <div class="small muted">Give</div><div class="trade-grid">${giveRow}</div>
        <div class="small muted">Get 1</div><div class="trade-grid">${getRow}</div>
        <p class="small muted">${tradeHint}</p>
        <h3>Ship to the Storehouse</h3>${ship}`,
      foot: `${primary}${secondary}`,
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
        <p class="lead">${due.length > 1 ? 'Each part needs a different resource type. ' : ''}Storehouse cards are used first, then your hand. The best choice is pre-selected.</p>
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

  viewShop() {
    const g = this.game;
    const e = g.earned;
    const nextBoss = g.blind === 2 ? BOSS_BY_ID[g.nextBossId] : g.boss;
    const next = g.blind === 2 ? `ante ${g.ante + 1}, Small round` : `${BLINDS[g.blind + 1]} round`;
    return {
      body: `<h2>Shop</h2>
        <p class="lead">Spend your VP on upgrades in the shop on the left. Unspent VP is lost when you leave; buying never lowers your score.</p>
        <div class="callout"><div class="row between"><span>Budget</span><b style="font-size:20px">${g.budget} VP</b></div>
          <div class="small muted">Score ${g.vp} + unused rolls ${e.unusedRolls} + Storehouse surplus ${e.storehouse}${e.river ? ` + River ${e.river}` : ''}${e.twinFortune ? ` + Twin Fortune ${e.twinFortune}` : ''}</div></div>
        <div class="callout"><b>${g.blind === 2 ? 'Next boss' : 'Boss of this ante'}: ${nextBoss.name}</b><div class="small muted">${nextBoss.desc}</div>
          <button class="small" data-a="reroll-boss" ${g.budget >= g.bossRerollPrice ? '' : 'disabled'} style="margin-top:6px">Reroll boss · ${g.bossRerollPrice} VP</button></div>`,
      foot: `<button class="primary big" data-a="leave" data-primary ${this.busy ? 'disabled' : ''}>Next: ${next}</button>`,
    };
  }

  renderOverlay() {
    const g = this.game;
    const show = g.phase === 'shop' && !this.boardReq;
    this.$overlay.hidden = !show;
    if (!show) return;
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
      return `<div class="offer card-o ${it.rarity} ${s.sold ? 'sold' : ''}"><div class="o-stage"><div class="pcard big ${it.rarity}"><i class="dot" style="background:${CAT_DOT[it.cat] || '#a6a59e'}"></i><span class="k">${esc(CAT_SHORT[it.cat])}</span><span class="r rarity-${it.rarity}">${it.rarity}</span><span class="art" style="background-position:${cardArt(it)}"></span><span class="nm">${esc(it.name)}</span><span class="tx">${esc(desc)}</span></div></div>${priceTag(price)}${btn}</div>`;
    }).join('');
    const guilds = g.guilds.map((gd) => `<div class="pcard ${ITEMS[gd.id].rarity}" ${this.tipAttr(`sg:${gd.uid}`, { kind: 'Guild · always on', title: ITEMS[gd.id].name, desc: ITEMS[gd.id].desc })}><i class="dot" style="background:${CAT_DOT.guild}"></i><span class="art" style="background-position:${cardArt(ITEMS[gd.id])}"></span><span class="nm">${esc(ITEMS[gd.id].name)}</span></div>`).join('');
    this.$overlay.innerHTML = `<div class="shop">
      <div class="shop-head"><div><div class="eyebrow">Between rounds</div><h2>The Shop</h2></div><div class="budget-box"><div class="eyebrow">Budget · unspent VP is lost</div><div class="budget">${g.budget}<small>VP</small></div></div></div>
      <div class="shop-grid">${offers}</div>
      <div class="shop-foot"><button data-a="reroll" ${g.budget >= g.rerollPrice ? '' : 'disabled'}>Reroll offers · ${g.rerollPrice} VP</button><span class="small muted">Dice, field and port upgrades ask you to pick their target after you buy.</span></div>
      <div class="shop-have"><div class="rcard-box"><div class="eyebrow">Your dice</div><div class="mini-dice">${[0, 1].map((i) => `<div class="mini-die">${this.facesHtml(i, null)}${this.dieTags(i)}</div>`).join('')}</div></div>
      <div class="rcard-box"><div class="eyebrow">Guilds <b>${g.guilds.length} of ${g.limits.guildSlots}</b></div><div class="slots" style="--n:${Math.max(1, g.limits.guildSlots)}">${guilds || '<span class="small muted">None yet.</span>'}</div></div></div></div>`;
  }

  viewGameOver() {
    const g = this.game;
    return {
      body: `<h2>Run over</h2><p>You survived <b>${g.roundsSurvived}</b> round(s) and reached ante ${g.ante} with a score of ${g.vp} VP.</p>
        <p class="small muted">Seed ${g.seed}. The same seed gives the same board and dice if you make the same choices.</p>`,
      foot: '<button class="primary big" data-a="fresh" data-primary>New run</button><button data-a="again">Replay this seed</button>',
    };
  }

  // ---------------------------------------------------------------- hand
  renderHand() {
    const g = this.game;
    if (!g || !g.board) return;
    const cost = this.hoverCost;
    // resources
    const stacks = RES.map((r) => {
      const n = g.hand[r];
      const need = cost ? cost[r] || 0 : 0;
      let cards = '';
      if (n === 0) cards = `<div class="rcard empty" style="--c:var(--${r})"><i class="dot"></i><span class="nm">No ${r}</span></div>`;
      else {
        const under = Math.min(n - 1, 4);
        for (let k = under; k >= 1; k--) cards += `<div class="rcard under" style="left:${-3 * k}px;top:${-3 * k}px;z-index:${5 - k}"></div>`;
        cards += rcard(r, need > 0 && n >= need ? 'need' : '', 'z-index:10');
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
        <div class="stack-cards">${cards}${n > 0 ? `<span class="count${n >= 100 ? ' l3' : ''}">${n}</span>` : ''}</div>
        <span class="stack-label">${short ? `<b class="bad">need ${need - n} more</b>` : ''}${g.storehouse[r] ? ` <span class="store">+${g.storehouse[r]} stored</span>` : ''}&nbsp;</span></div>`;
    }).join('');
    const total = RES.reduce((s, r) => s + g.hand[r], 0);
    const countable = g.handCountable();
    // card slots
    const canPlay = g.canAct() && !this.busy;
    const pcard = (it, name, tipKey, info, extra = '', hl = '') => `<div class="pcard ${it.rarity}" ${this.tipAttr(tipKey, info)} ${hl}><i class="dot" style="background:${CAT_DOT[it.cat] || '#a6a59e'}"></i><span class="art" style="background-position:${cardArt(it)}"></span><span class="nm">${esc(name)}</span>${extra}</div>`;
    const cardSlots = Array.from({ length: g.limits.handSlots }, (_, i) => {
      const c = g.cards[i];
      if (!c) return '<div class="slot empty">Empty<br>card slot</div>';
      const it = ITEMS[c.id];
      const info = {
        kind: CAT_LABEL[it.cat] || 'Card',
        title: it.name,
        desc: it.desc,
        now: canPlay ? 'Playable now.' : 'Playable on your turn, when no roll is pending.',
        lines: [`Rarity: ${it.rarity}`],
      };
      return `<div class="slot-wrap">${pcard(it, it.name, `card:${c.uid}`, info, '', `data-hl="card:${c.uid}"`)}<button class="small play ${canPlay ? 'primary' : ''}" data-a="play" data-uid="${c.uid}" ${canPlay ? '' : 'disabled'} title="${canPlay ? 'Play this card' : 'Cards can be played during your turn, when no roll is pending'}">Play</button></div>`;
    }).join('');
    const guildSlots = Array.from({ length: g.limits.guildSlots }, (_, i) => {
      const gd = g.guilds[i];
      if (!gd) return '<div class="slot empty small-slot">Empty<br>guild slot</div>';
      const it = ITEMS[gd.id];
      const now = this.guildNow(gd.id);
      const nm = `${it.name}${gd.data.terrain ? ` (${gd.data.terrain})` : ''}`;
      const info = { kind: 'Guild · always on', title: nm, desc: it.desc, now, lines: [`Rarity: ${it.rarity}`] };
      return `<div class="slot-wrap">${pcard(it, nm, `guild:${gd.uid}`, info)}</div>`;
    }).join('');
    this.$guilds.innerHTML = `<div><div class="zone-h" style="justify-content:flex-end">Guilds <b>${g.guilds.length} of ${g.limits.guildSlots}</b></div><div class="slots" style="--n:${g.limits.guildSlots}">${guildSlots}</div></div>`;
    this.$hand.innerHTML = `
      <section class="zone"><div class="zone-h">Hand <b>${total} card${total === 1 ? '' : 's'}${countable > 7 ? ' · <span class="bad">over 7: a 7 makes you discard</span>' : ' · safe from the robber up to 7'}</b></div><div class="res-row">${stacks}</div></section>
      <section class="zone"><div class="zone-h">Cards <b>${g.cards.length} of ${g.limits.handSlots}</b></div><div class="slots" style="--n:${g.limits.handSlots}">${cardSlots}</div></section>`;
    if (this.view && this.$hand.offsetHeight !== this._handH) { this._handH = this.$hand.offsetHeight; this.view.fit(); }
    this.applyHighlights();
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
    if (m.type === 'face') {
      const g = this.game;
      const dieBlock = (d) => `<div class="small muted">Die ${d + 1}</div><div class="face-grid">${m.options.map((o, i) => {
        if (o.die !== d) return '';
        const f = g.dice[d].faces[o.face];
        return `<button data-a="face" data-i="${i}" title="${esc(f.triggers.map((t) => ITEMS[t].name).join(', ') || (f.setter ? ITEMS[SETTER_ITEM[f.setter]].name : 'Shows ' + f.value))}">${faceArt(f, d.loaded && d.loaded.face === o.face)}</button>`;
      }).join('')}</div>`;
      return `<div class="modal" role="dialog" aria-modal="true"><h2>${esc(m.prompt)}</h2><p class="small muted">Upgrades stay on the physical face, not on its number. A new value-setter replaces the old one; triggers stack.</p>${dieBlock(0)}${dieBlock(1)}<div class="modal-foot">${cancel}</div></div>`;
    }
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
