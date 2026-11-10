// Browser UI. The right panel is a guided flow that shows one step at a time:
//   Roll → (Adjust) → Result → Build & trade → … → Tribute → Shop
// Each step lists only what you can do right now, with a reason next to anything unavailable.
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
const PRE_ROLL_CARDS = ['bumper', 'omen', 'monopoly'];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const resDot = (r) => `<span class="res-dot" style="background:var(--${r})"></span>`;
const costChips = (c) => RES.filter((r) => c[r]).map((r) => `<span class="cost" title="${c[r]} ${r}">${resDot(r)}${c[r]}</span>`).join('');

export class UI {
  constructor() {
    this.game = null;
    this.busy = false;
    this.boardReq = null;
    this.modal = null; // a pending choice from the engine
    this.panel = null; // help dialog
    this.devOpen = false;
    this.tributeTypes = null;
    this.trade = { give: 'brick', get: 'grain' };
    this.preBuild = false;
    this.$board = document.getElementById('board');
    this.$side = document.getElementById('side');
    this.$below = document.getElementById('below');
    this.$prompt = document.getElementById('prompt');
    this.$modal = document.getElementById('modal-root');
    this.bindEvents();
  }

  // ---------------------------------------------------------------- lifecycle
  newGame(seed) {
    this.boardReq = null;
    this.modal = null;
    this.panel = null;
    this.busy = false;
    this.tributeTypes = null;
    this.preBuild = false;
    const g = new Game({ seed, io: this });
    this.game = g;
    g.onChange = () => this.render();
    document.getElementById('seed').value = g.seed;
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
    document.addEventListener('change', (ev) => {
      const el = ev.target;
      if (el.dataset.trade) { this.trade[el.dataset.trade] = el.value; this.render(); }
      if (el.dataset.tp != null) { this.readTributeSelects(); this.render(); }
    });
    this.$board.addEventListener('click', (ev) => {
      const el = ev.target.closest('[data-k]');
      if (!el || !this.boardReq) return;
      const id = Number(el.dataset.id);
      if (el.dataset.k === this.boardReq.kind && this.boardReq.ids.has(id)) this.resolveBoard(id);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.target.matches('input, select')) return;
      if (ev.key === 'Escape') {
        if (this.boardReq?.cancel) this.resolveBoard(null);
        else if (this.modal?.cancel) this.resolveModal(null);
        else if (this.panel) { this.panel = null; this.render(); }
        return;
      }
      if (this.busy || this.modal || this.panel || this.boardReq) return;
      if (ev.key === 'Enter' || ev.key === ' ') {
        const btn = this.$side.querySelector('[data-primary]:not([disabled])');
        if (btn) { ev.preventDefault(); btn.click(); }
      }
    });
  }

  onTop(k) {
    if (k === 'new') {
      const v = Number(document.getElementById('seed').value);
      const seed = v && v !== this.game?.seed ? v : Math.floor(Math.random() * 1e9);
      const btn = document.querySelector('[data-top="new"]');
      const midRun = this.game && this.game.phase !== 'gameover' && this.game.phase !== 'setup';
      if (midRun && !this.confirmNew) {
        // two-step confirm in the page (window.confirm is blocked in some embeds)
        this.confirmNew = true;
        btn.textContent = 'Click again to abandon run';
        setTimeout(() => { this.confirmNew = false; btn.textContent = 'New run'; }, 3000);
        return;
      }
      this.confirmNew = false;
      btn.textContent = 'New run';
      this.newGame(seed);
    }
    if (k === 'help') { this.panel = { type: 'help' }; this.render(); }
    if (k === 'dev') { this.devOpen = !this.devOpen; this.render(); }
  }

  onAction(a, d) {
    const g = this.game;
    switch (a) {
      case 'opt': return this.resolveModal(this.modal.options[Number(d.i)].value);
      case 'face': return this.resolveModal(this.modal.options[Number(d.i)]);
      case 'cancel-modal': return this.resolveModal(null);
      case 'cancel-board': return this.resolveBoard(null);
      case 'close-panel': this.panel = null; return this.render();
      case 'res-inc': case 'res-dec': {
        const m = this.modal;
        const total = RES.reduce((s, r) => s + m.counts[r], 0);
        if (a === 'res-inc' && total < m.n && (!m.max || m.counts[d.r] < m.max[d.r])) m.counts[d.r]++;
        if (a === 'res-dec' && m.counts[d.r] > 0) m.counts[d.r]--;
        return this.render();
      }
      case 'res-ok': return this.resolveModal({ ...this.modal.counts });
      // turn flow
      case 'roll': this.preBuild = false; return this.run(() => g.roll());
      case 'resolve': return this.run(() => g.resolveRoll());
      case 'mod': return this.run(() => g.useModifier(Number(d.die), d.id));
      case 'seen': if (g.report) g.report.seen = true; return this.render();
      case 'prebuild': this.preBuild = true; return this.render();
      case 'end': this.preBuild = false; g.endRound(); return;
      case 'build': return this.run(() => g.build(d.kind));
      case 'play': return this.run(() => g.playCard(Number(d.uid)));
      case 'trade': g.trade(this.trade.give, this.trade.get); return;
      case 'ship': g.ship(Number(d.port), d.r, d.mode); return;
      case 'ship-mixed': return this.run(() => g.shipMixed(Number(d.port)));
      // tribute
      case 'pay': this.readTributeSelects(); if (g.payTribute(this.tributeTypes)) this.tributeTypes = null; return;
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
    this.renderBoard();
    this.renderPrompt();
    this.renderSide();
    this.renderBelow();
    this.renderModal();
  }

  renderPrompt() {
    const b = this.boardReq;
    this.$prompt.hidden = !b;
    if (!b) return;
    this.$prompt.innerHTML = `<span><b>Click on the board:</b> ${esc(b.prompt)}</span>${b.cancel ? '<button data-a="cancel-board">Cancel (Esc)</button>' : ''}`;
  }

  renderBoard() {
    const g = this.game;
    const B = g.board;
    const req = this.boardReq;
    const isT = (k, id) => req && req.kind === k && req.ids.has(id);
    const showPaid = this.step() === 'result' ? new Set(g.report?.hexes || []) : new Set();
    const rolled = this.step() === 'result' && g.report?.final && !g.report.final.zero ? g.report.final.sum : null;
    const parts = [];
    parts.push(`<polygon points="${[0, 1, 2, 3, 4, 5].map((i) => { const a = (Math.PI / 3) * i; return `${4.75 * Math.cos(a)},${4.75 * Math.sin(a)}`; }).join(' ')}" fill="#0002"/>`);
    for (const h of B.hexes) {
      const pts = h.vertices.map((v) => `${B.vertices[v].x},${B.vertices[v].y}`).join(' ');
      const cls = ['hex', isT('hex', h.id) ? 'target' : '', showPaid.has(h.id) ? 'paid' : '', req && !isT('hex', h.id) && req.kind === 'hex' ? 'dim' : ''].join(' ');
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
      parts.push(`<g class="port ${isT('port', p.id) ? 'target' : ''}" data-k="port" data-id="${p.id}"><circle cx="${p.x}" cy="${p.y}" r=".27" ${p.type !== 'generic' ? `style="fill:var(--${p.type})"` : ''}/><text x="${p.x}" y="${p.y - (up ? 0.05 : 0)}">${lbl}</text>${up ? `<text x="${p.x}" y="${p.y + 0.13}" style="font-size:.12px">${up}</text>` : ''}<title>${p.type} port</title></g>`);
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

  // ---------------------------------------------------------------- right panel
  renderSide() {
    const g = this.game;
    const step = this.step();
    const body = {
      setup: () => this.viewSetup(),
      roll: () => this.viewRoll(),
      adjust: () => this.viewAdjust(),
      result: () => this.viewResult(),
      build: () => this.viewBuild(),
      tribute: () => this.viewTribute(),
      shop: () => this.viewShop(),
      gameover: () => this.viewGameOver(),
    }[step]();
    this.$side.innerHTML = `${this.viewHeader(step)}<div class="step-body">${body}</div>`;
  }

  viewHeader(step) {
    const g = this.game;
    const vp = g.vpBreakdown();
    const due = g.tribute ? g.tributeDue() : [];
    const payable = g.tribute && g.phase === 'turn' ? g.autoAssign() != null : null;
    const steps = [['roll', 'Roll'], ['result', 'Result'], ['build', 'Build & trade'], ['tribute', 'Tribute'], ['shop', 'Shop']];
    const current = step === 'adjust' ? 'roll' : step === 'gameover' ? '' : step;
    const dots = g.rollsUsed != null ? Array.from({ length: ROLLS_PER_ROUND }, (_, i) => `<span class="dot ${i < g.rollsUsed ? 'used' : ''}"></span>`).join('') : '';
    const status = [];
    if (g.bribe) status.push(`Bribe −${g.bribe}`);
    if (g.hasGuild('taxCollector') && g.counts().city) status.push(`Tax Collector −${g.counts().city}`);
    if (g.oldBootExtra) status.push(`Old Boot +${g.oldBootExtra}`);
    if (g.levyDelay) status.push('Levy Delay: tribute pushed to next round');
    if (g.monopoly) status.push(`Monopoly: all production → ${g.monopoly}`);
    if (g.bumper) status.push('Bumper Harvest: next roll ×2');
    if (g.omen != null) status.push(`Omen on ${g.omen}: ×3`);
    if (g.fireSale) status.push('Fire Sale: bank trades 2:1');
    if (g.bossIs?.('barbarians')) status.push(`Barbarian fleet ${g.fleet}/3`);
    if (g.brokeGame) status.push('<b class="good">Game broken: tribute counts as paid</b>');
    return `<div class="hdr">
      <div class="row between">
        <div><span class="blind ${g.blind === 2 ? 'boss' : ''}">Ante ${g.ante} · ${BLINDS[g.blind]}</span></div>
        <div class="row small"><span title="Settlements ${vp.settlements} · Cities ${vp.cities} · VP cards ${vp.vpCards} · Longest road ${vp.road} (length ${vp.longestRoad}) · Army ${vp.army} (${g.knights} knights)">Score <b>${vp.total} VP</b></span><span class="muted">·</span><span>Survived <b>${g.roundsSurvived}</b></span></div>
      </div>
      ${g.phase === 'shop' ? `<div class="tribute-line"><span class="ok">✓ Tribute paid.</span><span class="muted small">Next: ${g.blind === 2 ? `ante ${g.ante + 1}, Small round` : `${BLINDS[g.blind + 1]} round`}</span></div>` : `<div class="tribute-line">
        <span class="muted small">Tribute due</span>
        ${due.map((p) => `<span class="chip">${p.type ? resDot(p.type) : ''}<b>${p.amount}</b> ${p.type ?? 'of one type'}</span>`).join('<span class="muted">+</span>') || '<span class="muted small">—</span>'}
        ${payable == null ? '' : payable ? '<span class="ok">✓ you can pay it now</span>' : '<span class="no">✗ not yet</span>'}
      </div>
      ${due.length > 1 ? '<div class="small muted">Each part must be a different resource.</div>' : ''}`}
      <div class="row between small"><span ${g.phase !== 'turn' ? 'hidden' : ''}>Rolls <span class="dots">${dots}</span> ${g.rollsUsed != null ? `${ROLLS_PER_ROUND - g.rollsUsed} left` : ''}</span><span class="muted" title="${esc(g.boss.desc)}">Boss: ${g.boss.name}${g.blind === 2 ? ' <b class="bad">(active)</b>' : ''}</span></div>
      ${status.length ? `<div class="small status">${status.join(' · ')}</div>` : ''}
      ${this.resourceStrip()}
      <ol class="stepper">${steps.map(([k, l]) => `<li class="${k === current ? 'on' : ''}">${l}</li>`).join('')}</ol>
    </div>`;
  }

  resourceStrip() {
    const g = this.game;
    return `<div class="res-strip">${RES.map((r) => `<div class="res ${g.hand[r] ? '' : 'zero'}" title="${r}">${resDot(r)}<span class="rn">${r}</span><b>${g.hand[r]}</b>${g.storehouse[r] ? `<span class="store" title="in the Storehouse">+${g.storehouse[r]}</span>` : ''}</div>`).join('')}</div>`;
  }

  // Two dice, each with its six faces and upgrades. `values` = shown numbers (or null).
  diceBlock(values, faces, opts = {}) {
    const g = this.game;
    return `<div class="dice2">${[0, 1].map((i) => {
      const d = g.dice[i];
      const ups = g.dieUps(i);
      const held = opts.held && opts.held[i];
      const faceHtml = d.faces.map((f, k) => {
        const loaded = d.loaded && d.loaded.face === k;
        const title = `Face ${k + 1}: ${f.setter ? ITEMS[SETTER_ITEM[f.setter]].name : 'shows ' + f.value}${f.triggers.length ? ' · ' + f.triggers.map((t) => ITEMS[t].name).join(', ') : ''}${loaded ? ` · loaded L${d.loaded.level} (${Math.round(LOADING[d.loaded.level - 1][0] * 100)}%)` : ''}`;
        return `<span class="face ${loaded ? 'loaded' : ''} ${faces && faces[i] === k ? 'shown' : ''}" title="${esc(title)}">${f.setter ? FACE_LABEL[f.setter] : f.value}${f.triggers.length ? `<i>${f.triggers.map((t) => TRIG_LABEL[t]).join('')}</i>` : ''}</span>`;
      }).join('');
      const notes = opts.notes ? opts.notes[i] : [];
      return `<div class="die-box">
        <div class="die-top"><div class="die-big ${held ? 'held' : ''}">${values ? (values[i] || '0') : '·'}</div>
          <div class="muted small">Die ${i + 1}${held ? '<br>held from last roll' : ''}</div></div>
        <div class="faces" title="The six faces of this die; the outlined one is showing">${faceHtml}</div>
        ${ups.length || d.loaded ? `<div class="tags">${d.loaded ? `<span class="tag">Loaded L${d.loaded.level}</span>` : ''}${ups.map((u) => `<span class="tag" title="${esc(ITEMS[u].desc)}">${ITEMS[u].name}${d.used[u] ? ' (used)' : ''}${!d.upgrades.includes(u) ? ' (copied)' : ''}</span>`).join('')}</div>` : ''}
        ${notes && notes.length ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  cardsList(filter) {
    const g = this.game;
    const cards = filter ? g.cards.filter((c) => filter(c.id)) : g.cards;
    if (!cards.length) return '';
    return `<div class="list">${cards.map((card) => {
      const it = ITEMS[card.id];
      return `<div class="item-line"><span><b>${it.name}</b> <span class="muted small">${it.desc}</span></span><button class="small" data-a="play" data-uid="${card.uid}" ${this.busy || !g.canAct() ? 'disabled' : ''}>Play</button></div>`;
    }).join('')}</div>`;
  }

  viewSetup() {
    const g = this.game;
    const n = Object.keys(g.buildings || {}).length;
    const roads = g.roads ? g.roads.size : 0;
    const what = n > roads ? 'a road next to it' : `settlement ${n + 1} of 2`;
    return `<h2>Set up your island</h2>
      <p>Place <b>${what}</b> by clicking one of the white markers on the board.</p>
      <ul class="small muted"><li>Pick corners touching good numbers: more dots under the number = rolled more often. 6 and 8 are best.</li>
      <li>Each starting settlement gives you one card of every resource next to it.</li>
      <li>Corners next to a port (3:1 or 2:1) unlock better trades and the Storehouse.</li></ul>`;
  }

  viewRoll() {
    const g = this.game;
    const pre = this.cardsList((id) => PRE_ROLL_CARDS.includes(id));
    return `<h2>Roll the dice</h2>
      <p>You get <b>${ROLLS_PER_ROUND} rolls</b> this round. Each roll pays out every hex with the rolled number to your adjacent buildings (settlement 1, city 2). After each roll you can build and trade.</p>
      ${this.diceBlock(null, null)}
      ${pre ? `<h3>Cards to play before rolling</h3>${pre}` : ''}
      <div class="actions">
        <button class="primary big" data-a="roll" data-primary ${this.busy ? 'disabled' : ''}>Roll the dice</button>
        <div class="row"><button data-a="prebuild" ${this.busy ? 'disabled' : ''}>Build or trade first</button>
        <button data-a="end" ${this.busy ? 'disabled' : ''}>Skip all rolls → tribute (+${ROLLS_PER_ROUND} VP)</button></div>
      </div>`;
  }

  viewAdjust() {
    const g = this.game;
    const pr = g.pendingRoll;
    const { v } = g.valuesOf(pr);
    const mods = g.modifiersAvailable();
    return `<h2>You rolled ${v[0] || '?'} + ${v[1] || '?'}</h2>
      <p>Your dice upgrades let you change this roll before it pays out.</p>
      ${this.diceBlock(v, pr.faces, { held: pr.hold.map((h) => h != null), notes: g.report?.dice.map((d) => d.notes) })}
      <div class="list">${mods.map((m) => `<div class="item-line"><span><b>${MOD_INFO[m.id][0]}</b> die ${m.die + 1}${m.id === 'twin' ? ` (other result: ${g.dice[m.die].faces[pr.alt[m.die]].value})` : ''} <span class="muted small">${MOD_INFO[m.id][1]}</span></span><button class="small" data-a="mod" data-die="${m.die}" data-id="${m.id}" ${this.busy ? 'disabled' : ''}>Use</button></div>`).join('')}</div>
      <div class="actions"><button class="primary big" data-a="resolve" data-primary ${this.busy ? 'disabled' : ''}>Use this roll (${v[0] + v[1] || '?'})</button></div>`;
  }

  viewResult() {
    const g = this.game;
    const rep = g.report;
    const f = rep.final;
    const gains = RES.filter((r) => rep.gains[r] > 0);
    const losses = RES.filter((r) => rep.gains[r] < 0);
    const store = RES.filter((r) => rep.storeGains[r] !== 0);
    const lines = rep.lines.filter((l) => l.cls !== 'roll');
    let headline;
    if (f.zero) headline = 'Mirror vs Mirror: 0';
    else if (f.robberFace) headline = "Robber's Face: counts as 7";
    else headline = `${f.values[0]} + ${f.values[1]} = ${f.sum}`;
    const tags = [];
    if (f.isDouble) tags.push('<span class="pill">Double</span>');
    if (f.seven) tags.push('<span class="pill bad">7: the robber</span>');
    if (rep.echo) tags.push('<span class="pill">Echo roll</span>');
    const nothing = !gains.length && !losses.length && !lines.length;
    const echoNext = g.echoQueue.length > 0;
    return `<h2 class="result-head">${headline} ${tags.join(' ')}</h2>
      ${this.diceBlock(f.values, g.lastRoll.faces, { notes: rep.dice.map((d) => d.notes) })}
      <h3>You got</h3>
      <div class="gains">${gains.map((r) => `<span class="gain">${resDot(r)} +${rep.gains[r]} ${r}</span>`).join('')}${losses.map((r) => `<span class="gain lose">${resDot(r)} ${rep.gains[r]} ${r}</span>`).join('')}${store.map((r) => `<span class="gain ${rep.storeGains[r] < 0 ? 'lose' : ''}">${resDot(r)} ${rep.storeGains[r] > 0 ? '+' : ''}${rep.storeGains[r]} ${r} (Storehouse)</span>`).join('')}
        ${!gains.length && !losses.length && !store.length ? `<span class="muted">Nothing.${!f.seven && !f.zero ? ` No hex with a ${f.sum} touches your buildings${g.board.hexes.some((h) => h.token === f.sum && h.id === g.robber) ? ', or the robber blocks it' : ''}.` : ''}</span>` : ''}</div>
      ${lines.length ? `<h3>What happened</h3><ul class="events">${lines.map((l) => `<li class="${l.cls}">${esc(l.msg)}</li>`).join('')}</ul>` : ''}
      ${nothing ? '' : ''}
      <div class="actions"><button class="primary big" data-a="seen" data-primary>${echoNext ? 'Continue (free Echo roll waiting) →' : 'Continue to build & trade →'}</button></div>`;
  }

  viewBuild() {
    const g = this.game;
    const dis = this.busy;
    const rollsLeft = ROLLS_PER_ROUND - g.rollsUsed;
    const echo = g.echoQueue.length > 0;
    const c = g.counts();
    const row = (kind, name, cost, extra) => {
      const why = g.whyNot(kind);
      return `<div class="build-row ${why ? 'off' : ''}"><div><b>${name}</b> <span class="costs">${costChips(cost)}</span><div class="small muted">${why ? esc(why) : extra}</div></div>
        <button class="small ${why ? '' : 'go'}" data-a="build" data-kind="${kind}" ${why || dis ? 'disabled' : ''}>Build</button></div>`;
    };
    // trade
    const t = this.trade;
    const rate = g.tradeRate(t.give);
    const canTrade = g.hand[t.give] >= rate && t.give !== t.get;
    const sel = (k) => `<select data-trade="${k}" id="trade-${k}">${RES.map((r) => `<option value="${r}" ${t[k] === r ? 'selected' : ''}>${r}${k === 'give' ? ` (${g.tradeRate(r)}:1, have ${g.hand[r]})` : ''}</option>`).join('')}</select>`;
    // ship
    const ports = g.ownedPorts();
    let ship = '';
    if (g.bossIs('pirate')) ship = '<p class="small bad">The Pirate: no shipping this round.</p>';
    else if (!ports.length) ship = '<p class="small muted">Build a settlement on a port to unlock shipping. Shipped cards count toward this round\'s tribute with a bonus.</p>';
    else {
      ship = ports.map((port) => {
        const { input, bonus } = g.storehouseRate(port);
        const rs = port.type === 'generic' ? RES : [port.type];
        return `<div class="small"><b>${port.type === 'generic' ? 'Generic port' : port.type + ' port'}</b>: ${input} cards → ${input + bonus} toward the tribute
          <div class="row" style="margin-top:4px">${rs.map((r) => `<button class="small" data-a="ship" data-port="${port.id}" data-r="${r}" data-mode="batch" ${g.hand[r] >= input && !dis ? '' : 'disabled'}>Ship ${input} ${r}</button>${port.up.overflow ? `<button class="small" data-a="ship" data-port="${port.id}" data-r="${r}" data-mode="overflow" ${g.hand[r] > 0 && g.hand[r] < input ? '' : 'disabled'}>Leftover ${r} 1:1</button>` : ''}`).join('')}
          ${port.up.free ? `<button class="small" data-a="ship-mixed" data-port="${port.id}">Mixed batch</button>` : ''}</div></div>`;
      }).join('');
    }
    const cards = this.cardsList();
    const primary = echo
      ? `<button class="primary big" data-a="roll" data-primary ${dis ? 'disabled' : ''}>Free Echo roll (die ${g.echoQueue[0] + 1})</button>`
      : rollsLeft > 0
        ? `<button class="primary big" data-a="roll" data-primary ${dis ? 'disabled' : ''}>Roll again (${rollsLeft} left)</button>`
        : `<button class="primary big" data-a="end" data-primary ${dis ? 'disabled' : ''}>Pay the tribute →</button>`;
    const endBtn = rollsLeft > 0 || echo ? `<button data-a="end" ${dis ? 'disabled' : ''}>End round now → tribute${rollsLeft > 0 ? ` (+${rollsLeft} VP for unused rolls)` : ''}</button>` : '';
    return `<h2>Build & trade</h2>
      <p class="small muted">${g.rollsUsed === 0 ? 'Before your first roll.' : `After roll ${g.rollsUsed} of ${ROLLS_PER_ROUND}.`} Do as much as you like, then roll again or end the round.</p>
      <div class="actions top">${primary}${endBtn}</div>
      <h3>Build</h3>
      ${row('settlement', 'Settlement', COSTS.settlement, `+1 VP, produces 1 · ${c.settlement}/${g.limits.settlement} used`)}
      ${row('city', 'City', COSTS.city, `Upgrade a settlement: +1 VP, produces 2 · ${c.city}/${g.limits.city} used`)}
      ${row('road', 'Road', COSTS.road, `Reach new corners · ${c.road}/${g.limits.road} used`)}
      ${row('dev', 'Development card', COSTS.dev, 'Random card from the stack')}
      <h3>Trade with the bank</h3>
      <div class="trade-row">Give ${rate} ${sel('give')} → 1 ${sel('get')} <button class="small ${canTrade ? 'go' : ''}" data-a="trade" ${canTrade && !dis ? '' : 'disabled'}>Trade</button></div>
      ${!canTrade ? `<div class="small muted">${t.give === t.get ? 'Pick two different resources.' : `You need ${rate} ${t.give} to trade.`}</div>` : ''}
      <h3>Ship to the Storehouse</h3>${ship}
      ${cards ? `<h3>Cards in hand (${g.cards.length}/${g.limits.handSlots})</h3>${cards}` : ''}
      ${g.guilds.length ? `<h3>Guilds (always active)</h3><div class="list">${g.guilds.map((gd) => `<div class="small"><b>${ITEMS[gd.id].name}</b>${gd.data.terrain ? ` (${gd.data.terrain})` : ''} <span class="muted">${ITEMS[gd.id].desc}</span></div>`).join('')}</div>` : ''}
      <details class="dice-details"><summary>Your dice</summary>${this.diceBlock(null, null)}</details>`;
  }

  readTributeSelects() {
    const g = this.game;
    const due = g.tributeDue();
    if (!this.tributeTypes || this.tributeTypes.length !== due.length) this.tributeTypes = g.autoAssign() ?? due.map((p) => p.type);
    due.forEach((p, i) => {
      const el = document.getElementById(`tp-${i}`);
      if (el && !p.fixed) this.tributeTypes[i] = el.value || null;
    });
  }

  viewTribute() {
    const g = this.game;
    const due = g.tributeDue();
    if (!this.tributeTypes || this.tributeTypes.length !== due.length) this.tributeTypes = g.autoAssign() ?? due.map((p) => p.type);
    const types = this.tributeTypes;
    const check = g.checkAssignment(types);
    const canAny = g.autoAssign() != null;
    return `<h2>Pay the tribute</h2>
      <p class="small muted">${due.length > 1 ? 'Each part needs a different resource. ' : 'Pick which resource to pay with. '}Storehouse cards are used first, then your hand. We pre-selected the choice that leaves you the most.</p>
      ${due.map((p, i) => `<div class="tribute-part"><b class="big-n">${p.amount}</b> ×
        ${p.fixed ? `<span class="chip">${resDot(p.type)} ${p.type} (fixed by the boss)</span>` : `<select id="tp-${i}" data-tp="${i}"><option value="">choose…</option>${RES.map((r) => `<option value="${r}" ${types[i] === r ? 'selected' : ''}>${r} (you have ${g.available(r)})</option>`).join('')}</select>`}
        ${p.carried ? '<span class="muted small">carried from Levy Delay</span>' : ''}</div>`).join('')}
      ${!check.ok && canAny ? `<p class="bad small">${esc(check.msg)}</p>` : ''}
      ${!canAny ? '<p class="bad"><b>You can\'t pay this tribute.</b> The run ends here.</p>' : ''}
      <div class="actions">${canAny ? `<button class="primary big" data-a="pay" data-primary ${check.ok ? '' : 'disabled'}>Pay tribute</button>` : '<button class="primary big" data-a="fail" data-primary>End the run</button>'}</div>`;
  }

  viewShop() {
    const g = this.game;
    const e = g.earned;
    const nextBoss = g.blind === 2 ? BOSS_BY_ID[g.nextBossId] : g.boss;
    const where = { face: 'Dice · face', die: 'Dice · whole die', token: 'Field · number token', hex: 'Field · hex', port: 'Field · port', classic: 'Card · single use', edict: 'Card · single use', guild: 'Guild · always active', charter: 'Charter · immediate' };
    const items = g.shop.map((s, i) => {
      const price = g.slotPrice(s);
      const afford = g.budget >= price;
      const btn = `<button class="small ${!s.sold && afford ? 'go' : ''}" data-a="buy" data-i="${i}" ${!s.sold && afford && !this.busy ? '' : 'disabled'}>${s.sold ? 'Bought' : `Buy · ${price === Infinity ? 'max' : price} VP`}</button>`;
      if (s.kind === 'pack') {
        return `<div class="shop-item ${s.sold ? 'sold' : ''}"><div><div class="kind">Pack · ${s.group}</div><b>Choose 1 of 3</b><div class="small muted">${s.options.map((o) => `${o.name} <span class="rarity-${o.rarity}">(${o.rarity})</span>`).join(' · ')}</div></div>${btn}</div>`;
      }
      const it = s.item;
      return `<div class="shop-item ${s.sold ? 'sold' : ''}"><div><div class="kind">${where[it.cat]} · <span class="rarity-${it.rarity}">${it.rarity}</span></div><b>${it.name}</b><div class="small muted">${it.desc}${it.id === 'loaded' ? ' Price rises with the level.' : ''}</div></div>${btn}</div>`;
    }).join('');
    return `<div class="row between"><h2>Shop</h2><div class="budget">${g.budget} VP</div></div>
      <p class="small muted">Budget = score ${g.vp} + unused rolls ${e.unusedRolls} + Storehouse surplus ${e.storehouse}${e.river ? ` + River ${e.river}` : ''}${e.twinFortune ? ` + Twin Fortune ${e.twinFortune}` : ''}. Unspent VP is lost when you leave. Buying never lowers your score.</p>
      <div class="list">${items}</div>
      <div class="row" style="margin-top:8px"><button class="small" data-a="reroll" ${g.budget >= g.rerollPrice ? '' : 'disabled'}>Reroll shop · ${g.rerollPrice} VP</button></div>
      <div class="boss-box small"><b>${g.blind === 2 ? 'Next boss' : 'Boss of this ante'}: ${nextBoss.name}</b><br><span class="muted">${nextBoss.desc}</span><br><button class="small" data-a="reroll-boss" ${g.budget >= g.bossRerollPrice ? '' : 'disabled'} style="margin-top:4px">Reroll boss · ${g.bossRerollPrice} VP</button></div>
      <div class="actions"><button class="primary big" data-a="leave" data-primary ${this.busy ? 'disabled' : ''}>Next round →</button></div>`;
  }

  viewGameOver() {
    const g = this.game;
    return `<h2>Run over</h2><p>You survived <b>${g.roundsSurvived}</b> round(s) and reached ante ${g.ante} with a score of ${g.vp} VP.</p>
      <p class="small muted">Seed ${g.seed}. The same seed gives the same board and dice if you make the same choices.</p>
      <div class="actions"><button class="primary big" data-a="fresh" data-primary>New run</button><button data-a="again">Replay this seed</button></div>`;
  }

  // ---------------------------------------------------------------- below the board: log + dev tools
  renderBelow() {
    const g = this.game;
    this.$below.innerHTML = `${this.devOpen ? this.devPanel() : ''}<div class="card"><h3>Log</h3><div class="log">${g.logLines.slice(-150).reverse().map((l) => `<div class="${l.cls}">${esc(l.msg)}</div>`).join('')}</div></div>`;
  }

  devPanel() {
    const g = this.game;
    const opts = [1, 2, 3, 4, 5, 6].map((n) => `<option>${n}</option>`).join('');
    return `<div class="card dev"><h3>Dev tools (testing only)</h3>
      <div class="row small">${RES.map((r) => `<span>${resDot(r)}<button class="small" data-a="dev-res" data-r="${r}" data-n="1">+1</button><button class="small" data-a="dev-res" data-r="${r}" data-n="5">+5</button></span>`).join(' ')}</div>
      <div class="row small" style="margin-top:6px">Force next roll <select id="dev-d1">${opts}</select> + <select id="dev-d2">${opts}</select><button class="small" data-a="dev-force">Set</button>${g.devForce ? ` <span class="muted">(${g.devForce.join('+')} queued)</span>` : ''}</div>
      <div class="row small" style="margin-top:6px">Give item <select id="dev-item">${ITEM_LIST.map((i) => `<option value="${i.id}">${i.cat}: ${i.name}</option>`).join('')}</select><button class="small" data-a="dev-item" ${this.busy ? 'disabled' : ''}>Give</button></div>
      <div class="row small" style="margin-top:6px"><button class="small" data-a="dev-shop" ${g.phase === 'turn' && !g.pendingRoll ? '' : 'disabled'}>Skip tribute → shop</button><button class="small" data-a="dev-budget" ${g.phase === 'shop' ? '' : 'disabled'}>+10 shop budget</button><span class="muted">Seed ${g.seed}</span></div></div>`;
  }

  // ---------------------------------------------------------------- dialogs
  renderModal() {
    const m = this.modal;
    let html = '';
    if (m) html = this.renderIoModal(m);
    else if (this.panel) html = this.renderHelp();
    this.$modal.innerHTML = html ? `<div class="modal-back">${html}</div>` : '';
  }

  renderIoModal(m) {
    const cancel = m.cancel ? '<button data-a="cancel-modal">Cancel</button>' : '';
    if (m.type === 'options') {
      return `<div class="modal"><h2>${esc(m.prompt)}</h2><div class="opts">${m.options.map((o, i) => `<button data-a="opt" data-i="${i}" ${o.disabled ? 'disabled' : ''}>${esc(o.label)}</button>`).join('')}</div><div class="modal-foot">${cancel}</div></div>`;
    }
    if (m.type === 'face') {
      const g = this.game;
      const dieBlock = (d) => `<div class="muted small">Die ${d + 1}</div><div class="face-grid">${m.options.map((o, i) => {
        if (o.die !== d) return '';
        const f = g.dice[d].faces[o.face];
        return `<button data-a="face" data-i="${i}" title="${esc(f.triggers.map((t) => ITEMS[t].name).join(', '))}">${f.setter ? FACE_LABEL[f.setter] : f.value}<small>${f.triggers.map((t) => TRIG_LABEL[t]).join(' ') || '&nbsp;'}</small></button>`;
      }).join('')}</div>`;
      return `<div class="modal"><h2>${esc(m.prompt)}</h2><p class="muted small">Upgrades stay on the physical face, not on its number. A new value-setter replaces the old one; triggers stack.</p>${dieBlock(0)}${dieBlock(1)}<div class="modal-foot">${cancel}</div></div>`;
    }
    if (m.type === 'resources') {
      const total = RES.reduce((s, r) => s + m.counts[r], 0);
      return `<div class="modal"><h2>${esc(m.prompt)}</h2><p class="muted">${m.discard ? 'Discard' : 'Choose'} ${m.n} — selected ${total}.</p>
        ${RES.map((r) => `<div class="counter"><span>${resDot(r)} ${r}</span><button data-a="res-dec" data-r="${r}">−</button><span class="n">${m.counts[r]}</span><button data-a="res-inc" data-r="${r}">+</button><span class="muted small">${m.max ? `of ${m.max[r]}` : ''}</span></div>`).join('')}
        <div class="modal-foot">${cancel}<button class="primary" data-a="res-ok" ${total === m.n ? '' : 'disabled'}>Confirm</button></div></div>`;
    }
    return '';
  }

  renderHelp() {
    return `<div class="modal help"><h2>How to play (draft)</h2>
      <p>Build one island across an endless run. The right side walks you through each round step by step.</p>
      <ol><li><b>Roll</b> the dice. Every hex with that number pays its resource to your adjacent buildings (settlement 1, city 2).</li>
      <li><b>Result</b> shows what the dice did, any upgrades that changed them, and what you got. On a 7 the robber strikes: discard half if you hold more than 7 cards, and the robber blocks one of your hexes.</li>
      <li><b>Build & trade</b>: build, trade with the bank (better with ports), ship to the Storehouse, play cards. Then roll again; you have 4 rolls per round.</li>
      <li><b>Tribute</b>: pay the resources shown at the top or the run ends. Ending the round early gives +1 VP per unused roll.</li>
      <li><b>Shop</b>: your score plus VP earned this round is your budget. Buy dice upgrades, field upgrades and cards. Unspent VP is lost.</li></ol>
      <p>Each ante has three rounds: Small (one resource type), Big (two types) and Boss (three types plus a drawback). Tributes grow every ante.</p>
      <p class="muted small">Shortcuts: Enter or Space = the highlighted main button · Esc = cancel. The seed in the URL reproduces the board and every roll.</p>
      <div class="modal-foot"><button data-a="close-panel" class="primary">Close</button></div></div>`;
  }
}
