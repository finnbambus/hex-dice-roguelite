# Port pieces: a half-hex footprint that meets the board along one coast edge, then breaks into an organic shape
# carrying the port's scene. Local frame: origin = middle of the coast edge, +x = out to sea, y = along the coast.
# usage: python3 ports.py -- OUTDIR type:k,type:k,... RES [SAMPLES]
import os, sys, math, random
HERE = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(HERE, 'tiles.py')).read()
exec(compile(_src[:_src.index('TILES = {')], 'tiles_pre', 'exec'), globals())

PPU = 512 / 2.6            # pixels per world unit, same as the tile sheet scale
FRAME = 3.6                # world units across the render frame
SAMPLES = int(sys.argv[sys.argv.index('--') + 4]) if len(sys.argv) > sys.argv.index('--') + 4 else 56


# ------------------------------------------------------------------ outline helpers
def catmull(pts, per=14):
    out = []
    n = len(pts)
    for i in range(n - 1):
        p0 = pts[max(i - 1, 0)]; p1 = pts[i]; p2 = pts[i + 1]; p3 = pts[min(i + 2, n - 1)]
        for s in range(per):
            t = s / per
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in (0, 1)))
    out.append(pts[-1])
    return out


def outline(ctrl, seed=0.0, wob=0.03):
    """Hex-aligned shoulders on both sides (they continue the neighbouring hex edges), organic sea side between."""
    sl = 0.57735  # slope of the hex edges leaving the coast edge
    xa = 0.30
    A = (xa, -(0.5 + sl * xa)); B = (xa, 0.5 + sl * xa)
    org = [A] + list(ctrl) + [B]
    c = catmull(org, 12)
    pts = []
    for i, (x, y) in enumerate(c):
        f = min(i, len(c) - 1 - i) / 6.0
        f = min(1.0, f)
        d = wob * f * noise.noise(Vector((x * 4.0 + seed, y * 4.0, seed)))
        # push along the outward direction of the curve (approx. radially from (0.4,0))
        rx, ry = x - 0.35, y
        rl = math.hypot(rx, ry) or 1
        pts.append((x + rx / rl * d, y + ry / rl * d))
    poly = [(0.0, -0.5), (0.15, -0.5 - sl * 0.15)] + pts + [(0.15, 0.5 + sl * 0.15), (0.0, 0.5)]
    # drop near-duplicates
    res = [poly[0]]
    for p in poly[1:]:
        if math.hypot(p[0] - res[-1][0], p[1] - res[-1][1]) > 0.012:
            res.append(p)
    return res


def seg_dist(pts, x, y):
    best = 1e9
    n = len(pts)
    for i in range(n):
        ax, ay = pts[i]; bx, by = pts[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        t = 0 if l2 == 0 else max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
        d = math.hypot(x - ax - t * dx, y - ay - t * dy)
        if d < best:
            best = d
    return best


def platform(pts, top_mat, wall_mat, hf, edge_keep=0.11, cuts=5):
    """Top surface (displaced by hf, flat on every border) plus soil-strata walls. Returns Z(x,y)."""
    # orient CCW
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    if area < 0:
        pts = pts[::-1]
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, 0)) for x, y in pts]
    f = bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=[f], quad_method='BEAUTY', ngon_method='BEAUTY')
    for _ in range(cuts):
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=False)
        bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method='BEAUTY')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    cache = {}

    def Z(x, y):
        k = (round(x, 4), round(y, 4))
        if k not in cache:
            d = seg_dist(pts, x, y)
            f_ = min(1.0, d / edge_keep)
            f_ = f_ * f_ * (3 - 2 * f_)
            cache[k] = hf(x, y) * f_
        return cache[k]
    for v in bm.verts:
        v.co.z = Z(v.co.x, v.co.y)
    # walls from the boundary edges
    wm = bmesh.new()
    levels = (0.0, -0.07, -0.20, -BASE_H)
    wv = {}
    def vert(v, lv):
        k = (v.index, lv)
        if k not in wv:
            wv[k] = wm.verts.new((v.co.x, v.co.y, levels[lv] if lv else v.co.z))
        return wv[k]
    bm.verts.ensure_lookup_table()
    for e in bm.edges:
        if len(e.link_faces) != 1:
            continue
        a, b = e.verts
        lp = e.link_loops[0]
        if lp.vert != a:
            a, b = b, a
        for lv in range(3):
            wm.faces.new((vert(b, lv), vert(a, lv), vert(a, lv + 1), vert(b, lv + 1)))
    # bottom
    bottom = [e for e in bm.edges if len(e.link_faces) == 1]
    top_o = obj_from_bm(bm, 'ptop', top_mat)
    obj_from_bm(wm, 'pwall', wall_mat, smooth=False)
    return Z


# ------------------------------------------------------------------ prop helpers
def group(fn, loc=(0, 0, 0), rot=0.0, scale=1.0):
    scene = bpy.context.scene
    before = set(scene.objects)
    fn()
    new = [o for o in scene.objects if o not in before and o.parent is None]
    e = bpy.data.objects.new('grp', None)
    scene.collection.objects.link(e)
    e.location = loc
    e.rotation_euler = (0, 0, rot)
    e.scale = (scale, scale, scale)
    for o in new:
        o.parent = e
    return e


def post(x, y, z, h, mat_, r=0.012):
    return cyl(r, h, (x, y, z), mat_, segs=6)


def rail(p0, p1, mat_, t=0.012, z=0.0):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    o = box((d.length, t, t), ((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2 - t / 2), mat_, rot=math.atan2(d.y, d.x))
    return o


def jetty(m, y0, length, x0=0.7, wide=0.17, tilt=0.0):
    """A wooden pier running out to sea from (x0, y0)."""
    deck = mat('deck', (0.36, 0.24, 0.13), (0.18, 0.11, 0.06), scale=26, bump=0.5)
    n = int(length / 0.07)
    for i in range(n):
        x = x0 + i * 0.07 + 0.035
        box((0.062, wide, 0.022), (x, y0 + tilt * i * 0.07, 0.015), deck)
    for i in range(0, n, 3):
        x = x0 + i * 0.07 + 0.035
        for s in (-1, 1):
            cyl(0.02, 0.17, (x, y0 + tilt * i * 0.07 + s * wide * 0.5, -0.15), m['trunk'], segs=6)
    return x0 + n * 0.07


def boat(m, loc, rot, s=1.0):
    """A small sailing dinghy, bow towards +x before rotation."""
    def build():
        hullm = mat('hull', (0.34, 0.21, 0.11), (0.17, 0.10, 0.05), scale=22, bump=0.5)
        inner = mat('hullin', (0.10, 0.06, 0.03), bump=0.2)
        sail = mat('dsail', (0.88, 0.82, 0.70), (0.66, 0.60, 0.50), scale=30, bump=0.4)
        blob(0.34, (0, 0, 0.02), hullm, squash=(1.0, 0.36, 0.20), noise_amt=0.0, sub=3)
        blob(0.30, (0.0, 0, 0.065), inner, squash=(0.97, 0.28, 0.12), noise_amt=0.0, sub=3)
        box((0.012, 0.16, 0.012), (-0.03, 0, 0.08), m['wood'])
        cyl(0.012, 0.52, (0.02, 0, 0.06), m['wood'], segs=6)
        bm = bmesh.new()
        vs = [bm.verts.new(p) for p in ((0.025, 0.0, 0.14), (0.025, 0.0, 0.56), (0.025, -0.0, 0.14))]
        vs = [bm.verts.new(p) for p in ((0.03, 0.0, 0.15), (0.03, 0.0, 0.58), (0.30, 0.0, 0.15))]
        bm.faces.new(vs)
        o = obj_from_bm(bm, 'sail', sail, smooth=False)
        mod = o.modifiers.new('sol', 'SOLIDIFY'); mod.thickness = 0.012
        vs2 = None
        bm = bmesh.new()
        vs = [bm.verts.new(p) for p in ((-0.01, 0.0, 0.15), (-0.01, 0.0, 0.46), (-0.26, 0.0, 0.15))]
        bm.faces.new(vs)
        o2 = obj_from_bm(bm, 'jib', sail, smooth=False)
        mod = o2.modifiers.new('sol', 'SOLIDIFY'); mod.thickness = 0.012
    group(build, loc=loc, rot=rot, scale=s)


def crate(x, y, z, s, rot, m_):
    box((s, s, s * 0.9), (x, y, z), m_, rot=rot)


def barrel(x, y, z, m_, r=0.035):
    cyl(r, 0.07, (x, y, z), m_, segs=10)


# ------------------------------------------------------------------ the six ports
# props are drawn chunky on purpose: the piece ends up ~80 px wide on screen, in two-tone halftone
def port_brick(m, rnd):
    clay = mat('pclay', (0.38, 0.135, 0.065), (0.18, 0.06, 0.03), scale=7, bump=0.7)
    def hf(x, y):
        pit = max(0.0, 1 - (math.hypot(x - 0.78, (y - 0.12) * 1.1) / 0.34)) ** 0.8
        return 0.03 + 0.06 * fbm(x, y, 1.4, 3, 2.2) - 0.08 * pit
    ol = outline([(0.50, -0.84), (0.72, -0.98), (0.96, -0.90), (1.04, -0.66), (1.00, -0.42), (1.14, -0.22), (1.24, 0.08), (1.12, 0.36), (0.96, 0.50), (0.98, 0.74), (0.80, 0.92), (0.56, 0.86)], seed=1.0, wob=0.04)
    Z = platform(ol, clay, m['soil'], hf)
    stone = mat('pkiln', (0.62, 0.60, 0.56), (0.34, 0.33, 0.31), scale=9, bump=0.7)
    kx, ky = 0.46, -0.40
    k0 = Z(kx, ky)
    cyl(0.24, 0.36, (kx, ky, k0), stone, segs=10, r2=0.19)
    blob(0.19, (kx, ky, k0 + 0.35), stone, squash=(1, 1, 0.55), noise_amt=0.0, sub=2)
    cyl(0.065, 0.55, (kx + 0.07, ky - 0.05, k0 + 0.38), m['roof'], segs=8, r2=0.05)
    box((0.14, 0.025, 0.11), (kx - 0.02, ky + 0.24, k0 + 0.05), m['glow'], rot=0.0)
    group(lambda: r_brick(m, rnd), loc=(0.98, -0.30, Z(0.98, -0.30) + 0.07), rot=0.35, scale=0.68)
    group(lambda: r_brick(m, rnd), loc=(0.55, 0.50, Z(0.55, 0.50) + 0.06), rot=-0.5, scale=0.52)
    brick = mat('pbrick', (0.85, 0.32, 0.16), (0.55, 0.18, 0.09), scale=30, bump=1.0)
    for (x, y, r_) in ((0.84, 0.58, 0.3), (0.94, 0.30, -0.2), (0.36, 0.08, 0.7), (1.08, 0.04, 0.1), (0.78, -0.12, 0.5)):
        box((0.15, 0.075, 0.05), (x, y, Z(x, y) + 0.01), brick, rot=r_)
    top = jetty(m, 0.58, 0.40, x0=0.82, wide=0.20)
    boat(m, (1.10, 0.92, -0.04), 0.15, 0.85)


def port_lumber(m, rnd):
    g = mat('pfloor', (0.075, 0.15, 0.055), (0.04, 0.075, 0.025), scale=7, bump=0.5)
    def hf(x, y):
        return 0.045 + 0.09 * fbm(x, y, 1.6, 4, 5.3)
    ol = outline([(0.50, -0.86), (0.70, -0.96), (0.84, -0.80), (1.02, -0.74), (1.08, -0.46), (1.20, -0.20), (1.14, 0.12), (1.20, 0.36), (1.04, 0.52), (1.02, 0.80), (0.80, 0.84), (0.64, 0.96), (0.50, 0.86)], seed=2.0, wob=0.045)
    Z = platform(ol, g, m['soil'], hf)
    leaf1 = mat('pleaf1', (0.07, 0.20, 0.09), (0.03, 0.09, 0.05), scale=30, bump=0.5)
    leaf2 = mat('pleaf2', (0.11, 0.24, 0.08), (0.05, 0.11, 0.04), scale=30, bump=0.5)
    for (x, y, s) in ((0.32, -0.62, 2.1), (0.58, -0.78, 1.8), (0.30, 0.62, 2.2), (0.64, 0.74, 1.7), (0.92, -0.60, 1.5), (0.16, -0.58, 1.6), (0.18, 0.55, 1.5)):
        tree_conifer(x, y, Z(x, y) - 0.01, s, rnd.choice((leaf1, leaf2)), m['trunk'], rnd)
    gable(0.30, 0.20, 0.14, 0.12, (0.52, -0.10, Z(0.52, -0.10)), m['wood'], m['roof'], rot=0.25)
    box((0.05, 0.012, 0.07), (0.58, -0.20, Z(0.52, -0.10) + 0.03), m['glow'], rot=0.25)
    group(lambda: r_lumber(m, rnd), loc=(0.92, 0.12, Z(0.92, 0.12)), rot=0.8, scale=0.82)
    group(lambda: r_lumber(m, rnd), loc=(0.66, 0.44, Z(0.66, 0.44)), rot=-0.4, scale=0.46)
    cutm = mat('pcut', (0.80, 0.64, 0.40), (0.58, 0.42, 0.24), scale=60, bump=0.4)
    for (x, y) in ((0.80, -0.34), (1.00, -0.20), (0.34, 0.22)):
        cyl(0.06, 0.07, (x, y, Z(x, y)), m['trunk'], segs=9)
        cyl(0.05, 0.072, (x, y, Z(x, y)), cutm, segs=9)
    top = jetty(m, -0.62, 0.40, x0=0.82, wide=0.20)
    boat(m, (1.05, -0.98, -0.04), 0.0, 0.85)


def port_wool(m, rnd):
    grass = mat('pgrass', (0.12, 0.25, 0.065), (0.055, 0.12, 0.035), scale=9, bump=0.6)
    def hf(x, y):
        return 0.06 + 0.12 * fbm(x, y, 1.2, 3, 7.1)
    ol = outline([(0.52, -0.84), (0.74, -0.96), (0.98, -0.86), (1.12, -0.58), (1.24, -0.30), (1.22, 0.02), (1.12, 0.30), (1.16, 0.54), (1.00, 0.76), (0.80, 0.92), (0.56, 0.86)], seed=3.0, wob=0.05)
    Z = platform(ol, grass, m['soil'], hf)
    cx, cy, R = 0.76, -0.14, 0.36
    n = 12
    posts = []
    for i in range(n):
        a = i / n * 2 * math.pi
        x, y = cx + math.cos(a) * R, cy + math.sin(a) * R * 0.9
        posts.append((x, y))
        post(x, y, Z(x, y) - 0.01, 0.15, m['wood'], r=0.021)
    for i in range(n):
        if i == 3: continue
        p, q = posts[i], posts[(i + 1) % n]
        rail((p[0], p[1], Z(*p) + 0.12), (q[0], q[1], Z(*q) + 0.12), m['wood'], 0.018)
        rail((p[0], p[1], Z(*p) + 0.065), (q[0], q[1], Z(*q) + 0.065), m['wood'], 0.018)
    for (x, y, a) in ((0.64, -0.20, 0.6), (0.88, -0.08, 2.4), (0.74, 0.02, -1.0)):
        group(lambda: r_sheep(m, rnd), loc=(x, y, Z(x, y)), rot=a, scale=0.56)
    hay = mat('phay', (0.70, 0.54, 0.20), (0.42, 0.30, 0.09), scale=50, bump=0.9)
    cyl(0.10, 0.14, (0.36, 0.40, Z(0.36, 0.40)), hay, segs=12)
    cyl(0.10, 0.14, (0.56, 0.56, Z(0.56, 0.56)), hay, segs=12)
    leaf = mat('pleafw', (0.14, 0.30, 0.08), (0.06, 0.14, 0.04), scale=30, bump=0.5)
    tree_round(0.26, -0.60, Z(0.26, -0.60), 2.0, leaf, m['trunk'], rnd)
    tree_round(0.84, 0.70, Z(0.84, 0.70), 1.5, leaf, m['trunk'], rnd)
    top = jetty(m, 0.62, 0.40, x0=0.86, wide=0.20)
    boat(m, (1.12, 0.98, -0.04), 0.1, 0.85)


def port_grain(m, rnd):
    stub = mat('pstub', (0.40, 0.32, 0.12), (0.19, 0.14, 0.05), scale=30, bump=0.8)
    def hf(x, y):
        return 0.04 + 0.03 * math.sin((x * 0.6 + y * 1.0) * 24) + 0.03 * fbm(x, y, 1.2, 2, 3.3)
    ol = outline([(0.50, -0.88), (0.84, -0.90), (1.02, -0.74), (1.06, -0.40), (1.22, -0.30), (1.24, 0.14), (1.08, 0.26), (1.08, 0.60), (0.96, 0.84), (0.70, 0.90), (0.50, 0.84)], seed=4.0, wob=0.03)
    Z = platform(ol, stub, m['soil'], hf)
    wx, wy = 0.56, -0.38
    z0 = Z(wx, wy)
    bright = mat('pwhite', (0.92, 0.88, 0.78), (0.70, 0.66, 0.56), scale=14, bump=0.3)
    cyl(0.21, 0.58, (wx, wy, z0), bright, segs=10, r2=0.125)
    cone(0.175, 0.25, (wx, wy, z0 + 0.58), m['roof'], segs=10)
    box((0.07, 0.02, 0.11), (wx, wy - 0.14, z0 + 0.02), m['wood'], rot=0.0)
    hy = wy + 0.16
    hubz = z0 + 0.52
    sail = mat('psail', (0.84, 0.78, 0.66), (0.62, 0.57, 0.46), scale=30, bump=0.4)
    cyl(0.025, 0.18, (wx, wy + 0.06, hubz), m['wood'], segs=6).rotation_euler = (-math.pi / 2, 0, 0)
    for k in range(4):
        a = 0.5 + k * math.pi / 2
        bx, bz = math.cos(a), math.sin(a)
        for (L, off, w, tt) in ((0.44, 0.22, 0.028, 0.02), (0.30, 0.28, 0.12, 0.01)):
            o = box((w, tt, L), (wx + bx * off - (bz * 0.05 if L < 0.3 else 0), hy, hubz + bz * off + (bx * 0.05 if L < 0.3 else 0)), m['wood'] if L > 0.3 else sail)
            o.rotation_euler = (0, a - math.pi / 2, 0)
    sackm = mat('psack', (0.74, 0.66, 0.46), (0.48, 0.40, 0.24), scale=30, bump=0.6)
    for (x, y) in ((0.90, -0.14), (1.00, -0.06), (0.92, 0.04), (0.95, -0.08)):
        blob(0.07, (x, y, Z(x, y) + 0.06), sackm, squash=(1, 0.85, 1.2), noise_amt=0.18, sub=2, seed=x * 9)
    group(lambda: r_wheat(m, rnd), loc=(0.94, 0.46, Z(0.94, 0.46)), rot=0.2, scale=0.52)
    group(lambda: r_wheat(m, rnd), loc=(0.60, 0.52, Z(0.60, 0.52)), rot=0.9, scale=0.44)
    straw = mat('pstraw', (0.82, 0.62, 0.20), (0.52, 0.36, 0.09), scale=40, bump=0.6)
    for i in range(40):
        x, y = rnd.uniform(0.3, 1.0), rnd.uniform(-0.2, 0.8)
        if seg_dist(ol, x, y) < 0.14: continue
        stick((x, y, Z(x, y)), (x + rnd.uniform(-0.01, 0.01), y, Z(x, y) + rnd.uniform(0.09, 0.14)), 0.008, straw, segs=4)
    top = jetty(m, -0.70, 0.40, x0=0.80, wide=0.20)
    boat(m, (1.06, -1.02, -0.04), 0.0, 0.85)


def port_ore(m, rnd):
    scree = mat('pscree', (0.20, 0.21, 0.23), (0.08, 0.08, 0.10), scale=12, bump=0.9)
    def hf(x, y):
        return 0.05 + 0.14 * fbm(x, y, 2.0, 4, 6.1)
    ol = outline([(0.50, -0.88), (0.66, -0.98), (0.88, -0.86), (1.02, -0.74), (0.98, -0.50), (1.16, -0.34), (1.22, -0.04), (1.08, 0.12), (1.16, 0.36), (1.02, 0.58), (1.04, 0.82), (0.82, 0.88), (0.62, 0.98), (0.50, 0.84)], seed=5.0, wob=0.06)
    Z = platform(ol, scree, m['soil'], hf)
    rock = mat('prock', (0.34, 0.35, 0.38), (0.12, 0.13, 0.16), scale=5, bump=0.9)
    snow = mat('psnow', (0.70, 0.72, 0.78), (0.42, 0.44, 0.50), scale=10, bump=0.3)
    for (x, y, r_, h, sd) in ((0.46, -0.58, 0.34, 0.95, 3), (0.34, -0.22, 0.26, 1.1, 8), (0.52, -0.84, 0.22, 1.0, 12), (0.40, 0.62, 0.26, 1.1, 17)):
        blob(r_, (x, y, Z(x, y) + r_ * 0.3), rock, squash=(1, 1, h), noise_amt=0.40, sub=3, seed=sd, smooth=False)
    blob(0.14, (0.44, -0.55, 0.46), snow, squash=(1, 1, 0.5), noise_amt=0.3, sub=2, seed=4, smooth=False)
    mx_, my_ = 0.74, -0.34
    z0 = Z(mx_, my_)
    dark = mat('pdark', (0.005, 0.005, 0.005), bump=0)
    box((0.03, 0.26, 0.22), (mx_ - 0.04, my_, z0), dark)
    for s in (-1, 1):
        box((0.05, 0.045, 0.26), (mx_, my_ + s * 0.14, z0), m['wood'])
    box((0.05, 0.34, 0.05), (mx_, my_, z0 + 0.24), m['wood'])
    for s in (-1, 1):
        rail((0.80, my_ + s * 0.06, z0 + 0.012), (1.08, my_ + 0.22 + s * 0.06, Z(1.08, my_ + 0.22) + 0.012), m['stone'], 0.02)
    ore = mat('pore', (0.50, 0.55, 0.66), (0.18, 0.20, 0.27), scale=20, rough=0.35, metallic=0.8, bump=0.8)
    cx, cy = 0.94, my_ + 0.15
    ang = math.atan2(0.22, 0.28)
    box((0.22, 0.15, 0.10), (cx, cy, Z(cx, cy) + 0.05), m['wood'], rot=ang)
    blob(0.09, (cx, cy, Z(cx, cy) + 0.14), ore, squash=(1.2, 0.9, 0.7), noise_amt=0.4, sub=2, seed=9, smooth=False)
    group(lambda: r_ore(m, rnd), loc=(0.90, 0.34, Z(0.90, 0.34)), rot=0.4, scale=1.05)
    group(lambda: r_ore(m, rnd), loc=(0.62, 0.42, Z(0.62, 0.42)), rot=1.4, scale=0.6)
    for (x, y) in ((1.06, -0.05), (0.80, 0.0), (1.0, 0.64), (0.30, 0.18)):
        blob(rnd.uniform(0.06, 0.09), (x, y, Z(x, y) + 0.03), rock, squash=(1, 1, 0.7), noise_amt=0.4, sub=1, seed=x * 5, smooth=False)
    top = jetty(m, 0.66, 0.40, x0=0.82, wide=0.20)
    boat(m, (1.10, 0.98, -0.04), 0.1, 0.85)


def port_generic(m, rnd):
    cob = mat('pcob', (0.34, 0.31, 0.27), (0.14, 0.13, 0.11), scale=36, bump=1.0)
    def hf(x, y):
        return 0.035 + 0.015 * fbm(x, y, 3.0, 2, 1.1)
    ol = outline([(0.54, -0.84), (0.84, -0.86), (0.98, -0.66), (1.10, -0.44), (1.16, -0.14), (1.06, 0.04), (1.06, 0.20), (1.18, 0.34), (1.12, 0.62), (0.94, 0.76), (0.78, 0.90), (0.54, 0.84)], seed=6.0, wob=0.03)
    Z = platform(ol, cob, m['soil'], hf)
    gable(0.40, 0.28, 0.20, 0.15, (0.46, -0.32, Z(0.46, -0.32)), m['plaster'], m['roof'], rot=0.0)
    box((0.10, 0.015, 0.13), (0.46, -0.465, Z(0.46, -0.32)), m['wood'], rot=0.0)
    lx, ly = 0.86, -0.50
    white = mat('plh', (0.84, 0.81, 0.74), (0.58, 0.55, 0.48), scale=14, bump=0.3)
    red = mat('plhr', (0.50, 0.12, 0.07), (0.28, 0.07, 0.04), scale=14, bump=0.3)
    z0 = Z(lx, ly)
    cyl(0.15, 0.28, (lx, ly, z0), white, segs=12, r2=0.125)
    cyl(0.125, 0.25, (lx, ly, z0 + 0.28), red, segs=12, r2=0.105)
    cyl(0.105, 0.23, (lx, ly, z0 + 0.53), white, segs=12, r2=0.087)
    cyl(0.115, 0.025, (lx, ly, z0 + 0.76), m['roof'], segs=12)
    cyl(0.065, 0.09, (lx, ly, z0 + 0.785), m['glow'], segs=10)
    cone(0.095, 0.115, (lx, ly, z0 + 0.875), m['roof'], segs=10)
    cr = mat('pcrate', (0.46, 0.31, 0.16), (0.24, 0.15, 0.08), scale=22, bump=0.6)
    for (x, y, s_, r_) in ((0.80, 0.08, 0.15, 0.3), (0.96, 0.20, 0.13, -0.2), (0.62, 0.36, 0.14, 0.1), (0.84, 0.46, 0.13, 0.6)):
        crate(x, y, Z(x, y), s_, r_, cr)
    crate(0.80, 0.08, Z(0.80, 0.08) + 0.135, 0.10, 0.5, cr)
    for (x, y) in ((0.50, 0.20), (0.58, 0.14), (0.52, 0.52), (0.98, 0.58)):
        barrel(x, y, Z(x, y), cr, r=0.052)
    for (x, y) in ((1.10, 0.28), (1.06, -0.20), (0.96, 0.70)):
        cyl(0.028, 0.08, (x, y, Z(x, y)), m['stone'], segs=8)
    top = jetty(m, 0.0, 0.50, x0=0.98, wide=0.24)
    boat(m, (1.04, 0.54, -0.04), 0.0, 1.0)


BUILD = {'brick': port_brick, 'lumber': port_lumber, 'wool': port_wool, 'grain': port_grain, 'ore': port_ore, 'generic': port_generic}


# ------------------------------------------------------------------ render
RES = int(round(FRAME * PPU))
for spec in WHICH:
    name, _, kk = spec.partition(':')
    k = int(kk or 0)
    sc = reset()
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    sc.camera.data.ortho_scale = FRAME
    sc.cycles.samples = SAMPLES
    rnd = random.Random(sum(map(ord, name)))
    before = set(sc.objects)
    BUILD[name](M(), rnd)
    new = [o for o in sc.objects if o not in before and o.parent is None]
    root = bpy.data.objects.new('root', None)
    sc.collection.objects.link(root)
    root.rotation_euler = (0, 0, -math.radians(60 * k))   # plain board angles run clockwise on screen
    for o in new:
        o.parent = root
    sc.render.filepath = f'{OUT}/{name}_{k}.png'
    bpy.ops.render.render(write_still=True)
    print('RENDERED', name, k)
