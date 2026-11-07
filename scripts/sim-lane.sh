#!/usr/bin/env bash
# sim-lane.sh — the machine-wide lane for iOS Simulators, and their reaper (E316, Jake 2026-09-29: "iOS simulators can be
# garbage collected. If no one's using them, kill them … we need to free up more memory").
#
# A booted Simulator costs ~6 GB and ~300 processes. On 2026-09-29 two sat booted (one for 18 h, driven by nobody) while
# the Mac had 1.5 GB free and the model jobs waited for memory.
#
#   scripts/sim-lane.sh run [--max <min>] [--keep] <device> <cmd …>
#        boot <device> (frame-floor-iphone-17-pro, wildshard-loading or wildshard-iphone, by name or UDID; G563: no other device
#        is ever created, a missing wildshard-iphone is made as an iPhone 17 Pro on the newest iOS runtime), run
#        <cmd> holding the lane, shut the device down after (--keep leaves it booted under a 30 min lease). <cmd> is
#        killed after --max minutes (default 60). $SIM_UDID is set for <cmd>.
#   scripts/sim-lane.sh lease <device> [<min>]      boot (if needed) and hold it for <min> minutes (default 30) while you
#                                                   drive it by hand; call again to renew. Prints the UDID.
#   scripts/sim-lane.sh release <device>            shut it down and drop the lease (do this when you are done)
#   scripts/sim-lane.sh status                      booted devices, uptime, lease, who is driving them
#   scripts/sim-lane.sh wait                        block until the lane has room
#   scripts/sim-lane.sh reap [--dry-run]            shut down idle Simulators (below); quit Simulator.app when none is left
#
# Lane size: SIM_LANES (default 1) booted devices machine-wide, whoever booted them.
# Reaping (also run by browser-lane.sh reap, so from the SessionStart / Stop / SubagentStop hooks and every lane wait):
# a booted device is shut down when its lease expired, or when it has no lease and has been up SIM_IDLE_MIN (default 30)
# minutes — unless a process outside the Simulator is driving it (its UDID or name on a command line: simctl io
# recordVideo, xcodebuild, a node script …), or a `run` is in progress on it. Log: ~/.sim-lane/reap.log.

set -uo pipefail

LANES="${SIM_LANES:-1}"
WAIT_SECONDS="${SIM_LANE_WAIT_SECONDS:-300}"
case "$WAIT_SECONDS" in ''|*[!0-9]*) echo "sim-lane: wait must be 1..300 seconds" >&2; exit 64;; esac
[ "$WAIT_SECONDS" -gt 0 ] && [ "$WAIT_SECONDS" -le 300 ] || { echo "sim-lane: wait must be 1..300 seconds" >&2; exit 64; }
WAIT_DEADLINE=$((SECONDS + WAIT_SECONDS))
IDLE_MIN="${SIM_IDLE_MIN:-30}"
DIR="${SIM_LANE_DIR:-$HOME/.sim-lane}"
mkdir -p "$DIR"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$DIR/reap.log"; }
now() { date +%s; }

booted() { xcrun simctl list devices booted -j 2>/dev/null | jq -r '.devices[][] | "\(.udid)\t\(.name)"'; }
booted_count() { booted | grep -c . ; }

# seconds a device has been up (its launchd_sim's age)
uptime_s() {
  local pid e d=0 h=0 m=0 s=0
  pid="$(ps -Ao pid=,command= | grep launchd_sim | grep "$1" | grep -v grep | awk '{print $1}' | head -1)"
  [ -z "$pid" ] && { echo 0; return; }
  e="$(ps -o etime= -p "$pid" | tr -d ' ')"
  if [[ "$e" == *-* ]]; then d="${e%%-*}"; e="${e#*-}"; fi
  IFS=: read -r -a p <<<"$e"
  case "${#p[@]}" in 3) h=${p[0]}; m=${p[1]}; s=${p[2]};; 2) m=${p[0]}; s=${p[1]};; *) s=${p[0]};; esac
  echo $(( 10#$d * 86400 + 10#$h * 3600 + 10#$m * 60 + 10#$s ))
}

# processes outside the Simulator whose command line names the device (who is driving it)
drivers() {
  local udid="$1" name="$2"
  ps -Ao pid=,command= | grep -F -e "$udid" -e "$name" | grep -v -e grep -e "CoreSimulator/Devices/$udid" -e launchd_sim \
    -e 'sim-lane.sh reap' -e 'sim-lane.sh status' | grep -v -E '^ *[0-9]+ (/bin/)?(ba)?sh -c .*sim-lane\.sh (reap|status)' | cut -c1-140
}

# lease file: "<expiry epoch> <owner pid or 0>"
lease_file() { echo "$DIR/$1.lease"; }
lease_valid() {
  local f; f="$(lease_file "$1")"; [ -f "$f" ] || return 1
  local exp pid; read -r exp pid < "$f"
  [ "${pid:-0}" != "0" ] && kill -0 "$pid" 2>/dev/null && return 0   # a `run` in progress
  [ "${exp:-0}" -gt "$(now)" ]
}

# G563 (Jake): the machine keeps three named devices; a lane never makes another (each new name was a 2-4 GB device).
DEFAULT_DEVICE=wildshard-iphone
DEVICES="frame-floor-iphone-17-pro wildshard-loading $DEFAULT_DEVICE"
resolve() {  # named device → UDID/runtime pair (only the default is created, when missing)
  local want="${1:-$DEFAULT_DEVICE}" u row name rt
  row="$(xcrun simctl list devices -j | jq -r --arg w "$want" '.devices | to_entries[] | .key as $runtime | .value[] | select(.udid == $w or .name == $w) | "\(.udid)\t\(.name)\t\($runtime)"' | head -1)"
  IFS=$'\t' read -r u name rt <<< "$row"
  case " $DEVICES " in *" ${name:-$want} "*) ;; *)
    echo "sim-lane: refusing device '$want': use one of $DEVICES (default $DEFAULT_DEVICE); lanes never create devices" >&2; exit 1;;
  esac
  if [ -z "$u" ] && [ "$want" != "$DEFAULT_DEVICE" ]; then
    echo "sim-lane: device '$want' does not exist on this Mac; use $DEFAULT_DEVICE" >&2; exit 1
  fi
  if [ -z "$u" ]; then
    local dt
    rt="$(xcrun simctl list runtimes -j | jq -r '[.runtimes[] | select(.platform == "iOS" and .isAvailable)] | last | .identifier')"
    dt="$(xcrun simctl list devicetypes -j | jq -r '[.devicetypes[] | select(.name | test("^iPhone 17 Pro$"))] | first | .identifier')"
    [ "$dt" = "null" ] && dt="$(xcrun simctl list devicetypes -j | jq -r '[.devicetypes[] | select(.name | test("^iPhone"))] | last | .identifier')"
    u="$(xcrun simctl create "$want" "$dt" "$rt")" || { echo "sim-lane: could not create $want" >&2; exit 1; }
    echo "sim-lane: created $want ($u)" >&2
  fi
  # Carry the pair from this locked inventory read; no sidecar can go stale.
  printf '%s\t%s\n' "$u" "$rt"
}

# FD locks keep a stable inode and live until the owning shell closes the descriptor. Resolve/create and boot
# admission are atomic machine-wide; the device lock lasts through command completion and shutdown (SF0d).
locked_resolve() (
  exec 9>"$DIR/admission.lock"
  remaining=$(wait_remaining) || exit "$?"
  lockf -s -t "$remaining" 9 || { wait_failed; exit 75; }
  resolve "$1"
)
lock_device() {
  exec 8>"$DIR/$1.drive.lock"
  local remaining
  remaining=$(wait_remaining) || return "$?"
  lockf -s -t "$remaining" 8 || { wait_failed; return 75; }
  # A wrapper started before SF0d has no drive lock. Let its live owner finish before adopting the device.
  local f exp pid
  f="$(lease_file "$1")"
  while [ -f "$f" ]; do
    read -r exp pid < "$f" || break
    [ "${pid:-0}" != "0" ] && [ "$pid" != "$$" ] && kill -0 "$pid" 2>/dev/null || break
    wait_remaining >/dev/null || return "$?"
    sleep 1
  done
}

is_booted() { booted | cut -f1 | grep -qx "$1"; }

shutdown_dev() {
  xcrun simctl shutdown "$1" >/dev/null 2>&1
  rm -f "$(lease_file "$1")"
  [ "$(booted_count)" -eq 0 ] && quit_app
  return 0
}

# Quit Simulator.app once nothing is booted, idempotently and quietly. A Simulator.app that ignores the AppleScript quit
# (2026-10-09: pid 51352, up 14 days, "quit" from every Stop hook 2,024 times in 12 h) gets one SIGTERM on a later reap,
# then is left alone: each step runs and logs once per app PID ($DIR/app-quit.<pid> holds "quit" or "term").
quit_app() {
  local pid f step
  pid="$(pgrep -x Simulator | head -1)"
  [ -z "$pid" ] && { rm -f "$DIR"/app-quit.* 2>/dev/null; return 0; }
  f="$DIR/app-quit.$pid"; step="$(cat "$f" 2>/dev/null)"
  case "$step" in
    "") osascript -e 'quit app "Simulator"' >/dev/null 2>&1; echo quit > "$f"; log "quit Simulator.app pid $pid (nothing booted)";;
    quit) kill -TERM "$pid" 2>/dev/null; echo term > "$f"; log "Simulator.app pid $pid ignored quit; sent SIGTERM once";;
    *) ;; # already asked twice: leave it, say nothing
  esac
  for f in "$DIR"/app-quit.*; do [ -e "$f" ] && [ "${f##*.}" != "$pid" ] && rm -f "$f"; done
  return 0
}

reap_device() (
  local udid="$1" name="$2" dry="$3" up why d
  exec 8>"$DIR/$udid.drive.lock"
  lockf -s -t 0 8 || exit 0 # a run owns the device, including before it writes its lease
  lease_valid "$udid" && exit 0
  d="$(drivers "$udid" "$name")"
  [ -n "$d" ] && exit 0
  up="$(uptime_s "$udid")"; why=""
  if [ -f "$(lease_file "$udid")" ]; then why="lease expired"
  elif [ "$up" -gt $((IDLE_MIN * 60)) ]; then why="no lease, idle, up $((up / 60)) min"; fi
  [ -z "$why" ] && exit 0
  if [ "$dry" = "--dry-run" ]; then echo "would shut down simulator $name ($udid): $why"
  else log "shutdown $name ($udid): $why"; echo "shut down simulator $name ($why)"; shutdown_dev "$udid"; fi
  exit 2 # tell the parent one idle device was found
)
reap() {
  local dry="${1:-}" n=0 udid name
  while IFS=$'\t' read -r udid name; do
    [ -z "$udid" ] && continue
    reap_device "$udid" "$name" "$dry"
    [ "$?" -eq 2 ] && n=$((n + 1))
  done < <(booted)
  [ "$dry" = "--dry-run" ] && [ $n -eq 0 ] && echo "no idle simulator"
  [ "$dry" != "--dry-run" ] && [ "$(booted_count)" -eq 0 ] && quit_app
  return 0
}

status() {
  echo "simulators: $(booted_count) / $LANES booted"
  while IFS=$'\t' read -r udid name; do
    [ -z "$udid" ] && continue
    local l="no lease" f; f="$(lease_file "$udid")"
    if [ -f "$f" ]; then read -r exp pid < "$f"; if [ "${pid:-0}" != "0" ] && kill -0 "$pid" 2>/dev/null; then l="run in progress (pid $pid)"; else l="lease $(( (exp - $(now)) / 60 )) min left"; fi; fi
    printf '  %-20s %s  up %4s min  %s\n' "$name" "$udid" "$(( $(uptime_s "$udid") / 60 ))" "$l"
    drivers "$udid" "$name" | sed 's/^/      driven by: /'
  done < <(booted)
  return 0
}

wait_room() {  # $1 = a UDID that may already be booted (it doesn't need a new slot)
  local said=0 remaining
  while :; do
    [ -n "${1:-}" ] && is_booted "$1" && return 0
    [ "$(booted_count)" -lt "$LANES" ] && return 0
    bash "$SELF" reap 8>&- 9>&- >/dev/null
    [ "$(booted_count)" -lt "$LANES" ] && return 0
    [ $said -eq 0 ] && { echo "sim-lane: $LANES simulator(s) already booted, waiting … (scripts/sim-lane.sh status)" >&2; said=1; }
    remaining=$(wait_remaining) || return "$?"
    [ "$remaining" -lt 15 ] || remaining=15
    sleep "$remaining"
  done
}

native_stage() {
  local label="$1" started=$SECONDS rc
  shift
  printf 'sim-lane: %s started\n' "$label" >&2
  startup "$@"; rc=$?
  printf 'sim-lane: %s finished in %ss (exit %s)\n' "$label" "$((SECONDS - started))" "$rc" >&2
  return "$rc"
}

boot() {
  local started=0 rc
  if ! is_booted "$1"; then
    local runtime="${2:-}"
    if [[ "$runtime" != com.apple.CoreSimulator.SimRuntime.iOS-* ]]; then
      echo 'sim-lane: missing exact iOS runtime binding for the owned device' >&2
      return 64
    fi
    # Apple documents this prerequisite for slow first boots in Xcode 26.x.
    # No --force, purge or all-runtime work. It spends the same admission
    # clock; native success is not a boot, launch or frame-readiness proof.
    printf 'sim-lane: preparing runtime %s for owned device %s\n' "$runtime" "$1" >&2
    native_stage 'selected runtime dyld cache readiness' xcrun simctl runtime dyld_shared_cache update "$runtime" >&2 || return "$?"
    wait_remaining >/dev/null || return "$?"
    native_stage 'device boot' xcrun simctl boot "$1" >/dev/null || return "$?"
    started=1
  fi
  # CI drives the booted device headlessly: Inspector uses its RWI socket,
  # route captures use Page.snapshotRect, and diagnostics use simctl io.
  # A desktop presentation host is not a native Safari/frame prerequisite.
  # Local interactive calls retain presentation after native migration.
  local developer="${DEVELOPER_DIR:-}" presentation=0
  if [ "${GITHUB_ACTIONS:-}" != true ] && [ "$started" -eq 1 ] && [[ "$developer" = /* ]] && [ -f "$developer/usr/bin/simctl" ] && [ -x "$developer/usr/bin/simctl" ]; then
    presentation=1
  fi
  # Preserve migration/system-app progress in the native failure artifact.
  # Lease stdout still contains only the exact device identifier.
  # One imported helper owns bootstatus and Safari. Its imports spend the
  # remaining admission budget; only a real successful native exit starts
  # the separate original 120 s Safari proof. No status-text interpretation.
  local remaining
  remaining=$(wait_remaining) || return "$?"
  if [ "$presentation" -eq 1 ]; then
    python3 "$(dirname "$SELF")/sim-safari-ready.py" "$1" --bootstatus "$remaining" --present
  else
    python3 "$(dirname "$SELF")/sim-safari-ready.py" "$1" --bootstatus "$remaining"
  fi
  rc=$?
  # A failed startup owns no lease. Release only the device this call booted.
  if [ "$rc" -ne 0 ] && [ "$started" -eq 1 ]; then shutdown_dev "$1"; fi
  return "$rc"
}

boot_in_lane() {
  local rc remaining
  while :; do
    wait_room "$1" || return "$?"
    exec 9>"$DIR/admission.lock"
    remaining=$(wait_remaining) || { exec 9>&-; return 75; }
    lockf -s -t "$remaining" 9 || { exec 9>&-; wait_failed; return 75; }
    if is_booted "$1" || [ "$(booted_count)" -lt "$LANES" ]; then
      boot "$1" "${2:-}"; rc=$?; exec 9>&-; return "$rc"
    fi
    exec 9>&- # someone admitted another device between the capacity check and the lock
  done
}

wait_failed() {
  echo "sim-lane: admission timed out after ${WAIT_SECONDS}s; lock/lease holders:" >&2
  status >&2
  for f in "$DIR"/*.lease; do [ -f "$f" ] && { printf '  %s ' "$f" >&2; cat "$f" >&2; }; done
  ps -Ao pid=,etime=,command= | awk '/sim-lane[.]sh (run|lease|release)/ && !/awk/ { print "  holder " $0 }' >&2
  return 75
}

wait_remaining() {
  local remaining=$((WAIT_DEADLINE - SECONDS))
  [ "$remaining" -gt 0 ] || { wait_failed; return 75; }
  echo "$remaining"
}

startup() {
  local remaining rc
  remaining=$(wait_remaining) || return "$?"
  python3 -c 'import sys,time
started=time.monotonic()
import subprocess
try:
    limit=int(sys.argv[1])
    remaining=limit-(time.monotonic()-started)
    if remaining<=0: sys.exit(75)
    result=subprocess.run(sys.argv[2:],timeout=remaining,check=False)
    code=result.returncode if result.returncode >= 0 else 128-result.returncode
    if code==0 and time.monotonic()-started>=limit: code=75
    sys.exit(code)
except subprocess.TimeoutExpired:
    sys.exit(75)
' "$remaining" "$@"
  rc=$?
  # Interpreter loading precedes its first monotonic sample. The original
  # shell admission clock also covers that gap, including live renewal.
  if [ "$rc" -eq 0 ]; then wait_remaining >/dev/null || return "$?"; fi
  [ "$rc" -ne 75 ] || wait_failed
  return "$rc"
}

case "${1:-}" in
  status) status;;
  reap) reap "${2:-}";;
  wait) wait_room "";;
  lease)
    dev="${2:?lease <device> [min]}"; min="${3:-30}"
    resolved="$(locked_resolve "$dev")" || exit "$?"
    IFS=$'\t' read -r udid device_runtime <<< "$resolved"
    lock_device "$udid" || exit "$?"
    if is_booted "$udid" && lease_valid "$udid"; then
      # Renewing a live manual lease must not navigate its Safari page away.
      startup xcrun simctl bootstatus "$udid" -b >/dev/null || exit "$?"
    else
      boot_in_lane "$udid" "$device_runtime" || exit "$?"
    fi
    echo "$(( $(now) + min * 60 )) 0" > "$(lease_file "$udid")"
    echo "$udid"; echo "sim-lane: $dev leased for $min min — renew with the same command, end with: scripts/sim-lane.sh release $dev" >&2;;
  release)
    resolved="$(locked_resolve "${2:?release <device>}")" || exit "$?"
    udid="${resolved%%$'\t'*}"
    lock_device "$udid" || exit "$?"
    shutdown_dev "$udid"; log "released $udid"; echo "released $2";;
  run)
    shift; max=60; keep=0
    while :; do case "${1:-}" in --max) max="$2"; shift 2;; --keep) keep=1; shift;; *) break;; esac; done
    dev="${1:?run <device> <cmd …>}"; shift
    [ $# -gt 0 ] || { echo "usage: sim-lane.sh run [--max <min>] [--keep] <device> <cmd …>" >&2; exit 64; }
    resolved="$(locked_resolve "$dev")" || exit "$?"
    IFS=$'\t' read -r udid device_runtime <<< "$resolved"
    lock_device "$udid" || exit "$?"
    boot_in_lane "$udid" "$device_runtime" || exit "$?"
    echo "$(( $(now) + max * 60 )) $$" > "$(lease_file "$udid")"
    SIM_UDID="$udid" "$@" 8>&- 9>&- & child=$!
    # The watchdog must not inherit a caller's output pipe: Node awaits close after all pipe holders exit.
    ( sleep $((max * 60)); if kill -0 "$child" 2>/dev/null; then echo "sim-lane: killed after ${max} min (--max)" >&2; log "run on $dev killed after ${max} min"; pkill -TERM -P "$child"; kill -TERM "$child"; fi ) 8>&- 9>&- >/dev/null 2>&1 & timer=$!
    trap 'pkill -TERM -P "$child"; kill -TERM "$child" 2>/dev/null' INT TERM
    wait "$child"; rc=$?
    # Stop sleep before its parent; otherwise it is reparented before pkill can find it.
    pkill -TERM -P "$timer" 2>/dev/null; kill "$timer" 2>/dev/null
    if [ $keep -eq 1 ]; then echo "$(( $(now) + 30 * 60 )) 0" > "$(lease_file "$udid")"; else shutdown_dev "$udid"; fi
    exit $rc;;
  *) sed -n '2,26p' "$SELF";;
esac
