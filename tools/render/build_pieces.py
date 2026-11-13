# Pack the piece renders from pieces.py into one 3 × 3 sheet of 640 px cells: settlement turns, city turns, robber.
# usage: python3 build_pieces.py RENDERS_DIR OUT.webp
import sys
from PIL import Image
SRC, OUT = sys.argv[1], sys.argv[2]
TURNS = [0, -24, 24, 52]
names = [f'settlement_{a}' for a in TURNS] + [f'city_{a}' for a in TURNS] + ['robber_turned']
sheet = Image.new('RGBA', (1920, 1920), (0, 0, 0, 0))
for i, n in enumerate(names):
    im = Image.open(f'{SRC}/{n}.png').convert('RGBA')
    sheet.alpha_composite(im, ((i % 3) * 640, (i // 3) * 640))
sheet.save(OUT, 'WEBP', quality=90, method=6)
print('wrote', OUT, sheet.size)
