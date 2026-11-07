"""DL23: one labelled board per recorded load (cold, warm), iPhone portrait frames from the Simulator recording at the
moments analyse.mjs found: the tap, the card's first frame, the download and Setup moving, the worst hold, control and
30 s of play. Every panel carries a burned-in label; the header carries the bar's verdicts.
  python3 -I scripts/loading-flow/board.py <run-dir> [<out.jpg>]   (after analyse.mjs wrote <run-dir>/timeline.json)
Grown from wildshard-v's E526 board (tmp/e526-sim/board.py)."""
import json
import os
import subprocess
import sys
import textwrap

from PIL import Image, ImageDraw, ImageFont

RUN = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(RUN, 'board.jpg')
F = '/System/Library/Fonts/Helvetica.ttc'
font, tfont, sfont = ImageFont.truetype(F, 17), ImageFont.truetype(F, 26), ImageFont.truetype(F, 17)
timeline = json.load(open(os.path.join(RUN, 'timeline.json')))
W, H, LAB, PAD, COLS = 228, 496, 112, 8, 12
LINES = {
    'reachesControl': 'reaches control', 'styledFromFirstFrame': 'card styled from frame 1',
    'cardMovesEverySecond': 'card moves every second', 'noLoadingFrameOver250ms': 'no loading frame > 250 ms',
    'everyLongStepNamed': 'no unnamed 3 s step', 'playNoFrameOver250ms': 'no play frame > 250 ms',
    'playSteadyFromSecondOne': 'normal fps from second 1', 'stuckShowsRetry': 'stuck load shows Retry',
    'playWalkedAndBoosted': 'walked + boosted after control',
}


def frame(video, at, path):
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', f'{max(0.0, at):.2f}', '-i', video, '-frames:v', '1',
                    '-vf', f'scale={W}:{H}', path], check=True)
    return Image.open(path)


def panels(mode, r):
    m, tap = r['milestones'], r['tapAtRecordingS']
    out = [(-0.5, 'before the tap: SHARD SELECT')]
    def add(key, text, shift=0.3):
        if key in m: out.append((m[key]['t'] + shift, text(m[key])))
    add('cardAppears', lambda v: f"t {v['t']:.1f} s: card's first frame, clock {v.get('clock')}" + ('' if v.get('styled') is not False else ' (UNSTYLED)'))
    out.append((1.0, 't 1.0 s: one second after the tap'))
    add('downloadMoves', lambda v: f"t {v['t']:.1f} s: download moves: {v['dl']}")
    add('setupMoves', lambda v: f"t {v['t']:.1f} s: Setup moves: {v['step']} ({v['pct']} %)")
    add('download100', lambda v: f"t {v['t']:.1f} s: download done: {v['dl']}")
    holds = sorted(r['cardStill_ge1s'], key=lambda s: -s['s'])[:1] + sorted([s for s in r['setupStalls_ge3s'] if not s['named']], key=lambda s: -s['s'])[:1]
    for h in holds:
        kind = 'card still' if 'dl' in h else 'unnamed step'
        out.append(((h['from'] + h['to']) / 2, f"t {h['from']:.1f}-{h['to']:.1f} s: {kind} {h['s']:.1f} s: {h['step']} ({h['pct']} %)"))
    lf = r['loading']
    if lf['longestFrameMs'] > 0:
        out.append((lf['longestFrameAt'] + 0.05, f"t {lf['longestFrameAt']:.1f} s: longest loading frame {lf['longestFrameMs']} ms"))
    c = r['controlS']
    if c is not None:
        out.append((c + 0.5, f't {c:.1f} s: control'))
        p = r['play']
        if p and p['frames'] > 0:
            out.append((c + 1.5, f"play second 1: {p['perSecond'][0]} fps, walking"))
            out.append((c + 15, f"control + 15 s: on the board at boost, {p['perSecond'][14]} fps"))
            out.append((p['longestFrameAt'] + 0.05, f"t {p['longestFrameAt']:.1f} s: longest play frame {p['longestFrameMs']} ms"))
            out.append((c + min(29.5, p['sampledS']), f"control + {min(29.5, p['sampledS']):.0f} s: {p['fps']} fps over the window, settled {p['settledFps']}"))
    else:
        out.append((r['loading']['longestFrameAt'], 'no control: last frame of the run'))
    out = sorted({round(t, 1): text for t, text in out}.items())[:COLS]
    return [(tap + t, text) for t, text in out]


rows = [mode for mode in ('cold', 'warm', 'upgrade') if mode in timeline]
board = Image.new('RGB', (COLS * (W + PAD) + PAD, 130 + len(rows) * (H + LAB + 84 + PAD)), (14, 18, 24))
d = ImageDraw.Draw(board)
build = (timeline.get('version') or {}).get('build', '?')
shard = next((timeline[m].get('shard') for m in rows if timeline[m].get('shard')), timeline.get('shard', '?'))
d.text((PAD, 10), f"{shard} load, build {build}, level download {timeline.get('levelDownload', 'shardfile')}: iPhone 17 Pro Simulator, Safari, portrait (DL23)", font=tfont, fill=(235, 245, 255))
d.text((PAD, 44), f"{timeline.get('base', '')} · t = seconds after the ENTER WORLD tap · bar: card moves every 1 s, styled from frame 1, no frame > 250 ms, no unnamed 3 s step, normal fps from play second 1", font=sfont, fill=(170, 190, 205))
d.text((PAD, 70), 'Simulator speed is not phone evidence: it compares runs on this Mac, the bar lines are what it proves.', font=sfont, fill=(170, 190, 205))
y = 100
tmp = os.path.join(RUN, '.board-frame.jpg')
for mode in rows:
    r = timeline[mode]
    play = r['play'] or {}
    mo = play.get('motion') or {}
    head = (f"{mode.upper()} {'PASS' if r['pass'] else 'FAIL'} · control {r['controlS']} s · loading frame max {r['loading']['longestFrameMs']} ms"
            f" · play {play.get('fps', '-')} fps ({play.get('source', '-')}), max frame {play.get('longestFrameMs', '-')} ms"
            f" · walked {mo.get('walkM', 0)} m, boosted {mo.get('boostM', 0)} m at up to {mo.get('boostTopMps', 0)} m/s")
    d.text((PAD, y), head, font=tfont, fill=(120, 255, 160) if r['pass'] else (255, 120, 110))
    x = PAD
    for k, ok in r['bar'].items():
        item = ('PASS ' if ok else 'FAIL ') + LINES.get(k, k) + '    '
        d.text((x, y + 32), item, font=sfont, fill=(120, 255, 160) if ok else (255, 120, 110))
        x += int(d.textlength(item, font=sfont))
    # the measure DL10 batches by (wildshard-new's ruling): the longest unpresented loading frame per Setup step
    slow = [f"{row['step']} {row['longestMs']} ms" for row in r['loading'].get('byStep', []) if row['longestMs'] > 250]
    d.text((PAD, y + 56), 'Loading frames > 250 ms by step: ' + (' · '.join(slow) if slow else 'none'), font=sfont, fill=(255, 225, 120) if slow else (120, 255, 160))
    y += 84
    for i, (at, text) in enumerate(panels(mode, r)):
        x = PAD + i * (W + PAD)
        board.paste(frame(os.path.join(RUN, f'{mode}-raw.mp4'), at, tmp), (x, y + LAB))
        d.rectangle([x, y, x + W, y + LAB - 2], fill=(30, 40, 52))
        for j, line in enumerate(textwrap.wrap(text, 25)[:5]):
            d.text((x + 6, y + 4 + j * 21), line, font=font, fill=(255, 225, 120) if j == 0 else (235, 240, 245))
    y += H + LAB + PAD
if os.path.exists(tmp):
    os.remove(tmp)
board.save(OUT, quality=52, optimize=True)
print(OUT, board.size, os.path.getsize(OUT) // 1024, 'KB')
