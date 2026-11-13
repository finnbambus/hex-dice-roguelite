# Board pieces with variety: settlements and cities at a few turns, and the robber as a smooth turned figure.
# Uses the camera, light and materials of tiles.py.
# usage: python3 pieces.py -- OUTDIR [RES]
#        then: python3 build_pieces.py OUTDIR ../../assets/pieces2.webp
import os, sys, math
HERE = os.path.dirname(os.path.abspath(__file__))
_argv = sys.argv[:]
sys.argv = [sys.argv[0], '--', _argv[_argv.index('--') + 1], 'none', _argv[_argv.index('--') + 2] if len(_argv) > _argv.index('--') + 2 else '640']
_src = open(os.path.join(HERE, 'tiles.py')).read()
exec(compile(_src[:_src.index('TILES = {')], 'tiles_pre', 'exec'), globals())

TURNS = [0, -24, 24, 52]  # degrees around the vertical; 0 is the original piece


def lathe(profile, material, segs=40, name='lathe'):
    """Revolve a (radius, z) profile around the z axis into a smooth closed body."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for k in range(segs):
            a = 2 * math.pi * k / segs
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(segs):
            a, b = rings[i][k], rings[i][(k + 1) % segs]
            c, d = rings[i + 1][(k + 1) % segs], rings[i + 1][k]
            try:
                bm.faces.new((a, b, c, d))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    o = obj_from_bm(bm, name, material, smooth=True)
    return o


def p_robber_turned(m, rnd):
    # the classic robber pawn: wide foot, tapering body, a collar, a round head
    prof = [(0.0, 0.0), (0.148, 0.0), (0.154, 0.012), (0.152, 0.03), (0.138, 0.06), (0.122, 0.12), (0.106, 0.2), (0.094, 0.27),
            (0.104, 0.298), (0.106, 0.316), (0.096, 0.334), (0.066, 0.35), (0.064, 0.362), (0.074, 0.38), (0.084, 0.404),
            (0.089, 0.43), (0.087, 0.458), (0.079, 0.482), (0.064, 0.503), (0.042, 0.518), (0.02, 0.526), (0.0, 0.528)]
    body = mat('robber', (0.15, 0.14, 0.15), (0.07, 0.065, 0.07), scale=14, bump=0.2, rough=0.55)
    lathe(prof, body, segs=48, name='robber')


SPECS = [(f'settlement_{a}', p_settlement, a) for a in TURNS] + [(f'city_{a}', p_city, a) for a in TURNS] + [('robber_turned', p_robber_turned, 0)]

for name, fn, turn in SPECS:
    sc = reset()
    rnd = random.Random(sum(map(ord, name)))
    fn(M(), rnd)
    if turn:
        yaw_all(math.radians(turn))
    sc.render.filepath = f'{OUT}/{name}.png'
    bpy.ops.render.render(write_still=True)
    print('RENDERED', name, flush=True)
