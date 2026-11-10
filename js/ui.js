// Browser UI (draft 0.2).
// Layout: status bar · board stage + step panel · hand.
// The step panel walks the player through a round: Roll → Result → Build & trade → … → Tribute → Shop.
// Each step shows only what is possible right now; one main button moves the game forward.
// The UI also implements the engine's `io` interface (board clicks and choice dialogs).
import { Game, COSTS, BLINDS } from './game.js';
import { RES, TERRAIN_RES, pips } from './board.js';
import { ITEMS, ITEM_LIST, BOSS_BY_ID, ROLLS_PER_ROUND, LOADING } from './content.js';

const TERRAIN_COLOR = { hills: '#c8734a', forest: '#3f7d4a', pasture: '#9ccf6a', fields: '#e8c547', mountains: '#8e939c', desert: '#e3d3a4' };
const RES_ICON = { brick: 'B', lumber: 'L', wool: 'W', grain: 'G', ore: 'O' };
const HEX_BADGE = { fertile: '+1', palisade: 'PAL', gold: 'GOLD', river: 'RIVER', guildDistrict: 'GUILD', volcanic: 'VOLC', sister: 'SIS', haven: 'HAVEN', capital: 'CAP' };
const TOKEN_BADGE = { jackpot: 'JACK', twinToken: 'TWIN', sevenToken: '+7', heartland: '±1', evergreen: 'EVER' };
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

// Simple white glyphs for the resource cards.
const ICON = {
  brick: '<svg viewBox="0 0 24 24" fill="#fff"><rect x="2" y="5" width="9" height="5" rx="1"/><rect x="13" y="5" width="9" height="5" rx="1"/><rect x="6" y="12" width="12" height="5" rx="1"/><rect x="2" y="12" width="2.5" height="5" rx="1"/><rect x="19.5" y="12" width="2.5" height="5" rx="1"/></svg>',
  lumber: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M12 2 5 12h4l-4 6h14l-4-6h4z"/><rect x="10.5" y="18" width="3" height="4"/></svg>',
  wool: '<svg viewBox="0 0 24 24" fill="#fff"><circle cx="8" cy="12" r="4.5"/><circle cx="13" cy="9" r="5"/><circle cx="16.5" cy="13.5" r="4.5"/><circle cx="11" cy="15" r="4"/></svg>',
  grain: '<svg viewBox="0 0 24 24" fill="#fff"><rect x="11.2" y="6" width="1.6" height="16"/><ellipse cx="9" cy="8" rx="2" ry="3.4" transform="rotate(-25 9 8)"/><ellipse cx="15" cy="8" rx="2" ry="3.4" transform="rotate(25 15 8)"/><ellipse cx="9" cy="13" rx="2" ry="3.4" transform="rotate(-25 9 13)"/><ellipse cx="15" cy="13" rx="2" ry="3.4" transform="rotate(25 15 13)"/><ellipse cx="12" cy="4" rx="1.8" ry="3"/></svg>',
  ore: '<svg viewBox="0 0 24 24" fill="#fff"><path d="M2 20 9 7l4 6 3-4 6 11z"/></svg>',
};
const rcard = (r, cls = '', style = '') => `<div class="rcard ${cls}" style="background:var(--${r});${style}">${ICON[r]}<span>${r}</span></div>`;

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
    this.$status = document.getElementById('status');
    this.$board = document.getElementById('board');
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
        if (this.boardReq?.cancel) this.resolveBoard(null);
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
    this.renderStatus();
    this.renderBoard();
    this.renderPrompt();
    this.renderOverlay();
    this.renderPanel();
    this.renderHand();
    this.renderDrawer();
    this.renderModal();
  }

  // ---------------------------------------------------------------- status bar
  renderStatus() {
    const g = this.game;
    const vp = g.vpBreakdown();
    const out = [];
    out.push(`<span class="round-chip ${g.blind === 2 ? 'boss' : ''}">Ante ${g.ante} · ${BLINDS[g.blind]}</span>`);
    if (g.phase === 'turn') {
      const dots = Array.from({ length: ROLLS_PER_ROUND }, (_, i) => `<span class="dot ${i < g.rollsUsed ? 'used' : ''}"></span>`).join('');
      out.push(`<span class="stat" title="Rolls this round">Rolls <span class="dots">${dots}</span></span>`);
    }
    if (g.phase === 'shop') {
      out.push(`<span class="tribute"><span class="pay-state ok">✓ Tribute paid</span></span>`);
    } else if (g.tribute) {
      const due = g.tributeDue();
      const assign = g.autoAssign();
      const ok = assign != null;
      const parts = due.map((p, i) => {
        const t = p.type || (ok ? assign[i] : null);
        return `<span class="tpart ${ok ? 'ok' : ''}" title="${p.type ? 'Must be ' + p.type : 'Any resource type (each part a different one)'}">${t ? resDot(t) : ''}<b>${p.amount}</b>${p.type ? ' ' + p.type : ''}</span>`;
      }).join('<span class="muted">+</span>');
      const state = g.phase === 'setup' ? '' : ok ? '<span class="pay-state ok">✓ payable</span>' : '<span class="pay-state no">✗ not yet</span>';
      out.push(`<span class="tribute" title="Pay this at the end of the round. Each part needs a different resource type."><span class="small muted">Tribute</span>${parts}${state}</span>`);
    }
    out.push(`<span class="stat" title="Settlements ${vp.settlements} · Cities ${vp.cities} · VP cards ${vp.vpCards} · Longest road ${vp.road} (length ${vp.longestRoad}) · Army ${vp.army} (${g.knights} knights)">Score <b>${vp.total}</b> VP</span>`);
    out.push(`<span class="stat">Survived <b>${g.roundsSurvived}</b></span>`);
    const boss = g.phase === 'shop' && g.blind === 2 ? BOSS_BY_ID[g.nextBossId] : g.boss;
    out.push(`<span class="boss-chip ${g.blind === 2 && g.phase !== 'shop' ? 'active' : ''}" title="${esc(boss.desc)}">${g.blind === 2 && g.phase !== 'shop' ? 'Boss active' : 'Boss'}: ${boss.name}</span>`);
    this.$status.innerHTML = out.join('');
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
    const B = g.board;
    const req = this.boardReq;
    const isT = (k, id) => req && req.kind === k && req.ids.has(id);
    const resultStep = this.step() === 'result';
    const showPaid = resultStep ? new Set(g.report?.hexes || []) : new Set();
    const rolled = resultStep && g.report?.final && !g.report.final.zero ? g.report.final.sum : null;
    const parts = [];
    parts.push(`<polygon points="${[0, 1, 2, 3, 4, 5].map((i) => { const a = (Math.PI / 3) * i; return `${4.75 * Math.cos(a)},${4.75 * Math.sin(a)}`; }).join(' ')}" fill="#0002"/>`);
    for (const h of B.hexes) {
      const pts = h.vertices.map((v) => `${B.vertices[v].x},${B.vertices[v].y}`).join(' ');
      const cls = ['hex', isT('hex', h.id) ? 'target' : '', showPaid.has(h.id) ? 'paid' : '', req && req.kind === 'hex' && !isT('hex', h.id) ? 'dim' : ''].join(' ');
      parts.push(`<polygon class="${cls}" data-k="hex" data-id="${h.id}" points="${pts}" fill="${TERRAIN_COLOR[h.terrain]}"><title>${h.terrain}${TERRAIN_RES[h.terrain] ? ' → ' + TERRAIN_RES[h.terrain] : ''}${h.hexEffect ? ' · ' + ITEMS[h.hexEffect.id].name : ''}${h.tokenEffect ? ' · ' + ITEMS[h.tokenEffect.id].name : ''}</title></polygon>`);
      if (h.token) {
        const hot = h.token === 6 || h.token === 8;
        const hit = rolled != null && h.token === rolled;
        parts.push(`<g pointer-events="none"><circle class="token ${hit ? 'hit' : ''}" cx="${h.x}" cy="${h.y}" r=".33"/><text class="token-num ${hot && !h.hidden ? 'hot' : ''}" x="${h.x}" y="${h.y - 0.03}">${h.hidden ? '?' : h.token}</text>`);
        if (!h.hidden) {
          const n = pips(h.token);
          for (let i = 0; i < n; i++) parts.push(`<circle cx="${h.x + (i - (n - 1) / 2) * 0.07}" cy="${h.y + 0.2}" r=".022" fill="${hot ? '#c0392b' : '#333'}"/>`);
        }
        parts.push('</g>');
      }
      if (h.tokenEffect) {
        const lbl = h.tokenEffect.id === 'doubleToken' ? `+${h.tokenEffect.number}` : TOKEN_BADGE[h.tokenEffect.id];
        parts.push(`<text class="badge" x="${h.x}" y="${h.y - 0.48}" pointer-events="none">${lbl}</text>`);
      }
      if (h.hexEffect) {
        let lbl = HEX_BADGE[h.hexEffect.id];
        if (h.hexEffect.id === 'sister') lbl += `→${B.hexes[h.hexEffect.link].terrain.slice(0, 3)}`;
        parts.push(`<text class="badge" x="${h.x}" y="${h.y + 0.58}" pointer-events="none">${lbl}</text>`);
      }
      if (g.volcanoHex === h.id) parts.push(`<text class="badge" x="${h.x}" y="${h.y + 0.58}" pointer-events="none">VOLCANO</text>`);
    }
    for (const p of B.ports) {
      for (const v of p.vertices) parts.push(`<line x1="${p.x}" y1="${p.y}" x2="${B.vertices[v].x}" y2="${B.vertices[v].y}" stroke="#f7efd9" stroke-width=".03" stroke-dasharray=".06 .05"/>`);
      const lbl = p.type === 'generic' ? '3:1' : `2:1${RES_ICON[p.type]}`;
      const up = [p.up.overflow ? 'O' : '', p.up.bigger ? `+${p.up.bigger}` : '', p.up.smaller ? `−${p.up.smaller}` : '', p.up.free ? 'F' : ''].join('');
      parts.push(`<g class="port ${isT('port', p.id) ? 'target' : ''}" data-k="port" data-id="${p.id}"><circle cx="${p.x}" cy="${p.y}" r=".27" ${p.type !== 'generic' ? `style="fill:var(--${p.type})"` : ''}/><text x="${p.x}" y="${p.y - (up ? 0.05 : 0)}">${lbl}</text>${up ? `<text x="${p.x}" y="${p.y + 0.13}" style="font-size:.12px">${up}</text>` : ''}<title>${p.type === 'generic' ? 'Generic port: trade 3:1' : p.type + ' port: trade 2:1'}</title></g>`);
    }
    for (const e of B.edges) {
      const [a, b] = e.v.map((v) => B.vertices[v]);
      if (g.roads.has(e.id)) parts.push(`<line class="road" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`);
      else if (isT('edge', e.id)) {
        const sx = a.x + (b.x - a.x) * 0.18, sy = a.y + (b.y - a.y) * 0.18, ex = a.x + (b.x - a.x) * 0.82, ey = a.y + (b.y - a.y) * 0.82;
        parts.push(`<line class="edge target" data-k="edge" data-id="${e.id}" x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}"/>`);
      }
    }
    const rh = B.hexes[g.robber];
    parts.push(`<g pointer-events="none"><circle class="robber" cx="${rh.x + 0.42}" cy="${rh.y - 0.1}" r=".17"/><text x="${rh.x + 0.42}" y="${rh.y - 0.1}" class="token-num" style="fill:#fff;font-size:.18px">R</text></g>`);
    for (const v of B.vertices) {
      const b = g.buildings[v.id];
      const t = isT('vertex', v.id);
      if (b === 'settlement') parts.push(`<polygon class="bld ${t ? 'vtx target' : ''}" data-k="vertex" data-id="${v.id}" points="${v.x - 0.13},${v.y + 0.11} ${v.x + 0.13},${v.y + 0.11} ${v.x + 0.13},${v.y - 0.04} ${v.x},${v.y - 0.16} ${v.x - 0.13},${v.y - 0.04}"/>`);
      else if (b === 'city') parts.push(`<polygon class="bld ${t ? 'vtx target' : ''}" data-k="vertex" data-id="${v.id}" points="${v.x - 0.2},${v.y + 0.14} ${v.x + 0.2},${v.y + 0.14} ${v.x + 0.2},${v.y - 0.06} ${v.x + 0.05},${v.y - 0.06} ${v.x + 0.05},${v.y - 0.16} ${v.x - 0.07},${v.y - 0.24} ${v.x - 0.2},${v.y - 0.16}"/>`);
      else if (t) parts.push(`<circle class="vtx target" data-k="vertex" data-id="${v.id}" cx="${v.x}" cy="${v.y}" r=".13" fill="#fff"/>`);
    }
    this.$board.innerHTML = parts.join('');
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
    const current = step === 'adjust' ? 'roll' : step;
    const idx = STEPS.findIndex(([k]) => k === current);
    const stepper = step === 'setup' || step === 'gameover' ? '' : `<ol class="stepper">${STEPS.map(([k, l], i) => `<li class="${i === idx ? 'on' : i < idx ? 'done' : ''}">${l}</li>`).join('')}</ol>`;
    const scroll = this.$panel.querySelector('.panel-body')?.scrollTop || 0;
    this.$panel.innerHTML = `${stepper}<div class="panel-body">${view.body}</div>${view.foot ? `<div class="panel-foot">${view.foot}</div>` : ''}`;
    if (this.lastStep === step) this.$panel.querySelector('.panel-body').scrollTop = scroll;
    this.lastStep = step;
  }

  diceBlock(values, faces, opts = {}) {
    const g = this.game;
    return `<div class="dice2">${[0, 1].map((i) => {
      const d = g.dice[i];
      const ups = g.dieUps(i);
      const held = opts.held && opts.held[i];
      const notes = opts.notes ? opts.notes[i] : [];
      return `<div class="die-box">
        <div class="die-top"><div class="die-big ${held ? 'held' : ''}">${values ? (values[i] || '0') : '·'}</div>
          <div class="small muted">Die ${i + 1}${held ? '<br>held from last roll' : ''}</div></div>
        ${this.facesHtml(i, faces ? faces[i] : null)}
        ${ups.length || d.loaded ? this.dieTags(i) : ''}
        ${notes && notes.length ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  facesHtml(i, shownFace) {
    const d = this.game.dice[i];
    return `<div class="faces" title="The six faces of die ${i + 1}">${d.faces.map((f, k) => {
      const loaded = d.loaded && d.loaded.face === k;
      const title = `Face ${k + 1}: ${f.setter ? ITEMS[SETTER_ITEM[f.setter]].name : 'shows ' + f.value}${f.triggers.length ? ' · ' + f.triggers.map((t) => ITEMS[t].name).join(', ') : ''}${loaded ? ` · loaded L${d.loaded.level} (${Math.round(LOADING[d.loaded.level - 1][0] * 100)}%)` : ''}`;
      return `<span class="face ${loaded ? 'loaded' : ''} ${shownFace === k ? 'shown' : ''}" title="${esc(title)}">${f.setter ? FACE_LABEL[f.setter] : f.value}${f.triggers.length ? `<i>${f.triggers.map((t) => TRIG_LABEL[t]).join('')}</i>` : ''}</span>`;
    }).join('')}</div>`;
  }

  dieTags(i) {
    const g = this.game;
    const d = g.dice[i];
    const ups = g.dieUps(i);
    return `<div class="tags">${d.loaded ? `<span class="tag">Loaded L${d.loaded.level}</span>` : ''}${ups.map((u) => `<span class="tag" title="${esc(ITEMS[u].desc)}">${ITEMS[u].name}${d.used[u] ? ' (used)' : ''}${!d.upgrades.includes(u) ? ' (copied)' : ''}</span>`).join('')}</div>`;
  }

  viewSetup() {
    const g = this.game;
    const n = Object.keys(g.buildings || {}).length;
    const roads = g.roads ? g.roads.size : 0;
    const what = n > roads ? 'a road next to your new settlement' : `settlement ${n + 1} of 2`;
    return {
      body: `<h2>Set up your island</h2>
        <p>Place <b>${what}</b> on one of the white markers.</p>
        <div class="callout"><b>Picking a good spot</b><ul class="small" style="margin:6px 0 0;padding-left:18px">
          <li>Each corner touches up to three hexes. Every hex pays its resource when its number is rolled.</li>
          <li>More dots under a number = rolled more often. 6 and 8 are best.</li>
          <li>Try to touch different resources: the Boss tribute needs three different types.</li>
          <li>Both starting settlements give you one card per hex next to them.</li></ul></div>`,
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
        <div class="tiles">${mods.map((m) => `<button class="tile" data-a="mod" data-die="${m.die}" data-id="${m.id}" ${this.busy ? 'disabled' : ''}><span class="t-name">${MOD_INFO[m.id][0]} · die ${m.die + 1}</span><span class="t-desc">${MOD_INFO[m.id][1]}${m.id === 'twin' ? ` Other result: ${g.dice[m.die].faces[pr.alt[m.die]].value}.` : ''}</span></button>`).join('')}</div>`,
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
    const head = f.zero ? 'Mirror vs Mirror: 0' : f.robberFace ? "Robber's Face: counts as 7" : `${f.values[0]} + ${f.values[1]} = ${f.sum}`;
    const tags = [];
    if (f.isDouble) tags.push('<span class="pill">Double</span>');
    if (f.seven) tags.push('<span class="pill bad">7 · robber</span>');
    if (rep.echo) tags.push('<span class="pill">Echo roll</span>');
    const nothingWhy = !f.seven && !f.zero
      ? `No hex with a ${f.sum} touches your buildings${g.board.hexes.some((h) => h.token === f.sum && h.id === g.robber) ? ', or the robber blocks it' : ''}.`
      : '';
    const gainCards = [
      ...gains.map((r) => `<div class="pick" style="border:0;padding:0">${rcard(r, '', 'position:static;width:54px;height:72px')}<b class="good">+${rep.gains[r]}</b></div>`),
      ...losses.map((r) => `<div class="pick" style="border:0;padding:0">${rcard(r, '', 'position:static;width:54px;height:72px;opacity:.6')}<b class="bad">${rep.gains[r]}</b></div>`),
      ...store.map((r) => `<div class="pick" style="border:0;padding:0">${rcard(r, '', 'position:static;width:54px;height:72px')}<b class="${rep.storeGains[r] > 0 ? 'good' : 'bad'}">${rep.storeGains[r] > 0 ? '+' : ''}${rep.storeGains[r]} store</b></div>`),
    ].join('');
    const echoNext = g.echoQueue.length > 0;
    return {
      body: `<div class="sum-line">${head} ${tags.join(' ')}</div>
        ${this.diceBlock(f.values, g.lastRoll.faces, { notes: rep.dice.map((d) => d.notes) })}
        <h3>You got</h3>
        ${gainCards ? `<div class="gains">${gainCards}</div>` : `<p class="muted">Nothing this time. ${nothingWhy}</p>`}
        ${lines.length ? `<h3>What happened</h3><ul class="events">${lines.map((l) => `<li class="${l.cls}">${esc(l.msg)}</li>`).join('')}</ul>` : ''}
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
      return `<button class="tile ${why ? '' : 'ok'}" data-a="build" data-kind="${kind}" data-cost="${kind}" ${why || dis ? 'disabled' : ''}>
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
    const offers = g.shop.map((s, i) => {
      const price = g.slotPrice(s);
      const afford = g.budget >= price;
      const btn = `<button class="${!s.sold && afford ? 'primary' : ''}" data-a="buy" data-i="${i}" ${!s.sold && afford && !this.busy ? '' : 'disabled'}>${s.sold ? 'Bought' : `Buy · ${price === Infinity ? 'max' : price} VP`}</button>`;
      if (s.kind === 'pack') {
        return `<div class="offer pack ${s.sold ? 'sold' : ''}"><span class="kind">Pack · ${s.group}</span><span class="name">Choose 1 of 3</span>
          <div class="desc">${s.options.map((o) => `${o.name} <span class="rarity-${o.rarity}">(${o.rarity})</span>`).join('<br>')}</div>${btn}</div>`;
      }
      const it = s.item;
      return `<div class="offer ${it.rarity} ${s.sold ? 'sold' : ''}"><span class="kind">${CAT_LABEL[it.cat]} · <span class="rarity-${it.rarity}">${it.rarity}</span></span><span class="name">${it.name}</span>
        <div class="desc">${it.desc}${it.id === 'loaded' ? ' Price rises with the level.' : ''}</div>${btn}</div>`;
    }).join('');
    this.$overlay.innerHTML = `<div class="shop-head"><div><h2>Shop</h2><div class="muted small">Dice upgrades · field upgrades · cards · a pack</div></div><div class="budget">${g.budget} VP</div></div>
      <div class="shop-grid">${offers}</div>
      <div class="shop-foot"><button data-a="reroll" ${g.budget >= g.rerollPrice ? '' : 'disabled'}>Reroll offers · ${g.rerollPrice} VP</button><span class="small muted">Items that need a target (a face, a die, a hex, a port) ask you to pick it after you buy.</span></div>`;
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
      const shown = Math.min(n, 7);
      let cards = '';
      if (n === 0) cards = `<div class="rcard empty" style="top:0">${ICON[r].replace('fill="#fff"', 'fill="currentColor"')}<span>${r}</span></div>`;
      for (let i = 0; i < shown; i++) {
        const isNeed = need > 0 && i >= shown - Math.min(need, shown);
        cards += rcard(r, isNeed ? 'need' : '', `top:${i * 7}px;z-index:${i}`);
      }
      const short = need > n;
      return `<div class="stack ${short ? 'short' : ''}" title="${n} ${r}${short ? ` · need ${need}` : ''}">
        <div class="stack-cards">${cards}${n > 0 ? `<span class="count">${n}</span>` : ''}</div>
        <span class="stack-label">${short ? `<b class="bad">need ${need}</b>` : ''}${g.storehouse[r] ? ` <span class="store">+${g.storehouse[r]} stored</span>` : ''}&nbsp;</span></div>`;
    }).join('');
    const total = RES.reduce((s, r) => s + g.hand[r], 0);
    const countable = g.handCountable();
    // card slots
    const canPlay = g.canAct() && !this.busy;
    const cardSlots = Array.from({ length: g.limits.handSlots }, (_, i) => {
      const c = g.cards[i];
      if (!c) return '<div class="slot empty">Empty card slot</div>';
      const it = ITEMS[c.id];
      return `<div class="slot card ${it.rarity}"><span class="s-kind">${it.cat === 'edict' ? 'Edict' : 'Card'} · single use</span><span class="s-name">${it.name}</span><span class="s-desc" title="${esc(it.desc)}">${it.desc}</span>
        <button class="small ${canPlay ? 'primary' : ''}" data-a="play" data-uid="${c.uid}" ${canPlay ? '' : 'disabled'} title="${canPlay ? 'Play this card' : 'Cards can be played during your turn, when no roll is pending'}">Play</button></div>`;
    }).join('');
    const guildSlots = Array.from({ length: g.limits.guildSlots }, (_, i) => {
      const gd = g.guilds[i];
      if (!gd) return '<div class="slot empty">Empty guild slot</div>';
      const it = ITEMS[gd.id];
      return `<div class="slot card ${it.rarity}"><span class="s-kind">Guild · always on</span><span class="s-name">${it.name}${gd.data.terrain ? ` (${gd.data.terrain})` : ''}</span><span class="s-desc" title="${esc(it.desc)}">${it.desc}</span></div>`;
    }).join('');
    const dice = [0, 1].map((i) => `<div class="mini-die"><span class="small muted">Die ${i + 1}</span>${this.facesHtml(i, null)}${this.dieTags(i)}</div>`).join('');
    this.$hand.innerHTML = `
      <section class="zone"><div class="zone-h">Resources <b>${total} card${total === 1 ? '' : 's'}${countable > 7 ? ' · <span class="bad">over 7: a 7 makes you discard</span>' : ''}</b></div><div class="res-row">${stacks}</div></section>
      <section class="zone"><div class="zone-h">Cards in hand <b>${g.cards.length}/${g.limits.handSlots}</b></div><div class="slots" style="--n:${g.limits.handSlots}">${cardSlots}</div></section>
      <section class="zone"><div class="zone-h">Guilds <b>${g.guilds.length}/${g.limits.guildSlots}</b></div><div class="slots" style="--n:${g.limits.guildSlots}">${guildSlots}</div></section>
      <section class="zone"><div class="zone-h">Dice <b>hover faces for details</b></div><div class="mini-dice">${dice}</div></section>`;
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
        return `<button data-a="face" data-i="${i}" title="${esc(f.triggers.map((t) => ITEMS[t].name).join(', '))}">${f.setter ? FACE_LABEL[f.setter] : f.value}<small>${f.triggers.map((t) => TRIG_LABEL[t]).join(' ') || '&nbsp;'}</small></button>`;
      }).join('')}</div>`;
      return `<div class="modal" role="dialog" aria-modal="true"><h2>${esc(m.prompt)}</h2><p class="small muted">Upgrades stay on the physical face, not on its number. A new value-setter replaces the old one; triggers stack.</p>${dieBlock(0)}${dieBlock(1)}<div class="modal-foot">${cancel}</div></div>`;
    }
    if (m.type === 'resources') {
      const total = RES.reduce((s, r) => s + m.counts[r], 0);
      return `<div class="modal" role="dialog" aria-modal="true"><h2>${esc(m.prompt)}</h2><p class="muted">${m.discard ? 'Discard' : 'Choose'} ${m.n} · selected <b>${total}</b></p>
        <div class="picker">${RES.map((r) => `<div class="pick">${rcard(r)}<span class="n">${m.counts[r]}</span><div class="pm"><button data-a="res-dec" data-r="${r}" aria-label="less ${r}">−</button><button data-a="res-inc" data-r="${r}" aria-label="more ${r}" ${total >= m.n || (m.max && m.counts[r] >= m.max[r]) ? 'disabled' : ''}>+</button></div>${m.max ? `<span class="small muted">have ${m.max[r]}</span>` : ''}</div>`).join('')}</div>
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
      <li><b>Shop</b>: your score plus VP earned this round is your budget. Unspent VP is lost.</li></ol>
      <p>Each ante has three rounds: Small, Big and Boss. Bosses add a drawback for one round. Tributes grow every ante.</p>
      <p class="small muted">Keys: Enter or Space = the main button · Esc = cancel or close.</p>
      <div class="modal-foot"><button data-a="close-dialog" class="primary">Got it</button></div></div>`;
  }
}
