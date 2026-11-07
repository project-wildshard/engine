"""The baked map's look (SF66 / G252, Jake's pick B "stylized", art/maps/round-1-baked-map-style/): turn a shard's top-down
colour pass and height pass (scripts/bake-maps.mjs) into flat colours by ground type, from the shard's own colour table
(src/shards/<slug>/look/map.json "style"), with a hillshade from the height pass and inked edges. No image model.

Three kinds of world:
  isle    an island in the sea (Driftwood): water by height (deep, shallow, a shore band), sand, grass bands by height,
          rock on steep slopes, tree crowns as dots with a shadow, paths and decks picked out with a dark edge
  void    islands floating in a void (Sky Reach): islands in stone tones by height (grassy where green), a hillshade, a
          dark rim and a cast shadow, thin spans (bridges) cream. The void is "transparent" (G252b, Jake: islands and
          bridges only, never the cloud sea: the map's own frame shows through, the cast shadow a soft dark veil) or a flat
          colour, with an optional faint glow of the colour pass ("glow", 0 = none)
  ground  any other ground: every pixel takes the flat fill of the table's class whose `match` colour is nearest the
          (smoothed) colour pass; raised things (trees, roofs) take a raised class with an edge and a cast shadow;
          optional water by height and rock by slope; an optional "void" (floors over nothing, Nine Dragon): where nothing
          was drawn is a flat colour or "transparent", with a cast shadow veil ("shadow") and an optional "rim" round the floors

Run: uv run --with numpy --with scipy --with pillow python scripts/map-stylize.py <colour.png> <height.png> <style.json> <out.webp> [size]
The height pass encodes y in metres as (y + 100) / 400 over 16 bits in R, G; B marks where anything was drawn.
"""
import json
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

colour_p, height_p, style_p, out_p = sys.argv[1:5]
N = int(sys.argv[5]) if len(sys.argv) > 5 else 1000
S = json.load(open(style_p))
photo = Image.open(colour_p).convert('RGB').resize((N, N), Image.LANCZOS)
P = np.asarray(photo).astype(np.float32) / 255.0
hraw = np.asarray(Image.open(height_p).convert('RGB').resize((N, N), Image.NEAREST)).astype(np.float32)
mask = hraw[..., 2] > 128
H = (hraw[..., 0] * 256 + hraw[..., 1]) / 65535 * 400 - 100
H = ndi.median_filter(H, size=3)
PPM = N / 500.0  # pixels per metre


def hex3(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255.0


def hillshade(h, az=315, alt=50, z=1.6):
    hs = ndi.gaussian_filter(h, 1.2)
    gy, gx = np.gradient(hs * PPM * z)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    a, b = np.radians(360 - az + 90), np.radians(alt)
    s = np.sin(b) * np.sin(slope) + np.cos(b) * np.cos(slope) * np.cos(a - aspect)
    return np.clip(s, 0, 1)


def drop_small(region, n):
    lab, k = ndi.label(region)
    if k == 0:
        return region
    sizes = ndi.sum(region, lab, range(1, k + 1))
    keep = np.zeros(k + 1, bool)
    keep[1:] = sizes >= n
    return keep[lab]


def outline(region, px=1):
    """the pixels just inside a region's border"""
    return region & ~ndi.binary_erosion(region, iterations=px)


def shade_land(C, land, strength, z=1.6):
    sh = hillshade(H, z=z)
    lo = 1.0 - strength * 0.7
    C[land] *= (lo + strength * 1.0 * sh[land])[:, None]


r, g, b = P[..., 0], P[..., 1], P[..., 2]
mx, mn = P.max(-1), P.min(-1)
sat = (mx - mn) / np.maximum(mx, 1e-3)
slope = np.hypot(*np.gradient(ndi.gaussian_filter(H, 1.0))) * PPM  # metres per metre
bump = H - ndi.median_filter(H, size=15)                             # what stands on the ground (trees, huts, decks)
kind = S['kind']
A = None  # the alpha: only a transparent void has one

if kind == 'isle':
    water = H < S['waterBelow']
    deep = H < S['deepBelow']
    green = (g > r * 1.05) & (g > b * 1.1)
    sandy = (r > 0.55) & (g > 0.45) & (b < g * 0.85) & ~green
    wood = (r > g * 1.12) & (r > 0.25) & (r < 0.75) & (sat > 0.3) & ~water & ~green
    rock = ~water & ~green & (sat < 0.28)
    rock |= ~water & (slope > 1.4)
    tree = ~water & (bump > 1.5) & green
    path = sandy & (H > S['pathAbove'])
    overwater = ndi.minimum_filter(H, size=11) < -0.5
    pier = ~water & overwater & ~green & (bump > 0.4)  # planks standing over the sea: the docks and jetties
    path = ndi.binary_opening(path & ~pier, iterations=1)
    path = drop_small(path, 150)
    deck = ndi.binary_opening(wood, iterations=1) | (wood & (H > 0.15) & (H < 3.5)) | pier
    deck = drop_small(ndi.binary_closing(deck, iterations=1), 60)
    sand = ~water & sandy & ~path
    sand = ndi.binary_closing(sand, iterations=2) & ~water
    land = ~water
    islet = land & ~drop_small(land, 600)  # the sea rocks
    C = np.zeros_like(P)
    C[:] = hex3(S['sea'])
    C[water & ~deep] = hex3(S['shallow'])
    C[deep] = hex3(S['sea'])
    C[water & ndi.binary_dilation(land, iterations=6) & ~deep] = hex3(S['shore'])
    gband = np.digitize(ndi.gaussian_filter(H, 2), S['grassBands'])
    for i, col in enumerate(S['grass']):
        C[land & (gband == i)] = hex3(col)
    C[sand] = hex3(S['sand'])
    C[rock & land & ~sand] = hex3(S['rock'])
    C[islet & ~deck] = hex3(S['seaRock'])
    shade = hillshade(H)
    C[land] *= (0.62 + 0.55 * shade[land])[:, None]
    tl = ndi.binary_opening(tree & ~islet, iterations=1)
    sh = ndi.shift(tl.astype(np.float32), (3, 3), order=0) > 0.5
    C[sh & land & ~tl] *= 0.72
    C[tl] = hex3(S['crown'])
    C[outline(tl)] = hex3(S['crownEdge'])
    C[ndi.binary_dilation(path, iterations=1)] = hex3(S['pathEdge'])
    C[path] = hex3(S['path'])
    C[ndi.binary_dilation(deck, iterations=1)] = hex3(S['deckEdge'])
    C[deck] = hex3(S['deck'])
    coast = outline(land, 2)
    C[coast & ~deck] = C[coast & ~deck] * 0.55 + hex3(S['coast']) * 0.45
elif kind == 'void':
    m = ndi.binary_opening(mask, iterations=1)
    isl = ndi.binary_opening(m, iterations=4)
    isl = ndi.binary_propagation(isl, mask=m) & ndi.binary_opening(m, iterations=2)
    thin = m & ~ndi.binary_dilation(isl, iterations=1)
    thin = ndi.binary_closing(ndi.binary_dilation(thin, iterations=1), iterations=2) & ~isl
    thin = drop_small(thin, 12)
    C = np.zeros_like(P)
    clear = S['void'] == 'transparent'
    if not clear:
        C[:] = hex3(S['void'])
        glow = float(S.get('glow', 0))
        if glow > 0:  # a faint glow of what lies under the islands, so the void is not dead flat
            lum = ndi.gaussian_filter(P.mean(-1), 6)
            C *= (1.0 - glow * 0.43 + glow * (lum - lum.min()) / (lum.max() - lum.min() + 1e-6))[..., None]
    grassy = ndi.gaussian_filter(((g > r * 0.98) & (g > b * 1.15)).astype(np.float32), 3) > 0.35
    band = np.digitize(H, S['stoneBands'])
    for i, col in enumerate(S['stone']):
        C[isl & (band == i)] = hex3(col)
    C[isl & grassy] = C[isl & grassy] * 0.2 + hex3(S['grass']) * 0.8
    shade = hillshade(H, z=0.8)
    C[isl] *= (0.7 + 0.45 * shade[isl])[:, None]
    sh = ndi.shift(isl.astype(np.float32), (6, 6), order=0) > 0.5
    cast = sh & ~isl & ~thin
    C[cast] *= 0.6
    C[outline(isl, 2)] = hex3(S['rim'])
    span = ndi.binary_dilation(thin, iterations=1) & ~isl
    C[span] = hex3(S['bridgeEdge'])
    C[thin] = hex3(S['bridge'])
    if clear:  # islands and bridges opaque, the cast shadow a veil, the rest of the void see-through
        A = np.zeros(C.shape[:2], np.float32)
        A[cast] = float(S.get('shadow', 0.35))
        A[isl | span] = 1.0
else:  # ground
    smooth = int(S.get('smooth', 5))
    Q = np.stack([ndi.median_filter(P[..., k], size=smooth) for k in range(3)], -1)
    ground = S['classes']
    matches = np.stack([hex3(c['match']) for c in ground])
    d = ((Q[:, :, None, :] - matches[None, None]) ** 2).sum(-1)
    cls = d.argmin(-1)
    # a majority clean-up: each class's share, blurred; the most common nearby wins (no salt and pepper)
    k = len(ground)
    share = np.stack([ndi.uniform_filter((cls == i).astype(np.float32), size=smooth + 2) for i in range(k)], -1)
    cls = share.argmax(-1)
    # a class with a "min" (pixels) drops its smaller patches into the most common other class nearby (a shadow read as water)
    for i, c in enumerate(ground):
        if 'min' in c:
            small = (cls == i) & ~drop_small(cls == i, int(c['min']))
            other = share.copy()
            other[..., i] = -1
            cls[small] = other.argmax(-1)[small]
    C = np.zeros_like(P)
    for i, c in enumerate(ground):
        C[cls == i] = hex3(c['fill'])
    land = mask | True
    if 'steep' in S:
        st = ndi.binary_opening(slope > S['steep']['slope'], iterations=1)
        C[st] = hex3(S['steep']['fill'])
        cls[st] = k
    shade_land(C, land, S.get('shade', 0.5))
    # inked edges between the classes that ask for one (paths, roads, the river)
    for i, c in enumerate(ground):
        if 'edge' in c:
            reg = drop_small(cls == i, 40)
            e = ndi.binary_dilation(reg, iterations=1) & ~reg
            C[e] = C[e] * 0.4 + hex3(c['edge']) * 0.6
    if 'water' in S:
        w = S['water']
        wat = ndi.binary_opening(H < w['below'], iterations=1) & mask
        if 'within' in w:  # only inside a world rectangle {x0, x1, z0, z1} (metres; +X left, +Z up the image): Nine Dragon's Well, not the road's decks
            r = w['within']
            cols, rows = np.meshgrid(np.arange(N), np.arange(N))
            wx, wz = 250 - (cols + 0.5) / PPM, 250 - (rows + 0.5) / PPM
            wat &= (wx >= r['x0']) & (wx <= r['x1']) & (wz >= r['z0']) & (wz <= r['z1'])
        C[wat] = hex3(w['fill'])
        if 'edge' in w:
            C[outline(wat, 1)] = hex3(w['edge'])
    if 'raised' in S:
        rz = S['raised']
        up = ndi.binary_opening(bump > rz['bump'], iterations=1)
        up = drop_small(up, int(rz.get('min', 12)))
        sh = ndi.shift(up.astype(np.float32), (3, 3), order=0) > 0.5
        C[sh & ~up] *= 0.68
        rcls = rz['classes']
        rm = np.stack([hex3(c['match']) for c in rcls])
        rd = ((Q[:, :, None, :] - rm[None, None]) ** 2).sum(-1).argmin(-1)
        rshade = hillshade(H, z=1.0)
        for i, c in enumerate(rcls):
            reg = up & (rd == i)
            C[reg] = hex3(c['fill'])
            C[reg] *= (0.78 + 0.3 * rshade[reg])[:, None]
            C[outline(reg)] = hex3(c['edge'])

    if 'void' in S:  # a world of floors over nothing (Nine Dragon's stack): undrawn pixels are the void, a flat colour or see-through
        drawn = drop_small(ndi.binary_opening(mask, iterations=1), 12)
        sh = ndi.shift(drawn.astype(np.float32), (4, 4), order=0) > 0.5
        cast = sh & ~drawn
        if S['void'] == 'transparent':
            A = np.zeros(C.shape[:2], np.float32)
            A[cast] = float(S.get('shadow', 0.35))
            A[drawn] = 1.0
            C[cast] = 0.0
        else:
            C[~drawn] = hex3(S['void'])
            C[cast] *= 1.0 - float(S.get('shadow', 0.35))
        if 'rim' in S:
            C[outline(drawn, 1)] = hex3(S['rim'])

rgb = (np.clip(C, 0, 1) * 255).astype(np.uint8)
if A is not None:
    img = Image.fromarray(np.dstack([rgb, (np.clip(A, 0, 1) * 255).astype(np.uint8)]), 'RGBA')
    img.save(out_p, 'WEBP', quality=int(S.get('quality', 82)), alpha_quality=100, method=6, exact=False)
else:
    img = Image.fromarray(rgb)
    img.save(out_p, 'WEBP', quality=int(S.get('quality', 82)), method=6)
print('map-stylize:', kind, out_p)
