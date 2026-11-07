#!/usr/bin/env bash
# proof-run.sh — run a long proof detached, write its result, and ping the lane that started it (SF74 W5).
#
# Why (process audit 2026-10-09): ~11 agent-hours in 12 h went to polling soaks, frame floors, boot smokes and
# Simulator runs ("sleep; tail the log; sleep"). Start the proof here instead and keep working: when it ends, the
# result lands in .git/proofs/<id>.json and herdr types one line into your pane with the verdict and the log path.
#
#   scripts/proof-run.sh <label> -- <command…>     prints the id, the log and the result paths, returns at once
#   scripts/proof-run.sh status [<id>]             the result JSON (or every running / finished proof, newest first)
#
# The command runs in its own session (it survives your shell), with your cwd and environment, under the lanes it asks
# for itself (browser-lane.sh, sim-lane.sh, heavy-lane.py): this runner adds no lease. The ping goes to the pane that
# started it (HERDR_PANE_ID); without herdr the result file is the only signal. Logs: .git/proofs/<id>.log.
set -uo pipefail
common="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || { echo "proof-run: not in a git checkout" >&2; exit 2; }
dir="$common/proofs"
mkdir -p "$dir"

if [ "${1:-}" = status ]; then
  if [ -n "${2:-}" ]; then cat "$dir/$2.json"; else ls -1t "$dir"/*.json 2>/dev/null | head -20 | while read -r f; do cat "$f"; echo; done; fi
  exit 0
fi

if [ "${1:-}" = --detached ]; then
  shift
  id="$1" label="$2" pane="$3"; shift 4 # the 4th is the literal --
  log="$dir/$id.log" result="$dir/$id.json"
  json() { node -e 'const [id, label, state, rc, start, end, log, pane, cmd] = process.argv.slice(1); console.log(JSON.stringify({ id, label, state, rc: rc === "" ? null : Number(rc), startedAt: Number(start), endedAt: end === "" ? null : Number(end), log, pane, command: cmd }));' "$@"; }
  start="$(date +%s)"
  json "$id" "$label" running "" "$start" "" "$log" "$pane" "$*" > "$result"
  "$@" > "$log" 2>&1
  rc=$?
  end="$(date +%s)"
  state=passed; [ "$rc" = 0 ] || state=failed
  json "$id" "$label" "$state" "$rc" "$start" "$end" "$log" "$pane" "$*" > "$result"
  if [ -n "$pane" ] && command -v herdr >/dev/null 2>&1; then
    tail_line="$(grep -v '^\s*$' "$log" | tail -1 | cut -c1-160)"
    herdr agent prompt "$pane" "[proof-run] $label $state (rc $rc, $((end - start)) s): $result. Last line: $tail_line" >/dev/null 2>&1 || true
  fi
  rm -f "$0" # this run's private snapshot
  exit 0
fi

label="${1:-}"
[ -n "$label" ] && [ "${2:-}" = -- ] && [ -n "${3:-}" ] || { echo "usage: scripts/proof-run.sh <label> -- <command…> | status [<id>]" >&2; exit 2; }
shift 2
id="$(date +%Y%m%dT%H%M%S)-$(printf '%s' "$label" | tr -c 'A-Za-z0-9_-' '-' | cut -c1-40)-$$"
snap="$(mktemp -t proof-run)" && cp "$0" "$snap" || exit 1
# Keep the launcher alive until the child has its own session. Returning while Python is still
# starting lets a tool's parent-shell cleanup kill the child before setsid, leaving no result or ping.
python3 -c '
import os, sys
reader, writer = os.pipe()
pid = os.fork()
if pid:
    os.close(writer)
    detached = os.read(reader, 1)
    os.close(reader)
    sys.exit(0 if detached == b"1" else 1)
os.close(reader)
os.setsid()
os.write(writer, b"1")
os.close(writer)
os.execvp(sys.argv[1], sys.argv[1:])
' bash "$snap" --detached "$id" "$label" "${HERDR_PANE_ID:-}" -- "$@" < /dev/null > /dev/null 2>&1 \
  || { echo "proof-run: could not detach $id" >&2; exit 1; }
echo "proof-run: started $id"
echo "  log:    $dir/$id.log"
echo "  result: $dir/$id.json (your pane is pinged when it ends; no need to poll)"
