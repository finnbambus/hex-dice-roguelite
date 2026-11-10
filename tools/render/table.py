# The tabletop: dark wooden planks printed as a halftone (light dots on dark paper), seamless in both directions.
# usage: python3 table.py OUT.webp [preview.png]
# The texture is already squashed to the board's camera (planks seen at an angle), so the game just tiles it at 1024 x 768 world px.
# The dot lattice is rotated by atan(3/4) with pitch 307.2/52 px so it repeats exactly across the 1536 x 1152 tile.
import sys
import numpy as np
import cv2
from PIL import Image

W, H = 1536, 1152            # final texture
PW = 1536                    # flat (top-down) plane before the camera squash
ROWS = 8                     # planks across the height
PAPER = np.array([22, 17, 13], np.float32)   # dark wood
INK = np.array([112, 80, 54], np.float32)    # light dots = highlights in the grain
GAIN = 0.85

rng = np.random.default_rng(11)


def pnoise(shape, sx, sy, seed):
    """Periodic noise stretched along x (grain runs along the plank)."""
    n = np.random.default_rng(seed).standard_normal(shape)
    F = np.fft.fft2(n)
    fy = np.fft.fftfreq(shape[0])[:, None]
    fx = np.fft.fftfreq(shape[1])[None, :]
    g = np.exp(-2 * np.pi ** 2 * ((fx * sx) ** 2 + (fy * sy) ** 2))
    r = np.real(np.fft.ifft2(F * g))
    return (r - r.mean()) / r.std()


fine = pnoise((PW, PW), 160, 1.8, 1)       # fine streaks
mid = pnoise((PW, PW), 260, 7, 2)          # broader tonal bands
warp = pnoise((PW, PW), 420, 34, 3)        # warps the growth rings
yy, xx = np.mgrid[0:PW, 0:PW].astype(np.float32)
rings = np.abs(np.sin((yy + warp * 26) * (2 * np.pi / 15.0))) ** 5     # thin ring lines
rings = (rings - rings.mean()) / rings.std()

L = np.zeros((PW, PW), np.float32)
ph = PW // ROWS
for r in range(ROWS):
    y0, y1 = r * ph, (r + 1) * ph
    # one or two joints per row, staggered
    j0 = int(rng.integers(0, PW))
    joints = sorted({j0, (j0 + int(rng.integers(560, 980))) % PW})
    bounds = joints + [joints[0] + PW]
    for a, b in zip(bounds[:-1], bounds[1:]):
        shift = int(rng.integers(0, PW))
        tone = rng.normal(0, 0.06)
        xs = (np.arange(a, b) % PW)
        rows = slice(y0, y1)
        f = np.roll(fine, shift, axis=1)[rows][:, xs]
        m = np.roll(mid, shift, axis=1)[rows][:, xs]
        g = np.roll(rings, shift // 2, axis=1)[rows][:, xs]
        seg = 0.30 + tone + 0.06 * f + 0.045 * m + 0.05 * g
        L[rows, xs] = seg
        # end joint: dark gap and a faint lit edge
        for k, w, v in ((0, 3, -0.36), (3, 2, 0.1)):
            xe = xs[k:k + w]
            L[y0:y1, xe] += v
    # long seam between plank rows
    L[y0:y0 + 3, :] -= 0.36
    L[y0 + 3:y0 + 5, :] += 0.1

L = np.clip(L, 0, 1)
# camera squash, then the print
L = cv2.resize(L, (W, H), interpolation=cv2.INTER_AREA)
pad = 24
L = cv2.GaussianBlur(np.pad(L, pad, mode='wrap'), (0, 0), 2.2)[pad:-pad, pad:-pad]   # the lattice samples a smooth tone, so no moire

th = np.arctan2(3, 4)
P = 307.2 / 52
c, s = np.cos(th), np.sin(th)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
u = (xx * c + yy * s) / P
v = (-xx * s + yy * c) / P
cu, cv_ = np.round(u), np.round(v)
px = (cu * c - cv_ * s) * P
py = (cu * s + cv_ * c) * P
ix = np.round(px).astype(int) % W
iy = np.round(py).astype(int) % H
Ls = L[iy, ix]
r = P * 0.74 * np.sqrt(np.clip(Ls * GAIN, 0, 1))
d = np.hypot(xx - px, yy - py)
ink = np.clip(r - d + 0.5, 0, 1)[..., None]
img = (PAPER * (1 - ink) + INK * ink).astype(np.uint8)
im = Image.fromarray(img, 'RGB')
im.save(sys.argv[1], quality=88, method=6)
if len(sys.argv) > 2:
    # preview: 2 x 2 tiles to check the seams
    t = np.tile(img, (2, 2, 1))
    Image.fromarray(t).resize((1536, 1152), Image.LANCZOS).save(sys.argv[2])
print('ok', im.size)
