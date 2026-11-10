// Board geometry and random board generation (base-game layout, 19 hexes, 9 ports).
export const RES = ['brick', 'lumber', 'wool', 'grain', 'ore'];
export const TERRAINS = ['hills', 'forest', 'pasture', 'fields', 'mountains'];
export const TERRAIN_RES = { hills: 'brick', forest: 'lumber', pasture: 'wool', fields: 'grain', mountains: 'ore', desert: null };
export const RES_TERRAIN = { brick: 'hills', lumber: 'forest', wool: 'pasture', grain: 'fields', ore: 'mountains' };

const SQ3 = Math.sqrt(3);
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// Dots on a number token (probability out of 36). A token of 7 counts as 6.
export function pips(n) {
  if (!n) return 0;
  return 6 - Math.abs(7 - n);
}

export function buildGeometry() {
  const hexes = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(q + r) > 2) continue;
      hexes.push({ id: hexes.length, q, r, x: SQ3 * (q + r / 2), y: 1.5 * r });
    }
  }
  const vmap = new Map();
  const vertices = [];
  const emap = new Map();
  const edges = [];
  const vkey = (x, y) => `${Math.round(x * 1000)}:${Math.round(y * 1000)}`;

  for (const h of hexes) {
    h.vertices = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      const x = h.x + Math.cos(a);
      const y = h.y + Math.sin(a);
      const k = vkey(x, y);
      let v = vmap.get(k);
      if (!v) {
        v = { id: vertices.length, x, y, hexes: [], edges: [], neighbors: [], port: null };
        vmap.set(k, v);
        vertices.push(v);
      }
      v.hexes.push(h.id);
      h.vertices.push(v.id);
    }
    h.edges = [];
    for (let i = 0; i < 6; i++) {
      const a = h.vertices[i];
      const b = h.vertices[(i + 1) % 6];
      const k = a < b ? `${a}-${b}` : `${b}-${a}`;
      let e = emap.get(k);
      if (!e) {
        e = { id: edges.length, v: [Math.min(a, b), Math.max(a, b)], hexes: [] };
        emap.set(k, e);
        edges.push(e);
        vertices[a].edges.push(e.id);
        vertices[b].edges.push(e.id);
        vertices[a].neighbors.push(b);
        vertices[b].neighbors.push(a);
      }
      e.hexes.push(h.id);
      h.edges.push(e.id);
    }
  }
  for (const h of hexes) {
    h.neighbors = hexes
      .filter((o) => o !== h && DIRS.some(([dq, dr]) => o.q === h.q + dq && o.r === h.r + dr))
      .map((o) => o.id);
  }
  return { hexes, vertices, edges };
}

export function generateBoard(rng) {
  const g = buildGeometry();
  const terr = [
    ...Array(4).fill('forest'), ...Array(4).fill('pasture'), ...Array(4).fill('fields'),
    ...Array(3).fill('hills'), ...Array(3).fill('mountains'), 'desert',
  ];
  const toks = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
  for (let tries = 0; ; tries++) {
    rng.shuffle(terr);
    rng.shuffle(toks);
    let ti = 0;
    for (const h of g.hexes) {
      h.terrain = terr[h.id];
      h.token = h.terrain === 'desert' ? null : toks[ti++];
    }
    const hot = (n) => n === 6 || n === 8;
    const ok = !g.hexes.some((h) => hot(h.token) && h.neighbors.some((n) => hot(g.hexes[n].token)));
    if (ok || tries > 500) break;
  }
  for (const h of g.hexes) {
    h.tokenEffect = null;
    h.hexEffect = null;
  }

  // Ports: 9 of the 30 coastal edges, spaced 3-3-4 around the coast.
  const coastal = g.edges.filter((e) => e.hexes.length === 1);
  const mid = (e) => {
    const a = g.vertices[e.v[0]];
    const b = g.vertices[e.v[1]];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };
  coastal.sort((a, b) => Math.atan2(mid(a).y, mid(a).x) - Math.atan2(mid(b).y, mid(b).x));
  const gaps = [3, 3, 4, 3, 3, 4, 3, 3, 4];
  const types = rng.shuffle(['generic', 'generic', 'generic', 'generic', ...RES]);
  const offset = rng.int(30);
  g.ports = [];
  let idx = offset;
  for (let i = 0; i < 9; i++) {
    const e = coastal[idx % 30];
    const m = mid(e);
    const len = Math.hypot(m.x, m.y);
    const port = {
      id: i,
      edge: e.id,
      vertices: [...e.v],
      type: types[i],
      up: { overflow: false, bigger: 0, smaller: 0, free: false },
      x: m.x + (m.x / len) * 0.55,
      y: m.y + (m.y / len) * 0.55,
    };
    g.ports.push(port);
    for (const v of e.v) g.vertices[v].port = i;
    idx += gaps[i];
  }
  return g;
}
