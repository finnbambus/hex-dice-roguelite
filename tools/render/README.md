# 3D renders behind the printed pieces

Needs the `bpy` Python module (Blender as a module), numpy, Pillow and opencv.

- `tiles.py` builds the tiles and pieces (`python3 tiles.py -- OUTDIR names RES`); `ports.py` imports its helpers and models the six ports
  (`python3 ports.py -- OUTDIR brick:0,generic:3,... RES SAMPLES`; the number is the coast direction 0-5, in 60 degree steps clockwise from east).
- `build_ports.py RENDERS OUT` prints the renders in the two-tone halftone of the tiles, packs them into `assets/ports.webp`
  and writes `js/ports-atlas.js` (sprite rectangles, offsets and hit outlines).
