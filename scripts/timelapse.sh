#!/bin/bash
# Assemble progress/timelapse.mp4 from the screenshots in progress/, in capture (mtime) order —
# the numeric prefixes collide across parallel workstreams, so name order is not chronological.
# Each frame is scaled to 1600x900 and captioned with its title (from the filename), 0.7 s per
# frame with a 2 s hold on the last one.
#   usage: scripts/timelapse.sh [seconds-per-frame=0.7]
set -e
cd "$(dirname "$0")/.."
DUR=${1:-0.7}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

python3 - "$TMP" <<'PY'
import glob, os, re, sys
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]
files = sorted(glob.glob("progress/[0-9]*.png"), key=os.path.getmtime)
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 34)
small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
W, H = 1600, 900
for i, f in enumerate(files):
    title = re.sub(r"^\d+-", "", os.path.splitext(os.path.basename(f))[0]).replace("-", " ")
    im = Image.open(f).convert("RGB")
    im.thumbnail((W, H))
    frame = Image.new("RGB", (W, H), "#050810")
    frame.paste(im, ((W - im.width) // 2, (H - im.height) // 2))
    d = ImageDraw.Draw(frame, "RGBA")
    d.rectangle([0, H - 80, W, H], fill=(5, 8, 16, 170))
    d.text((32, H - 62), title, font=font, fill="white")
    d.text((W - 32, H - 52), f"{i + 1} / {len(files)}", font=small, fill=(200, 205, 215), anchor="ra")
    frame.save(f"{out}/{i:04d}.png")
print(len(files))
PY

N=$(ls "$TMP"/*.png | wc -l | tr -d ' ')
LIST="$TMP/list.txt"
for f in "$TMP"/*.png; do
  echo "file '$f'" >> "$LIST"; echo "duration $DUR" >> "$LIST"
done
last=$(ls "$TMP"/*.png | tail -1); echo "file '$last'" >> "$LIST"; echo "duration 2" >> "$LIST"
echo "file '$last'" >> "$LIST"
ffmpeg -v error -y -f concat -safe 0 -i "$LIST" \
  -vf "format=yuv420p" -r 30 -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart progress/timelapse.mp4
echo "wrote progress/timelapse.mp4 ($N frames @ ${DUR}s)"
