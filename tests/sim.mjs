// Headless bot runs: plays many random-ish runs to catch crashes and broken invariants.
// Usage: node tests/sim.mjs [runs=200]
import { Game, COSTS } from '../js/game.js';
import { RNG } from '../js/rng.js';
import { RES } from '../js/board.js';
import { ITEM_LIST } from '../js/content.js';

const runs = Number(process.argv[2] || 200);
// coverage: feed the bot resources and budget so it reaches deep content; balance: honest greedy-ish play
const mode = process.argv[3] || 'coverage';
import { pips } from '../js/board.js';

class BotIO {
  constructor(rng) { this.rng = rng; }
  pick(arr) { return arr.length ? this.rng.pick(arr) : null; }
  async chooseVertex(ids, p, o) {
    if (/free settlement/.test(p) && this.game) {
      const score = (v) => this.game.board.vertices[v].hexes.reduce((a, h) => a + pips(this.game.hex(h).token), 0);
      return [...ids].sort((a, b) => score(b) - score(a))[0];
    }
    return this.maybeCancel(o) ?? this.pick(ids);
  }
  async chooseEdge(ids, _p, o) { return this.maybeCancel(o) ?? this.pick(ids); }
  async chooseHex(ids, _p, o) { return this.maybeCancel(o) ?? this.pick(ids); }
  async choosePort(ids, _p, o) { return this.maybeCancel(o) ?? this.pick(ids); }
  async chooseFace(opts, _p, o) { return this.maybeCancel(o) ?? this.pick(opts); }
  async chooseOption(opts, _p, o) {
    const ok = opts.filter((x) => !x.disabled);
    if (!ok.length) return null;
    return this.maybeCancel(o) ?? this.pick(ok).value;
  }
  async chooseResources(n, _p, o = {}) {
    const out = Object.fromEntries(RES.map((r) => [r, 0]));
    const max = o.max;
    for (let i = 0; i < n; i++) {
      const pool = RES.filter((r) => !max || out[r] < max[r]);
      if (!pool.length) return o.cancel ? null : out;
      out[this.rng.pick(pool)]++;
    }
    return out;
  }
  async discard(n, _p, o) {
    const out = Object.fromEntries(RES.map((r) => [r, 0]));
    for (let i = 0; i < n; i++) {
      const pool = RES.filter((r) => out[r] < o.max[r]);
      if (!pool.length) break;
      out[this.rng.pick(pool)]++;
    }
    return out;
  }
  maybeCancel(o) { return o?.cancel && this.rng.next() < 0.05 ? null : undefined; }
}

function check(g, where) {
  for (const r of RES) {
    if (g.hand[r] < 0 || !Number.isInteger(g.hand[r])) throw new Error(`bad hand ${r}=${g.hand[r]} at ${where}`);
    if (g.storehouse[r] < 0) throw new Error(`bad storehouse ${r} at ${where}`);
  }
  if (g.phase === 'shop' && g.budget < 0) throw new Error(`negative budget at ${where}`);
  const c = g.counts();
  if (c.settlement > g.limits.settlement || c.city > g.limits.city || c.road > g.limits.road) throw new Error(`piece limit broken at ${where}`);
}

async function playRun(seed, stats) {
  const rng = new RNG(seed * 7 + 1);
  const io = new BotIO(rng);
  const g = new Game({ seed, io });
  io.game = g;
  await g.start();
  let guard = 0;
  while (g.phase !== 'gameover' && guard++ < 5000) {
    if (g.roundsSurvived >= 60) break;
    if (g.phase === 'turn') {
      if (mode === 'coverage' && g.rollsUsed === 0 && !g.pendingRoll && !g._fed) { for (const r of RES) g.devGive(r, 4); g._fed = true; }
      if (g.pendingRoll) {
        const mods = g.modifiersAvailable();
        if (mods.length && rng.next() < 0.5) await g.useModifier(...Object.values(rng.pick(mods)));
        else await g.resolveRoll();
      } else if (g.canRoll() && (g.echoQueue.length || rng.next() < 0.97)) {
        await g.roll();
      } else if (!g.canRoll() || rng.next() < 0.3) {
        // build window actions
        for (let k = 0; k < 6; k++) {
          const acts = [];
          for (const b of ['city', 'settlement', 'road', 'dev']) if (g.canBuild(b)) acts.push(() => g.build(b));
          if (g.cards.length) acts.push(() => g.playCard(rng.pick(g.cards).uid));
          if (g.canShip()) {
            const p = rng.pick(g.ownedPorts());
            const r = p.type === 'generic' ? rng.pick(RES) : p.type;
            acts.push(() => g.ship(p.id, r, rng.next() < 0.8 ? 'batch' : 'overflow'));
            if (p.up.free) acts.push(() => g.shipMixed(p.id));
          }
          const rich = RES.filter((r) => g.hand[r] >= g.tradeRate(r) + 2);
          if (rich.length && rng.next() < 0.3) acts.push(() => g.trade(rng.pick(rich), rng.pick(RES)));
          if (!acts.length) break;
          await rng.pick(acts)();
          check(g, 'build');
        }
        g.endRound();
      } else {
        g.endRound();
      }
    } else if (g.phase === 'tribute') {
      const a = g.autoAssign();
      if (a) { if (!g.payTribute(a)) throw new Error('autoAssign produced unpayable assignment'); }
      else g.failTribute();
    } else if (g.phase === 'shop') {
      g._fed = false;
      if (mode === 'coverage') g.devBudget(25);
      for (let k = 0; k < 6; k++) {
        const r = rng.next();
        if (r < 0.1) g.rerollShop();
        else if (r < 0.15) g.rerollBoss();
        else {
          const i = rng.int(g.shop.length);
          const s = g.shop[i];
          if (s.sold) continue;
          await g.buy(i);
          if (s.sold) stats.bought[s.kind === 'pack' ? 'pack' : s.item.id] = (stats.bought[s.kind === 'pack' ? 'pack' : s.item.id] || 0) + 1;
        }
        check(g, 'shop');
      }
      g.leaveShop();
    }
    check(g, g.phase);
  }
  return g;
}

const stats = { bought: {}, rounds: [], broke: 0 };
const t0 = Date.now();
for (let s = 1; s <= runs; s++) {
  try {
    const g = await playRun(s, stats);
    stats.rounds.push(g.roundsSurvived);
  } catch (e) {
    console.error(`Seed ${s} crashed:`, e);
    process.exit(1);
  }
}
const avg = stats.rounds.reduce((a, b) => a + b, 0) / stats.rounds.length;
const hist = {};
for (const r of stats.rounds) hist[r] = (hist[r] || 0) + 1;
console.log(`[${mode}] ${runs} runs OK in ${Date.now() - t0} ms. Rounds survived (random bot): avg ${avg.toFixed(1)}, max ${Math.max(...stats.rounds)}`);
console.log('Distribution:', JSON.stringify(hist));
const never = ITEM_LIST.filter((i) => !stats.bought[i.id]).map((i) => i.id);
console.log('Items never bought by the bot:', never.join(', ') || 'none');
