// Rules engine. UI-agnostic: every player decision goes through `this.io` (async),
// so the same engine runs in the browser and in the headless bot tests.
import { RNG } from './rng.js';
import { generateBoard, RES, TERRAINS, TERRAIN_RES, pips } from './board.js';
import {
  ITEMS, ITEM_LIST, LOADING, BOSSES, BOSS_BY_ID, CATEGORY_GROUPS, RARITY_WEIGHTS, isUnique,
  tributeFor, SHOP_REROLL, BOSS_REROLL, PACK_PRICE,
  ROLLS_PER_ROUND, HAND_LIMIT, ECHO_BREAK, SETUP_RESOURCES, LOSING_STREAK, GENTLE_UNTIL_ANTE, START_SETTLEMENTS, seqAt,
} from './content.js';

export const COSTS = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { ore: 3, grain: 2 },
  dev: { ore: 1, wool: 1, grain: 1 },
};
export const BLINDS = ['Small', 'Big', 'Boss'];
const emptyRes = () => ({ brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 });
const sumRes = (r) => RES.reduce((a, k) => a + (r[k] || 0), 0);
let UID = 1;

export class Game {
  constructor({ seed, io }) {
    this.seed = seed ?? Math.floor(Math.random() * 1e9);
    this.rng = new RNG(this.seed);
    this.io = io;
    this.logLines = [];
    this.onChange = null;
    this.phase = 'init';
  }

  // ------------------------------------------------------------ utilities
  log(msg, cls = '') {
    this.logLines.push({ msg, cls });
    if (this.capture) this.capture.push({ msg, cls });
    if (this.logLines.length > 300) this.logLines.shift();
  }
  emit() {
    if (this.onChange) this.onChange();
  }
  hex(id) { return this.board.hexes[id]; }
  canAfford(cost) { return RES.every((r) => (this.hand[r] || 0) >= (cost[r] || 0)); }
  pay(cost) { for (const r of RES) this.hand[r] -= cost[r] || 0; }
  gain(r, n = 1) { if (n > 0) this.hand[r] += n; }
  hasGuild(id) { return this.guilds.some((g) => g.id === id); }
  guild(id) { return this.guilds.find((g) => g.id === id); }
  get boss() { return BOSS_BY_ID[this.bossId]; }
  get bossActive() { return this.blind === 2; }
  bossIs(id) { return this.bossActive && this.bossId === id; }

  // ------------------------------------------------------------ setup
  async start() {
    this.board = generateBoard(this.rng);
    this.robber = this.board.hexes.find((h) => h.terrain === 'desert').id;
    this.buildings = {}; // vertexId -> 'settlement' | 'city'
    this.roads = new Set();
    this.hand = emptyRes();
    this.storehouse = emptyRes();
    this.dice = [0, 1].map(() => ({
      faces: [1, 2, 3, 4, 5, 6].map((v) => ({ value: v, setter: null, triggers: [] })),
      upgrades: [],
      loaded: null,
      used: {},
    }));
    this.cards = [];
    this.guilds = [];
    this.limits = { settlement: 5, city: 4, road: 15, handSlots: 3, guildSlots: 3 };
    this.knights = 0;
    this.vpCards = 0;
    this.sevens = 0;
    this.ante = 1;
    this.blind = 0;
    this.roundsSurvived = 0;
    this.takenUniques = new Set();
    this.charterCount = {};
    this.bossRerolls = 0;
    this.carried = [];
    this.forcedNext = null;
    this.bossId = this.randomBoss(null, 1);
    this.rollSeq = 0;
    this.lastRoll = null;
    this.pendingRoll = null;
    this.echoQueue = [];
    this.devForce = null;
    this.phase = 'setup';
    this.log(`New run — seed ${this.seed}`, 'big');
    this.emit();

    for (let i = 0; i < START_SETTLEMENTS; i++) {
      let v = null;
      while (v == null) v = await this.io.chooseVertex(this.validSettlementSpots(true), `Place free settlement ${i + 1} of ${START_SETTLEMENTS}`, { cancel: false });
      this.buildings[v] = 'settlement';
      this.emit();
      let e = null;
      const roadSpots = this.board.vertices[v].edges.filter((id) => !this.roads.has(id));
      while (e == null) e = await this.io.chooseEdge(roadSpots, 'Place a free road next to it', { cancel: false });
      this.roads.add(e);
      if (i === START_SETTLEMENTS - 1 || SETUP_RESOURCES === 'all') {
        const got = [];
        for (const hid of this.board.vertices[v].hexes) {
          const r = TERRAIN_RES[this.hex(hid).terrain];
          if (r) { this.gain(r); got.push(r); }
        }
        this.log(`Starting resources from settlement ${i + 1}: ${got.length ? got.join(', ') : 'none (desert/coast)'}.`, 'good');
      }
      this.emit();
    }
    this.log(`Ante 1 boss: ${this.boss.name} — ${this.boss.desc}`);
    this.startRound();
  }

  // ------------------------------------------------------------ rounds
  startRound() {
    this.phase = 'turn';
    this.rollsUsed = 0;
    this.chain = 0;
    this.echoQueue = [];
    this.pendingRoll = null;
    this.lastRoll = null;
    this.brokeGame = false;
    this.bumper = false;
    this.omen = null;
    this.monopoly = null;
    this.fireSale = false;
    this.levyDelay = false;
    this.bribe = 0;
    this.oldBootExtra = 0;
    this.fleet = 0;
    this.earned = { unusedRolls: 0, storehouse: 0, river: 0, twinFortune: 0 };
    this.firePriestReroll = false;
    this.roundProduced = 0;
    this.streakGiven = false;
    for (const d of this.dice) d.used = {};

    // Tribute
    const a = this.ante - 1;
    const amounts = tributeFor(this.ante, this.blind);
    this.tribute = amounts.map((amount) => ({ amount, type: null, fixed: false, carried: false }));
    for (const c of this.carried) this.tribute.push({ amount: c, type: null, fixed: false, carried: true });
    this.carried = [];
    if (this.bossIs('pirate')) Object.assign(this.tribute[0], { type: 'wool', fixed: true });
    if (this.bossIs('caravan')) {
      const types = this.rng.shuffle([...RES]);
      this.tribute.filter((p) => !p.carried).forEach((p, i) => Object.assign(p, { type: types[i], fixed: true }));
    }
    if (this.bossIs('fog')) {
      const best = this.bestHexes(3);
      this.fogged = best.map((h) => ({ id: h.id, token: h.token }));
      const toks = this.rng.shuffle(best.map((h) => h.token));
      best.forEach((h, i) => (h.token = toks[i]));
      for (const h of best) h.hidden = true;
    }
    if (this.bossIs('volcano')) this.volcanoHex = this.bestHexes(1)[0]?.id ?? null;
    this.log(`— Ante ${this.ante}, ${BLINDS[this.blind]} round. Tribute: ${this.tributeText()}`, 'big');
    this.emit();
  }

  tributeText() {
    return this.tribute.map((p) => `${p.amount}${p.type ? ' ' + p.type : ''}`).join(' + ');
  }

  // hexes that produce most for you (pips × buildings)
  bestHexes(n) {
    return this.board.hexes
      .filter((h) => h.token)
      .map((h) => ({ h, s: pips(h.token) * this.buildingYield(h) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, n)
      .map((x) => x.h);
  }

  buildingYield(h) {
    let n = 0;
    for (const v of h.vertices) {
      const b = this.buildings[v];
      if (b === 'settlement') n += 1;
      else if (b === 'city') n += h.hexEffect?.id === 'guildDistrict' ? 3 : 2;
    }
    return n;
  }

  // ------------------------------------------------------------ dice
  dieUps(i) {
    const own = this.dice[i].upgrades;
    const other = this.dice[1 - i].upgrades;
    if (own.includes('copycat') && !other.includes('copycat')) {
      return [...new Set([...own, ...other.filter((u) => u !== 'copycat')])];
    }
    return own;
  }
  hasDieUp(i, id) { return this.dieUps(i).includes(id); }

  faceProbs(i) {
    const d = this.dice[i];
    if (!d.loaded) return Array(6).fill(1 / 6);
    const [fav, opp, side] = LOADING[d.loaded.level - 1];
    return [0, 1, 2, 3, 4, 5].map((k) => (k === d.loaded.face ? fav : k === 5 - d.loaded.face ? opp : side));
  }
  rollFace(i) { return this.rng.weightedIndex(this.faceProbs(i)); }

  canRoll() {
    return this.phase === 'turn' && !this.pendingRoll && (this.echoQueue.length > 0 || this.rollsUsed < ROLLS_PER_ROUND);
  }

  async roll() {
    if (!this.canRoll()) return;
    this.preRoll = this.snapshot();
    const pr = { faces: [0, 0], hold: [null, null], blank: [null, null], alt: [null, null], adj: [0, 0], set: [null, null], echo: false };
    if (this.echoQueue.length) {
      const die = this.echoQueue.shift();
      pr.echo = true;
      pr.faces = [...this.lastRoll.faces];
      pr.hold[1 - die] = this.lastRoll.values[1 - die];
      pr.faces[die] = this.rollFace(die);
      this.chain++;
      this.log(`Echo! Die ${die + 1} rolls again (chain ${this.chain}).`, 'good');
    } else {
      this.rollsUsed++;
      this.chain = 0;
      pr.faces = [this.rollFace(0), this.rollFace(1)];
    }
    if (this.devForce) {
      for (const i of [0, 1]) {
        if (pr.hold[i] != null) continue;
        const idx = this.dice[i].faces.findIndex((f) => f.value === this.devForce[i] && !f.setter);
        if (idx >= 0) pr.faces[i] = idx;
        else pr.set[i] = this.devForce[i];
      }
      this.devForce = null;
    }
    this.pendingRoll = pr;
    this.rollSeq = (this.rollSeq || 0) + 1;
    // Report shown in the Result step: what each die did, what happened, what you gained.
    const rep = { stage: 'adjust', echo: pr.echo, dice: [{ notes: [] }, { notes: [] }], lines: [], hexes: [], seen: false };
    for (const i of [0, 1]) {
      const d = this.dice[i];
      if (pr.hold[i] != null) rep.dice[i].notes.push('Held from the last roll (Echo)');
      else {
        if (d.loaded) rep.dice[i].notes.push(`Loaded die (level ${d.loaded.level} on face ${d.loaded.face + 1})`);
        if (pr.set[i] != null) rep.dice[i].notes.push(`Forced to ${pr.set[i]} (dev tools)`);
      }
    }
    this.report = rep;
    this.emit();
    if (!this.modifiersAvailable().length) await this.resolveRoll();
  }

  // Manual options before the roll resolves (Nudge, Recast, Alchemist, Twin Die).
  modifiersAvailable() {
    const pr = this.pendingRoll;
    if (!pr) return [];
    const out = [];
    for (const i of [0, 1]) {
      const d = this.dice[i];
      if (pr.hold[i] != null) continue;
      if (this.hasDieUp(i, 'nudge') && !d.used.nudge) out.push({ die: i, id: 'nudge' });
      if (this.hasDieUp(i, 'recast') && !d.used.recast) out.push({ die: i, id: 'recast' });
      if (this.hasDieUp(i, 'alchemist') && !d.used.alchemist) out.push({ die: i, id: 'alchemist' });
      if (this.hasDieUp(i, 'twin') && !d.used.twin) out.push({ die: i, id: 'twin' });
    }
    return out;
  }

  async useModifier(die, id) {
    const pr = this.pendingRoll;
    const d = this.dice[die];
    if (!pr) return;
    if (id === 'nudge') {
      const cur = this.valuesOf(pr).v[die];
      const opts = [];
      if (cur > 1) opts.push({ label: `−1 (→ ${cur - 1})`, value: -1 });
      if (cur < 6) opts.push({ label: `+1 (→ ${cur + 1})`, value: 1 });
      const delta = await this.io.chooseOption(opts, `Nudge die ${die + 1}`, { cancel: true });
      if (delta == null) return;
      pr.adj[die] += delta;
      d.used.nudge = true;
      this.report?.dice[die].notes.push(`Nudge: ${delta > 0 ? '+1' : '−1'}`);
    } else if (id === 'recast') {
      pr.faces[die] = this.rollFace(die);
      this.rollSeq++;
      pr.adj[die] = 0;
      pr.set[die] = null;
      pr.blank[die] = null;
      d.used.recast = true;
      this.log(`Recast die ${die + 1}.`);
      this.report?.dice[die].notes.push('Recast: rerolled');
    } else if (id === 'alchemist') {
      const v = await this.io.chooseOption([1, 2, 3, 4, 5, 6].map((n) => ({ label: String(n), value: n })), `Alchemist: set die ${die + 1}`, { cancel: true });
      if (v == null) return;
      pr.set[die] = v;
      pr.adj[die] = 0;
      d.used.alchemist = true;
      this.report?.dice[die].notes.push(`Alchemist: set to ${v}`);
    } else if (id === 'twin') {
      // Once per round: reroll this die instead of keeping the result. The new result stands, there is no going back.
      pr.faces[die] = this.rollFace(die);
      this.rollSeq++;
      pr.adj[die] = 0;
      pr.set[die] = null;
      pr.blank[die] = null;
      d.used.twin = true;
      this.log(`Twin Die: die ${die + 1} rerolled.`);
      this.report?.dice[die].notes.push('Twin Die: rerolled (final)');
    }
    this.emit();
  }

  valuesOf(pr) {
    const f = [0, 1].map((i) => this.dice[i].faces[pr.faces[i]]);
    const isMirror = (i) => pr.set[i] == null && pr.hold[i] == null && f[i].setter === 'mirror';
    const own = (i) => {
      if (pr.set[i] != null) return pr.set[i];
      if (pr.hold[i] != null) return pr.hold[i];
      if (f[i].setter === 'blank') return pr.blank[i] ?? 0;
      return f[i].value;
    };
    let v = [0, 0];
    let zero = false;
    if (isMirror(0) && isMirror(1)) zero = true;
    else v = [0, 1].map((i) => (isMirror(i) ? own(1 - i) : own(i)));
    v = v.map((x, i) => (x > 0 && pr.adj[i] ? Math.max(1, Math.min(6, x + pr.adj[i])) : x));
    const robberFaces = [0, 1].filter((i) => pr.hold[i] == null && pr.set[i] == null && f[i].setter === 'robber');
    return { v, zero, robberFaces, f };
  }

  async resolveRoll() {
    const pr = this.pendingRoll;
    if (!pr) return;
    // Blank faces: choose values now
    for (const i of [0, 1]) {
      const face = this.dice[i].faces[pr.faces[i]];
      if (face.setter === 'blank' && pr.hold[i] == null && pr.set[i] == null && pr.blank[i] == null) {
        let v = null;
        while (v == null) v = await this.io.chooseOption([1, 2, 3, 4, 5, 6].map((n) => ({ label: String(n), value: n })), `Blank Face on die ${i + 1}: choose its value`, { cancel: false });
        pr.blank[i] = v;
      }
    }
    const { v, zero, robberFaces, f } = this.valuesOf(pr);
    const sum = v[0] + v[1];
    const robberFace = robberFaces.length > 0;
    const isDouble = !zero && !robberFace && v[0] === v[1];
    const seven = robberFace || sum === 7;
    const triggers = {};
    for (const face of f) for (const t of face.triggers) triggers[t] = (triggers[t] || 0) + 1;
    const ctx = { sum: seven ? 7 : sum, isDouble, seven, triggers, produced: 0, gold: 0, producedHexes: new Set() };
    this.lastRoll = { faces: [...pr.faces], values: v, sum: ctx.sum, isDouble, seven, zero };
    const rep = this.report || { dice: [{ notes: [] }, { notes: [] }], lines: [], hexes: [] };
    this.report = rep;
    for (const i of [0, 1]) {
      if (pr.hold[i] != null || pr.set[i] != null) continue;
      const face = f[i];
      const n = rep.dice[i].notes;
      if (face.setter === 'mirror') n.push(zero ? 'Mirror Face vs Mirror Face: both count as 0' : `Mirror Face: copied the other die (${v[i]})`);
      if (face.setter === 'blank') n.push(`Blank Face: you chose ${pr.blank[i]}`);
      if (face.setter === 'robber') n.push("Robber's Face: the roll counts as 7, +2 resources of your choice");
      for (const t of face.triggers) n.push(`${ITEMS[t].name} face: ${ITEMS[t].desc}`);
    }
    rep.handBefore = { ...this.hand };
    rep.storeBefore = { ...this.storehouse };
    rep.ctx = ctx;
    this.capture = rep.lines;
    this.pendingRoll = null;
    this.log(`Rolled ${v[0]} + ${v[1]} = ${zero ? '0 (mirror vs mirror)' : ctx.sum}${isDouble ? ' (double)' : ''}${robberFace ? " — Robber's Face!" : ''}`, 'roll');

    if (zero) {
      // nothing produces
    } else if (seven) {
      await this.resolveSeven(ctx, f);
    } else {
      await this.produce(ctx);
    }
    if (robberFace) {
      const got = await this.io.chooseResources(2 * robberFaces.length, "Robber's Face: choose resources");
      this.addRes(got);
      ctx.produced += 2 * robberFaces.length;
    }
    if (!zero && (ctx.sum === 2 || ctx.sum === 12) && this.hasGuild('longShot')) {
      this.log('Long Shot! 4 resources of your choice.', 'good');
      this.addRes(await this.io.chooseResources(4, 'Long Shot: choose 4 resources'));
      ctx.produced += 4;
    }
    // Evergreen: produces 1 when nothing else did
    if (ctx.produced === 0) {
      for (const h of this.board.hexes) {
        if (h.tokenEffect?.id === 'evergreen' && this.buildingYield(h) > 0 && (this.robber !== h.id || h.hexEffect?.id === 'palisade')) {
          const r = this.resourceFor(h);
          if (r === 'gold') ctx.gold += 1;
          else { this.gain(r, 1); this.log(`Evergreen ${h.terrain}: +1 ${r}`); }
          ctx.produced += 1;
        }
      }
    }
    if (ctx.gold > 0) this.addRes(await this.io.chooseResources(ctx.gold, `Gold: choose ${ctx.gold} resource(s)`));
    if (isDouble && this.hasGuild('twinFortune')) { this.earned.twinFortune += 1; this.log('Twin Fortune: +1 VP', 'good'); }
    if (this.bossIs('barbarians') && (seven || isDouble)) await this.advanceFleet();
    if (ctx.produced === 0) {
      if (this.bossIs('oldBoot')) { this.oldBootExtra += 1; this.log('The Old Boot: dead roll, tribute +1', 'bad'); }
    }
    this.capture = null;
    this.roundProduced += ctx.produced;
    rep.gains = Object.fromEntries(RES.map((r) => [r, this.hand[r] - rep.handBefore[r]]));
    rep.storeGains = Object.fromEntries(RES.map((r) => [r, this.storehouse[r] - rep.storeBefore[r]]));
    rep.final = { values: v, sum: ctx.sum, isDouble, seven, zero, robberFace };
    // Faces that fired an effect this roll (triggers or a setter face), for the UI to light up.
    rep.fired = [];
    for (const i of [0, 1]) {
      if (pr.hold[i] != null || pr.set[i] != null) continue;
      if (f[i].triggers.length || f[i].setter) rep.fired.push({ die: i, face: pr.faces[i] });
    }
    rep.hexes = [...ctx.paidHexes || []];
    rep.stage = 'result';
    rep.seen = false;
    this.bumper = false;
    this.omen = null;

    // Echo
    if (isDouble) {
      for (const i of [0, 1]) if (this.hasDieUp(i, 'echo')) this.echoQueue.push(i);
    }
    if (isDouble && this.echoQueue.length) rep.lines.push({ msg: `Double + Echo: you get a free extra roll of die ${this.echoQueue.map((i) => i + 1).join(' and ')}.`, cls: 'good' });
    if (this.echoQueue.length && this.chain + 1 >= ECHO_BREAK) {
      this.echoQueue = [];
      this.brokeGame = true;
      this.log('YOU BROKE THE GAME! This round\'s tribute counts as paid.', 'big good');
    }
    if (this.bossIs('caravan')) {
      const parts = this.tribute.filter((p) => !p.carried);
      const p = this.rng.pick(parts);
      const unused = RES.filter((r) => !parts.some((q) => q.type === r));
      p.type = this.rng.pick(unused);
      this.log(`The Caravan: a tribute part now wants ${p.type}.`, 'bad');
    }
    // Losing streak: every roll this round came up empty → free development card
    if (LOSING_STREAK && !this.streakGiven && this.rollsUsed >= ROLLS_PER_ROUND && !this.echoQueue.length && this.roundProduced === 0) {
      this.streakGiven = true;
      const msg = 'Losing streak: no resources all round. You get a free development card!';
      this.log(msg, 'good');
      rep.lines.push({ msg, cls: 'good' });
      const item = await this.drawDevCard();
      if (item) rep.lines.push({ msg: `Free card: ${item.name}.`, cls: 'good' });
    }
    rep.changes = this.diffSnapshot(this.preRoll || this.snapshot(), this.snapshot());
    this.emit();
  }

  // The numbers a roll can move, so the Result step can show what grew (pure data, no DOM).
  snapshot() {
    return {
      vp: this.vp,
      fleet: this.fleet,
      oldBoot: this.oldBootExtra,
      chain: this.chain,
      knights: this.knights,
      streak: !!this.streakGiven,
      cardUids: this.cards.map((c) => c.uid),
      loaded: this.dice.map((d) => (d.loaded ? d.loaded.level : 0)),
      hand: { ...this.hand },
      store: { ...this.storehouse },
    };
  }

  // Compares two snapshots (before and after a roll). Returns [{ key, delta, text, cls }].
  diffSnapshot(a, b) {
    const out = [];
    const add = (key, from, to, text, cls = 'good') => { if (from !== to) out.push({ key, delta: to - from, text, cls }); };
    add('vp', a.vp, b.vp, `Score ${b.vp} VP`);
    add('fleet', a.fleet, b.fleet, `Barbarian Fleet ${b.fleet}/3`, 'bad');
    add('oldBoot', a.oldBoot, b.oldBoot, `Old Boot: tribute +${b.oldBoot}`, 'bad');
    add('chain', a.chain, b.chain, `Echo chain ${b.chain}`);
    add('knights', a.knights, b.knights, `Knights ${b.knights}`);
    if (!a.streak && b.streak) out.push({ key: 'streak', delta: 1, text: 'Losing streak: free card', cls: 'good' });
    for (const uid of b.cardUids) {
      if (a.cardUids.includes(uid)) continue;
      const c = this.cards.find((x) => x.uid === uid);
      out.push({ key: `card:${uid}`, delta: 1, text: `New card: ${c ? ITEMS[c.id].name : 'development card'}`, cls: 'good' });
    }
    b.loaded.forEach((lv, i) => add(`loaded:${i}`, a.loaded[i], lv, `Die ${i + 1} Loaded level ${lv}`));
    for (const r of RES) {
      add(`hand:${r}`, a.hand[r], b.hand[r], `${r} ${b.hand[r]} in hand`);
      add(`store:${r}`, a.store[r], b.store[r], `${r} ${b.store[r]} stored`);
    }
    return out;
  }

  // Draws a random development card (70/25/5 rarity) and takes it for free. Returns the item.
  async drawDevCard() {
    const w = RARITY_WEIGHTS;
    let item;
    for (let t = 0; t < 50; t++) {
      const rarity = ['common', 'rare', 'legendary'][this.rng.weightedIndex([w.common, w.rare, w.legendary])];
      const pool = ITEM_LIST.filter((i) => CATEGORY_GROUPS.dev.includes(i.cat) && i.rarity === rarity && this.itemAvailable(i));
      if (pool.length) { item = this.rng.pick(pool); break; }
    }
    if (!item) return null;
    this.log(`Drew a development card: ${item.name}.`, 'good');
    await this.acquire(item, { free: true, fromStack: true });
    return item;
  }

  addRes(got) {
    if (!got) return;
    for (const r of RES) this.gain(r, got[r] || 0);
  }

  resourceFor(h) {
    if (this.monopoly) return this.monopoly;
    if (h.hexEffect?.id === 'gold') return 'gold';
    return TERRAIN_RES[h.terrain];
  }

  productionBlocked(sum) {
    if (this.bossIs('doldrums') && [2, 3, 11, 12].includes(sum)) return true;
    if (this.bossIs('flood') && sum % 2 === 1) return true;
    return false;
  }

  matches(h, sum) {
    if (!h.token && !h.tokenEffect) return false;
    if (h.token === sum) return true;
    if (h.tokenEffect?.id === 'doubleToken' && h.tokenEffect.number === sum) return true;
    if (h.tokenEffect?.id === 'heartland' && h.token && Math.abs(h.token - sum) === 1) return true;
    return false;
  }

  async produce(ctx) {
    if (this.productionBlocked(ctx.sum)) {
      this.log(`${this.boss.name}: ${ctx.sum} produces nothing.`, 'bad');
      return;
    }
    const hexes = this.board.hexes.filter((h) => this.matches(h, ctx.sum));
    for (const h of hexes) await this.payoutWithRobber(h, ctx);
  }

  // Handles robber blocking + knight face triggers, then pays out.
  async payoutWithRobber(h, ctx) {
    const blocked = this.robber === h.id && h.hexEffect?.id !== 'palisade' && h.hexEffect?.id !== 'haven';
    if (blocked) {
      if (ctx.triggers.knightLucky && this.buildingYield(h) > 0) {
        this.moveRobberRandom(true);
        this.log("Knight's Lucky Number: the robber flees and the hex pays out.", 'good');
        await this.payout(h, ctx, { ignoreRobber: true });
      } else if (ctx.triggers.knightFav || ctx.triggers.knightLucky) {
        this.moveRobberRandom(true);
        this.log("Knight's Favorite: the robber flees (the hex still produces nothing this roll).", 'good');
      } else {
        if (this.buildingYield(h) > 0) this.log(`The robber blocks ${h.terrain} (${h.token}).`, 'bad');
      }
      return;
    }
    await this.payout(h, ctx, {});
  }

  async payout(h, ctx, { ignoreRobber = false, fromSister = false, noMult = false } = {}) {
    if (ctx.producedHexes.has(h.id)) return;
    ctx.producedHexes.add(h.id);
    let base = this.buildingYield(h);
    const r = this.resourceFor(h);
    if (base > 0 && r) {
      let amt = base;
      if (h.hexEffect?.id === 'fertile') amt += 1;
      amt += ctx.triggers.lucky || 0;
      if (this.hasGuild('mathematicians') && (h.token === 6 || h.token === 8)) amt += 1;
      const mono = this.guild('monoculture');
      if (mono) amt += h.terrain === mono.data.terrain ? 2 : -1;
      amt = Math.max(0, amt);
      if (!noMult) {
        if (h.tokenEffect?.id === 'jackpot') {
          if (ctx.sum === 2 || ctx.sum === 12) amt *= 3;
          else if (ctx.sum === 3 || ctx.sum === 11) amt *= 2;
        }
        if (h.tokenEffect?.id === 'twinToken' && ctx.isDouble) amt *= 2;
        if (h.hexEffect?.id === 'volcanic') amt *= 2;
        if (h.hexEffect?.id === 'haven' && this.robber === h.id) amt *= 2;
        if (this.bumper) amt *= 2;
        if (this.omen != null && this.omen === ctx.sum) amt *= 3;
      }
      if (amt > 0) {
        if (r === 'gold') ctx.gold += amt;
        else this.gain(r, amt);
        ctx.produced += amt;
        (ctx.paidHexes ||= new Set()).add(h.id);
        this.log(`${h.terrain} (${h.token ?? '—'}) → +${amt} ${r}${fromSister ? ' (sister)' : ''}`, 'good');
      }
      if (h.hexEffect?.id === 'volcanic') {
        if (this.hasGuild('firePriests')) { ctx.gold += 1; this.log('Fire Priests: +1 resource of choice'); }
        await this.eruptionCheck(h, false);
      }
      if (this.bossIs('volcano') && this.volcanoHex === h.id) await this.eruptionCheck(h, true);
    }
    // Sister Valleys (both directions)
    for (const o of this.board.hexes) {
      if (o.id === h.id) continue;
      const linked = (h.hexEffect?.id === 'sister' && h.hexEffect.link === o.id) || (o.hexEffect?.id === 'sister' && o.hexEffect.link === h.id);
      if (linked && !ctx.producedHexes.has(o.id)) {
        if (this.robber === o.id && o.hexEffect?.id !== 'palisade' && o.hexEffect?.id !== 'haven') { ctx.producedHexes.add(o.id); continue; }
        await this.payout(o, ctx, { fromSister: true });
      }
    }
  }

  checkRoll() {
    const f = [this.rollFace(0), this.rollFace(1)];
    const pr = { faces: f, hold: [null, null], blank: [null, null], alt: [null, null], adj: [0, 0], set: [null, null] };
    for (const i of [0, 1]) if (this.dice[i].faces[f[i]].setter === 'blank') pr.blank[i] = 1 + this.rng.int(6);
    const { v, zero } = this.valuesOf(pr);
    return { sum: v[0] + v[1], isDouble: !zero && v[0] === v[1] };
  }

  async eruptionCheck(h, isBoss) {
    let c = this.checkRoll();
    let erupt = c.isDouble || c.sum === h.token;
    if (erupt && this.hasGuild('firePriests') && !this.firePriestReroll) {
      this.firePriestReroll = true;
      this.log('Fire Priests reroll the eruption check.');
      c = this.checkRoll();
      erupt = c.isDouble || c.sum === h.token;
    }
    this.log(`${isBoss ? 'Volcano' : 'Volcanic Soil'} check: ${c.sum}${c.isDouble ? ' (double)' : ''} — ${erupt ? 'ERUPTION!' : 'calm'}`, erupt ? 'bad' : '');
    if (!erupt) return;
    const victims = h.vertices.filter((v) => this.buildings[v]);
    if (!victims.length) return;
    const v = this.rng.pick(victims);
    this.log(`A ${this.buildings[v]} is destroyed by lava.`, 'bad');
    delete this.buildings[v];
  }

  async resolveSeven(ctx, faces) {
    this.sevens++;
    const shown = (t) => faces.some((f) => f.triggers.includes(t));
    // Hexes that produce on 7 (token 7, Seven Token, Heartland on 6/8) — before the robber acts
    if (!this.productionBlocked(7)) {
      for (const h of this.board.hexes) {
        const on7 = h.token === 7 || (h.tokenEffect?.id === 'sevenToken' && h.token) ||
          (h.tokenEffect?.id === 'heartland' && (h.token === 6 || h.token === 8)) ||
          (h.tokenEffect?.id === 'doubleToken' && h.tokenEffect.number === 7);
        if (on7) await this.payoutWithRobber(h, ctx);
      }
    }
    // Hand limit
    if (!shown('hidden')) await this.handLimit();
    else this.log('Hidden face: no discard.', 'good');
    // Robber
    if (shown('robberLucky')) {
      let hid = null;
      while (hid == null) hid = await this.io.chooseHex(this.board.hexes.map((h) => h.id), "Robber's Lucky Number: place the robber and trigger that hex", { cancel: false });
      this.robber = hid;
      await this.payout(this.hex(hid), ctx, { ignoreRobber: true });
    } else if (shown('robberFav')) {
      let hid = null;
      while (hid == null) hid = await this.io.chooseHex(this.board.hexes.filter((h) => h.id !== this.robber).map((h) => h.id), "Robber's Favorite: place the robber", { cancel: false });
      this.robber = hid;
      this.log("Robber's Favorite: you placed the robber.");
    } else {
      this.moveRobberRandom(true);
    }
    if (this.bossIs('robberBaron')) {
      let n = Math.floor(sumRes(this.storehouse) / 2);
      if (n > 0) this.log(`The Robber Baron takes ${n} cards from the Storehouse.`, 'bad');
      while (n-- > 0) {
        const pool = RES.flatMap((r) => Array(this.storehouse[r]).fill(r));
        this.storehouse[this.rng.pick(pool)]--;
      }
    }
  }

  moveRobberRandom(announce) {
    const mine = this.board.hexes.filter((h) => h.id !== this.robber && h.hexEffect?.id !== 'palisade' && this.buildingYield(h) > 0 && h.terrain !== 'desert');
    const pool = mine.length ? mine : this.board.hexes.filter((h) => h.id !== this.robber);
    const h = this.rng.pick(pool);
    this.robber = h.id;
    if (announce) this.log(`The robber moves to ${h.terrain}${h.token ? ' (' + h.token + ')' : ''}.`, 'bad');
  }

  handCountable() {
    let n = sumRes(this.hand);
    if (this.hasGuild('granary')) n -= this.hand.grain;
    if (this.hasGuild('robbersFriend')) n -= Math.max(0, this.sevens - this.knights);
    return Math.max(0, n);
  }

  async handLimit() {
    const n = this.handCountable();
    if (n <= HAND_LIMIT) return;
    const toDiscard = Math.floor(n / 2);
    const allowed = this.hasGuild('granary') ? RES.filter((r) => r !== 'grain') : RES;
    const max = Object.fromEntries(RES.map((r) => [r, allowed.includes(r) ? this.hand[r] : 0]));
    const d = await this.io.discard(toDiscard, `The robber! You hold ${n} cards: discard ${toDiscard}.`, { max });
    for (const r of RES) this.hand[r] -= Math.min(d[r] || 0, this.hand[r]);
    this.log(`Discarded ${toDiscard} cards.`, 'bad');
  }

  async advanceFleet() {
    this.fleet++;
    this.log(`The Barbarian Fleet advances (${this.fleet}/3).`, 'bad');
    if (this.fleet >= 3) {
      this.fleet = 0;
      const vs = Object.keys(this.buildings);
      if (vs.length) {
        const v = this.rng.pick(vs);
        if (this.buildings[v] === 'city' && this.counts().settlement < this.limits.settlement) { this.buildings[v] = 'settlement'; this.log('The barbarians sack a city (→ settlement).', 'bad'); }
        else if (this.buildings[v] === 'city') { delete this.buildings[v]; this.log('The barbarians raze a city (no settlement piece left to replace it).', 'bad'); }
        else { delete this.buildings[v]; this.log('The barbarians burn a settlement.', 'bad'); }
      }
    }
  }

  // ------------------------------------------------------------ building
  counts() {
    const vals = Object.values(this.buildings);
    return { settlement: vals.filter((b) => b === 'settlement').length, city: vals.filter((b) => b === 'city').length, road: this.roads.size };
  }

  validSettlementSpots(setup = false) {
    const ignoreDistance = this.hasGuild?.('squatters');
    return this.board.vertices
      .filter((v) => !this.buildings[v.id])
      .filter((v) => ignoreDistance || v.neighbors.every((n) => !this.buildings[n]))
      .filter((v) => setup || v.edges.some((e) => this.roads.has(e)))
      .map((v) => v.id);
  }
  validRoadSpots() {
    return this.board.edges
      .filter((e) => !this.roads.has(e.id))
      .filter((e) => e.v.some((v) => this.buildings[v] || this.board.vertices[v].edges.some((x) => this.roads.has(x))))
      .map((e) => e.id);
  }
  validCitySpots() {
    return Object.keys(this.buildings).filter((v) => this.buildings[v] === 'settlement').map(Number);
  }

  canAct() { return this.phase === 'turn' && !this.pendingRoll; }

  canBuild(kind) {
    if (!this.canAct()) return false;
    const c = this.counts();
    if (kind === 'road') return this.canAfford(COSTS.road) && c.road < this.limits.road && this.validRoadSpots().length > 0;
    if (kind === 'settlement') return this.canAfford(COSTS.settlement) && c.settlement < this.limits.settlement && this.validSettlementSpots().length > 0;
    if (kind === 'city') return this.canAfford(COSTS.city) && c.city < this.limits.city && this.validCitySpots().length > 0;
    if (kind === 'dev') return this.canAfford(COSTS.dev);
    return false;
  }

  missingText(cost) {
    const miss = RES.filter((r) => (this.hand[r] || 0) < (cost[r] || 0)).map((r) => `${cost[r] - this.hand[r]} ${r}`);
    return miss.length ? `Need ${miss.join(', ')} more` : null;
  }

  // Short reason why a build action is unavailable, or null if it is available.
  whyNot(kind) {
    if (this.phase !== 'turn') return 'Not during this step';
    if (this.pendingRoll) return 'Finish the roll first';
    const c = this.counts();
    if (kind === 'road') {
      if (c.road >= this.limits.road) return `All ${this.limits.road} roads used`;
      if (!this.validRoadSpots().length) return 'No free edge next to your pieces';
      return this.missingText(COSTS.road);
    }
    if (kind === 'settlement') {
      if (c.settlement >= this.limits.settlement) return `All ${this.limits.settlement} settlements used (upgrade one to a city)`;
      if (!this.validSettlementSpots().length) return 'No legal spot: needs your road and 2 edges distance to other buildings';
      return this.missingText(COSTS.settlement);
    }
    if (kind === 'city') {
      if (c.city >= this.limits.city) return `All ${this.limits.city} cities used`;
      if (!this.validCitySpots().length) return 'No settlement to upgrade';
      return this.missingText(COSTS.city);
    }
    if (kind === 'dev') return this.missingText(COSTS.dev);
    return null;
  }

  async build(kind) {
    if (!this.canBuild(kind)) return;
    if (kind === 'road') {
      const e = await this.io.chooseEdge(this.validRoadSpots(), 'Build a road (1 brick, 1 lumber)', { cancel: true });
      if (e == null) return;
      this.pay(COSTS.road);
      this.roads.add(e);
      this.log('Built a road.');
    } else if (kind === 'settlement') {
      const v = await this.io.chooseVertex(this.validSettlementSpots(), 'Build a settlement', { cancel: true });
      if (v == null) return;
      this.pay(COSTS.settlement);
      this.buildings[v] = 'settlement';
      this.log('Built a settlement.');
    } else if (kind === 'city') {
      const v = await this.io.chooseVertex(this.validCitySpots(), 'Upgrade a settlement to a city', { cancel: true });
      if (v == null) return;
      this.pay(COSTS.city);
      this.buildings[v] = 'city';
      this.log('Built a city.');
    } else if (kind === 'dev') {
      this.pay(COSTS.dev);
      await this.drawDevCard();
    }
    this.emit();
  }

  // ------------------------------------------------------------ trading & storehouse
  ownedPorts() {
    return this.board.ports.filter((p) => p.vertices.some((v) => this.buildings[v]));
  }
  tradeRate(r) {
    let rate = 4;
    if (this.fireSale) rate = 2;
    for (const p of this.ownedPorts()) {
      if (p.type === 'generic') rate = Math.min(rate, 3);
      else if (p.type === r) rate = Math.min(rate, 2);
    }
    return rate;
  }
  trade(give, get) {
    if (!this.canAct() || give === get) return false;
    const rate = this.tradeRate(give);
    if (this.hand[give] < rate) return false;
    this.hand[give] -= rate;
    this.hand[get] += 1;
    this.log(`Traded ${rate} ${give} → 1 ${get}.`);
    this.emit();
    return true;
  }

  storehouseRate(p) {
    const owned = this.ownedPorts();
    const gen = owned.filter((q) => q.type === 'generic').length;
    const spec = owned.filter((q) => q.type !== 'generic').length;
    if (p.type === 'generic') {
      const input = Math.max(1, 6 - (this.hasGuild('tradeConsul') ? spec : 0) - p.up.smaller);
      return { input, bonus: 1 + p.up.bigger };
    }
    const input = Math.max(1, 4 - p.up.smaller);
    return { input, bonus: 1 + p.up.bigger + (this.hasGuild('moneylender') ? gen : 0) };
  }

  canShip() { return this.canAct() && !this.bossIs('pirate') && this.ownedPorts().length > 0; }

  // mode: 'batch' | 'overflow'
  ship(portId, r, mode = 'batch') {
    if (!this.canShip()) return false;
    const p = this.board.ports[portId];
    if (!this.ownedPorts().includes(p)) return false;
    if (p.type !== 'generic' && p.type !== r) return false;
    const { input, bonus } = this.storehouseRate(p);
    if (mode === 'batch') {
      if (this.hand[r] < input) return false;
      this.hand[r] -= input;
      this.storehouse[r] += input + bonus;
      this.log(`Shipped ${input} ${r} → ${input + bonus} in the Storehouse.`, 'good');
    } else {
      // Overflow: leftovers smaller than a batch ship 1:1 (so 7 ore at 6+1 → 8 in total).
      if (!p.up.overflow) return false;
      const n = this.hand[r];
      if (n <= 0 || n >= input) return false;
      this.hand[r] -= n;
      this.storehouse[r] += n;
      this.log(`Overflow: shipped ${n} leftover ${r} 1:1.`, 'good');
    }
    this.emit();
    return true;
  }

  async shipMixed(portId) {
    const p = this.board.ports[portId];
    if (!this.canShip() || p.type !== 'generic' || !p.up.free || !this.ownedPorts().includes(p)) return;
    const { input, bonus } = this.storehouseRate(p);
    if (sumRes(this.hand) < input) return;
    const pick = await this.io.chooseResources(input, `Free Port: choose ${input} cards from your hand to ship`, { max: { ...this.hand }, cancel: true });
    if (!pick) return;
    for (const r of RES) { this.hand[r] -= pick[r] || 0; this.storehouse[r] += pick[r] || 0; }
    const b = await this.io.chooseResources(bonus, `Free Port: choose the ${bonus} bonus card(s)`, {});
    for (const r of RES) this.storehouse[r] += b[r] || 0;
    this.log(`Free Port: shipped a mixed batch (+${bonus}).`, 'good');
    this.emit();
  }

  // ------------------------------------------------------------ VP
  longestRoad() {
    const adj = new Map();
    for (const e of this.roads) {
      for (const v of this.board.edges[e].v) {
        if (!adj.has(v)) adj.set(v, []);
        adj.get(v).push(e);
      }
    }
    let best = 0;
    const used = new Set();
    const dfs = (v, len) => {
      best = Math.max(best, len);
      for (const e of adj.get(v) || []) {
        if (used.has(e)) continue;
        used.add(e);
        const [a, b] = this.board.edges[e].v;
        dfs(a === v ? b : a, len + 1);
        used.delete(e);
      }
    };
    for (const v of adj.keys()) dfs(v, 0);
    return best;
  }

  vpBreakdown() {
    const out = { settlements: 0, cities: 0, vpCards: this.vpCards, road: 0, army: 0 };
    for (const [v, b] of Object.entries(this.buildings)) {
      if (b === 'settlement') out.settlements += 1;
      else {
        const capital = this.board.vertices[v].hexes.some((h) => this.hex(h).hexEffect?.id === 'capital');
        out.cities += capital ? 4 : 2;
      }
    }
    const lr = this.longestRoad();
    if (lr >= 5) out.road = 2 + (this.hasGuild('cartographer') ? lr - 5 : Math.floor((lr - 5) / 2));
    if (this.knights >= 3) out.army = 2 + (this.hasGuild('marshal') ? this.knights - 3 : Math.floor((this.knights - 3) / 2));
    out.longestRoad = lr;
    out.total = out.settlements + out.cities + out.vpCards + out.road + out.army;
    return out;
  }
  get vp() { return this.vpBreakdown().total; }

  riverIncome() {
    let n = 0;
    for (const h of this.board.hexes) {
      if (h.hexEffect?.id !== 'river') continue;
      n += h.edges.filter((e) => this.roads.has(e)).length;
    }
    return n;
  }

  // ------------------------------------------------------------ cards
  async playCard(uid) {
    if (!this.canAct()) return;
    const card = this.cards.find((c) => c.uid === uid);
    if (!card) return;
    const ok = await this.cardEffect(card.id);
    if (ok === false) return;
    this.cards = this.cards.filter((c) => c.uid !== uid);
    this.log(`Played ${ITEMS[card.id].name}.`);
    this.emit();
  }

  async cardEffect(id) {
    const io = this.io;
    switch (id) {
      case 'knight': {
        const hid = await io.chooseHex(this.board.hexes.filter((h) => h.id !== this.robber).map((h) => h.id), 'Knight: move the robber', { cancel: true });
        if (hid == null) return false;
        this.robber = hid;
        this.knights++;
        if (this.bossIs('barbarians') && this.fleet > 0) { this.fleet--; this.log('The knight pushes the fleet back.', 'good'); }
        return true;
      }
      case 'roadBuilding': {
        let built = 0;
        for (let i = 0; i < 2; i++) {
          if (this.roads.size >= this.limits.road) break;
          const spots = this.validRoadSpots();
          if (!spots.length) break;
          const e = await io.chooseEdge(spots, `Road Building: free road ${i + 1} of 2`, { cancel: true });
          if (e == null) break;
          this.roads.add(e);
          built++;
          this.emit();
        }
        return built > 0 ? true : false;
      }
      case 'yearOfPlenty': {
        const got = await io.chooseResources(2, 'Year of Plenty: take 2 resources', { cancel: true });
        if (!got) return false;
        this.addRes(got);
        return true;
      }
      case 'monopoly': {
        const r = await io.chooseOption(RES.map((x) => ({ label: x, value: x })), 'Monopoly: all production this round becomes…', { cancel: true });
        if (!r) return false;
        this.monopoly = r;
        return true;
      }
      case 'bumper': this.bumper = true; return true;
      case 'bribe': this.bribe += 2; return true;
      case 'census': {
        const n = this.counts().settlement;
        if (n === 0) return false;
        const got = await io.chooseResources(n, `Census: choose ${n} resource(s)`, { cancel: true });
        if (!got) return false;
        this.addRes(got);
        return true;
      }
      case 'fireSale': this.fireSale = true; return true;
      case 'omen': {
        const n = await io.chooseOption([2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 7].map((x) => ({ label: String(x), value: x })), 'Omen: name a number', { cancel: true });
        if (n == null) return false;
        this.omen = n;
        return true;
      }
      case 'levyDelay': this.levyDelay = true; return true;
      case 'demolition': {
        const v = await io.chooseVertex(Object.keys(this.buildings).map(Number), 'Demolition: remove one of your buildings', { cancel: true });
        if (v == null) return false;
        const kind = this.buildings[v];
        delete this.buildings[v];
        const cost = COSTS[kind];
        for (const r of RES) this.gain(r, 2 * (cost[r] || 0));
        this.log(`Demolished a ${kind}: gained double its cost.`);
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------ end of round & tribute
  canEndRound() { return this.phase === 'turn' && !this.pendingRoll; }

  endRound() {
    if (!this.canEndRound()) return;
    this.earned.unusedRolls = ROLLS_PER_ROUND - this.rollsUsed;
    this.echoQueue = [];
    if (this.levyDelay) {
      this.carried = this.tributeDue().map((p) => Math.ceil(p.amount * 1.5));
      this.log(`Levy Delay: tribute pushed to next round (${this.carried.join(' + ')}).`, 'good');
      this.finishTribute(true);
      return;
    }
    if (this.brokeGame) {
      this.log('The game is broken — tribute counts as paid.', 'good');
      this.finishTribute(true);
      return;
    }
    this.phase = 'tribute';
    this.emit();
  }

  // Tribute parts after Bribe, Tax Collector and Old Boot.
  tributeDue() {
    const parts = this.tribute.map((p) => ({ ...p }));
    if (parts.length) parts[0].amount += this.oldBootExtra;
    let red = this.bribe + (this.hasGuild('taxCollector') ? this.counts().city : 0);
    while (red > 0) {
      const p = parts.reduce((a, b) => (b.amount > a.amount ? b : a));
      if (p.amount <= 0) break;
      p.amount--;
      red--;
    }
    return parts;
  }

  available(r) { return this.hand[r] + this.storehouse[r]; }

  checkAssignment(types) {
    const due = this.tributeDue();
    const need = emptyRes();
    const seen = new Set();
    for (let i = 0; i < due.length; i++) {
      const t = due[i].fixed ? due[i].type : types[i];
      if (!t) return { ok: false, msg: 'Choose a type for every part.' };
      if (!due[i].carried) {
        if (seen.has(t)) return { ok: false, msg: 'Each part must use a different type.' };
        seen.add(t);
      }
      need[t] += due[i].amount;
    }
    for (const r of RES) if (this.available(r) < need[r]) return { ok: false, msg: `Not enough ${r}.`, need };
    return { ok: true, need };
  }

  // Finds the assignment leaving the most cards over, or null if none can pay.
  autoAssign() {
    const due = this.tributeDue();
    let best = null;
    const rec = (i, types) => {
      if (i === due.length) {
        const c = this.checkAssignment(types);
        if (c.ok) {
          const slack = RES.reduce((a, r) => a + Math.min(this.available(r) - c.need[r], 3), 0);
          if (!best || slack > best.slack) best = { types: [...types], slack };
        }
        return;
      }
      if (due[i].fixed) { types[i] = due[i].type; rec(i + 1, types); return; }
      for (const r of RES) { types[i] = r; rec(i + 1, types); }
    };
    rec(0, []);
    return best?.types ?? null;
  }

  payTribute(types) {
    if (this.phase !== 'tribute') return false;
    const c = this.checkAssignment(types);
    if (!c.ok) return false;
    for (const r of RES) {
      let n = c.need[r];
      const fromStore = Math.min(n, this.storehouse[r]);
      this.storehouse[r] -= fromStore;
      n -= fromStore;
      this.hand[r] -= n;
    }
    this.log(`Tribute paid.`, 'good');
    this.finishTribute(false);
    return true;
  }

  failTribute() {
    if (this.phase !== 'tribute') return;
    this.phase = 'gameover';
    this.log(`Tribute failed. Run over after ${this.roundsSurvived} round(s).`, 'big bad');
    this.emit();
  }

  finishTribute(skipped) {
    // Storehouse surplus → VP, then empties
    const surplus = sumRes(this.storehouse);
    this.earned.storehouse = Math.floor(surplus / 3);
    this.storehouse = emptyRes();
    this.earned.river = this.riverIncome();
    this.roundsSurvived++;
    // Restore fog
    if (this.fogged) {
      for (const f of this.fogged) { this.hex(f.id).token = f.token; this.hex(f.id).hidden = false; }
      this.fogged = null;
    }
    this.volcanoHex = null;
    const e = this.earned;
    const earnedTotal = e.unusedRolls + e.storehouse + e.river + e.twinFortune;
    this.budget = this.vp + earnedTotal;
    this.log(`Shop budget: ${this.vp} score + ${earnedTotal} earned = ${this.budget} VP.`, 'big');
    // After a boss round, reveal the next ante's boss now so it can be rerolled in this shop.
    if (this.blind === 2) {
      this.nextBossId = this.randomBoss(this.bossId, this.ante + 1);
    }
    this.openShop();
  }

  // Random boss for an ante; early antes only draw gentle bosses.
  randomBoss(exclude, ante = this.ante) {
    const pool = BOSSES.filter((b) => b.id !== exclude && (ante > GENTLE_UNTIL_ANTE || b.gentle));
    return this.rng.pick(pool).id;
  }

  // ------------------------------------------------------------ shop
  itemAvailable(item) {
    if (isUnique(item) && this.takenUniques.has(item.id)) return false;
    if (item.cat === 'guild' && this.hasGuild(item.id)) return false;
    if (item.id === 'clearDesert' && !this.board.hexes.some((h) => h.terrain === 'desert')) return false;
    if (item.id === 'forgery' && ![...this.takenUniques].some((id) => ['face', 'die'].includes(ITEMS[id].cat))) return false;
    if (item.id === 'lostFound' && this.takenUniques.size === 0) return false;
    return true;
  }

  pickItem(group) {
    const cats = CATEGORY_GROUPS[group];
    const w = RARITY_WEIGHTS;
    for (let t = 0; t < 50; t++) {
      const rarity = ['common', 'rare', 'legendary'][this.rng.weightedIndex([w.common, w.rare, w.legendary])];
      const pool = ITEM_LIST.filter((i) => cats.includes(i.cat) && i.rarity === rarity && this.itemAvailable(i));
      if (pool.length) return this.rng.pick(pool);
    }
    return ITEM_LIST.find((i) => cats.includes(i.cat) && i.rarity === 'common');
  }

  openShop() {
    this.phase = 'shop';
    this.shopRerolls = 0;
    this.generateShop();
    this.emit();
  }

  generateShop() {
    const slots = [
      { kind: 'dice', item: this.pickItem('dice') },
      { kind: 'field', item: this.pickItem('field') },
      { kind: 'dev', item: this.pickItem('dev') },
      { kind: 'dev', item: this.pickItem('dev') },
    ];
    const group = this.rng.pick(['dice', 'field', 'dev']);
    const opts = [];
    for (let t = 0; t < 20 && opts.length < 3; t++) {
      const it = this.pickItem(group);
      if (!opts.includes(it)) opts.push(it);
    }
    slots.push({ kind: 'pack', group, options: opts });
    if (this.forcedNext) {
      const it = ITEMS[this.forcedNext];
      const idx = ['face', 'die'].includes(it.cat) ? 0 : ['token', 'hex', 'port'].includes(it.cat) ? 1 : 2;
      slots[idx] = { kind: slots[idx].kind, item: it };
      this.forcedNext = null;
    }
    this.shop = slots.map((s) => ({ ...s, sold: false }));
  }

  priceOf(item) {
    if (item.cat === 'charter') {
      const n = this.charterCount[item.id] || 0;
      return Math.ceil(item.price * Math.pow(1.5, n));
    }
    if (item.id === 'loaded') {
      const lv = Math.min(...this.dice.map((d) => (d.loaded ? d.loaded.level : 0)));
      return lv >= 10 ? Infinity : LOADING[lv][3];
    }
    return item.price;
  }
  slotPrice(slot) { return slot.kind === 'pack' ? PACK_PRICE : this.priceOf(slot.item); }
  get rerollPrice() { return seqAt(SHOP_REROLL, this.shopRerolls); }
  get bossRerollPrice() { return seqAt(BOSS_REROLL, this.bossRerolls); }

  async buy(index) {
    if (this.phase !== 'shop') return;
    const slot = this.shop[index];
    if (!slot || slot.sold) return;
    if (slot.kind === 'pack') {
      if (this.budget < PACK_PRICE) return;
      const choice = await this.io.chooseOption(
        slot.options.map((it, i) => ({ label: `${it.name} (${it.rarity}) — ${it.desc}`, value: i, item: it.id })),
        'Pack: choose 1 of 3', { cancel: true });
      if (choice == null) return;
      const ok = await this.acquire(slot.options[choice], { free: true });
      if (ok == null) return;
      this.budget -= PACK_PRICE;
      slot.sold = true;
    } else {
      if (this.budget < this.priceOf(slot.item)) return;
      const cost = await this.acquire(slot.item, { maxPrice: this.budget });
      if (cost == null) return;
      this.budget -= cost;
      slot.sold = true;
    }
    this.emit();
  }

  rerollShop() {
    if (this.phase !== 'shop' || this.budget < this.rerollPrice) return;
    this.budget -= this.rerollPrice;
    this.shopRerolls++;
    this.generateShop();
    this.log('Shop rerolled.');
    this.emit();
  }

  rerollBoss() {
    if (this.phase !== 'shop' || this.budget < this.bossRerollPrice) return;
    this.budget -= this.bossRerollPrice;
    this.bossRerolls++;
    if (this.blind === 2) {
      this.nextBossId = this.randomBoss(this.nextBossId, this.ante + 1);
      this.log(`Next boss rerolled: ${BOSS_BY_ID[this.nextBossId].name}.`);
    } else {
      this.bossId = this.randomBoss(this.bossId);
      this.log(`Boss rerolled: ${this.boss.name}.`);
    }
    this.emit();
  }

  leaveShop() {
    if (this.phase !== 'shop') return;
    this.budget = 0;
    if (this.blind === 2) {
      this.ante++;
      this.blind = 0;
      this.bossId = this.nextBossId;
      this.nextBossId = null;
      this.log(`Ante ${this.ante} boss: ${this.boss.name} — ${this.boss.desc}`);
    } else {
      this.blind++;
    }
    this.startRound();
  }

  // ------------------------------------------------------------ acquiring items
  // Returns the VP cost actually charged (0 if free), or null if cancelled / impossible.
  async acquire(item, { free = false, maxPrice = Infinity, fromStack = false } = {}) {
    const io = this.io;
    const price = free ? 0 : this.priceOf(item);
    const done = (cost = price) => {
      if (isUnique(item)) this.takenUniques.add(item.id);
      this.log(`Acquired ${item.name}.`, 'good');
      return cost;
    };

    // ---- face upgrades
    if (item.cat === 'face') {
      const opts = [];
      for (const d of [0, 1]) for (let i = 0; i < 6; i++) {
        const f = this.dice[d].faces[i];
        opts.push({ die: d, face: i, label: `Die ${d + 1} · face ${i + 1}` });
      }
      const pick = await io.chooseFace(opts, `${item.name}: choose a face`, { cancel: true });
      if (!pick) return null;
      const f = this.dice[pick.die].faces[pick.face];
      if (item.kind === 'setter') {
        if (item.id === 'reforge') { const vals = [1, 2, 3, 4, 5, 6].filter((v) => v !== f.value); f.value = this.rng.pick(vals); f.setter = null; }
        else if (item.id === 'raise') { f.value = f.value === 6 ? 1 : f.value + 1; f.setter = null; }
        else if (item.id === 'lower') { f.value = f.value === 1 ? 6 : f.value - 1; f.setter = null; }
        else f.setter = { mirror: 'mirror', robberFace: 'robber', blank: 'blank' }[item.id];
      } else {
        f.triggers.push(item.id);
      }
      return done();
    }

    // ---- die upgrades
    if (item.cat === 'die') {
      if (item.id === 'loaded') {
        const opts = [0, 1].map((d) => {
          const L = this.dice[d].loaded;
          const lv = L ? L.level : 0;
          const cost = free ? 0 : lv >= 10 ? Infinity : LOADING[lv][3];
          return { label: L ? `Die ${d + 1}: level ${lv} → ${lv + 1} (${cost} VP)` : `Die ${d + 1}: start loading (${cost} VP)`, value: d, disabled: cost > maxPrice };
        });
        const d = await io.chooseOption(opts, 'Loaded: choose a die', { cancel: true });
        if (d == null) return null;
        const die = this.dice[d];
        if (!die.loaded) {
          const face = await io.chooseOption(die.faces.map((f, i) => ({ label: `Face ${i + 1} (shows ${f.setter ?? f.value})`, value: i })), 'Choose the face to favour', { cancel: true });
          if (face == null) return null;
          die.loaded = { face, level: 1 };
          return done(free ? 0 : LOADING[0][3]);
        }
        const cost = free ? 0 : LOADING[die.loaded.level][3];
        die.loaded.level++;
        return done(cost);
      }
      const opts = [0, 1].map((d) => ({ label: `Die ${d + 1}${this.dice[d].upgrades.includes(item.id) ? ' (already has it)' : ''}`, value: d, disabled: this.dice[d].upgrades.includes(item.id) }));
      const d = await io.chooseOption(opts, `${item.name}: choose a die`, { cancel: true });
      if (d == null) return null;
      this.dice[d].upgrades.push(item.id);
      return done();
    }

    // ---- token & hex upgrades
    if (item.cat === 'token' || item.cat === 'hex') {
      const hexes = this.board.hexes;
      const withToken = hexes.filter((h) => h.token).map((h) => h.id);
      const land = hexes.filter((h) => h.terrain !== 'desert').map((h) => h.id);
      let targets = item.cat === 'token' ? withToken : land;
      if (item.id === 'clearDesert') targets = hexes.filter((h) => h.terrain === 'desert').map((h) => h.id);
      if (item.id === 'tokenSwap') targets = withToken.filter((id) => this.hex(id).neighbors.some((n) => this.hex(n).token));
      if (!targets.length) return null;
      const hid = await io.chooseHex(targets, `${item.name}: choose a hex`, { cancel: true });
      if (hid == null) return null;
      const h = this.hex(hid);
      switch (item.id) {
        case 'tokenSwap': {
          const other = await io.chooseHex(h.neighbors.filter((n) => this.hex(n).token), 'Swap with which adjacent token?', { cancel: true });
          if (other == null) return null;
          const o = this.hex(other);
          [h.token, o.token] = [o.token, h.token];
          [h.tokenEffect, o.tokenEffect] = [o.tokenEffect, h.tokenEffect];
          break;
        }
        case 'shift': {
          const opts = [];
          if (h.token > 2) opts.push({ label: `−1 (→ ${h.token - 1})`, value: -1 });
          if (h.token < 12) opts.push({ label: `+1 (→ ${h.token + 1})`, value: 1 });
          const dlt = await io.chooseOption(opts, 'Shift the token', { cancel: true });
          if (dlt == null) return null;
          h.token += dlt;
          break;
        }
        case 'doubleToken': {
          const nums = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12].filter((n) => n !== h.token);
          h.tokenEffect = { id: 'doubleToken', number: this.rng.pick(nums) };
          this.log(`Second token: ${h.tokenEffect.number}.`);
          break;
        }
        case 'terraform': {
          h.terrain = this.rng.pick(TERRAINS.filter((t) => t !== h.terrain));
          break;
        }
        case 'clearDesert': {
          h.terrain = this.rng.pick(TERRAINS);
          h.token = 7;
          break;
        }
        case 'surveyor': {
          const t = await io.chooseOption(TERRAINS.filter((x) => x !== h.terrain).map((x) => ({ label: `${x} (${TERRAIN_RES[x]})`, value: x })), 'Surveyor: choose terrain', { cancel: true });
          if (!t) return null;
          h.terrain = t;
          break;
        }
        case 'sister': {
          const other = await io.chooseHex(land.filter((x) => x !== hid), 'Sister Valleys: link to which hex?', { cancel: true });
          if (other == null) return null;
          h.hexEffect = { id: 'sister', link: other };
          break;
        }
        default:
          if (item.cat === 'token') h.tokenEffect = { id: item.id };
          else h.hexEffect = { id: item.id };
      }
      return done();
    }

    // ---- port upgrades
    if (item.cat === 'port') {
      let ports = this.board.ports;
      if (item.id === 'freePort') ports = ports.filter((p) => p.type === 'generic' && !p.up.free);
      if (item.id === 'overflow') ports = ports.filter((p) => !p.up.overflow);
      const pid = await io.choosePort(ports.map((p) => p.id), `${item.name}: choose a port`, { cancel: true });
      if (pid == null) return null;
      const p = this.board.ports[pid];
      if (item.id === 'overflow') p.up.overflow = true;
      if (item.id === 'bigger') p.up.bigger++;
      if (item.id === 'smaller') p.up.smaller++;
      if (item.id === 'freePort') p.up.free = true;
      return done();
    }

    // ---- classic & edicts → hand
    if (item.cat === 'classic' || item.cat === 'edict') {
      if (item.id === 'vpCard') { this.vpCards++; return done(); }
      if (this.cards.length >= this.limits.handSlots) {
        const opts = this.cards.map((c) => ({ label: `Discard ${ITEMS[c.id].name}`, value: c.uid }));
        const uid = await io.chooseOption(opts, `Hand slots full — discard a card to take ${item.name}?`, { cancel: true });
        if (uid == null) return fromStack ? 0 : null;
        this.cards = this.cards.filter((c) => c.uid !== uid);
      }
      this.cards.push({ uid: UID++, id: item.id });
      return done();
    }

    // ---- guilds
    if (item.cat === 'guild') {
      let data = {};
      if (item.id === 'monoculture') {
        const t = await io.chooseOption(TERRAINS.map((x) => ({ label: `${x} (${TERRAIN_RES[x]})`, value: x })), 'Monoculture: which terrain gets +2?', { cancel: true });
        if (!t) return fromStack ? 0 : null;
        data.terrain = t;
      }
      if (this.guilds.length >= this.limits.guildSlots) {
        const opts = this.guilds.map((g) => ({ label: `Discard ${ITEMS[g.id].name}`, value: g.uid }));
        const uid = await io.chooseOption(opts, `Guild slots full — discard a Guild to take ${item.name}?`, { cancel: true });
        if (uid == null) return fromStack ? 0 : null;
        this.guilds = this.guilds.filter((g) => g.uid !== uid);
      }
      this.guilds.push({ uid: UID++, id: item.id, data });
      return done();
    }

    // ---- charters
    if (item.cat === 'charter') {
      switch (item.id) {
        case 'townCharter': this.limits.settlement++; break;
        case 'royalCharter': this.limits.city++; break;
        case 'highwayCharter': this.limits.road += 5; break;
        case 'guildExpansion': this.limits.guildSlots++; break;
        case 'deepPockets': this.limits.handSlots++; break;
        case 'forgery': {
          const owned = [...this.takenUniques].filter((id) => ['face', 'die'].includes(ITEMS[id].cat));
          const id = await io.chooseOption(owned.map((x) => ({ label: ITEMS[x].name, value: x })), 'Forgery: copy which unique upgrade?', { cancel: true });
          if (!id) return fromStack ? 0 : null;
          const r = await this.acquire(ITEMS[id], { free: true });
          if (r == null) return fromStack ? 0 : null;
          break;
        }
        case 'lostFound': {
          const id = await io.chooseOption([...this.takenUniques].map((x) => ({ label: ITEMS[x].name, value: x })), 'Lost and Found: return which unique upgrade to the pool?', { cancel: true });
          if (!id) return fromStack ? 0 : null;
          this.takenUniques.delete(id);
          this.forcedNext = id;
          break;
        }
      }
      if (!fromStack) this.charterCount[item.id] = (this.charterCount[item.id] || 0) + 1;
      return done();
    }
    return null;
  }

  // ------------------------------------------------------------ dev tools
  devGive(r, n) { this.hand[r] = Math.max(0, this.hand[r] + n); this.emit(); }
  devBudget(n) { if (this.phase === 'shop') { this.budget += n; this.emit(); } }
  async devItem(id) { await this.acquire(ITEMS[id], { free: true }); this.emit(); }
}
