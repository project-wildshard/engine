#!/usr/bin/env bash
# browser-lane.sh — the machine-wide lane for headless game browsers (E312, Jake 2026-09-29).
#
# Every agent on this Mac (every repo: wildshard, rockhop, trials-gauntlet …) shares one box. Each open game tab costs
# ~1.5 cores and ~1 GB, and memory competes with the local-model jobs (they wait for anon memory < 70 GB). Before this
# script the "at most 3 browsers" rule was advice only; on 2026-09-29 there were 6–7 open and 25 load on 18 cores.
#
#   scripts/browser-lane.sh [--max <min>] <cmd …>   run <cmd> holding one lane slot; waits for a free one; the slot is
#                                                   released when <cmd> exits (crash included — a kernel lock).
#                                                   --max: <cmd> is killed after this many minutes (default 60)
#   scripts/browser-lane.sh status                  slots held, open browsers, which are outside the lane
#   scripts/browser-lane.sh wait                    block until the lane has room (before `agent-browser open`)
#   scripts/browser-lane.sh free                    exit 0 if the lane has room now, 1 if not (the hook asks this)
#   scripts/browser-lane.sh reap [--dry-run]        kill zombie browsers (see below) and stale scratch dev servers
#
# Lane size: BROWSER_LANES (default 4, Jake 2026-09-30). A slot counts as used when a lane run holds it OR a browser is open outside any
# lane run (agent-browser sessions, a script run without this wrapper), so the cap holds whoever opened what.
# The push gate has one reserved slot of its own on top (SF74 W19, speed audit #4): its webkit-smoke waited 125-277 s
# behind the agents' slots in 3 of 7 gates. It is taken only with BROWSER_LANE_PRIORITY=1 under the live push-gate
# lease (heavy-lane.py gate, checked by ancestry); the gate tries it first, then the shared slots. Agents keep 4.
#
# Reaping (runs before every wait, from the Stop / SessionStart hooks, and by hand):
#   - a headless Chromium (Playwright's chrome-headless-shell / chromium, agent-browser's Chrome) whose parent died
#     (re-parented to launchd, ppid 1): nothing can ever close it;
#   - any of them older than BROWSER_MAX_AGE_MIN (default 90) — no capture runs that long;
#   - vite servers (E317 — nobody runs `vite` dev any more; scripts/serve-build.sh builds + previews): a registered
#     preview past its expiry, an unregistered preview older than PREVIEW_MAX_AGE_H (default 6), a dev server older than
#     DEV_MAX_AGE_H (default 2); and served build dirs nothing serves any more;
#   - iOS Simulators, through scripts/sim-lane.sh reap (E316).
# The user's own desktop Chrome is never matched (only the ms-playwright / agent-browser binaries are).
# Log: ~/.browser-lane/reap.log.

set -uo pipefail

# E357 decision 105: 8 lanes while the GAME-NORMALIZATION lock holds (.github/lock.json "locked": true), else 4
LOCK_JSON="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.github/lock.json"
if [ -z "${BROWSER_LANES:-}" ] && grep -q '"locked": true' "$LOCK_JSON" 2>/dev/null; then BROWSER_LANES=8; fi
LANES="${BROWSER_LANES:-4}"
WAIT_SECONDS="${BROWSER_LANE_WAIT_SECONDS:-300}"
case "$WAIT_SECONDS" in ''|*[!0-9]*) echo "browser-lane: wait must be 1..300 seconds" >&2; exit 64;; esac
[ "$WAIT_SECONDS" -gt 0 ] && [ "$WAIT_SECONDS" -le 300 ] || { echo "browser-lane: wait must be 1..300 seconds" >&2; exit 64; }
DIR="$HOME/.browser-lane"
mkdir -p "$DIR"
MAX_AGE_MIN="${BROWSER_MAX_AGE_MIN:-90}"
AGENT_BROWSER_MAX_AGE_H="${AGENT_BROWSER_MAX_AGE_H:-24}"
# A detached proof (proof-run.sh, start_new_session) leaves a live browser with no parent; only a long-orphaned one is dead.
ORPHAN_MIN="${BROWSER_ORPHAN_MIN:-10}"
PREVIEW_MAX_AGE_H="${PREVIEW_MAX_AGE_H:-6}"
DEV_MAX_AGE_H="${DEV_MAX_AGE_H:-2}"
# BUILD-SPEED 1.3 (E491): the command must START with the browser binary, which may sit inside a "Google Chrome for
# Testing.app" bundle whose path has spaces; the old `[^ ]*` could never cross them, so no Chrome for Testing root was
# ever matched and a 4-day-old agent-browser Chrome survived every reap.
# Only the actual browser executable may contain spaces: a Framework directory
# in a Crashpad helper path is not the Chrome for Testing executable.
BROWSER_RE='^ *[0-9]+ +[0-9]+ +/[^ ]*/(ms-playwright|\.agent-browser/browsers)/([^ /]+/)*(Google Chrome for Testing\.app/Contents/MacOS/Google Chrome for Testing|chrome-headless-shell|Chromium|chrome)( |$)'
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

# seconds since a process started (ps etime: [[dd-]hh:]mm:ss)
age_s() {
  local e; e="$(ps -o etime= -p "$1" 2>/dev/null | tr -d ' ')"; [ -z "$e" ] && { echo 0; return; }
  local d=0 h=0 m=0 s=0
  if [[ "$e" == *-* ]]; then d="${e%%-*}"; e="${e#*-}"; fi
  IFS=: read -r -a p <<<"$e"
  case "${#p[@]}" in 3) h=${p[0]}; m=${p[1]}; s=${p[2]};; 2) m=${p[0]}; s=${p[1]};; *) s=${p[0]};; esac
  echo $(( 10#$d * 86400 + 10#$h * 3600 + 10#$m * 60 + 10#$s ))
}

# the root process of every open headless browser (not its --type= helpers): "pid ppid"
browser_roots() {
  ps -Ao pid=,ppid=,command= | grep -E "$BROWSER_RE" | grep -v -- '--type=' | grep -v grep | awk '{print $1, $2}'
}

# is pid a descendant of a lane run? (its ancestry holds a `browser-lane.sh _slot N` shell)
in_lane() {
  local p="$1" n=0 c
  while [ "$p" -gt 1 ] && [ $n -lt 40 ]; do
    c="$(ps -o command= -p "$p" 2>/dev/null)"
    [[ "$c" == *browser-lane.sh\ _slot\ * ]] && return 0
    p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"; [ -z "$p" ] && return 1
    n=$((n + 1))
  done
  return 1
}

# lane runs in progress: distinct slot numbers of the `_slot` shells (a shell's subshells repeat its command line)
held_slots() { ps -Ao command= | grep -E 'browser-lane\.sh _slot [0-9]+ ' | grep -v -E '^(lockf|grep)' | grep -oE '_slot [0-9]+' | sort -u | wc -l | tr -d ' '; }
outside_lane() { local n=0; while read -r pid _; do [ -z "$pid" ] && continue; in_lane "$pid" || n=$((n + 1)); done < <(browser_roots); echo "$n"; }
used() { echo $(( $(held_slots) + $(outside_lane) )); }

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$DIR/reap.log"; }

kill_tree() {
  local pid="$1" kids
  # Registered detached previews use their PID as PGID: expiry must retire every child in that owned session.
  if [ "$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')" = "$pid" ]; then
    kill -TERM -- "-$pid" 2>/dev/null
    sleep 2
    kill -KILL -- "-$pid" 2>/dev/null
    return 0
  fi
  kids="$(pgrep -P "$pid" 2>/dev/null)"
  kill -TERM "$pid" $kids 2>/dev/null
  sleep 2
  kill -KILL "$pid" $kids 2>/dev/null
  return 0
}

reap() {
  local dry="${1:-}" n=0 pid ppid a why cwd
  while read -r pid ppid; do
    [ -z "$pid" ] && continue
    a="$(age_s "$pid")"; why=""
    # BUILD-SPEED 1.3 A3 (E491): an agent-browser Chrome is a session someone may still be driving, so only its age
    # counts, and the limit is a day; a Playwright browser is a capture, orphaned or past MAX_AGE_MIN means dead.
    if [[ "$(ps -o command= -p "$pid" 2>/dev/null)" == *".agent-browser/browsers/"* ]]; then
      [ "$a" -gt $((AGENT_BROWSER_MAX_AGE_H * 3600)) ] && why="agent-browser session older than ${AGENT_BROWSER_MAX_AGE_H} h"
    elif [ "$ppid" = "1" ] && [ "$a" -gt $((ORPHAN_MIN * 60)) ]; then why="orphaned (parent gone) for over ${ORPHAN_MIN} min"
    elif [ "$a" -gt $((MAX_AGE_MIN * 60)) ]; then why="older than ${MAX_AGE_MIN} min"; fi
    [ -z "$why" ] && continue
    n=$((n + 1))
    if [ "$dry" = "--dry-run" ]; then echo "would reap browser $pid ($why, $((a / 60)) min)"; continue; fi
    log "reap browser $pid: $why, $((a / 60)) min, $(ps -o command= -p "$pid" | cut -c1-120)"
    echo "reaped browser $pid ($why)"
    kill_tree "$pid"
  done < <(browser_roots)
  # vite servers (E317: no dev servers — scripts/serve-build.sh builds and previews). Registered previews
  # (~/.dev-servers/<port>: "pid expiry dir cwd name") live until their expiry, and never past PREVIEW_MAX_AGE_H; an
  # unregistered preview for PREVIEW_MAX_AGE_H; a dev server (`vite` with neither build nor preview) for DEV_MAX_AGE_H.
  # `vite build` is left alone. A served dir is only ever deleted under the repo's tmp/serve (or legacy /private/tmp/).
  local reg="${SERVE_REG_DIR:-$HOME/.dev-servers}" f rpid exp dir rcwd name why serve_root
  serve_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/tmp/serve"
  for f in "$reg"/*; do
    [ -f "$f" ] || continue
    read -r rpid exp dir rcwd name < "$f"
    if ! kill -0 "$rpid" 2>/dev/null; then
      [ "$dry" = "--dry-run" ] || python3 "$(dirname "$SELF")/serve-shared-preview.py" reap-entry "$reg" "$(basename "$f")" "$rpid" "$dir" bash "$(dirname "$SELF")/serve-build.sh" stop "$(basename "$f")"
      continue
    fi
    why=""
    if [ "$exp" -lt "$(date +%s)" ]; then why="expired"
    elif [ "$(age_s "$rpid")" -gt $((PREVIEW_MAX_AGE_H * 3600)) ]; then why="older than ${PREVIEW_MAX_AGE_H} h"; fi
    [ -z "$why" ] && continue
    n=$((n + 1))
    if [ "$dry" = "--dry-run" ]; then echo "would reap preview :$(basename "$f") ($name, $why)"; continue; fi
    log "reap preview :$(basename "$f") pid $rpid ($name): $why"; echo "reaped preview :$(basename "$f") ($name, $why)"
    python3 "$(dirname "$SELF")/serve-shared-preview.py" reap-entry "$reg" "$(basename "$f")" "$rpid" "$dir" bash "$(dirname "$SELF")/serve-build.sh" stop "$(basename "$f")"
  done
  while read -r pid; do
    [ -z "$pid" ] && continue
    c="$(ps -o command= -p "$pid" 2>/dev/null)"
    [[ "$c" == *" build"* ]] && continue
    grep -qs "^$pid " "$reg"/* && continue
    a="$(age_s "$pid")"
    if [[ "$c" == *" preview"* ]]; then kind="preview"; lim=$((PREVIEW_MAX_AGE_H * 3600)); else kind="dev server"; lim=$((DEV_MAX_AGE_H * 3600)); fi
    [ "$a" -gt "$lim" ] || continue
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    n=$((n + 1))
    if [ "$dry" = "--dry-run" ]; then echo "would reap vite $kind $pid ($((a / 3600)) h, $cwd)"; continue; fi
    log "reap vite $kind $pid: $((a / 3600)) h old, cwd $cwd"
    echo "reaped vite $kind $pid ($((a / 3600)) h, $cwd)"
    kill_tree "$pid"
  done < <(pgrep -f 'vite/bin/vite\.js' 2>/dev/null)
  # served build dirs nothing serves or builds any more (a stopped or killed preview): no registry row and no live
  # process naming the dir. No age rule: a day of kept builds filled the disk (221 GB, 2026-10-02)
  find "${SERVE_BUILD_DIR:-$serve_root}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | while read -r d; do
    grep -qs " ${d%.stopped-*} " "$reg"/* && [[ "$d" != *.stopped-* ]] && continue
    pgrep -f "$d" >/dev/null 2>&1 && continue
    local removed
    removed="$(python3 "$(dirname "$SELF")/serve-shared-preview.py" reap-output "$reg" "${SERVE_BUILD_DIR:-$serve_root}" "$d" ${dry:+"$dry"})"
    if [ -n "$removed" ]; then echo "$removed"; [ "$dry" = "--dry-run" ] || log "$removed"; fi
  done
  [ "$dry" = "--dry-run" ] && [ $n -eq 0 ] && echo "no browser or vite server to reap"
  # iOS Simulators (E316)
  [ -x "$(dirname "$SELF")/sim-lane.sh" ] && bash "$(dirname "$SELF")/sim-lane.sh" reap "$dry"
  return 0
}

status() {
  echo "lane: $(used) / $LANES used ($(held_slots) lane runs, $(outside_lane) browsers outside the lane)"
  ps -Ao pid=,etime=,command= | awk '/browser-lane[.]sh _slot [0-9]+ / && !/awk/ { print "  holder " $0 }'
  while read -r pid ppid; do
    [ -z "$pid" ] && continue
    local tag="outside"; in_lane "$pid" && tag="lane"
    local parent; parent="$(ps -o command= -p "$ppid" 2>/dev/null | cut -c1-70)"
    printf '  browser %-6s %-7s %4s min  parent %s\n' "$pid" "$tag" "$(( $(age_s "$pid") / 60 ))" "${parent:-?}"
  done < <(browser_roots)
}

wait_room() {
  local said=0 deadline=$((SECONDS + WAIT_SECONDS)) remaining
  while [ "$(used)" -ge "$LANES" ]; do
    reap >/dev/null
    [ "$(used)" -lt "$LANES" ] && break
    [ $said -eq 0 ] && { echo "browser-lane: all $LANES slots in use, waiting … (scripts/browser-lane.sh status)" >&2; said=1; }
    remaining=$((deadline - SECONDS))
    [ "$remaining" -gt 0 ] || { echo "browser-lane: admission timed out after ${WAIT_SECONDS}s" >&2; status >&2; return 75; }
    [ "$remaining" -lt 10 ] || remaining=10
    sleep "$remaining"
  done
}

# J148: name any listener outside localhost. Warn only: a lane never waits on a macOS service.
warn_listeners() {
  [ "$(uname)" = Darwin ] || return 0
  node "$(dirname "$SELF")/check-listeners.mjs" --warn >&2 || true
}

case "${1:-}" in
  status) status; exit 0;;
  capacity) n=$(used); free=$((LANES - n)); [ "$free" -lt 0 ] && free=0; printf '%s %s\n' "$LANES" "$free"; exit 0;;
  reap) reap "${2:-}"; exit 0;;
  free) [ "$(used)" -lt "$LANES" ]; exit $?;;
  wait) warn_listeners; wait_room; exit $?;;
  ''|-h|--help) sed -n '2,30p' "$SELF"; exit 0;;
  _slot)
    # the slot's shell, run under the kernel lease for N: re-check the cap (a browser may have opened outside the lane
    # since), then run <cmd> as a child — not exec: this command line is how in_lane() finds the browsers under it —
    # with a hard timeout. Exit 75 without the marker = the cap was full after all; the caller tries again.
    slot="$2"; marker="$3"; max="$4"; shift 4
    [ "$slot" = gate ] || [ "$(used)" -le "$LANES" ] || exit 75 # the gate's reserved slot is not one of the agents' 4
    : > "$marker"
    # P1: preserve caller stdin for a lane-held browser server (bash otherwise gives an async child /dev/null).
    exec 9<&0
    if [ "${BROWSER_SLOT_LOCK_FD:-}" = 8 ]; then
      ( exec 8>&-; unset BROWSER_SLOT_LOCK_FD; exec "$@" <&9 ) & child=$!
    else
      "$@" <&9 & child=$!
    fi
    exec 9<&-
    ( if [ "${BROWSER_SLOT_LOCK_FD:-}" = 8 ]; then exec 8>&-; unset BROWSER_SLOT_LOCK_FD; fi
      sleep $((max * 60))
      if kill -0 "$child" 2>/dev/null; then
        echo "browser-lane: killed after ${max} min (--max)" >&2; log "slot $slot: killed $* after ${max} min"
        kill_tree "$child"
      fi ) 2>/dev/null & timer=$!
    trap 'kill_tree "$child"' INT TERM
    wait "$child"; rc=$?
    # Kill the timeout sleep before its parent, so it cannot be orphaned while holding caller pipes open.
    pkill -P "$timer" 2>/dev/null; kill "$timer" 2>/dev/null
    exit $rc;;
esac

MAX_MIN=60
if [ "${1:-}" = "--max" ]; then MAX_MIN="${2:?--max needs minutes}"; shift 2; fi
[ "${1:-}" = "--" ] && shift
[ $# -gt 0 ] || { echo "usage: browser-lane.sh [--max <min>] <cmd …>" >&2; exit 64; }
warn_listeners

# Keep the native BSD path on the shared Mac. Linux CI uses the same
# nonblocking kernel lease through Python's POSIX flock; no lock binary install.
if command -v lockf >/dev/null 2>&1; then
  slot_lock() { lockf -s -t 0 "$@"; }
elif command -v python3 >/dev/null 2>&1; then
  slot_lock() { python3 "$(dirname "$SELF")/browser-slot-lock.py" "$@"; }
else
  echo 'browser-lane: no supported slot lock (BSD lockf or Python POSIX flock)' >&2
  exit 69
fi

# SF74 W19: the push gate (priority flag + an actual push-gate lease ancestor, not a copied env var) has a reserved slot
slots="$(seq 0 $((LANES - 1)))"
if [ "${BROWSER_LANE_PRIORITY:-0}" = 1 ] && node --input-type=module -e \
  "import {assertHeavyLease} from '$(dirname "$SELF")/heavy-lane-lease.mjs'; assertHeavyLease('push-gate');" >/dev/null 2>&1; then
  slots="gate $slots"
fi
said=0
deadline=$((SECONDS + WAIT_SECONDS))
while :; do
  [ "$SECONDS" -lt "$deadline" ] || { echo "browser-lane: admission timed out after ${WAIT_SECONDS}s" >&2; status >&2; exit 75; }
  reap >/dev/null
  for i in $slots; do
    marker="$DIR/got.$$.$i"; rm -f "$marker"
    slot_lock "$DIR/slot-$i.lock" bash "$SELF" _slot "$i" "$marker" "$MAX_MIN" "$@"
    rc=$?
    if [ -e "$marker" ]; then rm -f "$marker"; exit $rc; fi
    # Only contention/cap rejection can wait. A broken lock primitive is a
    # delivery failure, not four occupied slots for another five minutes.
    [ "$rc" -eq 75 ] || { echo "browser-lane: slot lock failed (exit $rc)" >&2; exit "$rc"; }
  done
  [ $said -eq 0 ] && { echo "browser-lane: all $LANES slots in use, waiting … (scripts/browser-lane.sh status)" >&2; said=1; }
  # the serialized push gate polls every second (BROWSER_LANE_PRIORITY=1): with ten lanes re-taking freed slots on a 10 s poll,
  # the gate's WebKit smoke starved for minutes while it held the heavy lane every suite waits on
  remaining=$((deadline - SECONDS))
  [ "$remaining" -gt 0 ] || continue
  interval=10; [ "${BROWSER_LANE_PRIORITY:-0}" = 1 ] && interval=1
  [ "$remaining" -lt "$interval" ] || remaining="$interval"
  sleep "$remaining"
done
