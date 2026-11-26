#!/bin/bash
# Records progress/progress-video.mp4: a scripted fly-through of the chunk captured headlessly
# frame by frame (agent-browser eval → screenshot), then encoded with ffmpeg.
#   usage: src/scripts/progress-video.sh [fps=8] [seconds=40] [url=http://localhost:5173/]
set -e
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SELF")/../.."
if [ "${WS_AGENT_BROWSER_TASK:-}" != 1 ]; then
  exec node src/scripts/agent-browser-session.mjs -- env WS_AGENT_BROWSER_TASK=1 bash "$SELF" "$@"
fi
FPS=${1:-8}; SECS=${2:-40}; URL=${3:-http://localhost:5173/}
S="${AGENT_BROWSER_SESSION:?run through agent-browser-session.mjs}"
TASK="tmp/${WS_LANE_NAME:-browser-task}"
mkdir -p "$TASK"
OUT=$(mktemp -d "$TASK/progress-video.XXXXXX")
trap 'rm -rf "$OUT"' EXIT
agent-browser --session "$S" open "$URL" >/dev/null
agent-browser --session "$S" set viewport 402 874 >/dev/null
# wait for the world (the loading screen + intro take a few seconds)
for i in $(seq 1 60); do agent-browser --session $S eval "typeof window.__wildshard?.world !== 'undefined'" 2>/dev/null | grep -q true && break; sleep 1; done
sleep 2
N=$((FPS * SECS))
for ((i=0; i<N; i++)); do
  T=$(python3 -c "print($i/$FPS)")
  # HMR reloads from concurrent edits drop window.__wildshard?.world for a few seconds — wait and retry
  until agent-browser --session $S eval "window.__wildshard.world.tour.active = true; window.__wildshard.world.tour.time = $T; window.__wildshard.world.crossbow.model.visible = true; 'ok'" 2>/dev/null | grep -q ok; do sleep 1; done
  sleep 0.15
  agent-browser --session $S screenshot "$OUT/$(printf %05d $i).png" >/dev/null
  [ $((i % 20)) -eq 0 ] && echo "frame $i / $N"
done
agent-browser --session $S close >/dev/null
ffmpeg -v error -y -framerate $FPS -i "$OUT/%05d.png" -vf "scale=402:874,format=yuv420p" -r 30 -c:v libx264 -crf 19 -pix_fmt yuv420p "$TASK/progress-video.mp4"
rm -rf "$OUT"
echo "wrote $TASK/progress-video.mp4 ($N frames @ ${FPS}fps)"
