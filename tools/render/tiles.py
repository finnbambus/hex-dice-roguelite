import bpy, bmesh, math, random, sys
from mathutils import Vector, noise, Matrix

OUT = sys.argv[sys.argv.index('--') + 1]
WHICH = sys.argv[sys.argv.index('--') + 2].split(',')
RES = int(sys.argv[sys.argv.index('--') + 3]) if len(sys.argv) > sys.argv.index('--') + 3 else 640
SAMPLES = 72
ELEV = math.radians(50)
BASE_H = 0.34


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 5
    sc.render.film_transparent = True
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    try:
        sc.view_settings.view_transform = 'AgX'
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except Exception as e:
        print('look', e)
    # camera
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = 2.6
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    d = Vector((0, -math.cos(ELEV), math.sin(ELEV)))
    co.location = d * 12
    co.rotation_euler = (math.pi / 2 - ELEV, 0, 0)
    sc.camera = co
    # world
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.20, 0.24, 0.34, 1)
    bg.inputs[1].default_value = 0.42
    # key sun: warm, from upper left front
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 3.4
    sun.angle = math.radians(6)
    sun.color = (1.0, 0.90, 0.76)
    so = bpy.data.objects.new('sun', sun)
    so.rotation_euler = (math.radians(52), math.radians(-8), math.radians(-48))
    sc.collection.objects.link(so)
    # cool rim from back right
    rim = bpy.data.lights.new('rim', 'SUN')
    rim.energy = 1.1
    rim.color = (0.55, 0.7, 1.0)
    ro = bpy.data.objects.new('rim', rim)
    ro.rotation_euler = (math.radians(65), 0, math.radians(140))
    sc.collection.objects.link(ro)
    return sc


def mat(name, c1, c2=None, rough=0.85, scale=8.0, bump=0.25, metallic=0.0, emit=None, detail=6.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metallic
    if c2 is None:
        c2 = tuple(x * 0.6 for x in c1)
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = 0.65
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.32
    ramp.color_ramp.elements[1].position = 0.72
    ramp.color_ramp.elements[0].color = (*c2, 1)
    ramp.color_ramp.elements[1].color = (*c1, 1)
    nt.links.new(n.outputs[0], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], b.inputs['Base Color'])
    if bump:
        n2 = nt.nodes.new('ShaderNodeTexNoise')
        n2.inputs['Scale'].default_value = scale * 5
        n2.inputs['Detail'].default_value = 8
        bp = nt.nodes.new('ShaderNodeBump')
        bp.inputs['Strength'].default_value = bump
        bp.inputs['Distance'].default_value = 0.02
        nt.links.new(n2.outputs[0], bp.inputs['Height'])
        nt.links.new(bp.outputs[0], b.inputs['Normal'])
    if emit:
        b.inputs['Emission Color'].default_value = (*emit[0], 1)
        b.inputs['Emission Strength'].default_value = emit[1]
    return m


def obj_from_bm(bm, name, material, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if material:
        me.materials.append(material)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return o


def hex_dist(x, y):
    """0 at center, 1 on the hex border (pointy-top, R=1)."""
    ax, ay = abs(x), abs(y)
    a = 0.8660254
    return max(ax / a, (ax * 0.5 + ay * a) / a)


def hex_corners(R=1.0, z=0.0):
    return [Vector((R * math.cos(math.radians(30 + 60 * i)), R * math.sin(math.radians(30 + 60 * i)), z)) for i in range(6)]


def base(side_mat, bottom_mat, R=1.0):
    """Side walls of the hex with soil strata."""
    bm = bmesh.new()
    rings = [(0.0, 1.0), (-0.07, 1.0), (-0.20, 0.985), (-BASE_H, 0.975)]
    vs = []
    for z, s in rings:
        vs.append([bm.verts.new(c * s + Vector((0, 0, z))) if False else bm.verts.new((c.x * s, c.y * s, z)) for c in hex_corners(R)])
    for k in range(len(rings) - 1):
        for i in range(6):
            bm.faces.new((vs[k][i], vs[k][(i + 1) % 6], vs[k + 1][(i + 1) % 6], vs[k + 1][i]))
    bm.faces.new(list(reversed(vs[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(bm, 'base', side_mat, smooth=False)
    return o


def top(material, height_fn, R=1.0, cuts=6, edge_keep=0.10):
    """Subdivided hex top displaced by height_fn(x,y)->z; border stays at 0."""
    bm = bmesh.new()
    c = bm.verts.new((0, 0, 0))
    cs = [bm.verts.new(v) for v in hex_corners(R)]
    for i in range(6):
        bm.faces.new((c, cs[i], cs[(i + 1) % 6]))
    for _ in range(cuts):
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
        bmesh.ops.triangulate(bm, faces=bm.faces[:]) if False else None
    for v in bm.verts:
        d = hex_dist(v.co.x, v.co.y)
        f = min(1.0, max(0.0, (1.0 - d) / edge_keep))
        f = f * f * (3 - 2 * f)
        v.co.z = height_fn(v.co.x, v.co.y) * f
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(bm, 'top', material)


def fbm(x, y, scale=1.0, oct=4, seed=0.0):
    v = 0
    a = 0.5
    f = scale
    for i in range(oct):
        v += a * noise.noise(Vector((x * f + seed, y * f - seed, seed * 0.37 + i)))
        a *= 0.5
        f *= 2
    return v


def cone(r, h, loc, material, segs=10, noise_amt=0.0, name='cone', rings=1, seed=0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=True, segments=segs, radius1=r, radius2=0.0, depth=h)
    if rings > 0 and noise_amt:
        for _ in range(rings):
            bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
        for v in bm.verts:
            n = noise.noise(v.co * 4.0 + Vector((seed, seed, seed)))
            t = 1 - (v.co.z + h / 2) / h
            v.co.x += n * noise_amt * t
            v.co.y += noise.noise(v.co * 4.0 + Vector((seed + 9, 3, 1))) * noise_amt * t
            v.co.z += noise.noise(v.co * 5.0 + Vector((1, seed + 4, 7))) * noise_amt * 0.5
    for v in bm.verts:
        v.co.z += h / 2
    o = obj_from_bm(bm, name, material, smooth=noise_amt == 0)
    o.location = loc
    return o


def box(size, loc, material, rot=0.0, name='box'):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= size[0]
        v.co.y *= size[1]
        v.co.z = (v.co.z + 0.5) * size[2]
    o = obj_from_bm(bm, name, material, smooth=False)
    o.location = loc
    o.rotation_euler = (0, 0, rot)
    return o


def cyl(r, h, loc, material, segs=14, r2=None, name='cyl', smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=h)
    for v in bm.verts:
        v.co.z += h / 2
    o = obj_from_bm(bm, name, material, smooth=False)
    if smooth:
        for p in o.data.polygons:
            p.use_smooth = abs(p.normal.z) < 0.9
    o.location = loc
    return o


def blob(r, loc, material, squash=(1, 1, 1), noise_amt=0.15, sub=2, seed=0, name='blob', smooth=True):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    for v in bm.verts:
        n = noise.noise(v.co * (2.2 / r) + Vector((seed, seed * 2, seed * 3)))
        v.co *= 1 + n * noise_amt
        v.co.x *= squash[0]
        v.co.y *= squash[1]
        v.co.z *= squash[2]
    o = obj_from_bm(bm, name, material, smooth=smooth)
    o.location = loc
    return o


def gable(w, d, h, roof_h, loc, wall_m, roof_m, rot=0.0):
    """House: walls + gable roof along x."""
    box((w, d, h), loc, wall_m, rot)
    bm = bmesh.new()
    ov = 1.12
    a = [(-w / 2 * ov, -d / 2 * ov, h), (w / 2 * ov, -d / 2 * ov, h), (w / 2 * ov, d / 2 * ov, h), (-w / 2 * ov, d / 2 * ov, h), (-w / 2 * ov, 0, h + roof_h), (w / 2 * ov, 0, h + roof_h)]
    v = [bm.verts.new(p) for p in a]
    bm.faces.new((v[0], v[1], v[5], v[4]))
    bm.faces.new((v[2], v[3], v[4], v[5]))
    bm.faces.new((v[1], v[2], v[5]))
    bm.faces.new((v[3], v[0], v[4]))
    bm.faces.new((v[3], v[2], v[1], v[0]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(bm, 'roof', roof_m, smooth=False)
    o.location = loc
    o.rotation_euler = (0, 0, rot)
    return o


def scatter(n, rmax, rnd, min_d=0.0, avoid=()):
    pts = []
    tries = 0
    while len(pts) < n and tries < n * 80:
        tries += 1
        x, y = rnd.uniform(-1, 1), rnd.uniform(-1, 1)
        if hex_dist(x, y) > rmax:
            continue
        if any((x - a[0]) ** 2 + (y - a[1]) ** 2 < a[2] ** 2 for a in avoid):
            continue
        if any((x - p[0]) ** 2 + (y - p[1]) ** 2 < min_d ** 2 for p in pts):
            continue
        pts.append((x, y))
    return pts


# ---------- shared materials
def M():
    d = {}
    d['soil'] = mat('soil', (0.16, 0.10, 0.06), (0.06, 0.04, 0.03), scale=14, bump=0.6)
    d['stone'] = mat('stone', (0.30, 0.30, 0.32), (0.12, 0.12, 0.14), scale=9, bump=0.7)
    d['trunk'] = mat('trunk', (0.12, 0.07, 0.04), scale=20)
    d['wood'] = mat('wood', (0.32, 0.20, 0.11), (0.17, 0.10, 0.05), scale=18, bump=0.4)
    d['plaster'] = mat('plaster', (0.78, 0.72, 0.60), (0.55, 0.50, 0.42), scale=14, bump=0.3)
    d['roof'] = mat('roof', (0.14, 0.15, 0.19), (0.07, 0.07, 0.10), scale=22, bump=0.5)
    d['glow'] = mat('glow', (1, 0.6, 0.2), emit=((1.0, 0.55, 0.18), 9.0), bump=0)
    return d


def tree_conifer(x, y, z, s, m_leaf, m_trunk, rnd):
    cyl(0.018 * s, 0.10 * s, (x, y, z), m_trunk, segs=6)
    h0 = 0.07 * s
    for i, (r, h) in enumerate(((0.105, 0.20), (0.082, 0.18), (0.058, 0.17))):
        cone(r * s, h * s, (x, y, z + h0), m_leaf, segs=9, noise_amt=0.012 * s, rings=1, seed=rnd.random() * 50)
        h0 += h * s * 0.52


def tree_round(x, y, z, s, m_leaf, m_trunk, rnd):
    cyl(0.016 * s, 0.11 * s, (x, y, z), m_trunk, segs=6)
    blob(0.085 * s, (x, y, z + 0.16 * s), m_leaf, squash=(1, 1, 0.9), noise_amt=0.28, seed=rnd.random() * 50)
    blob(0.055 * s, (x + 0.05 * s, y - 0.02 * s, z + 0.12 * s), m_leaf, noise_amt=0.28, seed=rnd.random() * 50)


# ---------- tiles
def t_forest(m, rnd):
    g = mat('fground', (0.07, 0.13, 0.05), (0.05, 0.06, 0.03), scale=7, bump=0.5)
    hf = lambda x, y: 0.05 + 0.10 * fbm(x, y, 1.6, 4, 3.1)
    base(m['soil'], m['soil']); top(g, hf)
    leaf1 = mat('leaf1', (0.05, 0.16, 0.07), (0.02, 0.07, 0.04), scale=30, bump=0.5)
    leaf2 = mat('leaf2', (0.09, 0.20, 0.06), (0.04, 0.09, 0.03), scale=30, bump=0.5)
    leaf3 = mat('leaf3', (0.22, 0.24, 0.06), (0.10, 0.12, 0.03), scale=30, bump=0.5)
    clearing = (0.18, -0.38, 0.22)
    for (x, y) in sorted(scatter(46, 0.88, rnd, 0.14, avoid=(clearing,)), key=lambda p: -p[1]):
        s = rnd.uniform(0.95, 1.75)
        z = hf(x, y) * min(1, (1 - hex_dist(x, y)) / 0.1) - 0.01
        if rnd.random() < 0.8:
            tree_conifer(x, y, z, s, rnd.choice((leaf1, leaf1, leaf2)), m['trunk'], rnd)
        else:
            tree_round(x, y, z, s * 1.2, rnd.choice((leaf2, leaf3)), m['trunk'], rnd)
    # woodcutter's hut + log pile in the clearing
    cx, cy = clearing[0], clearing[1]
    gable(0.15, 0.11, 0.07, 0.06, (cx, cy, hf(cx, cy)), m['wood'], m['roof'], rot=0.5)
    for i in range(3):
        o = cyl(0.014, 0.12, (cx - 0.17 + 0.0, cy - 0.06 + i * 0.03, hf(cx, cy) + 0.02), m['wood'], segs=6)
        o.rotation_euler = (0, math.pi / 2, 0.3)
    box((0.02, 0.008, 0.03), (cx + 0.02, cy - 0.065, hf(cx, cy) + 0.015), m['glow'], rot=0.5)


def t_pasture(m, rnd):
    g = mat('grass', (0.13, 0.25, 0.07), (0.06, 0.13, 0.04), scale=9, bump=0.6)
    hf = lambda x, y: 0.07 + 0.16 * fbm(x, y, 1.1, 3, 7.7)
    base(m['soil'], m['soil']); top(g, hf)
    wool = mat('wool', (0.86, 0.84, 0.78), (0.60, 0.58, 0.52), scale=40, bump=0.8)
    dark = mat('sheephead', (0.05, 0.045, 0.04), bump=0)
    Z = lambda x, y: hf(x, y) * min(1, (1 - hex_dist(x, y)) / 0.1)
    for (x, y) in scatter(9, 0.72, rnd, 0.2, avoid=((-0.42, 0.35, 0.3),)):
        a = rnd.uniform(0, 6.28)
        z = Z(x, y)
        s = rnd.uniform(0.9, 1.15)
        blob(0.05 * s, (x, y, z + 0.055 * s), wool, squash=(1.35, 0.95, 0.9), noise_amt=0.22, seed=rnd.random() * 40).rotation_euler = (0, 0, a)
        hx, hy = x + math.cos(a) * 0.07 * s, y + math.sin(a) * 0.07 * s
        blob(0.022 * s, (hx, hy, z + 0.055 * s), dark, squash=(1.2, 0.9, 1), noise_amt=0.0, sub=1).rotation_euler = (0, 0, a)
        for dx, dy in ((0.03, 0.02), (0.03, -0.02), (-0.03, 0.02), (-0.03, -0.02)):
            px = x + (dx * math.cos(a) - dy * math.sin(a)) * s
            py = y + (dx * math.sin(a) + dy * math.cos(a)) * s
            cyl(0.006, 0.035, (px, py, z), dark, segs=5)
    # fence arc
    for i in range(11):
        a = math.radians(95 + i * 13)
        x, y = -0.42 + math.cos(a) * 0.30, 0.35 + math.sin(a) * 0.30
        if hex_dist(x, y) > 0.9:
            continue
        z = Z(x, y)
        box((0.014, 0.014, 0.07), (x, y, z), m['wood'])
        a2 = math.radians(95 + (i + 1) * 13)
        x2, y2 = -0.42 + math.cos(a2) * 0.30, 0.35 + math.sin(a2) * 0.30
        if i < 10 and hex_dist(x2, y2) < 0.9:
            for hz in (0.03, 0.055):
                r = box((math.hypot(x2 - x, y2 - y), 0.008, 0.01), ((x + x2) / 2, (y + y2) / 2, (z + Z(x2, y2)) / 2 + hz), m['wood'], rot=math.atan2(y2 - y, x2 - x))
    tuft = mat('tuft', (0.16, 0.30, 0.08), (0.08, 0.16, 0.04), scale=40, bump=0.5)
    for (x, y) in scatter(160, 0.93, rnd, 0.05):
        cone(rnd.uniform(0.012, 0.022), rnd.uniform(0.025, 0.05), (x, y, Z(x, y) - 0.004), tuft, segs=5)
    # shepherd's hut, tree, rocks
    gable(0.16, 0.12, 0.07, 0.07, (-0.42, 0.36, Z(-0.42, 0.36)), m['plaster'], m['roof'], rot=-0.3)
    leaf = mat('leafp', (0.12, 0.26, 0.07), (0.05, 0.12, 0.03), scale=30, bump=0.5)
    tree_round(0.52, 0.30, Z(0.52, 0.30), 2.2, leaf, m['trunk'], rnd)
    tree_round(-0.1, 0.66, Z(-0.1, 0.66), 1.6, leaf, m['trunk'], rnd)
    for (x, y) in scatter(7, 0.85, rnd, 0.2):
        blob(rnd.uniform(0.02, 0.045), (x, y, Z(x, y)), m['stone'], squash=(1, 1, 0.6), noise_amt=0.3, sub=1, seed=rnd.random() * 9, smooth=False)


def t_fields(m, rnd):
    wheat = mat('wheat', (0.72, 0.50, 0.12), (0.42, 0.27, 0.06), scale=26, bump=0.9)
    ang = 0.5
    def hf(x, y):
        u = x * math.cos(ang) + y * math.sin(ang)
        v = -x * math.sin(ang) + y * math.cos(ang)
        plot = math.floor((v + 2) * 2.3)
        ridge = 0.5 + 0.5 * math.sin(u * 62 if plot % 2 else v * 62)
        hgt = (0.075 if plot % 3 else 0.03) + 0.03 * ridge
        if abs(((v + 2) * 2.3) % 1.0 - 0.5) > 0.44:
            hgt = 0.012
        return hgt + 0.03 * fbm(x, y, 1.2, 2, 2.0)
    base(m['soil'], m['soil'])
    t = top(wheat, hf, cuts=7, edge_keep=0.05)
    # colour by height: paths dark, stubble pale
    path = mat('path', (0.20, 0.13, 0.07), scale=20, bump=0.6)
    stub = mat('stub', (0.50, 0.44, 0.20), (0.33, 0.28, 0.12), scale=30, bump=0.8)
    t.data.materials.append(path); t.data.materials.append(stub)
    for p in t.data.polygons:
        zs = [t.data.vertices[i].co.z for i in p.vertices]
        z = sum(zs) / len(zs)
        p.use_smooth = False
        if z < 0.03:
            p.material_index = 1
        elif z < 0.062:
            p.material_index = 2
    # windmill
    wx, wy = 0.30, 0.28
    cyl(0.085, 0.30, (wx, wy, 0.02), m['plaster'], segs=10, r2=0.06)
    cone(0.085, 0.10, (wx, wy, 0.32), m['roof'], segs=10)
    hub = Vector((wx - 0.05, wy - 0.075, 0.33))
    for k in range(4):
        a = math.radians(20 + 90 * k)
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= 0.05; v.co.y *= 0.006; v.co.z = (v.co.z + 0.5) * 0.24
        o = obj_from_bm(bm, 'blade', m['wood'], smooth=False)
        o.location = hub
        o.rotation_euler = (0, a, math.radians(33))
    box((0.03, 0.008, 0.045), (wx - 0.045, wy - 0.07, 0.1), m['glow'], rot=math.radians(33))
    # hay stacks, barn
    hay = mat('hay', (0.66, 0.50, 0.18), (0.40, 0.28, 0.08), scale=50, bump=0.9)
    for (x, y) in ((-0.48, -0.30), (-0.38, -0.36), (-0.52, -0.42)):
        cyl(0.045, 0.05, (x, y, 0.03), hay, segs=9, r2=0.035)
        cone(0.045, 0.045, (x, y, 0.08), hay, segs=9)
    gable(0.2, 0.13, 0.08, 0.07, (-0.30, 0.55, 0.03), m['wood'], m['roof'], rot=ang)
    leaf = mat('leaff', (0.14, 0.24, 0.06), (0.06, 0.12, 0.03), scale=30, bump=0.5)
    tree_round(0.62, -0.12, 0.02, 1.7, leaf, m['trunk'], rnd)
    tree_round(-0.62, 0.22, 0.02, 1.5, leaf, m['trunk'], rnd)


def t_hills(m, rnd):
    clay = mat('clay', (0.48, 0.18, 0.08), (0.26, 0.09, 0.05), scale=6, bump=0.6)
    def hf(x, y):
        h = 0.20 + 0.42 * fbm(x * 1.0 + 0.3, y, 1.3, 4, 5.5)
        h = max(h, 0.02)
        return round(h / 0.07) * 0.07 * 0.75 + h * 0.25  # terraces
    base(m['soil'], m['soil'])
    t = top(clay, hf, cuts=7)
    grass = mat('hgrass', (0.22, 0.26, 0.08), (0.12, 0.14, 0.05), scale=9, bump=0.4)
    t.data.materials.append(grass)
    for p in t.data.polygons:
        z = sum(t.data.vertices[i].co.z for i in p.vertices) / len(p.vertices)
        if p.normal.z > 0.93 and z > 0.20:
            p.material_index = 1
        p.use_smooth = False
    Z = lambda x, y: hf(x, y) * min(1, (1 - hex_dist(x, y)) / 0.1)
    # brick kiln with glowing mouth + chimney
    kx, ky = -0.12, -0.42
    z = Z(kx, ky)
    brick = mat('brick', (0.50, 0.17, 0.09), (0.28, 0.08, 0.05), scale=40, bump=1.0)
    cyl(0.11, 0.12, (kx, ky, z - 0.01), brick, segs=10, r2=0.08)
    cyl(0.035, 0.16, (kx + 0.03, ky + 0.03, z + 0.08), brick, segs=8, r2=0.028)
    box((0.05, 0.02, 0.045), (kx - 0.02, ky - 0.095, z), m['glow'], rot=0.2)
    # stacked bricks
    for i in range(4):
        for j in range(2):
            box((0.05, 0.03, 0.02), (kx + 0.20 + j * 0.055, ky - 0.02, Z(kx + 0.2, ky - 0.02) + i * 0.021), brick, rot=0.1)
    leaf = mat('leafh', (0.16, 0.22, 0.06), (0.07, 0.11, 0.03), scale=30, bump=0.5)
    for (x, y) in scatter(9, 0.85, rnd, 0.22, avoid=((kx, ky, 0.3),)):
        if rnd.random() < 0.6:
            blob(rnd.uniform(0.035, 0.06), (x, y, Z(x, y) + 0.02), leaf, squash=(1, 1, 0.7), noise_amt=0.3, seed=rnd.random() * 9)
        else:
            tree_conifer(x, y, Z(x, y), rnd.uniform(0.9, 1.3), leaf, m['trunk'], rnd)


def t_mountains(m, rnd):
    rock = mat('rock', (0.30, 0.31, 0.34), (0.11, 0.12, 0.15), scale=5, bump=0.9)
    snow = mat('snow', (0.90, 0.92, 0.96), (0.70, 0.74, 0.82), scale=10, bump=0.2, rough=0.6)
    scree = mat('scree', (0.20, 0.21, 0.22), (0.10, 0.10, 0.11), scale=12, bump=0.8)
    peaks = ((0.05, 0.22, 0.98, 0.50), (-0.42, -0.02, 0.66, 0.36), (0.44, -0.10, 0.60, 0.34), (-0.08, -0.40, 0.36, 0.28), (0.38, 0.48, 0.5, 0.3))
    def hf(x, y):
        h = 0.05
        for (px, py, ph, pr) in peaks:
            d = math.hypot(x - px, y - py) / pr
            h = max(h, ph * max(0, 1 - d) ** 1.25)
        ridge = 1 - abs(fbm(x, y, 2.6, 4, 9.1)) * 2.2
        h = h * (0.55 + 0.55 * ridge) + 0.06 * abs(fbm(x, y, 7.0, 3, 4.0)) + 0.04 * fbm(x, y, 14.0, 2, 2.0) * (0.3 + h)
        return max(h, 0.02)
    base(m['stone'], m['stone'])
    t = top(rock, hf, cuts=8, edge_keep=0.07)
    t.data.materials.append(snow); t.data.materials.append(scree)
    for p in t.data.polygons:
        z = sum(t.data.vertices[i].co.z for i in p.vertices) / len(p.vertices)
        c = p.center
        p.use_smooth = False
        if z > 0.46 + 0.10 * noise.noise(Vector((c.x * 6, c.y * 6, 1))) and p.normal.z > 0.45:
            p.material_index = 1
        elif z < 0.10:
            p.material_index = 2
    Z = lambda x, y: hf(x, y) * min(1, (1 - hex_dist(x, y)) / 0.07)
    # mine entrance with lantern glow
    mx, my = 0.12, -0.62
    z = Z(mx, my)
    box((0.02, 0.03, 0.10), (mx - 0.055, my, z - 0.01), m['wood'])
    box((0.02, 0.03, 0.10), (mx + 0.055, my, z - 0.01), m['wood'])
    box((0.15, 0.035, 0.02), (mx, my, z + 0.085), m['wood'])
    blackm = mat('black', (0.005, 0.005, 0.005), bump=0)
    box((0.10, 0.02, 0.085), (mx, my + 0.012, z), blackm)
    blob(0.012, (mx + 0.075, my - 0.02, z + 0.075), m['glow'], noise_amt=0, sub=1)
    # ore cart rails + boulders
    ore = mat('ore', (0.42, 0.46, 0.55), (0.16, 0.18, 0.24), scale=20, rough=0.35, metallic=0.8, bump=0.8)
    for (x, y) in scatter(12, 0.88, rnd, 0.13):
        if Z(x, y) < 0.16:
            blob(rnd.uniform(0.025, 0.06), (x, y, Z(x, y) + 0.01), rnd.choice((m['stone'], ore, m['stone'])), squash=(1, 1, 0.7), noise_amt=0.35, sub=1, seed=rnd.random() * 9, smooth=False)
    leaf = mat('leafm', (0.05, 0.13, 0.07), (0.02, 0.06, 0.04), scale=30, bump=0.5)
    for (x, y) in scatter(14, 0.9, rnd, 0.1):
        if Z(x, y) < 0.13:
            tree_conifer(x, y, Z(x, y), rnd.uniform(0.7, 1.1), leaf, m['trunk'], rnd)


def t_desert(m, rnd):
    sand = mat('sand', (0.40, 0.28, 0.15), (0.25, 0.16, 0.08), scale=4, bump=0.5, rough=0.95)
    def hf(x, y):
        d = 0.5 + 0.5 * math.sin(x * 5.5 + y * 2.2 + 2.2 * fbm(x, y, 1.2, 2, 1.0))
        return 0.04 + 0.13 * d ** 1.6 + 0.08 * fbm(x, y, 1.0, 2, 8.0)
    base(m['soil'], m['soil'])
    t = top(sand, hf, cuts=7)
    Z = lambda x, y: hf(x, y) * min(1, (1 - hex_dist(x, y)) / 0.1)
    sandstone = mat('sandstone', (0.36, 0.25, 0.15), (0.18, 0.12, 0.07), scale=10, bump=0.9)
    # ruined tower + broken columns
    rx, ry = -0.22, 0.20
    z = Z(rx, ry) - 0.02
    cyl(0.12, 0.26, (rx, ry, z), sandstone, segs=9, r2=0.105, smooth=False)
    box((0.09, 0.09, 0.10), (rx + 0.05, ry + 0.02, z + 0.24), sandstone, rot=0.4)
    box((0.05, 0.05, 0.05), (rx - 0.06, ry - 0.03, z + 0.25), sandstone, rot=0.9)
    for i, (x, y, h) in enumerate(((0.12, 0.06, 0.16), (0.24, -0.02, 0.07), (0.02, -0.08, 0.11))):
        cyl(0.025, h, (x, y, Z(x, y) - 0.01), sandstone, segs=8, smooth=False)
    o = cyl(0.025, 0.14, (0.3, -0.16, Z(0.3, -0.16) + 0.02), sandstone, segs=8, smooth=False)
    o.rotation_euler = (math.pi / 2, 0, 0.7)
    # dead tree
    dx, dy = 0.46, 0.30
    dz = Z(dx, dy)
    cyl(0.016, 0.18, (dx, dy, dz), m['trunk'], segs=6, r2=0.008)
    for a, tz in ((0.6, 0.11), (-0.9, 0.14), (2.4, 0.09)):
        b = cyl(0.007, 0.10, (dx, dy, dz + tz), m['trunk'], segs=5, r2=0.003)
        b.rotation_euler = (0.9, 0, a)
    bone = mat('bone', (0.8, 0.76, 0.66), bump=0.2)
    for (x, y) in scatter(14, 0.85, rnd, 0.12, avoid=((rx, ry, 0.2),)):
        k = rnd.random()
        if k < 0.6:
            blob(rnd.uniform(0.02, 0.06), (x, y, Z(x, y)), sandstone, squash=(1, 1, 0.6), noise_amt=0.35, sub=1, seed=rnd.random() * 9, smooth=False)
        elif k < 0.75:
            b = cyl(0.006, 0.07, (x, y, Z(x, y) + 0.008), bone, segs=5)
            b.rotation_euler = (math.pi / 2, 0, rnd.uniform(0, 3))
        else:
            sc = mat('scrub', (0.24, 0.26, 0.12), bump=0.4)
            blob(0.03, (x, y, Z(x, y) + 0.01), sc, squash=(1, 1, 0.6), noise_amt=0.5, sub=1, seed=rnd.random() * 9, smooth=False)


def t_sea(m, rnd, plain=False):
    bedm = mat('seabed', (0.03, 0.07, 0.09), (0.01, 0.03, 0.05), scale=6, bump=0.4)
    base(bedm, bedm)
    water = bpy.data.materials.new('water')
    water.use_nodes = True
    nt = water.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.012, 0.085, 0.13, 1)
    b.inputs['Roughness'].default_value = 0.12
    b.inputs['Metallic'].default_value = 0.0
    try:
        b.inputs['Coat Weight'].default_value = 0.6
    except Exception:
        pass
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 26; n.inputs['Detail'].default_value = 4
    bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.35; bp.inputs['Distance'].default_value = 0.02
    nt.links.new(n.outputs[0], bp.inputs['Height']); nt.links.new(bp.outputs[0], b.inputs['Normal'])
    def hf(x, y):
        return -0.02 + 0.035 * math.sin(x * 9 + y * 5 + 3 * fbm(x, y, 1.5, 2, 3.0)) + 0.03 * fbm(x, y, 4, 3, 6.0)
    top(water, hf, cuts=7, edge_keep=0.03)
    if plain:
        return
    foam = mat('foam', (0.85, 0.92, 0.95), bump=0.3, rough=0.5)
    # small rock stack with foam ring + a fishing boat
    rx, ry = -0.38, 0.30
    blob(0.11, (rx, ry, 0.02), m['stone'], squash=(1, 0.9, 0.9), noise_amt=0.4, sub=2, seed=3, smooth=False)
    blob(0.06, (rx + 0.13, ry - 0.06, 0.0), m['stone'], squash=(1, 1, 0.8), noise_amt=0.4, sub=1, seed=5, smooth=False)
    cyl(0.16, 0.012, (rx + 0.02, ry - 0.01, -0.012), foam, segs=18)
    bx, by = 0.28, -0.22
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= 0.20 if v.co.z > 0 else 0.13
        v.co.y *= 0.075 if v.co.z > 0 else 0.04
        v.co.z = (v.co.z + 0.5) * 0.045
    hull = obj_from_bm(bm, 'hull', m['wood'], smooth=False)
    hull.location = (bx, by, 0.0); hull.rotation_euler = (0, 0, 0.5)
    cyl(0.006, 0.20, (bx, by, 0.04), m['wood'], segs=5)
    sail = mat('sail', (0.80, 0.74, 0.62), (0.6, 0.55, 0.45), scale=30, bump=0.4)
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in ((0, 0, 0.07), (0.11, 0, 0.08), (0.0, 0, 0.23))]
    bm.faces.new(vs)
    s = obj_from_bm(bm, 'sail', sail, smooth=False)
    s.location = (bx, by, 0.0); s.rotation_euler = (0, 0, 0.5)
    mod = s.modifiers.new('sol', 'SOLIDIFY'); mod.thickness = 0.004


# ---------- pieces (rendered alone, same camera)
def p_settlement(m, rnd):
    gable(0.26, 0.20, 0.15, 0.12, (0, 0, 0), m['plaster'], m['roof'], rot=0.35)
    box((0.045, 0.012, 0.07), (-0.02, -0.108, 0.0), m['wood'], rot=0.35)
    box((0.04, 0.012, 0.04), (0.075, -0.075, 0.06), m['glow'], rot=0.35)
    cyl(0.02, 0.10, (0.06, 0.05, 0.16), m['stone'], segs=6)


def p_city(m, rnd):
    gable(0.34, 0.22, 0.18, 0.13, (0.06, -0.02, 0), m['plaster'], m['roof'], rot=0.2)
    cyl(0.11, 0.42, (-0.16, 0.06, 0), m['stone'], segs=10, r2=0.10)
    cone(0.13, 0.20, (-0.16, 0.06, 0.42), m['roof'], segs=10)
    for dx in (-0.02, 0.10, 0.2):
        box((0.035, 0.012, 0.05), (0.06 + dx - 0.02, -0.125 + dx * 0.2, 0.07), m['glow'], rot=0.2)
    box((0.03, 0.012, 0.05), (-0.16, -0.045, 0.26), m['glow'])
    box((0.05, 0.012, 0.08), (0.0, -0.137, 0.0), m['wood'], rot=0.2)


def p_road(m, rnd, ang=0.0):
    r = box((0.62, 0.11, 0.035), (0, 0, 0), m['stone'], rot=ang)
    cob = mat('cobble', (0.42, 0.40, 0.36), (0.16, 0.15, 0.14), scale=36, bump=1.0)
    r.data.materials.clear(); r.data.materials.append(cob)


def p_robber(m, rnd):
    cloak = mat('cloak', (0.10, 0.09, 0.13), (0.04, 0.035, 0.06), scale=16, bump=0.6, rough=0.6)
    cone(0.16, 0.50, (0, 0, 0), cloak, segs=14, noise_amt=0.02, rings=2, seed=2)
    blob(0.105, (0, -0.01, 0.46), cloak, squash=(1, 1.05, 1.1), noise_amt=0.08, seed=4)
    blob(0.05, (0, -0.085, 0.45), mat('void', (0, 0, 0), bump=0), squash=(1, 0.5, 1.2), noise_amt=0, sub=2)
    for dx in (-0.022, 0.022):
        blob(0.009, (dx, -0.105, 0.46), mat('eye', (1, 0.3, 0.1), emit=((1.0, 0.25, 0.08), 14), bump=0), noise_amt=0, sub=1)


def die(loc, rot, m_body, m_pip, s=0.36):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=s)
    bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=s * 0.09, segments=4, affect='EDGES', profile=0.5)
    o = obj_from_bm(bm, 'die', m_body)
    for p in o.data.polygons:
        p.use_smooth = True
    try:
        o.data.use_auto_smooth = True
    except Exception:
        pass
    faces = {(0, 0, 1): 5, (0, -1, 0): 3, (1, 0, 0): 6, (-1, 0, 0): 1, (0, 1, 0): 4, (0, 0, -1): 2}
    lay = {1: [(0, 0)], 2: [(-1, -1), (1, 1)], 3: [(-1, -1), (0, 0), (1, 1)], 4: [(-1, -1), (1, 1), (-1, 1), (1, -1)], 5: [(-1, -1), (1, 1), (-1, 1), (1, -1), (0, 0)], 6: [(-1, -1), (1, 1), (-1, 1), (1, -1), (-1, 0), (1, 0)]}
    root = bpy.data.objects.new('dieroot', None)
    bpy.context.scene.collection.objects.link(root)
    o.parent = root
    for nrm, val in faces.items():
        n = Vector(nrm)
        u = Vector((0, 0, 1)) if abs(n.z) < 0.5 else Vector((1, 0, 0))
        v = n.cross(u)
        for (a, b) in lay[val]:
            p = n * (s / 2 - 0.004) + u * a * s * 0.25 + v * b * s * 0.25
            pip = blob(s * 0.085, p, m_pip, squash=(1, 1, 1), noise_amt=0, sub=2)
            pip.scale = Vector((1, 1, 1)) - Vector((abs(n.x), abs(n.y), abs(n.z))) * 0.75
            pip.parent = root
    root.location = loc
    root.rotation_euler = rot
    return root


def p_dice(m, rnd):
    bone = mat('dbone', (0.80, 0.76, 0.66), (0.62, 0.57, 0.47), scale=5, bump=0.1, rough=0.35)
    pip = mat('pip', (0.02, 0.02, 0.025), bump=0, rough=0.4)
    die((-0.30, 0.02, 0.18), (0, 0, 0.5), bone, pip)
    die((0.30, -0.10, 0.18), (math.pi / 2, 0, -0.35), bone, pip)


def p_die1(m, rnd):
    bone = mat('dbone', (0.80, 0.76, 0.66), (0.62, 0.57, 0.47), scale=5, bump=0.1, rough=0.35)
    pip = mat('pip', (0.02, 0.02, 0.025), bump=0, rough=0.4)
    die((0, 0, 0.30), (0, 0, 0.6), bone, pip, s=0.6)


def p_die_dark(m, rnd):
    body = mat('dobs', (0.03, 0.03, 0.04), (0.015, 0.015, 0.02), scale=5, bump=0.1, rough=0.22)
    pip = mat('pipg', (1, 0.3, 0.1), emit=((1.0, 0.3, 0.08), 6), bump=0)
    die((0, 0, 0.30), (0, 0, 0.6), body, pip, s=0.6)


def p_ship(m, rnd):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= 0.62 if v.co.z > 0 else 0.40
        v.co.y *= 0.22 if v.co.z > 0 else 0.10
        v.co.z = (v.co.z + 0.5) * 0.14
    hull = obj_from_bm(bm, 'hull', m['wood'], smooth=False)
    hull.rotation_euler = (0, 0, 0.45)
    cyl(0.014, 0.62, (0, 0, 0.12), m['wood'], segs=6)
    sail = mat('sail', (0.80, 0.74, 0.62), (0.6, 0.55, 0.45), scale=30, bump=0.4)
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in ((-0.19, 0, 0.30), (0.19, 0, 0.30), (0.16, -0.05, 0.66), (-0.16, -0.05, 0.66))]
    bm.faces.new(vs)
    s = obj_from_bm(bm, 'sail', sail, smooth=False)
    s.rotation_euler = (0, 0, 0.45 + math.pi / 2)
    mod = s.modifiers.new('sol', 'SOLIDIFY'); mod.thickness = 0.008
    box((0.42, 0.012, 0.012), (0, 0, 0.66), m['wood'], rot=0.45 + math.pi / 2)



# ---------- resource hero objects for card art
def yaw_all(a):
    e = bpy.data.objects.new('yaw', None)
    bpy.context.scene.collection.objects.link(e)
    for o in [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.parent is None]:
        o.parent = e
    e.rotation_euler = (0, 0, a)


def r_brick(m, rnd):
    brick = mat('brickh', (0.55, 0.19, 0.10), (0.30, 0.09, 0.05), scale=30, bump=1.0)
    for (x, y, z, r) in ((-0.24, 0, 0, 0.03), (0.24, 0, 0, -0.04), (0.0, 0.0, 0.21, 0.02), (0.05, -0.36, 0, 0.5)):
        box((0.44, 0.24, 0.20), (x, y, z), brick, rot=r)
    yaw_all(0.6)


def r_lumber(m, rnd):
    bark = mat('bark', (0.24, 0.14, 0.07), (0.10, 0.06, 0.03), scale=26, bump=1.0)
    cut = mat('cut', (0.78, 0.60, 0.36), (0.52, 0.38, 0.20), scale=60, bump=0.3)
    for (y, z) in ((-0.15, 0.14), (0.15, 0.14), (0.0, 0.39)):
        o = cyl(0.14, 0.86, (-0.43, y, z), bark, segs=14)
        o.rotation_euler = (0, math.pi / 2, 0)
        for xe in (-0.436, 0.43):
            c = cyl(0.115, 0.008, (xe, y, z), cut, segs=14)
            c.rotation_euler = (0, math.pi / 2, 0)
    yaw_all(0.95)


def r_wool(m, rnd):
    wool = mat('woolh', (0.88, 0.86, 0.80), (0.58, 0.56, 0.50), scale=22, bump=1.0)
    dark = mat('sheepd', (0.06, 0.05, 0.045), bump=0.2)
    blob(0.30, (0, 0, 0.42), wool, squash=(1.35, 0.95, 0.92), noise_amt=0.20, sub=3, seed=4)
    for (x, y) in ((0.2, 0.12), (0.2, -0.12), (-0.22, 0.12), (-0.22, -0.12)):
        cyl(0.035, 0.24, (x, y, 0.0), dark, segs=8)
    blob(0.13, (0.44, 0, 0.52), dark, squash=(1.25, 0.85, 1.0), noise_amt=0.03, sub=3)
    for y in (-0.11, 0.11):
        blob(0.05, (0.38, y, 0.60), dark, squash=(0.6, 1.3, 0.5), noise_amt=0, sub=2)
    blob(0.10, (0.36, 0, 0.66), wool, squash=(1, 1, 0.7), noise_amt=0.25, sub=2, seed=9)
    for o in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
        o.location = Matrix.Rotation(-0.5, 4, 'Z') @ o.location
        o.rotation_euler.z += -0.5


def r_grain(m, rnd):
    straw = mat('straw', (0.78, 0.58, 0.18), (0.50, 0.34, 0.08), scale=40, bump=0.6)
    ear = mat('ear', (0.86, 0.66, 0.22), (0.56, 0.38, 0.10), scale=60, bump=1.0)
    for i in range(46):
        a = rnd.uniform(0, 6.283); rr = rnd.uniform(0, 0.07)
        bx, by = math.cos(a) * rr, math.sin(a) * rr
        tilt = rnd.uniform(0.05, 0.42) * (0.4 + rr / 0.07)
        ta = a + rnd.uniform(-0.6, 0.6)
        L = rnd.uniform(0.62, 0.80)
        tx, ty = -math.sin(ta) * tilt, math.cos(ta) * tilt
        o = cyl(0.007, L, (bx, by, 0), straw, segs=5)
        o.rotation_euler = (tx, ty, 0)
        tip = o.rotation_euler.to_matrix() @ Vector((0, 0, L))
        e = blob(0.03, (bx + tip.x, by + tip.y, tip.z), ear, squash=(0.55, 0.55, 2.6), noise_amt=0.35, sub=2, seed=rnd.random() * 30)
        e.rotation_euler = (tx, ty, 0)
    cyl(0.085, 0.05, (0, 0, 0.30), mat('band', (0.40, 0.24, 0.10), bump=0.5), segs=14)


def r_ore(m, rnd):
    ore = mat('oreh', (0.46, 0.50, 0.60), (0.14, 0.16, 0.22), scale=9, rough=0.3, metallic=0.85, bump=0.9)
    for (x, y, r, sd) in ((0, 0.02, 0.30, 1), (-0.34, -0.08, 0.19, 2), (0.33, -0.12, 0.21, 3), (0.12, -0.3, 0.14, 4), (-0.14, 0.3, 0.16, 5)):
        blob(r, (x, y, r * 0.62), rnd.choice((ore, ore, m['stone'])) if sd > 1 else ore, squash=(1, 0.9, 0.85), noise_amt=0.42, sub=2, seed=sd * 3.1, smooth=False)


def stick(p0, p1, r, material, segs=5, r2=None):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=d.length)
    o = obj_from_bm(bm, 'stick', material, smooth=True)
    o.location = (p0 + p1) / 2
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return o


def r_brick(m, rnd):
    brick = mat('brick', (0.52, 0.17, 0.09), (0.30, 0.09, 0.05), scale=30, bump=1.0)
    rot = 0.45
    c, s_ = math.cos(rot), math.sin(rot)
    def put(x, y, z, jit):
        o = box((0.26, 0.125, 0.08), (x * c - y * s_, x * s_ + y * c, z), brick, rot + jit)
        mod = o.modifiers.new('bev', 'BEVEL'); mod.width = 0.008; mod.segments = 2
    for row, n in enumerate((3, 2, 1)):
        for i in range(n):
            x = (i - (n - 1) / 2) * 0.28
            for y in ((-0.07, 0.07) if row < 2 else (0.0,)):
                put(x, y + (0.0 if row != 1 else 0.0), row * 0.084, rnd.uniform(-0.05, 0.05))


def r_lumber(m, rnd):
    bark = mat('bark', (0.20, 0.12, 0.06), (0.09, 0.05, 0.03), scale=24, bump=1.0)
    cut = mat('cut', (0.74, 0.58, 0.36), (0.55, 0.40, 0.22), scale=60, bump=0.4)
    rot = 0.5
    ax = Vector((math.cos(rot), math.sin(rot), 0))
    side = Vector((-math.sin(rot), math.cos(rot), 0))
    R = 0.085
    for row, n in enumerate((3, 2, 1)):
        for i in range(n):
            off = side * ((i - (n - 1) / 2) * R * 2.02) + Vector((0, 0, R + row * R * 1.74)) + ax * rnd.uniform(-0.04, 0.04)
            stick(off - ax * 0.30, off + ax * 0.30, R, bark, segs=14)
            stick(off - ax * 0.302, off + ax * 0.302, R * 0.86, cut, segs=14)


def r_sheep(m, rnd):
    wool = mat('wool', (0.88, 0.86, 0.80), (0.62, 0.60, 0.54), scale=30, bump=0.9)
    dark = mat('sheephead', (0.06, 0.05, 0.045), bump=0)
    a = 0.55
    fw = Vector((math.cos(a), -math.sin(a), 0))
    blob(0.2, (0, 0, 0.30), wool, squash=(1.3, 0.95, 0.9), noise_amt=0.1, sub=3, seed=2).rotation_euler = (0, 0, -a)
    for i in range(26):
        t = rnd.uniform(0, 6.28); u = rnd.uniform(-0.6, 1.0)
        p = Vector((math.cos(t) * 0.22 * math.sqrt(max(0, 1 - u * u)), math.sin(t) * 0.16 * math.sqrt(max(0, 1 - u * u)), 0.30 + u * 0.15))
        p = Vector((p.x * fw.x - p.y * fw.y, p.x * fw.y + p.y * fw.x, p.z))
        blob(rnd.uniform(0.055, 0.085), p, wool, noise_amt=0.15, sub=2, seed=rnd.random() * 30)
    hp = fw * 0.29 + Vector((0, 0, 0.36))
    blob(0.075, hp, dark, squash=(1.25, 0.9, 1.0), noise_amt=0, sub=3).rotation_euler = (0, 0.5, -a)
    for sgn in (-1, 1):
        ear = blob(0.03, hp + Vector((-fw.y, fw.x, 0)) * 0.07 * sgn + Vector((0, 0, 0.03)) - fw * 0.03, dark, squash=(0.6, 1.4, 0.5), noise_amt=0, sub=2)
        ear.rotation_euler = (0, 0, -a)
        for k in (-0.13, 0.13):
            base = fw * k + Vector((-fw.y, fw.x, 0)) * 0.085 * sgn
            stick(base + Vector((0, 0, 0.0)), base + Vector((0, 0, 0.2)), 0.022, dark, segs=7)
    blob(0.06, hp - fw * 0.06 + Vector((0, 0, 0.06)), wool, noise_amt=0.2, sub=2, seed=3)


def r_wheat(m, rnd):
    straw = mat('straw', (0.78, 0.58, 0.18), (0.50, 0.34, 0.08), scale=40, bump=0.6)
    ear = mat('ear', (0.86, 0.64, 0.20), (0.60, 0.40, 0.10), scale=60, bump=1.0)
    tie = mat('tie', (0.40, 0.22, 0.10), scale=40, bump=0.8)
    for i in range(70):
        t = rnd.uniform(0, 6.28); rr = math.sqrt(rnd.random())
        tie_p = Vector((math.cos(t) * rr * 0.045, math.sin(t) * rr * 0.045, 0.26))
        spread = 0.05 + rr * 0.2
        top = Vector((math.cos(t) * spread, math.sin(t) * spread, 0.62 + rnd.uniform(-0.06, 0.06) - rr * 0.06))
        bot = Vector((math.cos(t) * (0.03 + rr * 0.14), math.sin(t) * (0.03 + rr * 0.14), 0.0))
        stick(bot, tie_p, 0.006, straw, segs=4)
        stick(tie_p, top, 0.006, straw, segs=4)
        d = (top - tie_p).normalized()
        e = stick(top - d * 0.01, top + d * 0.13, 0.022, ear, segs=6, r2=0.006)
        for k in range(3):
            q = top + d * (0.02 + k * 0.035)
            blob(0.02, q + Vector((rnd.uniform(-0.012, 0.012), rnd.uniform(-0.012, 0.012), 0)), ear, squash=(1, 1, 1.5), noise_amt=0.2, sub=1, seed=rnd.random() * 9)
    cyl(0.062, 0.035, (0, 0, 0.245), tie, segs=14)


def r_ore(m, rnd):
    ore = mat('ore', (0.44, 0.49, 0.60), (0.14, 0.16, 0.22), scale=9, rough=0.3, metallic=0.85, bump=0.9)
    dull = mat('orestone', (0.24, 0.25, 0.28), (0.10, 0.10, 0.12), scale=9, bump=0.9)
    blob(0.26, (0, 0, 0.19), ore, squash=(1.15, 0.95, 0.85), noise_amt=0.42, sub=2, seed=4, smooth=False)
    blob(0.15, (0.30, -0.10, 0.10), dull, squash=(1, 1, 0.8), noise_amt=0.42, sub=2, seed=11, smooth=False)
    blob(0.12, (-0.28, -0.14, 0.08), ore, squash=(1, 1, 0.8), noise_amt=0.42, sub=1, seed=17, smooth=False)
    blob(0.07, (0.10, -0.30, 0.05), dull, squash=(1, 1, 0.8), noise_amt=0.42, sub=1, seed=23, smooth=False)


def water_mat():
    water = bpy.data.materials.new('water')
    water.use_nodes = True
    nt = water.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.012, 0.085, 0.13, 1)
    b.inputs['Roughness'].default_value = 0.12
    try:
        b.inputs['Coat Weight'].default_value = 0.6
    except Exception:
        pass
    n = nt.nodes.new('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = 26; n.inputs['Detail'].default_value = 4
    bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.35; bp.inputs['Distance'].default_value = 0.02
    nt.links.new(n.outputs[0], bp.inputs['Height']); nt.links.new(bp.outputs[0], b.inputs['Normal'])
    return water


def r_ocean(m, rnd, seed=0.0):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=520, y_segments=420, size=1.0)
    for v in bm.verts:
        x, y = v.co.x * 13.0, v.co.y * 11.0
        v.co.x, v.co.y = x, y
        v.co.z = 0.04 * math.sin(x * 4.2 + y * 2.6 + seed * 2.1 + 3 * fbm(x, y, 0.8, 2, 3.0 + seed)) + 0.035 * fbm(x, y, 2.4, 3, 6.0 + seed * 3) + 0.05 * fbm(x, y, 0.5, 2, 1.0 + seed)
    obj_from_bm(bm, 'ocean', water_mat())


TILES = {'forest': t_forest, 'pasture': t_pasture, 'fields': t_fields, 'hills': t_hills, 'mountains': t_mountains, 'desert': t_desert, 'sea': t_sea, 'brick': r_brick, 'lumber': r_lumber, 'wool': r_wool, 'grain': r_grain, 'ore': r_ore, 'seaplain': lambda m, r: t_sea(m, r, True),
         'settlement': p_settlement, 'city': p_city, 'robber': p_robber, 'dice': p_dice, 'die1': p_die1, 'diedark': p_die_dark, 'ship': p_ship,
         'road0': lambda m, r: p_road(m, r, math.radians(90)), 'road1': lambda m, r: p_road(m, r, math.radians(30)), 'road2': lambda m, r: p_road(m, r, math.radians(150))}

for spec in WHICH:
    name, _, zoom = spec.partition('@')
    topdown = name.endswith('^')
    name = name.rstrip('^')
    sc = reset()
    if topdown:
        sc.camera.location = (0, 0, 12)
        sc.camera.rotation_euler = (0, 0, 0)
        sc.camera.data.ortho_scale = 2.0
    if zoom:
        sc.camera.data.ortho_scale = float(zoom)
        sc.camera.location.z += 0.25 * float(zoom) / 1.2 * 0 + 0.0
        sc.camera.data.shift_y = 0.17
    rnd = random.Random(hash(name) % 1000 if False else sum(map(ord, name)))
    if name.startswith('ocean'):
        sc.render.resolution_x = 1160; sc.render.resolution_y = 894
        sc.camera.data.ortho_scale = 1740 / 84.0
        sc.cycles.samples = 48
    TILES[name](M(), rnd)
    sc.render.filepath = f'{OUT}/{name}{"_art" if zoom else ""}{"_top" if topdown else ""}.png'
    bpy.ops.render.render(write_still=True)
    print('RENDERED', name)
