// The island view: isometric printed tiles, 3D-rendered pieces, number tokens drawn in perspective,
// lying flat on an abstract halftone tabletop, and a pannable camera.
// It only draws. All game rules stay in game.js; the UI passes in what to highlight.
import { TERRAIN_RES, pips } from './board.js';
import { portPlate } from './figures.js?v=38';
import { PORT_ATLAS, PORT_SCALE, PORT_SHEET } from './ports-atlas.js?v=11';

const SQ3 = Math.sqrt(3);
const U = 96; // hex radius in world pixels
const K = 0.766; // vertical squash of the fixed tilted camera
const CX = 520, CY = 385; // world position of the board centre
const S = 250; // size of a tile sprite box
// A steady pseudo-random tilt for printed things (same input, same tilt), in degrees within ±amp.
const tilt = (n, amp) => { const r = Math.sin(n * 127.1 + 311.7) * 43758.5453; return f1((r - Math.floor(r) - 0.5) * 2 * amp); };
const WORLD_W = 1140, WORLD_H = 900;
const TERR = { forest: 0, pasture: 1, fields: 2, hills: 3, mountains: 4, desert: 5 };
const ROAD_CELL = { v: 10, up: 11, down: 12 }; // vertical, "/" and "\" roads
const RES_NAME = { brick: 'Brick', lumber: 'Lumber', wool: 'Wool', grain: 'Grain', ore: 'Ore' };
const RES_ART = { brick: 13, lumber: 14, wool: 15, grain: 16, ore: 17 };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = (n) => n.toFixed(1);

const HEX_FX = {
  fertile: { stroke: '#9cc78a', w: 3, fill: 'rgba(156,199,138,.10)', chip: '+1' },
  palisade: { stroke: '#cfd6de', w: 4, fill: 'rgba(207,214,222,.08)', inner: 'rgba(255,255,255,.35)' },
  gold: { stroke: '#e2bd62', w: 4, fill: 'rgba(226,189,98,.22)', glow: '#e2bd62' },
  river: { stroke: '#5fb7ff', w: 3.5, fill: 'rgba(95,183,255,.16)' },
  guildDistrict: { stroke: '#dfe2e6', w: 4.5, fill: 'rgba(0,0,0,.14)', inner: '#0d0e10', chip: '3' },
  volcanic: { stroke: '#ff7a2a', w: 4, fill: 'rgba(20,8,6,.34)', glow: '#ff6a1a', chip: '×2' },
  sister: { stroke: '#b384ff', w: 3.5, fill: 'rgba(179,132,255,.12)', chip: '↔' },
  haven: { stroke: '#cfe0ff', w: 3, fill: 'rgba(10,10,14,.3)', inner: 'rgba(179,132,255,.5)', chip: '×2' },
  capital: { stroke: '#e2bd62', w: 4.5, fill: 'rgba(226,189,98,.14)', glow: '#e2bd62', inner: '#0d0e10', chip: '4' },
};
const TOKEN_FX = {
  jackpot: { cls: 'gold', chip: '×3' },
  twinToken: { cls: 'silver', chip: '2×' },
  sevenToken: { cls: 'violet', chip: '+7' },
  heartland: { cls: 'gold glow', chip: '±1' },
  evergreen: { cls: 'green', chip: '+1' },
  doubleToken: { cls: 'silver', chip: '+' },
};
const cellPos = (i) => `${((i % 4) * 100) / 3}% ${(Math.floor(i / 4) * 100) / 3}%`;
const hexPoints = (k) => [0, 1, 2, 3, 4, 5].map((i) => { const a = (Math.PI / 180) * (60 * i - 30); return `${f1(k * U * Math.cos(a))},${f1(k * U * K * Math.sin(a))}`; }).join(' ');


export class BoardView {
  constructor(el) {
    this.el = el;
    this.el.innerHTML = `<div class="world"><div class="table" aria-hidden="true"></div><div class="tiles"></div><div class="layer"></div></div>`;
    this.world = el.querySelector('.world');
    this.tilesEl = el.querySelector('.tiles');
    this.layer = el.querySelector('.layer');
    this.pan = { x: 0, y: 0 };
    this.insets = { top: 70, right: 16, bottom: 190, left: 16 };
    this.tileKey = '';
    this.moved = false;
    this.bindPan();
    if (window.ResizeObserver) new ResizeObserver(() => this.fit()).observe(el);
    this.fit();
  }

  // ------------------------------------------------------------ camera
  fit() {
    const r = this.el.getBoundingClientRect();
    if (!r.width) return;
    const hand = document.getElementById('hand');
    const { top, left } = this.insets;
    const col = document.querySelector('.rcol');
    const right = this.insets.right + (col && getComputedStyle(col).position === 'absolute' ? col.offsetWidth + 24 : 0); // the right column floats over the right edge
    const bottom = Math.max(this.insets.bottom, hand ? hand.offsetHeight + 14 : 0);
    const aw = Math.max(200, r.width - left - right), ah = Math.max(200, r.height - top - bottom);
    this.scale = Math.min(aw / 1075, ah / 730);
    this.cx = left + aw / 2;
    this.cy = top + ah / 2 + 8;
    this.applyCamera();
  }

  applyCamera() {
    const s = this.scale || 1;
    const lim = (v, m) => Math.max(-m, Math.min(m, v));
    this.pan.x = lim(this.pan.x, 360 * s);
    this.pan.y = lim(this.pan.y, 260 * s);
    const tx = this.cx - CX * s + this.pan.x;
    const ty = this.cy - (CY + 8) * s + this.pan.y;
    this.world.style.transform = `translate(${f1(tx)}px, ${f1(ty)}px) scale(${s.toFixed(4)})`;
  }

  bindPan() {
    let st = null;
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      st = { x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y };
      this.moved = false;
    });
    window.addEventListener('pointermove', (e) => {
      if (!st) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!this.moved && Math.hypot(dx, dy) < 5) return;
      this.moved = true;
      this.el.classList.add('panning');
      this.pan.x = st.px + dx;
      this.pan.y = st.py + dy;
      this.applyCamera();
    });
    const end = () => { st = null; this.el.classList.remove('panning'); };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    // a drag must not count as a click on whatever was underneath
    this.el.addEventListener('click', (e) => { if (this.moved) { e.stopPropagation(); e.preventDefault(); this.moved = false; } }, true);
  }

  // ------------------------------------------------------------ coordinates
  hx(h) { return CX + U * h.x; }
  hy(h) { return CY + U * K * h.y; }
  vx(v) { return CX + U * v.x; }
  vy(v) { return CY + U * K * v.y; }
  rowOf(h) { return Math.round(h.y / 1.5); }
  zRow(h) { return 100 + (this.rowOf(h) + 3) * 10; }
  zAt(y) { return 100 + (Math.ceil((y - CY) / (U * 1.5 * K)) + 3) * 10 + 5; }

  // ------------------------------------------------------------ tiles (only rebuilt when terrain changes)
  renderTiles(B, dimSet) {
    const key = B.hexes.map((h) => h.terrain).join(',') + '|' + (dimSet ? [...dimSet].join(',') : '');
    if (key === this.tileKey) return;
    this.tileKey = key;
    this.tilesEl.innerHTML = B.hexes.map((h) => {
      const dim = dimSet && !dimSet.has(h.id) ? ' dim' : '';
      return `<div class="tile${dim}" data-hex="${h.id}" style="left:${f1(this.hx(h) - S / 2)}px;top:${f1(this.hy(h) - S / 2)}px;z-index:${this.zRow(h)}"><i style="background-position:${cellPos(TERR[h.terrain])}"></i></div>`;
    }).join('');
  }

  // ------------------------------------------------------------ everything that changes while playing
  // opts: { req, paid:Set, rolled, volcano, badge:{hex,token}, labels }
  render(g, opts) {
    const B = g.board;
    const { req, paid, rolled } = opts;
    const isT = (k, id) => req && req.kind === k && req.ids.has(id);
    const resultMode = paid && paid.size > 0;
    this.renderTiles(B, resultMode ? paid : req && req.kind === 'hex' ? req.ids : null);
    const out = [];

    // hex hit areas (clickable only while the game asks for a hex)
    for (const h of B.hexes) {
      const t = isT('hex', h.id);
      out.push(`<div class="hexhit${t ? ' target' : ''}" ${t ? `data-k="hex" data-id="${h.id}"` : ''} style="left:${f1(this.hx(h) - SQ3 * U / 2)}px;top:${f1(this.hy(h) - U * K)}px;z-index:${this.zRow(h) + 1}"><title>${esc(this.hexTitle(B, h))}</title></div>`);
    }
    // outlines on the hexes that paid out, or that can be picked
    for (const h of B.hexes) {
      const lit = (resultMode && paid.has(h.id)) || isT('hex', h.id);
      if (!lit) continue;
      out.push(`<svg class="lit${isT('hex', h.id) ? ' tgt' : ''}" aria-hidden="true" width="220" height="180" viewBox="-110 -90 220 180" style="left:${f1(this.hx(h) - 110)}px;top:${f1(this.hy(h) - 90)}px;z-index:700"><polygon points="${hexPoints(0.93)}"/></svg>`);
    }
    // while picking a hex for an upgrade: hexes that already carry one say that it will be replaced
    if (opts.replace && req && req.kind === 'hex') {
      for (const h of B.hexes) {
        const nm = opts.replace.get(h.id);
        if (!nm || !isT('hex', h.id)) continue;
        out.push(`<div class="hexlabel rep" style="left:${f1(this.hx(h) - 90)}px;top:${f1(this.hy(h) + 22)}px;width:180px;z-index:720"><span>Replaces ${esc(nm)}</span></div>`);
      }
    }
    // ports
    for (const p of B.ports) this.port(out, B, p, isT('port', p.id));
    // roads
    for (const e of B.edges) {
      const a = B.vertices[e.v[0]], b = B.vertices[e.v[1]];
      const x1 = this.vx(a), y1 = this.vy(a), x2 = this.vx(b), y2 = this.vy(b);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      if (g.roads.has(e.id)) {
        const dx = x2 - x1, dy = y2 - y1;
        const cell = Math.abs(dx) < 1 ? ROAD_CELL.v : dx * dy > 0 ? ROAD_CELL.down : ROAD_CELL.up;
        out.push(`<div class="sprite road" style="left:${f1(mx - 156)}px;top:${f1(my - 156)}px;z-index:${this.zAt(my) - 2};background-position:${cellPos(cell)}"></div>`);
      } else if (isT('edge', e.id)) {
        const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        const len = Math.hypot(x2 - x1, y2 - y1) * 0.62;
        out.push(`<button class="spot edge" data-k="edge" data-id="${e.id}" aria-label="Build a road here" style="left:${f1(mx - len / 2)}px;top:${f1(my - 11)}px;width:${f1(len)}px;transform:rotate(${f1(ang)}deg);z-index:740"><i></i></button>`);
      }
    }
    // the roads that make up the longest road (hover the stat card to see them), numbered in order
    if (opts.hlEdges && opts.hlEdges.length) {
      opts.hlEdges.forEach((id, n) => {
        const e = B.edges[id];
        const va = B.vertices[e.v[0]], vb = B.vertices[e.v[1]];
        const x1 = this.vx(va), y1 = this.vy(va), x2 = this.vx(vb), y2 = this.vy(vb);
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const len = Math.hypot(x2 - x1, y2 - y1) * 0.92;
        const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        out.push(`<div class="roadhl" style="left:${f1(mx - len / 2)}px;top:${f1(my - 3.5)}px;width:${f1(len)}px;transform:rotate(${f1(ang)}deg);z-index:735"></div><span class="roadn" style="left:${f1(mx - 11)}px;top:${f1(my - 11)}px;z-index:736">${n + 1}</span>`);
      });
    }
    // buildings and open spots
    for (const v of B.vertices) {
      const b = g.buildings[v.id];
      const x = this.vx(v), y = this.vy(v);
      if (b) out.push(`<div class="sprite bld ${b}" style="left:${f1(x - 187.5)}px;top:${f1(y - 187.5)}px;z-index:${this.zAt(y)};background-position:${cellPos(b === 'city' ? 8 : 7)}"></div>`);
      if (isT('vertex', v.id)) out.push(`<button class="spot vtx" data-k="vertex" data-id="${v.id}" aria-label="${b ? 'Upgrade to a city here' : 'Build a settlement here'}" style="left:${f1(x - 22)}px;top:${f1(y - 22)}px;z-index:740"><i></i></button>`);
    }
    // the robber
    const rh = B.hexes[g.robber];
    const rx = this.hx(rh) + 27, ry = this.hy(rh) + 7;
    out.push(`<div class="sprite robber" style="left:${f1(rx - 187.5)}px;top:${f1(ry - 187.5)}px;z-index:${this.zAt(ry)};background-position:${cellPos(9)}"></div>`);
    // number tokens
    for (const h of B.hexes) {
      if (!h.token) continue;
      const hot = h.token === 6 || h.token === 8;
      const hit = resultMode ? paid.has(h.id) : false;
      const match = rolled != null && h.token === rolled;
      const dim = resultMode && !hit && !match;
      const n = pips(h.token);
      const dots = h.hidden ? '' : `<b class="pips">${'<i></i>'.repeat(n)}</b>`;
      out.push(`<div class="tok${hot && !h.hidden ? ' hot' : ''}${hit || match ? ' lit' : ''}${dim ? ' dim' : ''}" style="left:${f1(this.hx(h) - 20)}px;top:${f1(this.hy(h) - 20 * K)}px;height:${f1(40 * K)}px;z-index:${this.zRow(h) + 7}"><div class="in" style="transform:scaleY(${K}) rotate(${tilt(h.id + 3, 1.8)}deg)"><span class="n">${h.hidden ? '?' : h.token}</span>${dots}</div></div>`);
    }
    // field upgrades: a finish and rim on the hex, a ring and a chip on the token (same palette as the upgrade figures)
    for (const h of B.hexes) {
      const fx = h.hexEffect && HEX_FX[h.hexEffect.id];
      const tip = opts.tip ? opts.tip(h) : '';
      const x = this.hx(h), y = this.hy(h), z = this.zRow(h);
      if (fx) {
        const glow = fx.glow ? `filter:drop-shadow(0 0 7px ${fx.glow});` : '';
        out.push(`<svg class="rim" aria-hidden="true" width="220" height="180" viewBox="-110 -90 220 180" style="left:${f1(x - 110)}px;top:${f1(y - 87)}px;z-index:${z + 2};${glow}"><polygon points="${hexPoints(0.985)}" fill="${fx.fill}" stroke="${fx.stroke}" stroke-width="${fx.w}" stroke-linejoin="round"/>${fx.inner ? `<polygon points="${hexPoints(0.9)}" fill="none" stroke="${fx.inner}" stroke-width="2"/>` : ''}</svg>`);
        if (h.hexEffect.id === 'sister' && h.id < h.hexEffect.link) {
          const o = B.hexes[h.hexEffect.link];
          const x2 = this.hx(o), y2 = this.hy(o), len = Math.hypot(x2 - x, y2 - y), ang = (Math.atan2(y2 - y, x2 - x) * 180) / Math.PI;
          out.push(`<i class="trail" style="left:${f1(x)}px;top:${f1(y)}px;width:${f1(len)}px;transform:rotate(${f1(ang)}deg);z-index:${z + 3}"></i>`);
        }
        if (fx.chip) out.push(`<div class="fxchip${fx.chip.length >= 3 ? ' l3' : ''}" style="left:${f1(x + 44)}px;top:${f1(y + 8)}px;z-index:${z + 9}">${fx.chip}</div>`);
      }
      if (h.tokenEffect) {
        const te = TOKEN_FX[h.tokenEffect.id];
        const label = h.tokenEffect.id === 'doubleToken' ? `+${h.tokenEffect.number}` : te.chip;
        out.push(`<div class="tokring ${te.cls}" style="left:${f1(x - 23)}px;top:${f1(y - 23 * K)}px;height:${f1(46 * K)}px;z-index:${z + 6}"></div><div class="fxchip sm${label.length >= 3 ? ' l3' : ''}" style="left:${f1(x + 14)}px;top:${f1(y - 25)}px;z-index:${z + 10}">${label}</div>`);
      }
      if (opts.volcano === h.id) out.push(`<div class="fxchip wide" style="left:${f1(x - 30)}px;top:${f1(y + 26)}px;z-index:${z + 10}">Volcano</div>`);
      if (tip || h.hexEffect || h.tokenEffect) out.push(`<div class="hexhit info" ${tip} style="left:${f1(x - 40)}px;top:${f1(y - 30)}px;width:80px;height:60px;clip-path:none;z-index:${z + 11}"></div>`);
    }
    // what a paying hex gave
    if (resultMode) {
      let k = 0;
      for (const h of B.hexes) {
        if (!paid.has(h.id)) continue;
        const res = TERRAIN_RES[h.terrain];
        if (!res) continue;
        out.push(`<div class="pop" style="left:${f1(this.hx(h))}px;top:${f1(this.hy(h) - 66)}px;z-index:720;animation-delay:${k++ * 90}ms"><i style="background:var(--${res})"></i>${RES_NAME[res]}</div>`);
      }
    }
    this.layer.innerHTML = out.join('');
  }

  hexTitle(B, h) {
    const res = TERRAIN_RES[h.terrain];
    return `${h.terrain}${res ? ' → ' + res : ''}`;
  }

  // A port is a printed piece: the hex edge it sits on becomes an organic shore with the port's scene on it.
  // The pieces are 3D renders turned into the same halftone print as the tiles (one sprite per type and coast direction).
  port(out, B, p, target) {
    const [va, vb] = p.vertices.map((v) => B.vertices[v]);
    const mx = (va.x + vb.x) / 2, my = (va.y + vb.y) / 2;
    const owner = B.hexes.find((h) => h.vertices.includes(p.vertices[0]) && h.vertices.includes(p.vertices[1]));
    let nx = mx - (owner ? owner.x : 0), ny = my - (owner ? owner.y : 0);
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    const k = (((Math.round((Math.atan2(ny, nx) * 180) / Math.PI / 60) % 6) + 6) % 6);
    const at = PORT_ATLAS[`${p.type}:${k}`];
    const Mx = CX + U * mx, My = CY + U * K * my;
    const z = this.zAt(My) - 6;
    const generic = p.type === 'generic';
    const num = (t) => `<u class="pc${t.length >= 3 ? ' l3' : ''}">${t}</u>`;
    const up = [p.up.overflow ? 'overflow' : '', p.up.bigger ? num(`+${p.up.bigger}`) : '', p.up.smaller ? num(`−${p.up.smaller}`) : '', p.up.free ? 'free' : ''].filter(Boolean).join('');
    const title = generic ? 'Generic port: trade 3:1' : `${p.type} port: trade 2:1`;
    const tx = Mx + nx * 0.62 * U, ty = My + ny * 0.62 * U * K; // the port card sits out in the sea, piers run back to the two intersections
    const c = PORT_SCALE;
    const [sx, sy, w, h] = at.s;
    const left = Mx + at.o[0] * c, top = My + at.o[1] * c;
    out.push(`<div class="pport${target ? ' target' : ''}" style="left:${f1(left)}px;top:${f1(top)}px;width:${f1(w * c)}px;height:${f1(h * c)}px;background-size:${f1(PORT_SHEET[0] * c)}px ${f1(PORT_SHEET[1] * c)}px;background-position:${f1(-sx * c)}px ${f1(-sy * c)}px;z-index:${z}"></div>`);
    const kind = generic ? 'any' : p.type;
    const pw = 100, ph = (86 * pw) / 140, cy = (42 * pw) / 140; // the card stack's centre sits on the port point; the rate is laid over it
    // the port's cards, as in the shop; clickable while a port is being picked
    out.push(`<div class="portcard ${kind}${target ? ' target' : ''}" ${target ? `data-k="port" data-id="${p.id}"` : ''} title="${esc(title)}" style="left:${f1(tx - pw / 2)}px;top:${f1(ty - cy)}px;width:${pw}px;height:${f1(ph)}px;z-index:${z + 10}"><div>${portPlate(generic ? 'generic' : p.type, pw)}</div></div>`);
    if (up) out.push(`<em class="pup" style="left:${f1(tx)}px;top:${f1(ty - cy - 20)}px;z-index:${z + 11}">${up}</em>`);
    // piers: a short wooden dock from the card to each of the two intersections the port serves, ringed in the resource colour
    {
      const x1 = this.vx(va), y1 = this.vy(va), x2 = this.vx(vb), y2 = this.vy(vb);
      const line = (ax, ay, bx, by) => {
        const len = Math.hypot(bx - ax, by - ay), ang = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
        return `<div class="dock ${kind}" style="left:${f1((ax + bx) / 2 - len / 2)}px;top:${f1((ay + by) / 2 - 2)}px;width:${f1(len)}px;transform:rotate(${f1(ang)}deg);z-index:${z + 2}"></div>`;
      };
      const ring = (x, y) => `<i class="pierend ${kind}" style="left:${f1(x - 9)}px;top:${f1(y - 9)}px;width:18px;height:18px;z-index:${z + 3}"></i>`;
      out.push(line(tx, ty, x1, y1) + line(tx, ty, x2, y2) + ring(x1, y1) + ring(x2, y2));
    }
    const pts = at.p.map(([x, y]) => `${f1(x * c)},${f1(y * c)}`).join(' ');
    out.push(`<svg class="phit${target ? ' target' : ''}" ${target ? `data-k="port" data-id="${p.id}"` : ''} style="left:${f1(left)}px;top:${f1(top)}px;z-index:${z + 8}" width="${f1(w * c)}" height="${f1(h * c)}" viewBox="0 0 ${f1(w * c)} ${f1(h * c)}"><polygon points="${pts}"><title>${esc(title)}</title></polygon></svg>`);
  }
}
