// Effect figures: one small picture per upgrade, drawn as a change to the thing it upgrades
// (a face, a die, a token, a hex or a port). The same figure is used in the shop and on the board.
// Ported from the design canvas: figure(id) returns the HTML for a 240 × 210 stage.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const INK = '#17181b', GOLD = '#e2bd62', GOLD2 = '#a67f22', CARD = '#8c8168';
const G = {
  clover: (f) => '<g fill="' + f + '"><circle cx="50" cy="31" r="17"/><circle cx="69" cy="50" r="17"/><circle cx="50" cy="69" r="17"/><circle cx="31" cy="50" r="17"/></g><path d="M50 52 Q56 78 70 92" stroke="' + f + '" stroke-width="7" fill="none" stroke-linecap="round"/>',
  knight: (f) => '<path d="M50 2 L62 14 L62 61 L38 61 L38 14 Z" fill="' + f + '"/><rect x="18" y="61" width="64" height="9" rx="3" fill="' + f + '"/><rect x="45" y="69" width="10" height="19" fill="' + f + '"/><circle cx="50" cy="92" r="5.5" fill="' + f + '"/>',
  robber: (f) => '<circle cx="50" cy="27" r="15" fill="' + f + '"/><path d="M24 90 Q26 52 50 44 Q74 52 76 90 Z" fill="' + f + '"/>',
  eye: (f) => '<path d="M8 50 Q50 12 92 50 Q50 88 8 50 Z" fill="none" stroke="' + f + '" stroke-width="8" stroke-linejoin="round"/><circle cx="50" cy="50" r="13" fill="' + f + '"/><path d="M18 86 L82 14" stroke="' + f + '" stroke-width="9" stroke-linecap="round"/>',
  sprout: (f) => '<path d="M50 90 L50 46" stroke="' + f + '" stroke-width="7" stroke-linecap="round"/><path d="M50 56 Q20 54 16 26 Q46 24 50 56 Z" fill="' + f + '"/><path d="M50 46 Q80 44 84 14 Q54 12 50 46 Z" fill="' + f + '"/>',
  crown: (f) => '<path d="M14 76 L10 30 L33 52 L50 20 L67 52 L90 30 L86 76 Z" fill="' + f + '"/><rect x="14" y="80" width="72" height="9" fill="' + f + '"/>',
  sigil: (f) => '<path d="M50 14 L88 78 L12 78 Z" fill="none" stroke="' + f + '" stroke-width="7" stroke-linejoin="round"/><circle cx="50" cy="56" r="13" fill="none" stroke="' + f + '" stroke-width="6"/><path d="M50 78 L50 94 M38 88 L62 88" stroke="' + f + '" stroke-width="6" stroke-linecap="round"/>',
  coin: (f, r) => '<circle cx="50" cy="50" r="40" fill="' + f + '" stroke="' + (r || GOLD2) + '" stroke-width="6"/><circle cx="50" cy="50" r="24" fill="none" stroke="' + (r || GOLD2) + '" stroke-width="5"/>',
  sparkle: (f) => '<path d="M50 4 Q54 46 96 50 Q54 54 50 96 Q46 54 4 50 Q46 46 50 4 Z" fill="' + f + '"/>',
  arrow: (f, d) => d === 'up' ? '<path d="M50 14 L82 52 L60 52 L60 88 L40 88 L40 52 L18 52 Z" fill="' + f + '"/>' : '<path d="M50 86 L82 48 L60 48 L60 12 L40 12 L40 48 L18 48 Z" fill="' + f + '"/>',
  crate: (t, l, r) => '<polygon points="50,6 92,28 50,50 8,28" fill="' + t + '"/><polygon points="8,28 50,50 50,96 8,74" fill="' + l + '"/><polygon points="92,28 50,50 50,96 92,74" fill="' + r + '"/><path d="M8 28 L50 50 L92 28 M50 50 L50 96" stroke="rgba(23,24,27,0.5)" stroke-width="3" fill="none"/>',
  leaf: (f) => '<path d="M10 90 Q6 30 60 8 Q90 40 40 86 Z" fill="' + f + '"/>'
};

// The face of a die that carries a trigger: every pip is replaced by the trigger's symbol (a sword for
// the Knight's faces, a robber for the Robber's faces, a clover for Lucky Number, an eye for Hidden), so the
// number of symbols is still the face's value. Rare triggers get a gold frame. Returns a 100 × 100 svg body.
export const TRIG_GLYPH = { lucky: 'clover', knightFav: 'knight', knightLucky: 'knight', robberFav: 'robber', robberLucky: 'robber', hidden: 'eye' };
const TRIG_PRIO = ['knightLucky', 'knightFav', 'robberLucky', 'robberFav', 'hidden', 'lucky'];
const PIPS_AT = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]] };
export function primaryTrigger(triggers) { return TRIG_PRIO.find((t) => triggers.includes(t)) || null; }
export function faceBody(value, triggers) {
  const t = primaryTrigger(triggers);
  if (!t) return null;
  const rare = triggers.includes('knightLucky') || triggers.includes('robberLucky');
  const ink = rare ? GOLD2 : INK;
  const gl = G[TRIG_GLYPH[t]];
  const size = value === 1 ? 46 : 27;
  const marks = PIPS_AT[value].map((q) => '<g transform="translate(' + (q[0] - size / 2) + ' ' + (q[1] - size / 2) + ') scale(' + size / 100 + ')">' + gl(ink) + '</g>').join('');
  const frame = '<rect x="5" y="5" width="90" height="90" fill="none" stroke="' + (rare ? GOLD : CARD) + '" stroke-width="' + (rare ? 4 : 2) + '"/>';
  return frame + marks;
}

function build(id) {
    const INK = '#17181b', BONE = '#e3dcc8', CREAM = '#efeadc', GOLD = '#e2bd62', GOLD2 = '#a67f22', SILV = '#a9c4dc', CARD = '#8c8168';
    const FONT = "'Grenze Gotisch', Georgia, serif";
    const enc = (vw, vh, body) => "url('data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + vw + ' ' + vh + '">' + body + '</svg>').replace(/'/g, '%27') + "')";
    const px = (n) => (Math.round(n * 10) / 10) + 'px';
    const abs = (x, y, w, h, extra) => 'position:absolute;left:' + px(x) + ';top:' + px(y) + ';width:' + px(w) + ';height:' + px(h) + ';' + (extra || '');
    // svg layer
    const sv = (x, y, w, h, vw, vh, body, extra) => ({ style: abs(x, y, w, h, 'background:' + enc(vw, vh, body) + ' center/100% 100% no-repeat;pointer-events:none;' + (extra || '')), txt: '', kids: [] });
    const txt = (x, y, w, h, t, size, color, extra) => ({ style: abs(x, y, w, h, 'display:flex;align-items:center;justify-content:center;text-align:center;font-family:' + FONT + ';font-weight:800;font-size:' + size + 'px;line-height:1;color:' + color + ';' + (extra || '')), txt: t, kids: [] });
    const chip = (x, y, w, h, t, size, bg, fg, border, extra) => txt(x, y, w, h, t, w === h ? size * (String(t).length >= 4 ? 0.62 : String(t).length === 3 ? 0.78 : 1) : size, fg, 'background:' + bg + ';border-radius:' + (w === h ? '50%' : '9px') + ';box-sizing:border-box;border:2px solid ' + (border || BONE) + ';' + (extra || ''));
    const layers = [], dice = [];
    let rarity = 'common';
    const R = (...a) => layers.push(...a);

    // ---------- glyph bodies (100x100) ----------

    // ---------- rarity halo (same dotted foil as the pieces) ----------
    const halo = (kind) => {
      const grad = kind === 'legendary' ? 'linear-gradient(115deg,#ff6a45,#f3c64a,#74e0a6,#5fb7ff,#b384ff,#ff6a45)' : 'linear-gradient(115deg,rgba(190,215,240,0.15) 20%,rgba(190,215,240,0.85) 46%,#fff 50%,rgba(190,215,240,0.85) 54%,rgba(190,215,240,0.15) 80%)';
      const m = 'radial-gradient(circle,#000 1.3px,transparent 1.8px),radial-gradient(circle,#000 30%,transparent 70%)';
      return { style: abs(24, 6, 192, 192, 'border-radius:50%;pointer-events:none;opacity:' + (kind === 'legendary' ? 0.55 : 0.45) + ';background-image:' + grad + ';background-size:260% 260%;-webkit-mask-image:' + m + ';mask-image:' + m + ';-webkit-mask-size:5px 5px,100% 100%;mask-size:5px 5px,100% 100%;-webkit-mask-composite:source-in;mask-composite:intersect;z-index:0'), txt: '', kids: [] };
    };

    // ---------- cardboard hex (halftone printed) ----------
    const HEXP = '50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%';
    const C = [[64, 0], [128, 37], [128, 111], [64, 148], [0, 111], [0, 37]];
    const poly = (pts) => 'polygon(' + pts.map((p) => px(p[0]) + ' ' + px(p[1])).join(',') + ')';
    const printKid = (terr, extra, clip) => ({ style: abs(6, 7, 128, 148, 'clip-path:' + (clip || 'polygon(' + HEXP + ')') + ';background-image:url(assets/hexprint.webp);background-size:592px 296px;background-position:' + (-10 - (terr % 4) * 148) + 'px ' + (-Math.floor(terr / 4) * 148) + 'px;background-color:#2a2b31;' + (extra || '')), txt: '', kids: [] });
    const ovKid = (body, clip) => ({ style: abs(6, 7, 128, 148, 'clip-path:' + (clip || 'polygon(' + HEXP + ')') + ';background:' + enc(128, 148, body) + ' center/100% 100% no-repeat;pointer-events:none'), txt: '', kids: [] });
    const hex = (terr, o) => {
      o = o || {};
      const x = o.x === undefined ? 50 : o.x, y = o.y === undefined ? 22 : o.y, zoom = o.zoom || 1;
      const kids = [
        { style: abs(0, 0, 140, 162, 'background:' + BONE + ';clip-path:polygon(' + HEXP + ')'), txt: '', kids: [] },
        printKid(terr, o.printExtra)
      ].concat(o.kids || []);
      const lay = { style: abs(x, y, 140, 162, 'transform:scale(' + zoom + ');transform-origin:0 0;z-index:' + (o.z || 2) + ';filter:drop-shadow(0 2px 0 #8c8168) drop-shadow(0 12px 10px rgba(0,0,0,0.6));opacity:' + (o.op === undefined ? 1 : o.op)), txt: '', kids: kids };
      return lay;
    };
    const T = { forest: 0, pasture: 1, fields: 2, hills: 3, mountains: 4, desert: 5 };
    const mark = (t, w) => ({ style: abs(112 - (w || 50) / 2 + 20, 108, w || 50, 50, 'box-sizing:border-box;border-radius:25px;background:' + INK + ';border:2px solid ' + BONE + ';display:flex;align-items:center;justify-content:center;font-family:' + FONT + ';font-weight:800;font-size:25px;line-height:1;color:' + CREAM), txt: t, kids: [] });

    // ---------- cardboard token ----------
    const PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1, 7: 6 };
    const pipBody = (n, f) => { let b = ''; const w = n * 9; for (let i = 0; i < n; i++) b += '<circle cx="' + (4.5 + i * 9) + '" cy="4.5" r="3" fill="' + f + '"/>'; return [w, b]; };
    const tok = (n, cx, cy, o) => {
      o = o || {};
      const s = o.s || 1, hot = n === 6 || n === 8, fg = o.dark ? CREAM : (hot ? '#a3271a' : INK);
      const kids = (o.under || []).slice();
      if (!o.ghost) {
        kids.push(txt(0, 13, 92, 44, String(n), 42, fg, 'font-family:' + FONT));
        const [pw, pb] = pipBody(PIPS[n] || 0, fg);
        if (PIPS[n]) kids.push(sv(46 - pw / 2, 58, pw, 9, pw, 9, pb));
      } else {
        kids.push(txt(0, 20, 92, 44, String(n), 40, 'rgba(236,235,230,0.5)', ''));
      }
      (o.kids || []).forEach((k) => kids.push(k));
      if (o.shine) kids.push({ style: abs(0, 0, 92, 92, 'border-radius:50%;background:' + shineGrad(o.shine) + ';mix-blend-mode:screen;opacity:' + shineOp(o.shine) + ';pointer-events:none;' + DOTMASK), txt: '', kids: [] });
      const base = o.ghost
        ? 'border:2px dashed rgba(236,235,230,0.38);background:rgba(236,235,230,0.05);'
        : (o.dark ? 'background:#2a2b31;box-shadow:inset 0 0 0 3px #1a1b1f,inset 0 0 0 4px #4a4c53,0 2px 0 #0a0a0b,0 12px 12px rgba(0,0,0,0.55);'
          : 'background-color:' + BONE + ';background-image:radial-gradient(circle at 50% 28%,rgba(255,255,255,0.5),rgba(255,255,255,0) 60%),radial-gradient(rgba(120,100,60,0.22) 0.8px,transparent 1.3px);background-size:100% 100%,4px 4px;box-shadow:inset 0 0 0 3px #d0c7ae,inset 0 0 0 4px #b9b095,' + (o.rim ? '0 0 0 4px ' + o.rim + ',' : '') + '0 2px 0 #8c8168,0 12px 12px rgba(0,0,0,0.55);');
      return { style: abs(cx - 46 * s, cy - 46 * s, 92, 92, 'transform:scale(' + s + ');transform-origin:0 0;border-radius:50%;box-sizing:border-box;z-index:' + (o.z || 3) + ';opacity:' + (o.op === undefined ? 1 : o.op) + ';' + base), txt: '', kids: kids };
    };

    // ---------- die helpers ----------
    const faceSvg = (body, nopips) => ({ svg: body, nopips: !!nopips });
    const pipC = (x, y, f, r) => '<circle cx="' + x + '" cy="' + y + '" r="' + (r || 8.5) + '" fill="' + f + '"/>';
    const med = (cx, cy, tier, glyph) => {
      const dark = tier === 'rare';
      const rim = dark ? GOLD : CARD, fill = dark ? '#1b1c20' : BONE, ink = dark ? GOLD : INK;
      const gl = G[glyph](ink);
      return '<circle cx="' + cx + '" cy="' + cy + '" r="22" fill="' + fill + '" stroke="' + rim + '" stroke-width="3.5"/><g transform="translate(' + (cx - 14) + ' ' + (cy - 14) + ') scale(0.28)">' + gl + '</g>';
    };
    const frame = (c) => '<rect x="5" y="5" width="90" height="90" fill="none" stroke="' + c + '" stroke-width="2"/>';
    const die = (d, x, y, o) => {
      o = o || {};
      const size = d.size || 86, box = Math.round(size * 1.5);
      dice.push({ d: Object.assign({ size: size, ry: -34, spin: 'none' }, d), left: Math.round(x - box / 2), top: Math.round(y - box / 2), z: o.z || 5, op: o.op === undefined ? 1 : o.op });
    };
    const ring = (rx, ry2, w, c, part) => {
      // tilted halo ellipse with arrowheads; part = 'back' | 'front'
      const arc = part === 'back' ? 'M10 60 A90 32 0 0 1 190 60' : 'M190 60 A90 32 0 0 1 10 60';
      const head = part === 'back' ? '<path d="M176 40 L194 56 L170 60 Z" fill="' + c + '"/>' : '<path d="M24 80 L6 64 L30 60 Z" fill="' + c + '"/>';
      return enc(200, 120, '<path d="' + arc + '" stroke="' + c + '" stroke-width="' + w + '" fill="none" stroke-linecap="round" stroke-dasharray="1 0"/>' + head);
    };


    // ---------- print & material helpers ----------
    const ARTU = 'assets/art.webp', TILEU = 'assets/pieces.webp';
    const artBg = (i) => 'background-image:url(' + ARTU + ');background-repeat:no-repeat;background-size:500% 400%;background-position:' + ((i % 5) * 25) + '% ' + (Math.floor(i / 5) * 33.333) + '%;';
    const RES = { brick: 13, lumber: 14, wool: 15, grain: 16, ore: 17 };
    const pieceSprite = (i, x, y, size, z, extra) => ({ style: abs(x, y, size, size, 'background-image:url(' + TILEU + ');background-repeat:no-repeat;background-size:400% 400%;background-position:' + ((i % 4) * 33.333) + '% ' + (Math.floor(i / 4) * 33.333) + '%;pointer-events:none;z-index:' + (z || 6) + ';' + (extra || '')), txt: '', kids: [] });
    const hexRingClip = (k) => 'polygon(evenodd,' + C.map((q) => px(q[0]) + ' ' + px(q[1])).join(',') + ',' + C.map((q) => px(64 + (q[0] - 64) * k) + ' ' + px(74 + (q[1] - 74) * k)).join(',') + ')';
    const FOIL = 'linear-gradient(115deg,#6e4f10 0%,#e8c460 14%,#fff0b0 22%,#b88a26 34%,#f4d782 48%,#7a5812 62%,#e9c565 78%,#fff0b0 86%,#9a7220 100%)';
    const ringKid = (k, bg, extra) => ({ style: abs(6, 7, 128, 148, 'clip-path:' + hexRingClip(k) + ';background:' + bg + ';' + (extra || '')), txt: '', kids: [] });
    const blendKid = (bg, mode, extra, clip) => ({ style: abs(6, 7, 128, 148, 'clip-path:' + (clip || 'polygon(' + HEXP + ')') + ';background:' + bg + ';mix-blend-mode:' + mode + ';pointer-events:none;' + (extra || '')), txt: '', kids: [] });
    const dotsBg = (c, r, step) => 'radial-gradient(circle,' + c + ' ' + r + 'px,transparent ' + (r + 0.6) + 'px) 0 0/' + step + 'px ' + step + 'px, radial-gradient(circle,' + c + ' ' + r + 'px,transparent ' + (r + 0.6) + 'px) ' + (step / 2) + 'px ' + (step / 2) + 'px/' + step + 'px ' + step + 'px';
    const resCard = (art, x, y, w, rot, z, o) => {
      o = o || {};
      const h = Math.round(w * 1.32);
      // the art sheet's cells are 6:5, so the art box keeps that shape (it used to be stretched tall)
      return { style: abs(x, y, w, h, 'box-sizing:border-box;border-radius:6px;background:' + (o.ghost ? 'rgba(236,235,230,0.06)' : '#1a1b1f') + ';border:' + (o.ghost ? '2px dashed rgba(236,235,230,0.4)' : '1.5px solid ' + (o.edge || '#5a5c63')) + ';box-shadow:' + (o.ghost ? 'none' : '0 1px 0 #8c8168,0 6px 8px rgba(0,0,0,0.5)') + ';transform:rotate(' + (rot || 0) + 'deg);z-index:' + (z || 6)), txt: '', kids: o.ghost ? [] : (o.q ? [txt(0, h * 0.5 - w * 0.5, w, w, '?', Math.round(w * 0.78), '#ff4a1c', 'z-index:1')] : [{ style: abs(w * 0.08, h * 0.5 - w * 0.37, w * 0.84, w * 0.7, artBg(art)), txt: '', kids: [] }]) };
    };

    // ---------- shine by rarity ----------
    const DOTMASK = '-webkit-mask-image:radial-gradient(circle,#000 1.3px,transparent 1.9px);mask-image:radial-gradient(circle,#000 1.3px,transparent 1.9px);-webkit-mask-size:5px 5px;mask-size:5px 5px;';
    const shineGrad = (r) => r === 'legendary' ? 'linear-gradient(115deg,#ff6a45,#f3c64a,#74e0a6,#5fb7ff,#b384ff,#ff6a45)' : (r === 'rare' ? 'linear-gradient(115deg,rgba(169,196,220,0) 26%,rgba(169,196,220,0.9) 44%,#fff 50%,rgba(169,196,220,0.9) 56%,rgba(169,196,220,0) 74%)' : 'linear-gradient(115deg,rgba(255,255,255,0) 34%,rgba(255,255,255,0.6) 47%,rgba(255,255,255,0) 60%)');
    const shineOp = (r) => r === 'legendary' ? 0.3 : (r === 'rare' ? 0.4 : 0.32);
    const hexShine = (r, k) => blendKid(shineGrad(r), 'screen', DOTMASK + 'opacity:' + (shineOp(r) * (k || 1)) + ';');
    const SB = 'linear-gradient(135deg,#0d0e10 0%,#8f949c 16%,#e8ebef 28%,#16171a 44%,#0d0e10 54%,#a9aeb6 68%,#f1f3f5 78%,#202226 100%)';
    const goldShimmer = () => [blendKid('linear-gradient(115deg,rgba(226,189,98,0) 20%,rgba(226,189,98,0.28) 44%,rgba(255,240,180,0.32) 52%,rgba(226,189,98,0) 74%)', 'screen'), blendKid('radial-gradient(circle,rgba(255,244,200,0.95) 0.7px,transparent 1.1px) 0 0/11px 13px, radial-gradient(circle,rgba(255,244,200,0.8) 0.6px,transparent 1px) 5px 7px/17px 15px', 'screen', 'opacity:0.4')];
    const symMask = (body, big) => ({ style: abs(big ? 10 : 14, big ? 10 : 14, big ? 72 : 64, big ? 72 : 64, 'background:' + dotsBg('rgba(23,24,27,0.26)', 1.1, 4.2) + ';-webkit-mask-image:' + enc(100, 100, body) + ';mask-image:' + enc(100, 100, body) + ';-webkit-mask-size:100% 100%;mask-size:100% 100%;pointer-events:none'), txt: '', kids: [] });
    const SUN = (() => { let b = '<circle cx="50" cy="50" r="19" fill="#000"/>'; for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, a1 = a - 0.16, a2 = a + 0.16; b += '<polygon fill="#000" points="' + (50 + 27 * Math.cos(a1)).toFixed(1) + ',' + (50 + 27 * Math.sin(a1)).toFixed(1) + ' ' + (50 + 47 * Math.cos(a)).toFixed(1) + ',' + (50 + 47 * Math.sin(a)).toFixed(1) + ' ' + (50 + 27 * Math.cos(a2)).toFixed(1) + ',' + (50 + 27 * Math.sin(a2)).toFixed(1) + '"/>'; } return b; })();
    const HEART = '<path d="M50 88 C6 58 2 26 24 14 C38 8 48 18 50 26 C52 18 62 8 76 14 C98 26 94 58 50 88 Z" fill="#000"/>';
    const LEAF = '<path fill-rule="evenodd" fill="#000" d="M14 88 C4 42 38 8 92 10 C94 62 62 92 14 88 Z M16 84 L22 86 L88 14 L84 10 Z"/>';

    // =================================================================
    const E = {};

    // ---------------------------- FACES ----------------------------
    const faceDie = (front, extra, topV) => { die({ top: topV || 5, front: 2, right: 3, size: 88, marks: Object.assign({ front: front }, extra || {}) }, 120, 108); };
    E.reforge = () => {
      const old = '<g fill="none" stroke="rgba(23,24,27,0.4)" stroke-width="3" stroke-dasharray="3 3">' + [[28, 28], [50, 50], [72, 72]].map((p) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="8.5"/>').join('') + '</g>';
      const nw = [[28, 28], [72, 28], [28, 72], [72, 72]].map((p) => pipC(p[0], p[1], INK)).join('');
      const arrows = '<path d="M64 18 A18 18 0 0 1 86 30" stroke="' + GOLD2 + '" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M90 22 L88 36 L76 30 Z" fill="' + GOLD2 + '"/>';
      faceDie(faceSvg(old + nw + arrows, true));
    };
    E.raise = () => {
      const p = [[28, 28], [72, 28], [28, 72]].map((q) => pipC(q[0], q[1], INK)).join('') + '<circle cx="72" cy="72" r="13" fill="' + GOLD + '" stroke="' + GOLD2 + '" stroke-width="3"/><path d="M72 64 L72 80 M64 72 L80 72" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/>';
      faceDie(faceSvg(p, true));
    };
    E.lower = () => {
      const p = [[28, 28], [72, 28], [28, 72]].map((q) => pipC(q[0], q[1], INK)).join('') + '<circle cx="72" cy="72" r="12" fill="none" stroke="rgba(23,24,27,0.55)" stroke-width="3" stroke-dasharray="4 3"/><path d="M64 72 L80 72" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/>';
      faceDie(faceSvg(p, true));
    };
    E.lucky = () => faceDie(faceSvg(faceBody(3, ['lucky']), true));
    E.knightFav = () => faceDie(faceSvg(faceBody(3, ['knightFav']), true));
    E.knightLucky = () => { rarity = 'rare'; faceDie(faceSvg(faceBody(3, ['knightLucky']), true)); };
    E.robberFav = () => faceDie(faceSvg(faceBody(3, ['robberFav']), true));
    E.robberLucky = () => { rarity = 'rare'; faceDie(faceSvg(faceBody(3, ['robberLucky']), true)); };
    E.hidden = () => faceDie(faceSvg(faceBody(3, ['hidden']), true));
    E.mirror = () => { rarity = 'rare'; die({ top: 5, front: 1, right: 3, size: 88, marks: { front: 'mirror' } }, 120, 108); };
    E.robberFace = () => { rarity = 'rare'; die({ top: 5, front: 1, right: 3, size: 88, marks: { front: 'robber' } }, 120, 108); };
    E.blank = () => { rarity = 'rare'; die({ top: 5, front: 1, right: 3, size: 88, marks: { front: 'wild' } }, 120, 108); };

    // ---------------------------- DICE ----------------------------
    E.loaded = () => {
      let t = '';
      for (let i = 0; i < 10; i++) { const a = (-130 + i * 29) * Math.PI / 180, x1 = 50 + 37 * Math.cos(a), y1 = 50 + 37 * Math.sin(a), x2 = 50 + 45 * Math.cos(a), y2 = 50 + 45 * Math.sin(a); t += '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '" stroke="' + (i < 3 ? GOLD2 : 'rgba(23,24,27,0.35)') + '" stroke-width="' + (i < 3 ? 5 : 3) + '" stroke-linecap="round"/>'; }
      const body = '<circle cx="50" cy="50" r="31" fill="none" stroke="' + GOLD2 + '" stroke-width="4"/><circle cx="50" cy="50" r="27" fill="#c9a94d" opacity="0.55"/>' + pipC(50, 50, INK, 10) + t;
      die({ top: 5, front: 1, right: 3, size: 88, marks: { front: faceSvg(body) } }, 120, 108);
    };
    E.nudge = () => {
      const dial = '<circle cx="50" cy="50" r="34" fill="#c9a94d" stroke="' + GOLD2 + '" stroke-width="4"/><circle cx="50" cy="50" r="22" fill="#efeadc" stroke="' + GOLD2 + '" stroke-width="3"/><path d="M50 10 L62 24 L38 24 Z M50 90 L62 76 L38 76 Z" fill="' + INK + '"/><path d="M42 50 L58 50 M50 42 L50 58" stroke="' + INK + '" stroke-width="5" stroke-linecap="round"/>';
      die({ top: 4, front: 2, right: 3, size: 88, marks: { top: faceSvg(dial, true) } }, 120, 112);
    };
    E.recast = () => {
      R({ style: abs(20, 55, 200, 120, 'background:' + ring(0, 0, 7, SILV, 'back') + ' center/100% 100% no-repeat;z-index:3'), txt: '', kids: [] });
      die({ top: 3, front: 5, right: 2, size: 80, marks: {} }, 120, 106, { z: 5 });
      R({ style: abs(20, 55, 200, 120, 'background:' + ring(0, 0, 7, SILV, 'front') + ' center/100% 100% no-repeat;z-index:7'), txt: '', kids: [] });
    };
    E.twin = () => { rarity = 'rare'; die({ top: 6, front: 3, right: 5, size: 74, marks: {} }, 148, 92, { z: 4, op: 0.55 }); die({ top: 2, front: 4, right: 1, size: 80, marks: {} }, 100, 118, { z: 6 }); };
    E.alchemist = () => { rarity = 'legendary'; die({ top: 6, front: 4, right: 2, size: 88, tone: 'gold', marks: { top: faceSvg(G.sigil('#3b2a08'), true) } }, 120, 110); R(sv(38, 22, 26, 26, 100, 100, G.sparkle('#fff3c4'), 'z-index:8'), sv(176, 34, 18, 18, 100, 100, G.sparkle('#fff3c4'), 'z-index:8'), sv(184, 130, 22, 22, 100, 100, G.sparkle('#fff3c4'), 'z-index:8')); };
    E.echo = () => {
      rarity = 'legendary';
      R(sv(12, 142, 216, 56, 200, 52, '<ellipse cx="100" cy="26" rx="46" ry="12" fill="none" stroke="rgba(236,235,230,0.55)" stroke-width="2"/><ellipse cx="100" cy="26" rx="72" ry="18" fill="none" stroke="rgba(236,235,230,0.32)" stroke-width="2"/><ellipse cx="100" cy="26" rx="98" ry="24" fill="none" stroke="rgba(236,235,230,0.16)" stroke-width="2"/>', 'z-index:1'));
      die({ top: 4, front: 4, right: 2, size: 66, marks: {} }, 48, 104, { z: 2, op: 0.14 });
      die({ top: 4, front: 4, right: 2, size: 72, marks: {} }, 82, 106, { z: 3, op: 0.3 });
      die({ top: 4, front: 4, right: 2, size: 80, marks: {} }, 122, 108, { z: 5 });
    };
    E.copycat = () => { rarity = 'legendary'; die({ top: 5, front: 1, right: 3, size: 74, marks: { front: 'mirror' } }, 70, 108, { z: 3, op: 0.42 }); die({ top: 5, front: 1, right: 3, size: 80, marks: { front: 'mirror' } }, 160, 108, { z: 5 }); R(sv(78, 62, 84, 40, 100, 48, '<path d="M6 44 Q50 -10 94 44" fill="none" stroke="' + GOLD + '" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 9"/><path d="M82 30 L96 46 L74 48 Z" fill="' + GOLD + '"/>', 'z-index:7')); };

    // ---------------------------- TOKENS ----------------------------
    E.tokenSwap = () => {
      const arcs = '<path d="M16 34 A34 34 0 0 1 72 18" fill="none" stroke="#17181b" stroke-width="4.5" stroke-linecap="round"/><path d="M78 12 L76 30 L61 22 Z" fill="#17181b"/><path d="M76 58 A34 34 0 0 1 20 74" fill="none" stroke="#17181b" stroke-width="4.5" stroke-linecap="round"/><path d="M14 80 L16 62 L31 70 Z" fill="#17181b"/>';
      R(tok(9, 120, 104, { s: 1.5, z: 4, kids: [sv(0, 0, 92, 92, 92, 92, arcs)] }));
    };
    E.shift = () => {
      const ch = '<path d="M17 34 L8 46 L17 58" fill="none" stroke="#17181b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M75 34 L84 46 L75 58" fill="none" stroke="#17181b" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>';
      R(tok(8, 120, 104, { s: 1.5, z: 4, kids: [sv(0, 0, 92, 92, 92, 92, ch), txt(0, 6, 92, 16, '±1', 15, '#17181b', 'opacity:0.7')] }));
    };
    E.doubleToken = () => { rarity = 'rare'; R(tok(6, 150, 118, { s: 0.94, z: 3 }), tok(9, 94, 90, { s: 1, z: 4 })); };
    E.jackpot = () => {
      rarity = 'rare';
      R(tok(12, 118, 102, { s: 1.3, rim: GOLD, z: 4, under: [symMask(SUN, true)], shine: 'rare' }));
      R(chip(160, 130, 54, 54, '×3', 26, INK, GOLD, GOLD, 'z-index:9'));
    };
    E.twinToken = () => {
      rarity = 'rare';
      R(tok(8, 120, 88, { s: 1.04, z: 4 }));
      const twoDice = '<rect x="4" y="4" width="40" height="40" rx="3" fill="' + CREAM + '" stroke="' + INK + '" stroke-opacity="0.4" stroke-width="2"/>' + pipC(15, 15, INK, 5) + pipC(33, 15, INK, 5) + pipC(15, 33, INK, 5) + pipC(33, 33, INK, 5) + '<rect x="56" y="4" width="40" height="40" rx="3" fill="' + CREAM + '" stroke="' + INK + '" stroke-opacity="0.4" stroke-width="2"/>' + pipC(67, 15, INK, 5) + pipC(85, 15, INK, 5) + pipC(67, 33, INK, 5) + pipC(85, 33, INK, 5);
      R({ style: abs(70, 140, 100, 46, 'background:' + BONE + ';border-radius:8px;box-shadow:0 2px 0 #8c8168,0 10px 10px rgba(0,0,0,0.5);z-index:6'), txt: '', kids: [] });
      R(sv(74, 142, 92, 42, 100, 48, twoDice, 'z-index:7'));
    };
    E.sevenToken = () => {
      rarity = 'rare';
      R(tok(5, 108, 106, { s: 1.04, z: 4 }));
      R(tok(7, 160, 70, { s: 0.62, dark: true, z: 6 }));
    };
    E.heartland = () => {
      rarity = 'legendary';
      R(tok(7, 46, 112, { s: 0.7, ghost: true, z: 2 }), tok(9, 194, 112, { s: 0.7, ghost: true, z: 2 }));
      R(tok(8, 120, 106, { s: 1.2, rim: GOLD, z: 4, under: [symMask(HEART, true)], shine: 'legendary' }));
    };
    E.evergreen = () => {
      rarity = 'legendary';
      R(tok(6, 120, 106, { s: 1.3, z: 4, under: [symMask(LEAF, true)], shine: 'legendary' }));
    };
    // ---------------------------- HEX ----------------------------
    E.fertile = () => {
      const speck = dotsBg('rgba(190,230,120,0.9)', 0.9, 7);
      R(hex(T.fields, { printExtra: 'filter:saturate(1.6) contrast(1.12) brightness(1.05);', kids: [blendKid(speck, 'soft-light'), blendKid('radial-gradient(ellipse at 50% 40%,rgba(255,240,150,0.28),rgba(255,240,150,0) 70%)', 'screen'), hexShine('common'), mark('+1', 54)] }));
    };
    E.terraform = () => {
      const tear = [[64, 0], [72, 22], [58, 44], [72, 66], [58, 88], [72, 110], [58, 130], [64, 148], [128, 111], [128, 37]];
      const tl = '<path d="M64 0 L72 22 L58 44 L72 66 L58 88 L72 110 L58 130 L64 148" fill="none" stroke="' + CREAM + '" stroke-width="3" stroke-linejoin="round"/>';
      R(hex(T.forest, { kids: [printKid(T.hills, '', poly(tear)), ovKid(tl)] }));
      R(sv(70, 150, 100, 44, 100, 44, '<path d="M10 34 Q50 -8 90 30" fill="none" stroke="' + CREAM + '" stroke-width="5" stroke-linecap="round"/><path d="M96 34 L76 28 L84 12 Z" fill="' + CREAM + '"/>', 'z-index:9;opacity:0'));
    };
    E.clearDesert = () => {
      const patch = 'circle(36px at 44px 94px)';
      const edge = '<circle cx="44" cy="94" r="36" fill="none" stroke="' + CREAM + '" stroke-width="3" stroke-dasharray="5 5"/>';
      R(hex(T.desert, { kids: [printKid(T.pasture, '', patch), ovKid(edge)] }));
      R(tok(7, 150, 92, { s: 0.7, z: 6 }));
    };
    E.palisade = () => {
      const wood = 'repeating-linear-gradient(95deg,#6a5f56 0 4px,#7b7068 4px 7px,#554b44 7px 10px),#6a5f56';
      const silver = 'linear-gradient(115deg,rgba(255,255,255,0) 14%,rgba(226,233,242,0.8) 36%,rgba(255,255,255,0) 52%,rgba(226,233,242,0.55) 72%,rgba(255,255,255,0) 90%)';
      let jn = '';
      for (let e = 0; e < 6; e++) {
        const a = C[e], b = C[(e + 1) % 6];
        for (let i = 1; i < 7; i++) {
          const t = i / 7, ox = a[0] + (b[0] - a[0]) * t, oy = a[1] + (b[1] - a[1]) * t, ix = 64 + (ox - 64) * 0.82, iy = 74 + (oy - 74) * 0.82;
          jn += '<path d="M' + ox.toFixed(1) + ' ' + oy.toFixed(1) + ' L' + ix.toFixed(1) + ' ' + iy.toFixed(1) + '" stroke="rgba(20,18,18,0.55)" stroke-width="1.6"/>';
        }
      }
      const bevel = '<polygon points="' + C.map((q) => (64 + (q[0] - 64) * 0.82).toFixed(1) + ',' + (74 + (q[1] - 74) * 0.82).toFixed(1)).join(' ') + '" fill="none" stroke="rgba(15,14,14,0.8)" stroke-width="2.4"/><polygon points="' + C.map((q) => q[0] + ',' + q[1]).join(' ') + '" fill="none" stroke="rgba(240,245,250,0.55)" stroke-width="2.4"/>';
      R(hex(T.hills, { kids: [ringKid(0.82, wood), ovKid(jn + bevel, hexRingClip(1)), blendKid(silver, 'screen', 'clip-path:' + hexRingClip(0.82)), hexShine('common')] }));
    };
    E.surveyor = () => {
      rarity = 'rare';
      const order = [T.forest, T.pasture, T.fields, T.hills, T.mountains, T.desert];
      const kids = order.map((t, i) => printKid(t, '', poly([[64, 74], C[i], C[(i + 1) % 6]])));
      let ln = ''; for (let i = 0; i < 6; i++) ln += '<path d="M64 74 L' + C[i][0] + ' ' + C[i][1] + '" stroke="' + CREAM + '" stroke-width="3"/>';
      kids.push(ovKid(ln + '<circle cx="64" cy="74" r="12" fill="' + INK + '" stroke="' + CREAM + '" stroke-width="3"/><circle cx="64" cy="74" r="3.5" fill="' + CREAM + '"/>'));
      R(hex(T.forest, { kids: kids }));
    };
    E.gold = () => {
      rarity = 'rare';
      const glit = 'radial-gradient(circle,rgba(255,255,255,0.95) 0.7px,transparent 1.1px) 0 0/11px 13px, radial-gradient(circle,rgba(255,255,255,0.8) 0.6px,transparent 1px) 5px 7px/17px 15px';
      R(hex(T.fields, { printExtra: 'filter:grayscale(1) contrast(1.35) brightness(1.3);', kids: [blendKid(FOIL, 'multiply'), blendKid('linear-gradient(115deg,rgba(255,255,255,0) 30%,rgba(255,255,255,0.75) 44%,rgba(255,255,255,0) 54%)', 'screen'), blendKid(glit, 'screen', 'opacity:0.7')] }));
    };
    E.river = () => {
      rarity = 'rare';
      const holo = 'linear-gradient(120deg,rgba(40,150,255,0.32),rgba(120,225,255,0.3) 32%,rgba(130,110,255,0.3) 62%,rgba(60,190,255,0.32))';
      const rim = 'linear-gradient(135deg,#1b6fa8,#8fd8ff 30%,#2a86c4 55%,#bfeaff 80%,#1f78b8)';
      R(hex(T.pasture, { kids: [blendKid(holo, 'screen'), blendKid('linear-gradient(115deg,rgba(255,255,255,0) 30%,rgba(190,235,255,0.9) 46%,rgba(255,255,255,0) 60%)', 'screen', DOTMASK + 'opacity:0.45;'), ringKid(0.95, rim), hexShine('rare', 0.7)] }));
    };
    E.guildDistrict = () => {
      rarity = 'rare';
      R(hex(T.hills, { kids: goldShimmer().concat([ringKid(0.9, SB), hexShine('rare'), chip(100, 98, 46, 46, '3', 26, INK, GOLD, GOLD)]) }));
    };
    E.volcanic = () => {
      rarity = 'rare';
      R({ style: abs(50, 22, 140, 162, 'filter:blur(9px);opacity:0.85;z-index:1'), txt: '', kids: [{ style: abs(0, 0, 140, 162, 'clip-path:polygon(' + HEXP + ');background:#ff7a1f'), txt: '', kids: [] }] });
      const rim = 'linear-gradient(135deg,#ff5a14,#ffb04a 32%,#ff6a1a 58%,#ffd27a 84%,#ff5a14)';
      R(hex(T.mountains, { printExtra: 'filter:grayscale(0.9) brightness(0.5) contrast(1.2);', kids: [ringKid(0.92, rim), blendKid(dotsBg('rgba(255,150,60,0.9)', 0.9, 8), 'screen', 'opacity:0.35;clip-path:' + hexRingClip(0.92)), hexShine('rare'), mark('×2', 54)] }));
    };
    E.sister = () => {
      rarity = 'legendary';
      const rim = 'linear-gradient(135deg,#4a2d9a,#b894ff 24%,#7048d6 44%,#e2d0ff 62%,#5b36b8 80%,#a784f5)';
      const vio = 'linear-gradient(115deg,rgba(150,110,255,0) 24%,rgba(190,150,255,0.3) 46%,rgba(230,210,255,0.35) 52%,rgba(150,110,255,0) 76%)';
      R(sv(120, 70, 36, 60, 36, 60, '<g fill="#b894ff"><circle cx="4" cy="4" r="3"/><circle cx="11" cy="14" r="2.6"/><circle cx="18" cy="26" r="2.2"/><circle cx="24" cy="38" r="1.8"/><circle cx="30" cy="50" r="1.4"/></g>', 'z-index:1;opacity:0.9'));
      R(hex(T.forest, { x: 14, y: 14, zoom: 0.84, z: 3, kids: [blendKid(vio, 'screen'), ringKid(0.92, rim), hexShine('legendary')] }));
      R(hex(T.forest, { x: 140, y: 78, zoom: 0.62, z: 2, kids: [blendKid(vio, 'screen'), ringKid(0.92, rim), hexShine('legendary')] }));
    };
    E.haven = () => {
      rarity = 'legendary';
      R(hex(T.hills, { printExtra: 'filter:brightness(0.72) saturate(0.8) contrast(1.1);', kids: [blendKid('radial-gradient(ellipse at 50% 55%,rgba(10,8,12,0),rgba(10,8,12,0.6) 85%)', 'multiply'), hexShine('legendary', 0.8), mark('×2', 54)] }));
      R(pieceSprite(9, -10, -15, 260, 6));
    };
    E.capital = () => {
      rarity = 'legendary';
      R(hex(T.fields, { kids: goldShimmer().concat([ringKid(0.9, SB), hexShine('legendary', 0.8), chip(100, 100, 46, 46, '4', 26, INK, GOLD, GOLD)]) }));
      R(pieceSprite(8, -25, -35, 310, 6));
    };
    // ---------------------------- PORTS ----------------------------
    const harbour = (x, y, o) => {
      o = o || {};
      const n = o.n || 3, arts = o.arts || [RES.ore, RES.ore, RES.ore];
      const sea = dotsBg('rgba(111,180,201,0.85)', 1.25, 5);
      const plate = { style: abs(x, y, 180, 112, 'border-radius:12px;background:' + BONE + ';box-shadow:0 2px 0 #8c8168,0 12px 10px rgba(0,0,0,0.6);z-index:' + (o.z || 2)), txt: '', kids: [{ style: abs(8, 8, 164, 96, 'border-radius:7px;background-color:#12313f;background-image:' + sea), txt: '', kids: [] }] };
      const out = [plate];
      for (let i = 0; i < n; i++) out.push(resCard(arts[i % arts.length], x + 16 + i * 17, y + 26 - i * 2, 42, 0, 3 + i));
      if (o.ghostCard) out.push(resCard(RES.ore, x + 16 + n * 17, y + 26 - n * 2, 42, 0, 3, { ghost: true }));
      out.push(txt(x + 92, y + 28, 80, 52, o.ratio || '3:1', 44, CREAM, 'text-shadow:0 2px 0 rgba(0,0,0,0.5);z-index:9'));
      return out;
    };
    E.overflow = () => {
      R(...harbour(8, 40));
      R(resCard(RES.ore, 172, 98, 40, 14, 8), resCard(RES.ore, 190, 84, 40, -9, 9));
      R(chip(178, 30, 46, 46, '+1', 22, INK, CREAM, BONE, 'z-index:10'));
    };
    E.bigger = () => {
      rarity = 'rare';
      R(...harbour(8, 76));
      R(resCard(RES.ore, 150, 8, 54, 8, 8, { edge: GOLD }));
      R(chip(174, 52, 46, 46, '+1', 22, INK, GOLD, GOLD, 'z-index:10'));
    };
    E.smaller = () => {
      rarity = 'rare';
      R(...harbour(8, 40, { n: 2, ratio: '2:1', ghostCard: true }));
      R(chip(178, 30, 46, 46, '−1', 22, INK, CREAM, BONE, 'z-index:10'));
    };
    E.freePort = () => {
      rarity = 'legendary';
      R(...harbour(8, 40, { n: 3, arts: [RES.brick, RES.wool, RES.ore], ratio: '3:1' }));
      R(resCard(RES.lumber, 176, 96, 40, 10, 8), resCard(RES.grain, 192, 82, 40, -8, 9));
    };

    // the port plate as it is drawn on the board: same harbour card as in the shop, sized 180 × 112 from (0, 0)
    // board version: no plate, just the stack of resource cards (3:1 ports show "?" cards, like the packs in the shop) with the rate centred on a layer above it
    const boardPort = (t) => {
      const generic = t === 'generic', n = generic ? 3 : 2;
      const arts = generic ? [RES.brick, RES.wool, RES.ore] : [RES[t], RES[t]];
      const cw = 64, step = generic ? 24 : 30, rot = n === 3 ? [-8, -1, 7] : [-6, 6];
      const x0 = (140 - (cw + (n - 1) * step)) / 2;
      for (let k = 0; k < n; k++) R(resCard(arts[k], x0 + k * step, 1 + (k === 1 && n === 3 ? 2 : 0), cw, rot[k], 3 + k, generic ? { q: true, edge: k === n - 1 ? '#ff4a1c' : undefined } : undefined));
      R(txt(0, 42 - 26, 140, 52, generic ? '3:1' : '2:1', 44, CREAM, 'text-shadow:0 0 3px #000,0 0 7px #000,0 3px 0 #000;z-index:20'));
    };
    for (const t of ['generic', 'brick', 'lumber', 'wool', 'grain', 'ore']) E['port:' + t] = () => boardPort(t);
    (E[id] || E.fertile)();
    if (rarity !== 'common') layers.unshift(halo(rarity));
    layers.forEach((l, i) => { if (l.style.indexOf('z-index') < 0) l.style += ';z-index:2'; });
    return { layers: layers, dice: dice };
}

// ---------------------------------------------------------------- 3D die (static), as in the canvas
function dieHtml(d) {
  const s = d.size || 54, h = s / 2, ry = d.ry === undefined ? -34 : d.ry;
  const P = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]], 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]] };
  const pr = s * 0.085;
  const pips = (v, ink) => P[v].map((q) => `radial-gradient(circle at ${q[0]}% ${q[1]}%, ${ink} 0 ${pr.toFixed(1)}px, transparent ${(pr + 0.8).toFixed(1)}px)`).join(', ');
  const vals = { top: d.top, front: d.front, right: d.right, left: 7 - d.right, back: 7 - d.front, bottom: 7 - d.top };
  const gold = d.tone === 'gold';
  const tone = gold ? { top: '#f3dd92', front: '#e2c670', right: '#c9a94d', left: '#c9a94d', back: '#e2c670', bottom: '#9d7f2f' } : { top: '#efeadc', front: '#d3cdbd', right: '#b3ad9d', left: '#b3ad9d', back: '#d3cdbd', bottom: '#8f8a7c' };
  const TF = { top: 'rotateX(90deg)', front: '', right: 'rotateY(90deg)', left: 'rotateY(-90deg)', back: 'rotateY(180deg)', bottom: 'rotateX(-90deg)' };
  const marks = d.marks || {};
  const faces = Object.keys(TF).map((k) => {
    const m = marks[k];
    const ink = gold ? '#3b2a08' : '#17181b';
    let bg = `${pips(vals[k], ink)}, ${tone[k]}`, glyph = '';
    if (m && typeof m === 'object') {
      const body = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${m.svg}</svg>`;
      const url = `url('data:image/svg+xml;utf8,${encodeURIComponent(body).replace(/'/g, '%27')}') center/100% 100% no-repeat`;
      bg = `${url}, ${m.nopips ? '' : pips(vals[k], ink) + ', '}${tone[k]}`;
    }
    if (m === 'mirror') bg = `radial-gradient(circle at 50% 50%, #17181b 0 ${(s * 0.17).toFixed(1)}px, #e9e4d6 ${(s * 0.18).toFixed(1)}px ${(s * 0.27).toFixed(1)}px, #17181b ${(s * 0.28).toFixed(1)}px)`;
    if (m === 'robber') { bg = '#17181b'; glyph = 'R'; }
    if (m === 'wild') { bg = '#17181b'; glyph = '?'; }
    return `<div style="position:absolute;left:0;top:0;width:${s}px;height:${s}px;box-sizing:border-box;border:1px solid rgba(0,0,0,.35);background:${bg};transform:${(TF[k] + ` translateZ(${h}px)`).trim()};display:flex;align-items:center;justify-content:center;font-family:'Grenze Gotisch',Georgia,serif;font-weight:800;font-size:${Math.round(s * 0.62)}px;line-height:1;color:#e9e4d6">${glyph}</div>`;
  }).join('');
  const box = Math.round(s * 1.5);
  return `<div style="width:${box}px;height:${box}px;display:flex;align-items:center;justify-content:center;perspective:${s * 9}px"><div style="width:${s}px;height:${s}px;position:relative;transform-style:preserve-3d;transform:rotateX(-28deg) rotateY(${ry}deg)">${faces}</div></div>`;
}

const layerHtml = (l) => `<div style="${l.style}">${l.txt ? esc(l.txt) : ''}${(l.kids || []).map(layerHtml).join('')}</div>`;

const cache = new Map();
// The figure for an upgrade id, as HTML. `scale` shrinks the 240 × 210 stage (the wrapper keeps the scaled size).
export function figure(id, scale = 1) {
  const key = `${id}@${scale}`;
  if (cache.has(key)) return cache.get(key);
  const out = build(id);
  const inner = out.layers.map(layerHtml).join('') + out.dice.map((q) => `<div style="position:absolute;left:${q.left}px;top:${q.top}px;z-index:${q.z};opacity:${q.op}">${dieHtml(q.d)}</div>`).join('');
  const html = `<div class="figure" style="width:${240 * scale}px;height:${210 * scale}px"><div style="width:240px;height:210px;position:relative;overflow:visible;transform:scale(${scale});transform-origin:0 0">${inner}</div></div>`;
  cache.set(key, html);
  return html;
}

// The port figure for the board (the stack of resource cards with the rate above it), `w` px wide. type: a resource or 'generic'.
export function portPlate(type, w = 90) {
  const k = w / 140; // the board figure is 140 × 86; the card stack's centre sits 42 px down
  const out = build('port:' + type);
  const inner = out.layers.map(layerHtml).join('');
  return `<div class="portplate" style="width:${w}px;height:${86 * k}px"><div style="width:140px;height:86px;position:relative;transform:scale(${k});transform-origin:0 0">${inner}</div></div>`;
}
