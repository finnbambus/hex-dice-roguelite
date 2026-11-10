# The tabletop: an abstract, organic black-and-white halftone print (flowing contour lines and soft clouds), seamless in both directions.
# usage: python3 table.py OUT.webp [preview.png]
# The texture is already squashed to the board's camera, so the game just tiles it at 1024 x 768 world px.
# The dot lattice is rotated by atan(3/4) with pitch 307.2/52 px so it repeats exactly across the 1536 x 1152 tile.
import sys
import numpy as np
import cv2
from PIL import Image

W, H = 1536, 1152            # final texture
PW = 1536                    # flat plane before the camera squash
PAPER = np.array([12, 12, 12], np.float32)   # near-black
INK = np.array([172, 172, 170], np.float32)  # neutral light grey: black and white only, the lamp adds all the colour
GAIN = 0.9


def pnoise(shape, s, seed):
    """Periodic, isotropic smooth noise with feature size ~s px."""
    n = np.random.default_rng(seed).standard_normal(shape)
    F = np.fft.fft2(n)
    fy = np.fft.fftfreq(shape[0])[:, None]
    fx = np.fft.fftfreq(shape[1])[None, :]
    g = np.exp(-2 * np.pi ** 2 * s ** 2 * (fx ** 2 + fy ** 2))
    r = np.real(np.fft.ifft2(F * g))
    return ((r - r.mean()) / r.std()).astype(np.float32)


def warp(img, dx, dy):
    yy, xx = np.mgrid[0:PW, 0:PW].astype(np.float32)
    return cv2.remap(img, xx + dx, yy + dy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


# a flowing field: big slow noise, bent twice by itself so the lines fold like ink on water
base = 0.9 * pnoise((PW, PW), 250, 1) + 0.45 * pnoise((PW, PW), 110, 2) + 0.2 * pnoise((PW, PW), 50, 3)
w1x, w1y = pnoise((PW, PW), 330, 4), pnoise((PW, PW), 330, 5)
f = warp(base, 170 * w1x, 170 * w1y)
f = warp(f, 40 * pnoise((PW, PW), 120, 6), 40 * pnoise((PW, PW), 120, 7))
f = (f - f.mean()) / f.std()

clouds = 1 / (1 + np.exp(-1.6 * f))                       # soft light and dark masses
lines = np.abs(np.sin(f * 4.4)) ** 22                      # thin contour lines that follow the folds
lines = np.clip(lines * 1.3, 0, 1)
L = 0.04 + 0.12 * clouds + 0.34 * lines * (0.3 + 0.7 * clouds)
L = np.clip(L, 0, 1).astype(np.float32)

L = cv2.resize(L, (W, H), interpolation=cv2.INTER_AREA)   # camera squash
pad = 24
L = cv2.GaussianBlur(np.pad(L, pad, mode='wrap'), (0, 0), 1.6)[pad:-pad, pad:-pad]

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
    t = np.tile(img, (2, 2, 1))
    Image.fromarray(t).resize((1536, 1152), Image.LANCZOS).save(sys.argv[2])
print('ok', im.size)
