#!/usr/bin/env python3
"""Golden rerun board (docs/goldens.md, .claude/skills/goldens/SKILL.md). Carried from singleplayer's
.claude/skills/goldens/board.py (REPO-KIT K9); the goldens themselves live in each shard repo's art/goldens/.

A shard (24 cameras). <goldens> is a shard repo's art/goldens/: cameras24.json, shardfile/, legacy/ (optional):
  python3 scripts/goldens/board.py --goldens <goldens> --shard <slug> --now <capture.mjs --out dir> --out <dir> \
      [--label "NOW <build id>"] [--cams 1,5,9] [--red 11,12]
  NOW frames: <now>/<slug>/<nn>-<camera>-shardfile.png (capture.mjs writes them). Columns: LEGACY golden (when the
  repo keeps legacy/) | SHARDFILE golden | NOW. SSIM is NOW against the SHARDFILE golden.
An open plot (8 views). <goldens> holds <plot>/cameras.json and <plot>/<n>-<view>.jpg:
  python3 scripts/goldens/board.py --goldens <goldens> --plot <plot> --now <dir> --out <dir> [...]
  NOW frames: <now>/<plot>/<n>-<view>.png|.jpg. Columns: GOLDEN | NOW.

Writes <out>/<id>.jpg (one big labelled row per camera: read every one) and <out>/board-<slug>.jpg (every camera on one
labelled board, <= 500 KB; --red burns a red frame and RED onto those cameras). Prints SSIM per camera: a guide only,
clouds, rain, crowds and the hands' sway move; the verdict is by eye.
Large mean colour shifts are automatically RED (sRGB luma >= 0.15 or HSV
saturation >= 0.08, in either direction); the header never substitutes for review.

Promote (an approved look change only, never silently; the commit names the ruling):
  python3 scripts/goldens/board.py --goldens <goldens> --shard <slug> --now <dir> --promote 11,12 --source "<sha10> G1234"
  rewrites <goldens>/shardfile/<nn>-<camera>.jpg from NOW: 540 px wide, 22 px label strip, JPEG q72.
Needs Pillow and NumPy.
"""
import argparse, io, json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from colour_shift import colour_shift  # noqa: E402

STRIP = 22  # the SHARDFILE goldens carry a 22 px label strip on top
RED, INK, BG = (230, 40, 40), (240, 240, 240), (16, 20, 26)


def luma(img):
    a = np.asarray(img.convert('RGB'), dtype=np.float64)
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def blur(a):
    x = np.arange(-5, 6); k = np.exp(-x * x / (2 * 1.5 ** 2)); k /= k.sum()
    p = np.pad(a, 5, mode='reflect')
    rows = sum(k[i] * p[i:i + a.shape[0], :] for i in range(11))
    return sum(k[i] * rows[:, i:i + a.shape[1]] for i in range(11))


def ssim(a_img, b_img):
    """Luma SSIM at 402 x 681, the G859 page's measure."""
    size = (402, 681)
    a, b = luma(a_img.resize(size, Image.BILINEAR)), luma(b_img.resize(size, Image.BILINEAR))
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    ma, mb = blur(a), blur(b)
    va, vb, cov = blur(a * a) - ma * ma, blur(b * b) - mb * mb, blur(a * b) - ma * mb
    m = ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma * ma + mb * mb + c1) * (va + vb + c2))
    return float(m.mean())


def font(size):
    for p in ('/System/Library/Fonts/Menlo.ttc', '/System/Library/Fonts/SFNSMono.ttf'):
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default(size)


def find(base, names):
    for name in names:
        p = os.path.join(base, name)
        if os.path.exists(p): return Image.open(p).convert('RGB')
    return None


def fit(img, w): return img.resize((w, round(img.height * w / img.width)), Image.LANCZOS)


def labelled(img, text, color, w, f):
    out = Image.new('RGB', (w, img.height + f.size + 8), BG)
    out.paste(img, (0, f.size + 8)); ImageDraw.Draw(out).text((4, 3), text, fill=color, font=f)
    return out


def row(cells, title, w, red, f):
    h = max(c.height for c in cells)
    out = Image.new('RGB', (len(cells) * (w + 2) + 2, h + f.size + 10), RED if red else BG)
    for i, c in enumerate(cells): out.paste(c, (2 + i * (w + 2), f.size + 10))
    ImageDraw.Draw(out).text((4, 4), title, fill=INK, font=f)
    return out


def cameras(a):
    """[(n, id, [(column label, golden image)], now image or None)]"""
    out, g = [], a.goldens
    if a.shard:
        for c in json.load(open(os.path.join(g, 'cameras24.json')))['cameras'][a.shard]:
            cid = f'{c["n"]:02d}-{c["name"]}'
            cols = []  # LEGACY is all or nothing per shard, so every board row has the same columns
            if os.path.isdir(os.path.join(g, 'legacy')):
                cols.append(('LEGACY golden', Image.open(os.path.join(g, 'legacy', f'{cid}.jpg')).convert('RGB')))
            golden = Image.open(os.path.join(g, 'shardfile', f'{cid}.jpg')).convert('RGB')
            cols.append(('SHARDFILE golden', golden.crop((0, STRIP, golden.width, golden.height))))
            now = find(os.path.join(a.now, a.shard), (f'{cid}-shardfile.png', f'{cid}.png', f'{cid}.jpg'))
            out.append((c['n'], cid, cols, now))
    else:
        for v in json.load(open(os.path.join(g, a.plot, 'cameras.json')))['views']:
            vid = f'{v["n"]}-{v["name"]}'
            golden = Image.open(os.path.join(g, a.plot, f'{vid}.jpg')).convert('RGB')
            now = find(os.path.join(a.now, a.plot), (f'{vid}.png', f'{vid}.jpg'))
            out.append((v['n'], vid, [('GOLDEN', golden)], now))
    return out


def promote(a, cams):
    if not a.shard or not a.source: raise SystemExit('--promote needs --shard and --source "<sha10> <ruling>"')
    for n, cid, _, now in cams:
        if n not in a.promote: continue
        if now is None: raise SystemExit(f'no NOW frame for {cid}')
        img, f = fit(now, 540), font(12)
        out = Image.new('RGB', (540, img.height + STRIP), (0, 0, 0)); out.paste(img, (0, STRIP))
        ImageDraw.Draw(out).text((6, 3), f'SHARDFILE golden · {a.shard} · {cid} · {a.source}', fill=(255, 255, 255), font=f)
        path = os.path.join(a.goldens, 'shardfile', f'{cid}.jpg')
        out.save(path, 'JPEG', quality=72); print('promoted', path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--goldens', required=True, help="the shard repo's art/goldens directory")
    g = ap.add_mutually_exclusive_group(required=True); g.add_argument('--shard'); g.add_argument('--plot')
    ap.add_argument('--now', required=True); ap.add_argument('--out', default='')
    ap.add_argument('--label', default='NOW'); ap.add_argument('--cams', default=''); ap.add_argument('--red', default='')
    ap.add_argument('--promote', default=''); ap.add_argument('--source', default='')
    a = ap.parse_args()
    nums = lambda s: {int(x) for x in s.split(',') if x}
    only, red, a.promote = nums(a.cams), nums(a.red), nums(a.promote)
    slug = a.shard or a.plot
    cams = [c for c in cameras(a) if not only or c[0] in only]
    if a.promote: return promote(a, cams)
    if not a.out: raise SystemExit('--out is required')
    os.makedirs(a.out, exist_ok=True)
    big, small, missing = [], [], []
    for n, cid, goldens, now in cams:
        if now is None: missing.append(cid); continue
        s = ssim(goldens[-1][1], now)
        pixels = lambda image: image.convert('RGB').resize((128, 217), Image.BILINEAR).getdata()
        colour = colour_shift(pixels(goldens[-1][1]), pixels(now))
        if colour['red']: red.add(n)
        is_red = n in red
        shift = f'dY {colour["luma_delta"]:+.3f} dS {colour["saturation_delta"]:+.3f}'
        flag = ' RED COLOUR' if colour['red'] else ' RED' if is_red else ''
        print(f'{cid:28s} {s:.3f}  {shift}{flag}')
        for w, size, sink, title in ((360, 13, big, f'{slug} {cid}  SSIM {s:.2f}  {shift}'), (120, 9, small, f'{cid} {s:.2f}')):
            f = font(size)
            cells = [labelled(fit(img, w), label, INK, w, f) for label, img in goldens]
            cells.append(labelled(fit(now, w), a.label, RED if is_red else INK, w, f))
            sink.append(row(cells, title + flag, w, is_red, f))
        big[-1].save(os.path.join(a.out, f'{cid}.jpg'), quality=82)
    if missing: print('MISSING NOW frames:', ', '.join(missing))
    if not small: raise SystemExit('no frames to board')
    cols = 4; tw, th = small[0].width, max(t.height for t in small)
    f = font(16); head = 2 * f.size + 24
    board = Image.new('RGB', (cols * (tw + 4) + 4, head + -(-len(small) // cols) * (th + 4) + 4), BG)
    columns = ' . '.join([label for label, _ in cams[0][2]] + [a.label])
    draw = ImageDraw.Draw(board)
    draw.text((6, 6), f'GOLDEN RERUN {slug} | {columns}', fill=INK, font=f)
    status = f'RED: {",".join(map(str, sorted(red)))}' if red else 'No mean colour-shift flags; VISUAL REVIEW REQUIRED'
    if missing: status = f'INCOMPLETE: {len(missing)} of {len(cams)} cameras missing. ' + status
    draw.text((6, f.size + 12), status, fill=RED if red or missing else INK, font=f)
    for i, t in enumerate(small): board.paste(t, (4 + (i % cols) * (tw + 4), head + (i // cols) * (th + 4)))
    for q in (80, 72, 64, 56, 48, 40):
        buf = io.BytesIO(); board.save(buf, 'JPEG', quality=q)
        if buf.tell() <= 500_000: break
    path = os.path.join(a.out, f'board-{slug}.jpg'); open(path, 'wb').write(buf.getvalue())
    print(f'{path} {buf.tell() // 1000} KB, {len(small)} cameras')
    if missing: raise SystemExit(f'INCOMPLETE: {len(missing)} NOW frames missing; the board is not a green run')


if __name__ == '__main__':
    main()
