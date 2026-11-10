# The tabletop: a very quiet black-and-white halftone of long, faint wood fibres, seamless in both directions.
# It is deliberately low in contrast so it never competes with the board; the lamp's own dot pool gives the table its light.
# usage: python3 table.py OUT.webp [preview.png]
# The texture is already squashed to the board's camera, so the game just tiles it at 1024 x 768 world px.
# The dot lattice is rotated by atan(3/4) with pitch 307.2/52 px so it repeats exactly across the 1536 x 1152 tile.
import sys
import numpy as np
import cv2
from PIL import Image

OUT = sys.argv[1]
W, H = 1536, 1152            # final texture
PW = 1536                    # flat plane before the camera squash
PAPER = np.array([11, 11, 11], np.float32)    # near-black
INK = np.array([120, 120, 118], np.float32)   # dim neutral grey: black and white only, the lamp adds all the colour
GAIN = 0.9


def pnoise(s, seed, sy=None):
    """Periodic smooth noise with feature size s px along x and sy (default s) along y."""
    sy = s if sy is None else sy
    n = np.random.default_rng(seed).standard_normal((PW, PW))
    F = np.fft.fft2(n)
    fy = np.fft.fftfreq(PW)[:, None]
    fx = np.fft.fftfreq(PW)[None, :]
    g = np.exp(-2 * np.pi ** 2 * ((s * fx) ** 2 + (sy * fy) ** 2))
    r = np.real(np.fft.ifft2(F * g))
    return ((r - r.mean()) / r.std()).astype(np.float32)


# long thin fibres, a slow wide drift of tone, and nothing else: no planks, no knots, no swirls
fibres = np.clip(pnoise(170, 11, 1.4) * 0.5 + 0.5, 0, 1) ** 2
mid = np.clip(pnoise(300, 12, 14) * 0.5 + 0.5, 0, 1)
drift = np.clip(pnoise(500, 13, 120) * 0.5 + 0.5, 0, 1)
L = 0.07 + 0.05 * drift + 0.1 * mid * fibres + 0.07 * fibres
L = np.clip(L, 0, 1).astype(np.float32)

L = cv2.resize(L, (W, H), interpolation=cv2.INTER_AREA)   # camera squash
pad = 24
L = cv2.GaussianBlur(np.pad(L, pad, mode='wrap'), (0, 0), 1.5)[pad:-pad, pad:-pad]

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
im.save(OUT, quality=88, method=6)
if len(sys.argv) > 2:
    t = np.tile(img, (2, 2, 1))
    Image.fromarray(t).resize((1536, 1152), Image.LANCZOS).save(sys.argv[2])
print('ok', im.size)
