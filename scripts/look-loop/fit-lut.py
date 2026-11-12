#!/usr/bin/env python3
"""fit-lut.py: fit a shard's learned 33³ colour LUT from its look loop's frames (docs/look-loop.md, step 6).

  python3 scripts/look-loop/fit-lut.py --shard <slug> <mockup dir> '<no-LUT dir>/nolut-capture-{n}-*.jpg' [out.bin] [pred dir]
  python3 scripts/look-loop/fit-lut.py --regions <json> <mockup dir> '<pattern>' public/assets/lut/<slug>.bin

Regions as palette-delta.py (--regions, else scripts/look-loop/regions/<slug>.json). out.bin defaults to engine's
public/assets/lut/<shard>.bin, which src/client/engine/world/lut.ts loads for that shard (a shard with no file gets no
LUT pass); the predicted frames go to ./tmp/look-loop/pred unless a pred dir is given.

The input captures must be frames shot with the LUT off, from the loop cameras. Mockups and captures are not
pixel-aligned (the mockups are recompositions), so the fit is per material, not per pixel:
1. for every region of the regions JSON (same rectangles, same material filters) each capture pixel gets a
   target by Reinhard transfer in CIELAB — its offset from the capture's mean, scaled by the ratio of the spreads
   (clamped 0.7–1.4), re-centred on the mockup's mean — giving (source, target) colour pairs;
2. a coarse identity lattice (7³, low weight) and the grey axis (weight `greyAnchor`, default 3) anchor every colour the regions never see (the sword,
   the hands, the HUD-free rest of the frame) to "leave it alone";
3. each of the 33³ nodes moves by the kernel-weighted mean displacement of the pairs near it (Gaussian, σ = 0.08 in
   display sRGB) shrunk toward zero where the pairs are sparse (λ), then the displacement field is smoothed
   (3D Gaussian, σ = 1 node) and the move capped at 0.22 — a smooth, non-posterizing warp;
4. it prints the predicted per-region ΔE00 after applying the LUT to the captures, then writes the table as RGBA8
   (index (b·33 + g)·33 + r) for src/client/engine/world/lut.ts.
"""
import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('palette_delta', HERE / 'palette-delta.py')
PD = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(PD)

N = 33
SIGMA = 0.08
LAMBDA = 2.0
MAX_MOVE = 0.22
ROOT = HERE.parent.parent


def srgb_to_lab_arr(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)


def lab_to_srgb_arr(lab):
    fy = (lab[:, 0] + 16) / 116
    fx, fz = fy + lab[:, 1] / 500, fy - lab[:, 2] / 200
    inv = lambda f: np.where(f ** 3 > 0.008856, f ** 3, (f - 16 / 116) / 7.787)
    xyz = np.stack([inv(fx), inv(fy), inv(fz)], 1) * np.array([0.95047, 1.0, 1.08883])
    Mi = np.linalg.inv(np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]]))
    c = np.clip(xyz @ Mi.T, 0, 1)
    c = np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
    return np.clip(c * 255, 0, 255)


def pairs(mock_dir, game_pat, rng, cfg):
    mocks = {n: Image.open(next(mock_dir.glob(f'mockup-{n}-*.jpg'))) for n in PD.frames(cfg)}
    games = {n: Image.open(f) for n in PD.frames(cfg) if (f := PD.frame_path(game_pat, n))}
    src, dst, wt = [], [], []
    for mat, regs in cfg['regions'].items():
        m_all = [PD.select(mat, PD.pixels(mocks[n], r), cfg) for n, r in regs if n in games]
        g_all = [PD.select(mat, PD.pixels(games[n], r), cfg) for n, r in regs if n in games]
        m = np.concatenate(m_all) if m_all else np.zeros((0, 3))
        g = np.concatenate(g_all) if g_all else np.zeros((0, 3))
        if len(m) < 50 or len(g) < 50: continue
        lm, lg = srgb_to_lab_arr(m), srgb_to_lab_arr(g)
        k = np.clip(lm.std(0) / np.maximum(lg.std(0), 1e-3), 0.7, 1.4)
        pick = g[rng.choice(len(g), size=min(len(g), 2500), replace=False)]
        tgt = lab_to_srgb_arr((srgb_to_lab_arr(pick) - lg.mean(0)) * k + lm.mean(0))
        src.append(pick / 255); dst.append(tgt / 255); wt.append(np.full(len(pick), cfg['weights'].get(mat, 1.0)))
    # identity anchors: a coarse lattice + the grey axis
    lat = np.stack(np.meshgrid(*[np.linspace(0, 1, 7)] * 3, indexing='ij'), -1).reshape(-1, 3)
    grey = np.repeat(np.linspace(0, 1, 33)[:, None], 3, 1)
    for a, w in ((lat, 0.6), (grey, cfg['greyAnchor'])):
        src.append(a); dst.append(a); wt.append(np.full(len(a), w))
    return np.concatenate(src), np.concatenate(dst), np.concatenate(wt)


def fit(src, dst, wt):
    g = np.linspace(0, 1, N)
    nodes = np.stack(np.meshgrid(g, g, g, indexing='ij'), -1).reshape(-1, 3)   # [r][g][b]
    disp = dst - src
    out = np.zeros_like(nodes)
    for i in range(0, len(nodes), 1500):
        d2 = ((nodes[i:i + 1500, None, :] - src[None, :, :]) ** 2).sum(-1)
        w = np.exp(-d2 / (2 * SIGMA ** 2)) * wt[None, :]
        out[i:i + 1500] = (w @ disp) / (w.sum(1, keepdims=True) + LAMBDA)
    field = out.reshape(N, N, N, 3)
    k = np.exp(-0.5 * np.arange(-2, 3) ** 2); k /= k.sum()
    for ax in range(3):
        field = np.apply_along_axis(lambda v: np.convolve(np.pad(v, 2, mode='edge'), k, mode='valid'), ax, field)
    mag = np.linalg.norm(field, axis=-1, keepdims=True)
    field = field * np.minimum(1, MAX_MOVE / np.maximum(mag, 1e-6))
    return np.clip(nodes.reshape(N, N, N, 3) + field, 0, 1)   # [r][g][b] → rgb


def apply(lut, img):
    a = np.asarray(img.convert('RGB'), dtype=np.float64) / 255 * (N - 1)
    i0 = np.floor(a).astype(int).clip(0, N - 2); f = a - i0
    out = np.zeros_like(a)
    for dr in (0, 1):
        for dg in (0, 1):
            for db in (0, 1):
                w = (f[..., 0] if dr else 1 - f[..., 0]) * (f[..., 1] if dg else 1 - f[..., 1]) * (f[..., 2] if db else 1 - f[..., 2])
                out += w[..., None] * lut[i0[..., 0] + dr, i0[..., 1] + dg, i0[..., 2] + db]
    return Image.fromarray((out * 255).round().clip(0, 255).astype(np.uint8))


def main(argv=None):
    ap = PD.arg_parser("fit a shard's 33³ colour LUT from its mockup loop")
    ap.add_argument('out', nargs='?', default=None, help='the LUT (default public/assets/lut/<shard>.bin)')
    ap.add_argument('pred_dir', nargs='?', default='tmp/look-loop/pred', help='where the predicted frames go (default ./tmp/look-loop/pred)')
    a = ap.parse_args(argv)
    cfg = PD.load_config(a.shard, a.regions)
    mock_dir, game_pat = Path(a.mock_dir), a.game_pat
    if not a.out and not a.shard: ap.error('pass out.bin, or --shard <slug> for public/assets/lut/<slug>.bin')
    out_path = Path(a.out) if a.out else ROOT / 'public' / 'assets' / 'lut' / f'{a.shard}.bin'
    rng = np.random.default_rng(7)
    src, dst, wt = pairs(mock_dir, game_pat, rng, cfg)
    lut = fit(src, dst, wt)
    # predicted table: the captures through the LUT
    pred_dir = Path(a.pred_dir)
    pred_dir.mkdir(parents=True, exist_ok=True)
    for n in PD.frames(cfg):
        p = PD.frame_path(game_pat, n)
        if p: apply(lut, Image.open(p)).save(pred_dir / f'pred-{n}.png')
    print('predicted after the LUT:'); PD.report(mock_dir, str(pred_dir / 'pred-{n}.png'), cfg)
    rgba = np.concatenate([np.transpose(lut, (2, 1, 0, 3)).reshape(-1, 3), np.ones((N ** 3, 1))], 1)   # → [b][g][r]
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes((rgba * 255).round().clip(0, 255).astype(np.uint8).tobytes())
    print(f'wrote {out_path} ({N}³ RGBA8, {N ** 3 * 4} bytes)')


if __name__ == '__main__':
    main()
