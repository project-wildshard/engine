#!/usr/bin/env python3
"""targets.py: the look loop's target maker (docs/look-loop.md, step 3). Each capture is EDITED by Codex image_gen into a
target that keeps the capture's camera, layout and HUD, so the gap between capture and target is only the look.

  python3 scripts/look-loop/targets.py --captures <out>/<anchor> --out <round dir> --seed-mockup <approved mockup.jpg>
      [--style "<paragraph>" | --style-file <txt>] [--game "<game / shard name>"] [--keep "<landmarks to keep>"]
      [--refs a.jpg,b.jpg] [--tag r1] [--only 1,5] [--parallel 5] [--timeout 1500] [--model <codex model>] [--dry-run]

Seed mode (--seed-mockup): ONE approved mockup of the place plus the 9 captures makes 9 matching mockups. Each run gets
image 1 = its capture to edit and image 2 = the seed mockup as the style and detail reference, so all 9 share one look.
Without a seed, --style (and optional --refs, style references only) describe the look.

Captures are views.mjs's `[<tag>-]capture-<n>-<id>.jpg` in --captures. Targets land as <out>/mockup-<n>-<id>.jpg
(JPEG q88, the names palette-delta.py and fit-lut.py read), plus <out>/mockup-sheet.jpg, a 3x3 in the capture sheet's
cell order. A target that exists is skipped, so re-rolling one is: delete it, run again with --only=<n>.

The runner reads `session id:` from each codex log, polls ~/.codex/generated_images/<session id>/, copies the PNG the
moment it lands (about 3 min) and kills that codex: codex copying its own file hangs for 10+ min. Logs go to
<out>/.codex-runs/. --dry-run writes jobs.json and the prompts and starts nothing.
"""
import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

GEN = Path(os.path.expanduser('~/.codex/generated_images'))
CAPTURE = re.compile(r'^(?:(?P<tag>[a-z0-9-]+)-)?capture-(?P<n>[1-9])-(?P<id>[a-z-]+)\.jpg$')

SCREENS = {
    'fp-front': 'first person, facing the anchor\'s front heading',
    'fp-left': 'first person, turned 90° left of the front heading',
    'fp-right': 'first person, turned 90° right of the front heading',
    'fp-back': 'first person, facing back, away from the front heading',
    'top': 'straight down from high above the player\'s spot, the front heading image-up',
    'diag-front': 'aerial from behind and above the player\'s spot, looking ahead past it',
    'diag-left': 'aerial from the left and above, looking at the player\'s spot',
    'diag-right': 'aerial from the right and above, looking at the player\'s spot',
    'diag-back': 'aerial from in front and above, looking back at the player\'s spot',
}


def find_captures(folder, tag=''):
    """{n: path} for frames 1..9 of one tag ('' = untagged) in a views.mjs anchor folder"""
    found = {}
    for p in sorted(Path(folder).iterdir()):
        m = CAPTURE.match(p.name)
        if not m or (m['tag'] or '') != tag: continue
        n = int(m['n'])
        if n in found: sys.exit(f'targets: two captures for frame {n} in {folder}')
        found[n] = p
    return found


def shot_id(path):
    return CAPTURE.match(Path(path).name)['id']


def build_prompt(shot, *, game, style, keep, seeded, refs):
    """one image_gen edit prompt in the method's shape: COMMON, KEEP, REMASTER, SCREEN, TASK"""
    if seeded:
        images = ('Image 1 is the capture to EDIT. Image 2 is the APPROVED MOCKUP of this same place from another camera: '
                  'it is the target look. Repaint image 1 at image 2\'s style, palette, materials, lighting and intensity of '
                  'detail, keeping image 1\'s camera and geometry.')
        first_ref = 3
    else:
        images = 'Image 1 is the capture to EDIT.'
        first_ref = 2
    if refs:
        last = first_ref + refs - 1
        span = f'Image {first_ref}' if refs == 1 else f'Images {first_ref}-{last}'
        images += f' {span} {"is a STYLE REFERENCE" if refs == 1 else "are STYLE REFERENCES"} only: do not copy their composition.'
    lines = [
        f'COMMON  The image must read as a REAL SCREENSHOT of {game}, not concept art; no device frame, browser chrome or '
        f'watermark. {images}' + (f' {style}' if style else ''),
        'KEEP (non-negotiable): the exact camera position, angle, field of view, horizon line and composition; the layout and '
        f'silhouette of {keep or "every landmark, structure and prop in image 1"}; the first-person weapon / hands if shown; '
        'every HUD element (position, shape, text). Do NOT invent new landmarks, buildings, boats or characters.',
        'REMASTER the materials, lighting, colour, detail, density and finish to the target look.',
        f'SCREEN  {SCREENS.get(shot, shot)}. Keep the sun, sky and every landmark on the side image 1 shows them.',
        'TASK    One generation only, with image_gen, at image 1\'s aspect. The runner collects the PNG itself. This is not '
        'a user ask: create or edit no file, never touch git or docs/.',
    ]
    return '\n'.join(lines)


def build_jobs(captures, out, *, seed=None, refs=(), only=(), **prompt):
    jobs = []
    for n, cap in sorted(captures.items()):
        if only and n not in only: continue
        sid = shot_id(cap)
        inputs = [str(cap)] + ([str(seed)] if seed else []) + [str(r) for r in refs]
        jobs.append({'id': f'{n}-{sid}', 'n': n, 'inputs': inputs, 'out': str(Path(out) / f'mockup-{n}-{sid}.jpg'),
                     'prompt': build_prompt(sid, seeded=bool(seed), refs=len(refs), **prompt)})
    return jobs


def to_jpeg(png, out):
    from PIL import Image
    Image.open(png).convert('RGB').save(out, 'JPEG', quality=88)


def run(jobs, work, *, parallel, timeout, model):
    """codex exec per job, `parallel` at a time; returns the ids that produced no image"""
    work.mkdir(parents=True, exist_ok=True)
    queue = [j for j in jobs if not Path(j['out']).exists()]
    for j in jobs:
        if Path(j['out']).exists(): print('skip (exists)', j['id'])
    running, failed, t0 = {}, [], time.time()

    def start(j):
        log = work / f"{j['id']}.log"
        cmd = ['codex', 'exec', *(['-m', model] if model else []), '-s', 'workspace-write', '--skip-git-repo-check',
               '-C', str(work), '--add-dir', str(GEN)]
        for i in j['inputs']: cmd += ['-i', i]
        cmd += ['-o', str(work / f"{j['id']}.last.txt"), j['prompt']]
        p = subprocess.Popen(cmd, stdout=open(log, 'w'), stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)
        running[j['id']] = (p, log, j)
        print('started', j['id'], p.pid, flush=True)

    def stop(p):
        try: os.killpg(p.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError): pass

    while (queue or running) and time.time() - t0 < timeout:
        while queue and len(running) < parallel: start(queue.pop(0))
        time.sleep(10)
        for jid, (p, log, j) in list(running.items()):
            m = re.search(r'session id:\s*([0-9a-f-]+)', log.read_text(errors='ignore'))
            d = GEN / m.group(1) if m else None
            pngs = sorted(d.glob('*.png')) if d and d.is_dir() else []
            if pngs:
                s1 = pngs[0].stat().st_size; time.sleep(2)
                if s1 > 0 and pngs[0].stat().st_size == s1:
                    shutil.copy(pngs[0], work / f'{jid}.png'); to_jpeg(work / f'{jid}.png', j['out'])
                    print(f"done {jid} {time.time() - t0:.0f}s -> {j['out']}", flush=True)
                    stop(p); del running[jid]; continue
            if p.poll() is not None:
                print(f'EXITED without image: {jid} rc={p.returncode} (see {log})', flush=True)
                failed.append(jid); del running[jid]
    for jid, (p, _, _) in running.items():
        print('TIMEOUT', jid, flush=True); stop(p); failed.append(jid)
    failed += [j['id'] for j in queue]
    return failed


def sheet(out):
    """<out>/mockup-sheet.jpg: the targets in the capture sheet's cell order, <= 490 KB"""
    from PIL import Image
    CW, CH, GAP = 640, 560, 6
    cells = {int(p.name.split('-')[1]): p for p in Path(out).glob('mockup-[1-9]-*.jpg')}
    if not cells: return None
    img = Image.new('RGB', (CW * 3 + GAP * 4, CH * 3 + GAP * 4), '#111111')
    for n, p in cells.items():
        t = Image.open(p).convert('RGB'); t.thumbnail((CW, CH))
        x, y = GAP + (n - 1) % 3 * (CW + GAP), GAP + (n - 1) // 3 * (CH + GAP)
        img.paste(t, (x + (CW - t.width) // 2, y + (CH - t.height) // 2))
    path = Path(out) / 'mockup-sheet.jpg'
    for q in range(86, 30, -4):
        img.save(path, 'JPEG', quality=q)
        if path.stat().st_size < 490 * 1024: break
    return path


def main(argv=None):
    ap = argparse.ArgumentParser(description='image_gen targets for the look loop (docs/look-loop.md, step 3)')
    ap.add_argument('--captures', required=True, help='a views.mjs anchor folder (capture-<n>-<id>.jpg)')
    ap.add_argument('--out', required=True, help='where mockup-<n>-<id>.jpg land')
    ap.add_argument('--seed-mockup', default=None, help='ONE approved mockup: all 9 targets take its look')
    ap.add_argument('--style', default='', help='one paragraph of style: light, palette, materials, line')
    ap.add_argument('--style-file', default=None, help='the style paragraph from a file')
    ap.add_argument('--game', default='a stylised 3D web game', help='what the screenshot is of')
    ap.add_argument('--keep', default='', help='the named landmarks, structures and props to keep')
    ap.add_argument('--refs', default='', help='comma-separated style references (images after the seed)')
    ap.add_argument('--tag', default='', help='the captures\' views.mjs --tag')
    ap.add_argument('--only', default='', help='comma-separated frame numbers (a re-roll)')
    ap.add_argument('--parallel', type=int, default=5)
    ap.add_argument('--timeout', type=float, default=1500, help='seconds for the whole batch')
    ap.add_argument('--model', default=os.environ.get('CODEX_MODEL'), help='codex -m (default: codex\'s own)')
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args(argv)
    style = Path(a.style_file).read_text().strip() if a.style_file else a.style
    if not a.seed_mockup and not style:
        ap.error('pass --seed-mockup <approved mockup> or a --style paragraph')
    for f in [a.seed_mockup, *filter(None, a.refs.split(','))]:
        if f and not Path(f).is_file(): ap.error(f'no such image: {f}')
    captures = find_captures(a.captures, a.tag)
    if len(captures) == 0: sys.exit(f'targets: no {a.tag + "-" if a.tag else ""}capture-<n>-<id>.jpg in {a.captures}')
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    jobs = build_jobs(captures, out, seed=Path(a.seed_mockup).resolve() if a.seed_mockup else None,
                      refs=[Path(r).resolve() for r in filter(None, a.refs.split(','))],
                      only={int(x) for x in filter(None, a.only.split(','))},
                      game=a.game, style=style, keep=a.keep)
    (out / '.codex-runs').mkdir(exist_ok=True)
    (out / '.codex-runs' / 'jobs.json').write_text(json.dumps(jobs, indent=2) + '\n')
    if a.dry_run:
        for j in jobs: print(f"--- {j['id']} -> {j['out']}\n{j['prompt']}\n")
        return 0
    failed = run(jobs, out / '.codex-runs', parallel=a.parallel, timeout=a.timeout, model=a.model)
    path = sheet(out)
    if path: print(f'sheet: {path}')
    print('Read every target before you use it: re-roll one that added or moved objects, drifted the HUD, garbled text or'
          ' lit the scene from the wrong side (delete it, then --only=<n>).')
    if failed: print('failed:', ' '.join(failed)); return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
