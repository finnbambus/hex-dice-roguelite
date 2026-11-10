// Browser UI. Renders state from the engine and implements the engine's `io` interface
// (board clicks and modals that resolve promises).
import { Game, COSTS, BLINDS } from './game.js';
import { RES, TERRAIN_RES, pips } from './board.js';
import { ITEMS, ITEM_LIST, BOSS_BY_ID, ROLLS_PER_ROUND, LOADING } from './content.js';

const TERRAIN_COLOR = { hills: '#c8734a', forest: '#3f7d4a', pasture: '#9ccf6a', fields: '#e8c547', mountains: '#8e939c', desert: '#e3d3a4' };
const RES_ICON = { brick: 'B', lumber: 'L', wool: 'W', grain: 'G', ore: 'O' };
const HEX_BADGE = { fertile: '+1', palisade: 'PAL', gold: 'GOLD', river: 'RIVER', guildDistrict: 'GUILD', volcanic: 'VOLC', sister: 'SIS', haven: 'HAVEN', capital: 'CAP' };
const TOKEN_BADGE = { jackpot: 'JACK', twinToken: 'TWIN', sevenToken: '+7', heartland: '±1', evergreen: 'EVER' };
const FACE_LABEL = { mirror: 'M', robber: 'R7', blank: '?' };
const TRIG_LABEL = { lucky: 'L', knightFav: 'kF', knightLucky: 'kL', robberFav: 'rF', robberLucky: 'rL', hidden: 'H' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const resDot = (r) => `<span class="res-dot" style="background:var(--${r})"></span>`;
const costText = (c) => RES.filter((r) => c[r]).map((r) => `${c[r]}${RES_ICON[r]}`).join(' ');

export class UI {
  constructor() {
    this.game = null;
    this.busy = false;
    this.boardReq = null;
    this.modal = null; // io modal (a pending choice)
    this.panel = null; // non-blocking modal: trade, ship, help
    this.devOpen = false;
    this.tributeTypes = null;
    this.$board = document.getElementById('board');
    this.$side = document.getElementById('side');
    this.$dice = document.getElementById('dice');
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
    document.addEventListener('keydown', (ev) => {
      if (ev.target.matches('input, select')) return;
      const g = this.game;
      if (!g) return;
      if (ev.key === 'Escape') {
        if (this.boardReq?.cancel) this.resolveBoard(null);
        else if (this.modal?.cancel) this.resolveModal(null);
        else if (this.panel) { this.panel = null; this.render(); }
      }
      if (this.busy || this.modal || this.panel) return;
      if (ev.key === 'r' || ev.key === ' ') { ev.preventDefault(); if (g.canRoll()) this.run(() => g.roll()); else if (g.pendingRoll) this.run(() => g.resolveRoll()); }
      if (ev.key === 'e' && g.canEndRound()) g.endRound();
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
      // modal resolution
      case 'opt': return this.resolveModal(this.modal.options[Number(d.i)].value);
      case 'face': return this.resolveModal(this.modal.options[Number(d.i)]);
      case 'cancel-modal': return this.resolveModal(null);
      case 'cancel-board': return this.resolveBoard(null);
      case 'res-inc': case 'res-dec': {
        const m = this.modal;
        const total = RES.reduce((s, r) => s + m.counts[r], 0);
        if (a === 'res-inc' && total < m.n && (!m.max || m.counts[d.r] < m.max[d.r])) m.counts[d.r]++;
        if (a === 'res-dec' && m.counts[d.r] > 0) m.counts[d.r]--;
        return this.render();
      }
      case 'res-ok': return this.resolveModal({ ...this.modal.counts });
      // turn
      case 'roll': return this.run(() => g.roll());
      case 'resolve': return this.run(() => g.resolveRoll());
      case 'mod': return this.run(() => g.useModifier(Number(d.die), d.id));
      case 'end': g.endRound(); return;
      case 'build': return this.run(() => g.build(d.kind));
      case 'play': return this.run(() => g.playCard(Number(d.uid)));
      case 'panel': this.panel = { type: d.p, give: 'brick', get: 'grain' }; return this.render();
      case 'close-panel': this.panel = null; return this.render();
      case 'trade': g.trade(this.panel.give, this.panel.get); return;
      case 'ship': g.ship(Number(d.port), d.r, d.mode); return;
      case 'ship-mixed': return this.run(() => g.shipMixed(Number(d.port)));
      // tribute
      case 'pay': if (g.payTribute(this.currentTributeTypes())) this.tributeTypes = null; return;
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
        const a1 = Number(document.getElementById('dev-d1').value);
        const a2 = Number(document.getElementById('dev-d2').value);
        g.devForce = [a1, a2];
        g.log(`Dev: next roll forced to ${a1}+${a2}.`);
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
    this.renderDice();
    this.renderSide();
    this.renderPrompt();
    this.renderModal();
  }

  renderPrompt() {
    const b = this.boardReq;
    this.$prompt.hidden = !b;
    if (!b) return;
    this.$prompt.innerHTML = `<span>${esc(b.prompt)}</span>${b.cancel ? '<button data-a="cancel-board">Cancel (Esc)</button>' : ''}`;
  }

  renderBoard() {
    const g = this.game;
    const B = g.board;
    const req = this.boardReq;
    const isT = (k, id) => req && req.kind === k && req.ids.has(id);
    const parts = [];
    // sea outline
    parts.push(`<polygon points="${[0, 1, 2, 3, 4, 5].map((i) => { const a = (Math.PI / 3) * i; return `${4.75 * Math.cos(a)},${4.75 * Math.sin(a)}`; }).join(' ')}" fill="#0002"/>`);
    for (const h of B.hexes) {
      const pts = h.vertices.map((v) => `${B.vertices[v].x},${B.vertices[v].y}`).join(' ');
      parts.push(`<polygon class="hex ${isT('hex', h.id) ? 'target' : ''}" data-k="hex" data-id="${h.id}" points="${pts}" fill="${TERRAIN_COLOR[h.terrain]}"><title>${h.terrain}${TERRAIN_RES[h.terrain] ? ' → ' + TERRAIN_RES[h.terrain] : ''}${h.hexEffect ? ' · ' + ITEMS[h.hexEffect.id].name : ''}${h.tokenEffect ? ' · ' + ITEMS[h.tokenEffect.id].name : ''}</title></polygon>`);
      if (h.token) {
        const hot = h.token === 6 || h.token === 8;
        const label = h.hidden ? '?' : h.token;
        parts.push(`<g pointer-events="none"><circle class="token" cx="${h.x}" cy="${h.y}" r=".33"/><text class="token-num ${hot && !h.hidden ? 'hot' : ''}" x="${h.x}" y="${h.y - 0.03}">${label}</text>`);
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
    // ports
    for (const p of B.ports) {
      for (const v of p.vertices) parts.push(`<line x1="${p.x}" y1="${p.y}" x2="${B.vertices[v].x}" y2="${B.vertices[v].y}" class="port-line" stroke="#f7efd9" stroke-width=".03" stroke-dasharray=".06 .05"/>`);
      const lbl = p.type === 'generic' ? '3:1' : `2:1${RES_ICON[p.type]}`;
      const up = [p.up.overflow ? 'O' : '', p.up.bigger ? `+${p.up.bigger}` : '', p.up.smaller ? `−${p.up.smaller}` : '', p.up.free ? 'F' : ''].join('');
      parts.push(`<g class="port ${isT('port', p.id) ? 'target' : ''}" data-k="port" data-id="${p.id}"><circle cx="${p.x}" cy="${p.y}" r=".27" ${p.type !== 'generic' ? `style="fill:var(--${p.type})"` : ''}/><text x="${p.x}" y="${p.y - (up ? 0.05 : 0)}">${lbl}</text>${up ? `<text x="${p.x}" y="${p.y + 0.13}" style="font-size:.12px">${up}</text>` : ''}<title>${p.type} port</title></g>`);
    }
    // edges
    for (const e of B.edges) {
      const [a, b] = e.v.map((v) => B.vertices[v]);
      if (g.roads.has(e.id)) parts.push(`<line class="road" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`);
      else if (isT('edge', e.id)) {
        const sx = a.x + (b.x - a.x) * 0.18, sy = a.y + (b.y - a.y) * 0.18, ex = a.x + (b.x - a.x) * 0.82, ey = a.y + (b.y - a.y) * 0.82;
        parts.push(`<line class="edge target" data-k="edge" data-id="${e.id}" x1="${sx}" y1="${sy}" x2="${ex}" y2="${ey}"/>`);
      }
    }
    // robber
    const rh = B.hexes[g.robber];
    parts.push(`<g pointer-events="none"><circle class="robber" cx="${rh.x + 0.42}" cy="${rh.y - 0.1}" r=".17"/><text x="${rh.x + 0.42}" y="${rh.y - 0.1}" class="token-num" style="fill:#fff;font-size:.18px">R</text></g>`);
    // buildings & vertex targets
    for (const v of B.vertices) {
      const b = g.buildings[v.id];
      const t = isT('vertex', v.id);
      if (b === 'settlement') parts.push(`<polygon class="bld ${t ? 'vtx target' : ''}" data-k="vertex" data-id="${v.id}" points="${v.x - 0.13},${v.y + 0.11} ${v.x + 0.13},${v.y + 0.11} ${v.x + 0.13},${v.y - 0.04} ${v.x},${v.y - 0.16} ${v.x - 0.13},${v.y - 0.04}"/>`);
      else if (b === 'city') parts.push(`<polygon class="bld ${t ? 'vtx target' : ''}" data-k="vertex" data-id="${v.id}" points="${v.x - 0.2},${v.y + 0.14} ${v.x + 0.2},${v.y + 0.14} ${v.x + 0.2},${v.y - 0.06} ${v.x + 0.05},${v.y - 0.06} ${v.x + 0.05},${v.y - 0.16} ${v.x - 0.07},${v.y - 0.24} ${v.x - 0.2},${v.y - 0.16}"/>`);
      else if (t) parts.push(`<circle class="vtx target" data-k="vertex" data-id="${v.id}" cx="${v.x}" cy="${v.y}" r=".13" fill="#fff"/>`);
    }
    this.$board.innerHTML = parts.join('');
  }

  renderDice() {
    const g = this.game;
    const pr = g.pendingRoll;
    let vals = null;
    let faces = null;
    if (pr) { vals = g.valuesOf(pr).v; faces = pr.faces; }
    else if (g.lastRoll) { vals = g.lastRoll.values; faces = g.lastRoll.faces; }
    this.$dice.innerHTML = [0, 1].map((i) => {
      const d = g.dice[i];
      const ups = g.dieUps(i);
      const face = (f, k) => {
        const lbl = f.setter ? FACE_LABEL[f.setter] : f.value;
        const tr = f.triggers.map((t) => TRIG_LABEL[t]).join('');
        const loaded = d.loaded && d.loaded.face === k;
        const title = `Face ${k + 1}: ${f.setter ? ITEMS[{ mirror: 'mirror', robber: 'robberFace', blank: 'blank' }[f.setter]].name : 'shows ' + f.value}${f.triggers.length ? ' · ' + f.triggers.map((t) => ITEMS[t].name).join(', ') : ''}${loaded ? ` · loaded L${d.loaded.level} (${Math.round(LOADING[d.loaded.level - 1][0] * 100)}%)` : ''}`;
        return `<div class="face ${loaded ? 'loaded' : ''} ${faces && faces[i] === k ? 'shown' : ''}" title="${esc(title)}">${lbl}<span class="tr">${tr || '&nbsp;'}</span></div>`;
      };
      const held = pr && pr.hold[i] != null;
      return `<div class="die-card">
        <div class="die-big ${held ? 'held' : ''}" title="${held ? 'Held (Echo)' : ''}">${vals ? (vals[i] || '?') : '–'}</div>
        <div><div class="faces">${d.faces.map(face).join('')}</div>
        <div class="tags">${d.loaded ? `<span class="tag">Loaded L${d.loaded.level}</span>` : ''}${ups.map((u) => `<span class="tag" title="${esc(ITEMS[u].desc)}">${ITEMS[u].name}${d.used[u] ? ' ✓' : ''}${!d.upgrades.includes(u) ? ' (copied)' : ''}</span>`).join('')}</div></div>
      </div>`;
    }).join('') + (g.lastRoll && !pr ? `<div class="die-card"><div><div class="muted small">Last roll</div><div class="stat"><b>${g.lastRoll.zero ? 0 : g.lastRoll.sum}</b>${g.lastRoll.isDouble ? ' double' : ''}${g.lastRoll.seven ? ' — robber!' : ''}</div></div></div>` : '');
  }

  renderSide() {
    const g = this.game;
    const dis = (cond) => (this.busy || !cond ? 'disabled' : '');
    const out = [];
    const vp = g.vpBreakdown();
    const c = g.counts();

    // Status
    out.push(`<div class="card"><div class="row between">
      <div class="stat">Ante <b>${g.ante}</b> <span class="blind ${g.blind === 2 ? 'boss' : ''}">${BLINDS[g.blind]}</span></div>
      <div class="stat" title="Settlements ${vp.settlements} · Cities ${vp.cities} · VP cards ${vp.vpCards} · Longest road ${vp.road} (length ${vp.longestRoad}) · Army ${vp.army} (${g.knights} knights)">Score <b>${vp.total}</b> VP</div>
      <div class="stat">Rounds <b>${g.roundsSurvived}</b></div></div>
      <div class="row small muted" style="margin-top:4px">Rolls ${g.rollsUsed ?? 0}/${ROLLS_PER_ROUND}${g.chain ? ` · Echo chain ${g.chain}` : ''} · 7s rolled ${g.sevens} · Knights ${g.knights}${g.brokeGame ? ' · <b class="good">GAME BROKEN</b>' : ''}</div></div>`);

    // Boss & tribute
    const boss = g.boss;
    const due = g.tribute ? g.tributeDue() : [];
    const mods = [];
    if (g.bribe) mods.push(`Bribe −${g.bribe}`);
    if (g.hasGuild('taxCollector') && c.city) mods.push(`Tax Collector −${c.city}`);
    if (g.oldBootExtra) mods.push(`Old Boot +${g.oldBootExtra}`);
    if (g.levyDelay) mods.push('Levy Delay active');
    if (g.monopoly) mods.push(`Monopoly: ${g.monopoly}`);
    if (g.bumper) mods.push('Bumper Harvest');
    if (g.omen != null) mods.push(`Omen: ${g.omen}`);
    if (g.fireSale) mods.push('Fire Sale 2:1');
    if (g.bossIs?.('barbarians')) mods.push(`Fleet ${g.fleet}/3`);
    out.push(`<div class="card"><h3>Tribute due this round</h3>
      <div class="row">${due.map((p) => `<span class="chip">${p.type ? resDot(p.type) : ''}<b>${p.amount}</b> ${p.type ?? 'any type'}${p.carried ? ' (carried)' : ''}</span>`).join('<span class="muted">+</span>') || '<span class="muted">—</span>'}</div>
      ${mods.length ? `<div class="small muted" style="margin-top:4px">${mods.join(' · ')}</div>` : ''}
      <div class="small" style="margin-top:6px"><b>${boss.name}</b> ${g.blind === 2 ? '<span class="bad">(active now)</span>' : '<span class="muted">(boss of this ante)</span>'}<br><span class="muted">${boss.desc}</span></div></div>`);

    // Actions
    const pr = g.pendingRoll;
    let act = '';
    if (g.phase === 'setup') act = '<div class="muted">Place your two starting settlements and roads on the board.</div>';
    else if (g.phase === 'tribute') act = '<div class="muted">Paying the tribute…</div>';
    else if (g.phase === 'shop') act = '<div class="muted">In the shop.</div>';
    else if (g.phase === 'gameover') act = '<div class="bad">Run over.</div>';
    else if (pr) {
      const ms = g.modifiersAvailable();
      const label = { nudge: 'Nudge', recast: 'Recast', alchemist: 'Alchemist', twin: 'Swap Twin result' };
      act = `<div class="muted small">Adjust the roll, then resolve it.</div><div class="row" style="margin:6px 0">${ms.map((m) => `<button data-a="mod" data-die="${m.die}" data-id="${m.id}" ${dis(true)}>${label[m.id]} die ${m.die + 1}</button>`).join('')}</div><button class="primary" data-a="resolve" ${dis(true)}>Resolve roll</button>`;
    } else if (g.phase === 'turn') {
      const echo = g.echoQueue.length > 0;
      const unused = ROLLS_PER_ROUND - g.rollsUsed;
      act = `<div class="row"><button class="primary" data-a="roll" ${dis(g.canRoll())}>${echo ? `Echo roll (free, die ${g.echoQueue[0] + 1})` : `Roll (${unused} left)`}</button>
        <button data-a="end" ${dis(g.canEndRound())}>End round${unused > 0 ? ` (+${unused} VP)` : ''}</button></div>`;
    }
    out.push(`<div class="card"><h3>Turn</h3>${act}</div>`);

    // Build
    if (g.phase === 'turn') {
      out.push(`<div class="card"><h3>Build window</h3><div class="row">
        <button data-a="build" data-kind="road" ${dis(g.canBuild('road'))}>Road <span class="muted small">${costText(COSTS.road)}</span></button>
        <button data-a="build" data-kind="settlement" ${dis(g.canBuild('settlement'))}>Settlement <span class="muted small">${costText(COSTS.settlement)}</span></button>
        <button data-a="build" data-kind="city" ${dis(g.canBuild('city'))}>City <span class="muted small">${costText(COSTS.city)}</span></button>
        <button data-a="build" data-kind="dev" ${dis(g.canBuild('dev'))}>Dev card <span class="muted small">${costText(COSTS.dev)}</span></button>
        <button data-a="panel" data-p="trade" ${dis(g.canAct())}>Trade</button>
        <button data-a="panel" data-p="ship" ${dis(g.canShip())}>Ship${g.bossIs('pirate') ? ' (Pirate!)' : ''}</button>
      </div><div class="small muted" style="margin-top:6px">Pieces: settlements ${c.settlement}/${g.limits.settlement} · cities ${c.city}/${g.limits.city} · roads ${c.road}/${g.limits.road}</div></div>`);
    }

    // Resources
    const total = RES.reduce((s, r) => s + g.hand[r], 0);
    out.push(`<div class="card"><h3>Resources <span class="muted">(${total} in hand · limit 7 on a 7)</span></h3>
      <div class="row">${RES.map((r) => `<span class="chip" title="${r}">${resDot(r)} ${r} <b>${g.hand[r]}</b></span>`).join('')}</div>
      <div class="small muted" style="margin-top:6px">Storehouse (tribute only): ${RES.some((r) => g.storehouse[r]) ? RES.filter((r) => g.storehouse[r]).map((r) => `${g.storehouse[r]} ${r}`).join(', ') : 'empty'}</div></div>`);

    // Cards & guilds
    out.push(`<div class="card"><h3>Hand cards ${g.cards.length}/${g.limits.handSlots}</h3><div class="list">${g.cards.map((card) => {
      const it = ITEMS[card.id];
      return `<div class="item-line"><span title="${esc(it.desc)}"><span class="rarity-${it.rarity}">●</span> ${it.name} <span class="muted small">${it.desc}</span></span><button class="small" data-a="play" data-uid="${card.uid}" ${dis(g.canAct())}>Play</button></div>`;
    }).join('') || '<span class="muted small">No cards.</span>'}</div>
      <h3 style="margin-top:10px">Guilds ${g.guilds.length}/${g.limits.guildSlots}</h3><div class="list">${g.guilds.map((gd) => {
      const it = ITEMS[gd.id];
      return `<div class="item-line"><span><span class="rarity-${it.rarity}">●</span> ${it.name}${gd.data.terrain ? ` (${gd.data.terrain})` : ''} <span class="muted small">${it.desc}</span></span></div>`;
    }).join('') || '<span class="muted small">No guilds.</span>'}</div></div>`);

    if (this.devOpen) out.push(this.devPanel());

    out.push(`<div class="card"><h3>Log</h3><div class="log">${g.logLines.slice(-120).reverse().map((l) => `<div class="${l.cls}">${esc(l.msg)}</div>`).join('')}</div></div>`);
    this.$side.innerHTML = out.join('');
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

  currentTributeTypes() {
    const g = this.game;
    const due = g.tributeDue();
    if (!this.tributeTypes || this.tributeTypes.length !== due.length) {
      this.tributeTypes = g.autoAssign() ?? due.map((p) => p.type);
    }
    // read selects
    due.forEach((p, i) => {
      const el = document.getElementById(`tp-${i}`);
      if (el && !p.fixed) this.tributeTypes[i] = el.value || null;
    });
    return this.tributeTypes;
  }

  renderModal() {
    const g = this.game;
    const m = this.modal;
    let html = '';
    if (m) html = this.renderIoModal(m);
    else if (this.panel) html = this.renderPanel();
    else if (this.boardReq) html = '';
    else if (g?.phase === 'tribute') html = this.renderTribute();
    else if (g?.phase === 'shop' && !this.busy) html = this.renderShop();
    else if (g?.phase === 'shop' && this.busy) html = '';
    else if (g?.phase === 'gameover') html = this.renderGameOver();
    this.$modal.innerHTML = html ? `<div class="modal-back">${html}</div>` : '';
    // bind live tribute selects
    if (g?.phase === 'tribute' && !m && !this.panel) {
      this.$modal.querySelectorAll('select[data-tp]').forEach((s) => s.addEventListener('change', () => { this.currentTributeTypes(); this.render(); }));
    }
    if (this.panel?.type === 'trade') {
      this.$modal.querySelectorAll('select[data-trade]').forEach((s) => s.addEventListener('change', () => { this.panel[s.dataset.trade] = s.value; this.render(); }));
    }
  }

  renderIoModal(m) {
    const cancel = m.cancel ? '<button data-a="cancel-modal">Cancel</button>' : '';
    if (m.type === 'options') {
      return `<div class="modal"><h2>${esc(m.prompt)}</h2><div class="opts">${m.options.map((o, i) => `<button data-a="opt" data-i="${i}" ${o.disabled ? 'disabled' : ''}>${esc(o.label)}</button>`).join('')}</div><div class="modal-foot">${cancel}</div></div>`;
    }
    if (m.type === 'face') {
      const g = this.game;
      const dieBlock = (d) => `<div class="muted small">Die ${d + 1}</div><div class="face-grid">${m.options.map((o, i) => (o.die !== d ? '' : (() => {
        const f = g.dice[d].faces[o.face];
        const lbl = f.setter ? FACE_LABEL[f.setter] : f.value;
        return `<button data-a="face" data-i="${i}" title="${esc(f.triggers.map((t) => ITEMS[t].name).join(', '))}">${lbl}<small>${f.triggers.map((t) => TRIG_LABEL[t]).join(' ') || '&nbsp;'}</small></button>`;
      })())).join('')}</div>`;
      return `<div class="modal"><h2>${esc(m.prompt)}</h2><p class="muted small">Upgrades stay on the physical face, not its number. Value-setters replace each other; triggers stack.</p>${dieBlock(0)}${dieBlock(1)}<div class="modal-foot">${cancel}</div></div>`;
    }
    if (m.type === 'resources') {
      const total = RES.reduce((s, r) => s + m.counts[r], 0);
      return `<div class="modal"><h2>${esc(m.prompt)}</h2><p class="muted">${m.discard ? 'Discard' : 'Choose'} ${m.n} — selected ${total}.</p>
        ${RES.map((r) => `<div class="counter"><span>${resDot(r)} ${r}</span><button data-a="res-dec" data-r="${r}">−</button><span class="n">${m.counts[r]}</span><button data-a="res-inc" data-r="${r}">+</button><span class="muted small">${m.max ? `of ${m.max[r]}` : ''}</span></div>`).join('')}
        <div class="modal-foot">${cancel}<button class="primary" data-a="res-ok" ${total === m.n ? '' : 'disabled'}>Confirm</button></div></div>`;
    }
    return '';
  }

  renderPanel() {
    const g = this.game;
    const p = this.panel;
    if (p.type === 'help') {
      return `<div class="modal help"><h2>How to play (draft)</h2>
        <p>Build one island across an endless run. Each round you get <b>4 rolls</b>; after each roll you can build, trade, ship and play cards. At the end of the round you must pay the <b>tribute</b> or the run ends.</p>
        <ul><li><b>Antes</b> have three rounds: Small (1 resource type), Big (2 types), Boss (3 types + a drawback). Tributes grow each ante.</li>
        <li><b>Ending early</b> gives +1 VP per unused roll.</li>
        <li><b>Ports</b> unlock better trades and the <b>Storehouse</b>: ship full batches for a bonus that counts toward the tribute (and 3 surplus = +1 VP).</li>
        <li><b>VP</b> is your score and, after each round, your shop budget (score + VP earned this round). Unspent budget is lost.</li>
        <li><b>Shop:</b> dice upgrades (faces &amp; whole dice), field upgrades (tokens, hexes, ports), development cards and a pack.</li>
        <li>On a <b>7</b>: discard half if you hold more than 7 cards, and the robber jumps onto one of your hexes.</li></ul>
        <p class="muted small">Shortcuts: R / Space = roll or resolve · E = end round · Esc = cancel. The seed in the URL reproduces the board and every roll.</p>
        <div class="modal-foot"><button data-a="close-panel" class="primary">Close</button></div></div>`;
    }
    if (p.type === 'trade') {
      const rate = g.tradeRate(p.give);
      const sel = (k) => `<select data-trade="${k}">${RES.map((r) => `<option ${p[k] === r ? 'selected' : ''}>${r}</option>`).join('')}</select>`;
      return `<div class="modal"><h2>Trade with the bank</h2>
        <p class="muted small">Rates: ${RES.map((r) => `${r} ${g.tradeRate(r)}:1`).join(' · ')}</p>
        <div class="row">Give ${rate} ${sel('give')} → get 1 ${sel('get')} <button class="primary" data-a="trade" ${g.hand[p.give] >= rate && p.give !== p.get ? '' : 'disabled'}>Trade</button></div>
        <p class="small">You have: ${RES.map((r) => `${g.hand[r]} ${r}`).join(', ')}</p>
        <div class="modal-foot"><button data-a="close-panel">Done</button></div></div>`;
    }
    if (p.type === 'ship') {
      const ports = g.ownedPorts();
      return `<div class="modal"><h2>Ship to the Storehouse</h2><p class="muted small">Shipped cards count toward this round's tribute only. Storehouse: ${RES.map((r) => `${g.storehouse[r]} ${r}`).join(', ')}</p>
        ${ports.map((port) => {
          const { input, bonus } = g.storehouseRate(port);
          const rs = port.type === 'generic' ? RES : [port.type];
          return `<div class="card" style="margin-top:8px"><b>${port.type === 'generic' ? 'Generic port' : port.type + ' port'}</b> — batch ${input} → ${input + bonus}${port.up.overflow ? ' · Overflow' : ''}${port.up.free ? ' · Free Port' : ''}
            <div class="row" style="margin-top:6px">${rs.map((r) => `<button class="small" data-a="ship" data-port="${port.id}" data-r="${r}" data-mode="batch" ${g.hand[r] >= input ? '' : 'disabled'}>${r} (${g.hand[r]})</button>${port.up.overflow ? `<button class="small" data-a="ship" data-port="${port.id}" data-r="${r}" data-mode="overflow" ${g.hand[r] > 0 && g.hand[r] < input ? '' : 'disabled'}>leftover ${r}</button>` : ''}`).join('')}
            ${port.up.free ? `<button class="small" data-a="ship-mixed" data-port="${port.id}">Mixed batch</button>` : ''}</div></div>`;
        }).join('') || '<p>You need a building on a port.</p>'}
        <div class="modal-foot"><button data-a="close-panel">Done</button></div></div>`;
    }
    return '';
  }

  renderTribute() {
    const g = this.game;
    const due = g.tributeDue();
    const types = this.currentTributeTypes();
    const check = g.checkAssignment(types);
    const canAny = g.autoAssign() != null;
    return `<div class="modal"><h2>Pay the tribute — ${BLINDS[g.blind]} round, ante ${g.ante}</h2>
      <p class="muted small">Each part must use a different resource type. The Storehouse is used first, then your hand.</p>
      ${due.map((p, i) => `<div class="tribute-part"><b>${p.amount}</b> ×
        ${p.fixed ? `<span class="chip">${resDot(p.type)} ${p.type} (fixed)</span>` : `<select id="tp-${i}" data-tp="${i}"><option value="">choose…</option>${RES.map((r) => `<option value="${r}" ${types[i] === r ? 'selected' : ''}>${r} (have ${g.available(r)})</option>`).join('')}</select>`}
        ${p.carried ? '<span class="muted small">carried from Levy Delay</span>' : ''}</div>`).join('')}
      <p class="small">Available: ${RES.map((r) => `${r} ${g.hand[r]}${g.storehouse[r] ? `+${g.storehouse[r]}` : ''}`).join(' · ')}</p>
      ${!check.ok ? `<p class="bad small">${esc(check.msg)}</p>` : ''}
      <div class="modal-foot">${!canAny ? '<span class="bad">You cannot pay this tribute.</span><button data-a="fail">End the run</button>' : ''}<button class="primary" data-a="pay" ${check.ok ? '' : 'disabled'}>Pay tribute</button></div></div>`;
  }

  renderShop() {
    const g = this.game;
    const e = g.earned;
    const nextBoss = g.blind === 2 ? BOSS_BY_ID[g.nextBossId] : g.boss;
    const rarity = (it) => `<span class="rarity-${it.rarity} small">${it.rarity}</span>`;
    return `<div class="modal wide"><div class="row between"><div><h2>Shop</h2><div class="muted small">Score ${g.vp} + unused rolls ${e.unusedRolls} + Storehouse surplus ${e.storehouse} + River ${e.river} + Twin Fortune ${e.twinFortune}</div></div>
      <div class="budget">${g.budget} VP</div></div>
      <div class="shop-grid">${g.shop.map((s, i) => {
        const price = g.slotPrice(s);
        if (s.kind === 'pack') {
          return `<div class="shop-slot ${s.sold ? 'sold' : ''}"><span class="kind">Pack · ${s.group}</span><span class="name">Choose 1 of 3</span><div class="desc">${s.options.map((o) => `${o.name} (${o.rarity})`).join('<br>')}</div><button data-a="buy" data-i="${i}" ${!s.sold && g.budget >= price ? '' : 'disabled'}>${s.sold ? 'Sold' : `Buy · ${price} VP`}</button></div>`;
        }
        const it = s.item;
        return `<div class="shop-slot ${s.sold ? 'sold' : ''}"><span class="kind">${it.cat} upgrade ${rarity(it)}</span><span class="name">${it.name}</span><div class="desc">${it.desc}${it.id === 'loaded' ? '<br>Price depends on the die\'s level.' : ''}</div><button data-a="buy" data-i="${i}" ${!s.sold && g.budget >= price ? '' : 'disabled'}>${s.sold ? 'Sold' : `Buy · ${price === Infinity ? 'max' : price} VP`}</button></div>`;
      }).join('')}</div>
      <div class="row between" style="margin-top:12px">
        <div class="small">${g.blind === 2 ? 'Next boss' : 'Boss of this ante'}: <b>${nextBoss.name}</b> <span class="muted">${nextBoss.desc}</span></div>
      </div>
      <div class="modal-foot"><span class="muted small">Unspent VP is lost.</span>
        <button data-a="reroll-boss" ${g.budget >= g.bossRerollPrice ? '' : 'disabled'}>Reroll boss · ${g.bossRerollPrice} VP</button>
        <button data-a="reroll" ${g.budget >= g.rerollPrice ? '' : 'disabled'}>Reroll shop · ${g.rerollPrice} VP</button>
        <button class="primary" data-a="leave">Next round →</button></div></div>`;
  }

  renderGameOver() {
    const g = this.game;
    return `<div class="modal"><h2>Run over</h2><p>You survived <b>${g.roundsSurvived}</b> round(s) and reached ante ${g.ante} with a score of ${g.vp} VP.</p>
      <p class="muted small">Seed ${g.seed}. Replaying the same seed gives the same board and the same dice, as long as you make the same choices.</p>
      <div class="modal-foot"><button data-a="again">Replay seed</button><button class="primary" data-a="fresh">New run</button></div></div>`;
  }
}
