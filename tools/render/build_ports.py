# Turn the port renders into the same two-tone halftone print as the terrain tiles, pack them into one sheet.
# usage: python3 build_ports.py RENDERS_DIR OUT_DIR
import sys, json, os
import numpy as np
from PIL import Image
import cv2

SRC, OUT = sys.argv[1], sys.argv[2]
PPU = 512 / 2.6
INK = {'forest': (29, 65, 37), 'pasture': (65, 88, 30), 'fields': (116, 81, 13), 'hills': (110, 42, 24), 'mountains': (51, 62, 79), 'desert': (104, 78, 41)}
PAPER = {'forest': (172, 186, 160), 'pasture': (172, 184, 140), 'fields': (206, 185, 138), 'hills': (204, 168, 148), 'mountains': (168, 172, 174), 'desert': (205, 190, 164)}
KIND = {'brick': 'hills', 'lumber': 'forest', 'wool': 'pasture', 'grain': 'fields', 'ore': 'mountains', 'generic': 'desert'}
PITCH, ANG, GAIN = 5.08, 30.0, 0.85


def mono(path, kind):
    a = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32) / 255
    A = a[..., 3]
    L = 0.30 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2]
    H, W = L.shape
    p = np.percentile(L[A > 0.5], 93)
    Ln = np.clip(L / max(p, 1e-3), 0, 1) ** 1.15
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    t = np.radians(ANG); c, s = np.cos(t), np.sin(t)
    u = (xx * c + yy * s) / PITCH; v = (-xx * s + yy * c) / PITCH
    cu, cv = np.round(u), np.round(v)
    px = (cu * c - cv * s) * PITCH; py = (cu * s + cv * c) * PITCH
    ix = np.clip(px.round().astype(int), 0, W - 1); iy = np.clip(py.round().astype(int), 0, H - 1)
    D = 1 - Ln
    r = PITCH * 0.74 * np.sqrt(np.clip(D[iy, ix] * GAIN, 0, 1))
    d = np.hypot(xx - px, yy - py)
    ink = np.clip(r - d + 0.5, 0, 1)
    paper = np.array(PAPER[kind], np.float32); inkc = np.array(INK[kind], np.float32)
    col = paper * (1 - ink[..., None]) + inkc * ink[..., None]
    A8 = (A > 0.02).astype(np.float32)
    return np.dstack([col, A8[..., None] * 255]).astype(np.uint8), A


items = []
for name in KIND:
    for k in range(6):
        p = f'{SRC}/{name}_{k}.png'
        img, A = mono(p, KIND[name])
        H, W = A.shape
        ys, xs = np.where(A > 0.04)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        if x0 <= 1 or y0 <= 1 or x1 >= W - 1 or y1 >= H - 1:
            print('WARNING frame clipped', name, k, (x0, y0, x1, y1), (W, H))
        crop = Image.fromarray(img[y0:y1, x0:x1], 'RGBA')
        # hit polygon (simplified silhouette), relative to the origin pixel
        m = (A[y0:y1, x0:x1] > 0.3).astype(np.uint8) * 255
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
        cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        big = max(cs, key=cv2.contourArea)
        ap = cv2.approxPolyDP(big, 3.0, True)[:, 0, :]
        ox, oy = x0 - W / 2, y0 - H / 2
        items.append((f'{name}:{k}', crop, ox, oy, [(int(px_) , int(py_)) for px_, py_ in ap]))

# shelf pack
SHEET_W = 4096
x = y = rowh = 0
placed = []
for key, im, ox, oy, poly in items:
    if x + im.width + 2 > SHEET_W:
        x = 0; y += rowh + 2; rowh = 0
    placed.append((key, im, x, y, ox, oy, poly))
    x += im.width + 2
    rowh = max(rowh, im.height)
SHEET_H = y + rowh + 2
sheet = Image.new('RGBA', (SHEET_W, SHEET_H), (0, 0, 0, 0))
atlas = {}
for key, im, sx, sy, ox, oy, poly in placed:
    sheet.paste(im, (sx, sy))
    atlas[key] = {'s': [sx, sy, im.width, im.height], 'o': [round(ox, 1), round(oy, 1)], 'p': poly}
os.makedirs(OUT, exist_ok=True)
sheet.save(f'{OUT}/ports.webp', quality=90, method=6, exact=True)
js = '// Generated from the 3D port renders (see the port pipeline). s: sprite rect in the sheet, o: offset of its top-left from the coast-edge midpoint,\n// p: simplified silhouette (sprite px, relative to the sprite top-left). All in sheet pixels; SCALE converts them to world pixels.\n'
js += f'export const PORT_SCALE = {96 / PPU:.5f};\nexport const PORT_SHEET = [{SHEET_W}, {SHEET_H}];\nexport const PORT_ATLAS = {json.dumps(atlas, separators=(",", ":"))};\n'
open(f'{OUT}/ports-atlas.js', 'w').write(js)
print('sheet', sheet.size, 'items', len(atlas), os.path.getsize(f'{OUT}/ports.webp') // 1024, 'KB')
