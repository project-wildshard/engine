#!/usr/bin/env python3
"""palette-delta.py — a mockup loop's colour check, per shard (E43, DRIFTWOOD-REMASTER look track; any shard since
PINE-HOLLOW-REMASTER PH-0.3).

Samples the MEAN colour of the same regions in each mockup frame and its in-game capture and prints mockup vs game per
region with CIEDE2000 ΔE. The regions belong to a shard's loop cameras and live in src/shards/<shard>/art/palette-regions.json
(Driftwood: the 9 E43 spawn-cove cameras, art/driftwood-isle/round-4-remaster/README.md).

  python3 scripts/palette-delta.py [--shard driftwood-isle] [--regions <json>] <mockup dir> '<captures>/ingame-{n}.jpg'
  python3 scripts/palette-delta.py art/driftwood-isle/round-4-remaster 'art/driftwood-isle/round-6-loop/ingame-{n}.jpg'

--shard defaults to driftwood-isle; --regions defaults to that file, else scripts/palette-regions/<shard>.json. Mockups are
<mockup dir>/mockup-<n>-*.jpg, n = the frames the regions name (1..9 for Driftwood).

Regions are fixed rectangles in normalised image coordinates per camera, the same for the mockup and the capture;
inside each rectangle only the pixels that belong to the material count (a hue / saturation / value filter), so a
palm or a HUD panel crossing the rectangle does not pollute the sand's mean. A material's mean is over every rectangle
it has, in every frame. A shadow material (Driftwood's `sand shadow`) is its rectangles' pixels darker than a share
(72 %) of the lit material's median.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
DEFAULT_SHARD = 'driftwood-isle'


def load_config(shard=DEFAULT_SHARD, path=None):
    """a shard's regions / filters / fit weights (its folder's art/palette-regions.json, or `path`)"""
    own = HERE.parent / 'src' / 'shards' / shard / 'art' / 'palette-regions.json'
    p = Path(path) if path else own if own.exists() else HERE / 'palette-regions' / f'{shard}.json'
    if not p.exists():
        sys.exit(f'palette-delta: no regions for {shard} ({p}); write one for the shard\'s loop cameras')
    cfg = json.loads(p.read_text())
    return {'regions': {m: [(n, tuple(r)) for n, r in regs] for m, regs in cfg['regions'].items()},
            'filters': cfg['filters'], 'weights': cfg.get('fitWeights', {}), 'greyAnchor': cfg.get('greyAnchor', 3.0)}


def arg_parser(desc):
    ap = argparse.ArgumentParser(description=desc)
    ap.add_argument('--shard', default=DEFAULT_SHARD, help='the shard slug (default driftwood-isle)')
    ap.add_argument('--regions', default=None, help='a regions JSON (default the shard\'s art/palette-regions.json)')
    ap.add_argument('mock_dir', help='the mockup folder (mockup-<n>-*.jpg)')
    ap.add_argument('game_pat', help="the captures, a path with {n} (1..9)")
    return ap


def hsv(px):
    a = px / 255.0
    mx, mn = a.max(1), a.min(1)
    d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    r, g, b = a[:, 0], a[:, 1], a[:, 2]
    h = np.zeros_like(mx)
    m = d > 1e-6
    rm = m & (mx == r); gm = m & (mx == g) & ~rm; bm = m & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6
    h[gm] = (b - r)[gm] / d[gm] + 2
    h[bm] = (r - g)[bm] / d[bm] + 4
    return h * 60, s, mx


def pixels(img, rect):
    w, h = img.size
    x0, y0, x1, y1 = rect
    return np.asarray(img.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h))).convert('RGB'), dtype=np.float64).reshape(-1, 3)


def select(mat, px, cfg):
    H, S, V = hsv(px)
    lum = px @ np.array([0.299, 0.587, 0.114])
    f = cfg['filters'][mat]
    if isinstance(f, dict):   # a shadow material: darker than a share of the lit material's median
        lo, hi, smin, vmin, vmax = cfg['filters'][f['shadowOf']][:5]
        lit = (H >= lo) & (H <= hi) & (S >= smin) & (V >= vmin)
        if lit.sum() < 20: return px[:0]
        med = np.median(lum[lit])
        elo, ehi, esat = f['excludeHue']
        excluded = (H >= elo) & (H <= ehi) & (S > esat)
        return px[(lum < f['below'] * med) & (V > f['vmin']) & ~excluded]
    lo, hi, smin, vmin, vmax = f[:5]
    smax = f[5] if len(f) > 5 else 1.0   # an optional 6th: max saturation (a grey material: Pine Hollow's rock)
    return px[(H >= lo) & (H <= hi) & (S >= smin) & (S <= smax) & (V >= vmin) & (V <= vmax)]


def srgb_to_lab(rgb):
    c = np.array(rgb) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    x, y, z = M @ c / np.array([0.95047, 1.0, 1.08883])
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x), f(y), f(z)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def ciede2000(l1, l2):
    L1, a1, b1 = l1; L2, a2, b2 = l2
    C1, C2 = math.hypot(a1, b1), math.hypot(a2, b2)
    Cb = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360
    h2p = math.degrees(math.atan2(b2, a2p)) % 360
    dLp, dCp = L2 - L1, C2p - C1p
    dh = h2p - h1p
    if C1p * C2p == 0: dh = 0
    elif dh > 180: dh -= 360
    elif dh < -180: dh += 360
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dh / 2))
    Lbp, Cbp = (L1 + L2) / 2, (C1p + C2p) / 2
    if C1p * C2p == 0: hbp = h1p + h2p
    elif abs(h1p - h2p) <= 180: hbp = (h1p + h2p) / 2
    else: hbp = (h1p + h2p + 360) / 2 if h1p + h2p < 360 else (h1p + h2p - 360) / 2
    T = 1 - 0.17 * math.cos(math.radians(hbp - 30)) + 0.24 * math.cos(math.radians(2 * hbp)) + 0.32 * math.cos(math.radians(3 * hbp + 6)) - 0.2 * math.cos(math.radians(4 * hbp - 63))
    dth = 30 * math.exp(-(((hbp - 275) / 25) ** 2))
    Rc = 2 * math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    Sl = 1 + 0.015 * (Lbp - 50) ** 2 / math.sqrt(20 + (Lbp - 50) ** 2)
    Sc, Sh = 1 + 0.045 * Cbp, 1 + 0.015 * Cbp * T
    Rt = -math.sin(math.radians(2 * dth)) * Rc
    return math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))


def frames(cfg):
    """the frame numbers the regions use (Driftwood: 1..9; Pine Hollow's three-zone loop: 1..27)"""
    return sorted({n for regs in cfg['regions'].values() for n, _ in regs})


def report(mock_dir, game_pat, cfg):
    mock_dir = Path(mock_dir)
    mocks = {n: Image.open(next(mock_dir.glob(f'mockup-{n}-*.jpg'))) for n in frames(cfg)}
    games = {n: Image.open(game_pat.format(n=n)) for n in frames(cfg) if Path(game_pat.format(n=n)).exists()}
    rows, worst = [], 0.0
    for mat, regs in cfg['regions'].items():
        acc = {'m': [], 'g': []}
        for n, rect in regs:
            if n not in games: continue
            acc['m'].append(select(mat, pixels(mocks[n], rect), cfg))
            acc['g'].append(select(mat, pixels(games[n], rect), cfg))
        m = np.concatenate(acc['m']) if acc['m'] else np.zeros((0, 3))
        g = np.concatenate(acc['g']) if acc['g'] else np.zeros((0, 3))
        if len(m) < 20 or len(g) < 20:
            rows.append((mat, None, None, None, len(m), len(g))); continue
        mm, gm = m.mean(0), g.mean(0)
        de = ciede2000(srgb_to_lab(mm), srgb_to_lab(gm))
        worst = max(worst, de)
        rows.append((mat, mm, gm, de, len(m), len(g)))
    hexc = lambda c: '#%02x%02x%02x' % tuple(int(round(v)) for v in c)
    print(f"{'region':14} {'mockup':8} {'game':8} {'ΔE00':>6}   (pixels mock / game)")
    for mat, mm, gm, de, nm, ng in rows:
        if de is None: print(f'{mat:14} {"—":8} {"—":8} {"n/a":>6}   ({nm} / {ng})'); continue
        flag = '' if de < 10 else '  <-- over 10'
        print(f'{mat:14} {hexc(mm):8} {hexc(gm):8} {de:6.1f}   ({nm} / {ng}){flag}')
    print(f'worst ΔE00 = {worst:.1f}')


def main(argv=None):
    a = arg_parser('mockup vs capture colour per region (CIEDE2000)').parse_args(argv)
    report(a.mock_dir, a.game_pat, load_config(a.shard, a.regions))


if __name__ == '__main__':
    main()
