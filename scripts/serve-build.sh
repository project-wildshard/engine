#!/usr/bin/env bash
# serve-build.sh — build the game and serve that build: the ONLY way to run it locally (E317, Jake 2026-09-29: "Vite dev
# sucks. No one should be using Vite dev … a combination of vite build and vite start"). No `vite` dev servers.
#
#   scripts/serve-build.sh [--head | --rev <rev>] [--shard <slug>[,<slug>]] [--full] [--port <n>] [--hours <h>] [--name <label>] [--devserver]
#        app build → a private out dir → scripts/preview-server.mjs on a free port (4400–4999), detached. Prints the URL.
#        --head   reserve preview room, then build HEAD in the shared mirror slot pool
#        --rev    the same for any commit (a before / after pair, e.g. scripts/nine-sim-memory.mjs --rev=f9ca6490)
#        --shard  filter a working-tree build; pinned HEAD/rev previews build all products for sharing (G620).
#                 Every other shard in a working-tree build keeps its product only
#                 while its content key still matches, else it is left out of the preview (never served stale)
#        --full   the push gate's full rebuild (`pnpm gen` + every shardfile from scratch); default is the fast proof
#                 build: `gen.mjs --proof` (no derived docs, parallel generation) and `build-shardfiles.mjs --reuse`
#                 (a shard whose inputs are unchanged reuses its product from the slot or the shared content-keyed
#                 cache, scripts/shardfile-cache.mjs). Same bytes as --full for every changed shard; ~25–40 s, not ~95 s.
#        --hours  the server is reaped after this long (default 4; `scripts/browser-lane.sh reap`)
#   scripts/serve-build.sh list                  the servers this script started, their age and expiry
#   scripts/serve-build.sh stop <port|all-mine>  stop one (all-mine: every server this Claude session started)
#
# public/ (≈ 500 MB) is not copied: the out dir symlinks its top-level entries (--head/--rev: APFS clones, `cp -c`, no extra
# bytes, because the mirror moves on once this script exits), so a build takes the JS build's time only.
# Registry: ~/.dev-servers/<port> ("pid expiry outdir owner name"; owner = the session id, E338). Reaped by `scripts/browser-lane.sh reap` (hooks on
# SessionStart / Stop / SubagentStop): an expired registered preview, an unregistered `vite preview` older than 6 h, and
# every `vite` dev server older than 2 h.

set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
REG="${SERVE_REG_DIR:-$HOME/.dev-servers}"; mkdir -p "$REG"
# "mine" is the calling session, not its folder (E338): every agent runs from the repo root or a shared scratchpad, so a
# cwd key let one agent's all-mine / eviction stop another's preview mid-run. Claude Code sets CLAUDE_CODE_SESSION_ID;
# anything else falls back to the folder. Subagents share their parent's session id, so a lane sets SERVE_OWNER=<lane>
# (op-nine11, …) or a sibling's eviction stops its preview mid-capture.
CALLER="${SERVE_OWNER:-${CLAUDE_CODE_SESSION_ID:-${CODEX_SESSION_ID:-$PWD}}}"; CALLER="${CALLER// /_}"
BASE="${SERVE_BUILD_DIR:-$REPO/tmp/serve}"; mkdir -p "$BASE"; BASE="$(cd "$BASE" && pwd -P)" # canonical (E432)

case "${1:-}" in
  list)
    for f in "$REG"/*; do
      [ -f "$f" ] || continue
      read -r pid exp out cwd name < "$f"
      if ! kill -0 "$pid" 2>/dev/null; then rm -f "$f"; continue; fi
      printf '  http://127.0.0.1:%-5s pid %-6s %4s min left  %s  (%s)\n' "$(basename "$f")" "$pid" "$(( (exp - $(date +%s)) / 60 ))" "$name" "$out"
    done
    exit 0;;
  stop)
    tgt="${2:?stop <port|all-mine>}"
    for f in "$REG"/*; do
      [ -f "$f" ] || continue
      read -r pid exp out cwd name < "$f"
      if [ "${SERVE_SHARED_STOP:-}" != 1 ] && { [ "$tgt" = "$(basename "$f")" ] || [ "$tgt" = all-mine ]; }; then
        all_mine=0; [ "$tgt" = all-mine ] && all_mine=1
        SERVE_STOP_OBSERVED_PID="$pid" SERVE_STOP_OBSERVED_OUT="$out" python3 "$REPO/scripts/serve-shared-preview.py" release "$REG" "$(basename "$f")" "$CALLER" "$all_mine" bash "$0" stop "$(basename "$f")"
        shared_result=$?
        [ "$shared_result" = 0 ] && continue
        exit "$shared_result"
      fi
      if [ "$tgt" = "$(basename "$f")" ] || { [ "$tgt" = "all-mine" ] && [ "$cwd" = "$CALLER" ]; }; then
        if [ -n "${SERVE_STOP_PID:-}" ] && { [ "$pid" != "$SERVE_STOP_PID" ] || [ "$out" != "$SERVE_STOP_OUT" ]; }; then
          echo 'serve-build: preview registry owner changed; refusing teardown' >&2
          exit 1
        fi
        # New previews have PID == PGID. Retire their whole session, including pnpm/vite descendants.
        # Older registered previews share their launcher's group, so retain the legacy PID-only cleanup there.
        if [ "$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')" = "$pid" ]; then
          kill -TERM -- "-$pid" 2>/dev/null
          sleep 2
          kill -KILL -- "-$pid" 2>/dev/null
        else
          pkill -TERM -P "$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null
        fi
        rm -f "$f"
        # delete the build now (~1.5 GB each): kept as .stopped-* they filled the disk (221 GB, 2026-10-02)
        [ -n "$out" ] && [ -d "$out" ] && [[ "$out" == /private/tmp/?*/?* || "$out" == "$REPO"/tmp/serve/?* ]] && { rm -rf "$out" & } 2>/dev/null
        echo "stopped :$(basename "$f")"
      fi
    done
    exit 0;;
esac

MODE=production; HEAD_ONLY=0; REV=HEAD; PORT=""; HOURS=4; NAME="build"; FULL=0; SHARDS=""
ARGS=("$@")
while [ $# -gt 0 ]; do
  case "$1" in
    --devserver) MODE=devserver; shift;;
    --head) HEAD_ONLY=1; shift;;
    --rev) HEAD_ONLY=1; REV="$2"; shift 2;;
    --full) FULL=1; shift;;
    --shard) SHARDS="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --hours) HOURS="$2"; shift 2;;
    --name) NAME="$2"; shift 2;;
    *) echo "serve-build.sh: unknown option $1" >&2; exit 64;;
  esac
done
# Resolve once before queueing. Later HEAD movement must not change a waiting
# request's source; the mirror child receives the same full pinned SHA.
if [ $HEAD_ONLY -eq 1 ]; then
  REV="${SERVE_SHARED_SHA:-$(git -C "$REPO" rev-parse --verify "$REV^{commit}")}" || exit 1
  if [ -z "${SERVE_IN_MIRROR:-}" ]; then
    node "$REPO/scripts/build-mirror.mjs" authorize "$REV" >/dev/null || exit 2
  fi
  if [ -z "${SERVE_SHARED_SHA:-}" ]; then
    exec python3 "$REPO/scripts/serve-shared-preview.py" run "$REG" "$REV" "$MODE" "$CALLER" bash "$0" "${ARGS[@]}"
  fi
  # G620: the first pinned build contains every product, so every later lane's
  # --shard subset shares it. Working-tree builds retain their explicit filter.
  SHARDS=""
fi
# caps (E317 follow-up: one session held 26 previews registered for 8–12 h): --hours at most SERVE_MAX_HOURS (4), and at
# most SERVE_MAX_LIVE (12) previews machine-wide. Over it: this caller's own oldest preview is stopped to make room; else
# another's, but only one older than SERVE_RECYCLE_MIN (60) minutes — a preview someone is capturing on right now is never
# pulled (E339: the old any-preview recycling stopped agents' servers mid-capture); else it waits for room.
# The port is picked and reserved under a lock (a placeholder registry entry, this shell's pid, until the preview's own
# pid replaces it): two starts in the same second were both handed :4400 (E339).
MAX_H="${SERVE_MAX_HOURS:-4}"; MAX_LIVE="${SERVE_MAX_LIVE:-12}"; RECYCLE_MIN="${SERVE_RECYCLE_MIN:-60}"
ROOM_WAIT_SECONDS=300
ROOM_DEADLINE=$((SECONDS + ROOM_WAIT_SECONDS))
if ! [[ "$HOURS" =~ ^[0-9]+$ ]] || [ "$HOURS" -lt 1 ]; then HOURS=1; fi
if [ "$HOURS" -gt "$MAX_H" ]; then echo "serve-build: --hours capped at $MAX_H" >&2; HOURS=$MAX_H; fi
age_min() {  # minutes since pid started (ps etime [[dd-]hh:]mm:ss)
  local e d=0 h=0 m=0; e="$(ps -o etime= -p "$1" 2>/dev/null | tr -d ' ')"; [ -z "$e" ] && { echo 0; return; }
  if [[ "$e" == *-* ]]; then d="${e%%-*}"; e="${e#*-}"; fi
  IFS=: read -r -a t <<<"$e"
  case "${#t[@]}" in 3) h=${t[0]}; m=${t[1]};; 2) m=${t[0]};; esac
  echo $(( 10#$d * 1440 + 10#$h * 60 + 10#$m ))
}
lock() {  # Never steal a registry lock or start a fresh wait after admission expires.
  local deadline=${1:-$((SECONDS + ROOM_WAIT_SECONDS))}
  until mkdir "$REG/.lock" 2>/dev/null; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo 'serve-build: timed out after 5 min waiting for preview registry lock; holder:' >&2
      cat "$REG/.lock/owner" >&2 2>/dev/null || echo 'pid/command/start unavailable (legacy lock)' >&2
      return 124
    fi
    sleep 0.2
  done
  printf 'pid=%s command=serve-build.sh start=%s slot=preview-registry\n' "$$" "$(date -u +%FT%TZ)" > "$REG/.lock/owner"
}
unlock() { rm -f "$REG/.lock/owner"; rmdir "$REG/.lock" 2>/dev/null; return 0; }

REQUESTED_PORT="$PORT"; PORT_END=4999
if [ -n "$PORT" ]; then
  [[ "$PORT" =~ ^[0-9]{1,5}$ ]] || { echo 'serve-build: invalid port' >&2; exit 64; }
  PORT=$((10#$PORT))
  [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || { echo 'serve-build: invalid port' >&2; exit 64; }
  PORT_START=$PORT; PORT_END=65535
else PORT_START=4400; fi

# Private FIFOs work with macOS Bash 3 without inheriting lease descriptors
# into builders or detached previews. The helper also exits if its owner dies.
if [ -n "${SERVE_RESERVED_PORT:-}" ]; then
  PORT="$SERVE_RESERVED_PORT"; stamp="${SERVE_RESERVED_STAMP:?}"
  PORT_CHANNEL="${SERVE_RESERVED_CHANNEL:?}"; PORT_LEASE_OWNER=""
else
  PORT_CHANNEL="$(mktemp -d "$REG/.port-lease-XXXXXX")" || exit 1
  mkfifo "$PORT_CHANNEL/commands" "$PORT_CHANNEL/replies" || exit 1
  python3 "$REPO/scripts/serve-port-lease.py" hold "$REG" "$PORT_CHANNEL" "$$" &
  PORT_LEASE_OWNER=$!
fi
close_port_lease() {
  if [ -n "${PORT_LEASE_OWNER:-}" ]; then
    python3 "$REPO/scripts/serve-port-lease.py" request "$PORT_CHANNEL" close >/dev/null 2>&1 || kill "$PORT_LEASE_OWNER" 2>/dev/null
    wait "$PORT_LEASE_OWNER" 2>/dev/null || true
    PORT_LEASE_OWNER=""
  fi
}
cleanup_reservation() {
  [ -n "${PREVIEW_PID:-}" ] && kill -TERM -- "-$PREVIEW_PID" 2>/dev/null
  close_port_lease
  [ -n "${PORT:-}" ] && [ -f "$REG/$PORT" ] && grep -q "^$$ " "$REG/$PORT" && rm "$REG/$PORT"
  return 0
}
trap cleanup_reservation EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
port_lease() {
  local reply
  reply="$(python3 "$REPO/scripts/serve-port-lease.py" request "$PORT_CHANNEL" take "$1")" || return 2
  case "$reply" in ok) return 0;; busy) return 1;; *) return 2;; esac
}
reserve_port() { # caller holds the registry lock; the OS lease stays held after unlock
  local p rc
  for ((p=PORT_START; p<=PORT_END; p++)); do
    [ -f "$REG/$p" ] && continue
    lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && continue
    if port_lease "$p"; then PORT=$p; return 0; else rc=$?; fi
    [ "$rc" = 1 ] || return "$rc"
  done
  return 1
}
publish_reservation() { # atomic rows cannot be mistaken for dead, partially written owners
  local entry="$REG/.entry-$PORT-$$"
  if [ -n "${SERVE_SHARED_SHA:-}" ]; then
    mkdir -p "$BASE/$stamp" || return
    printf '%s\n' "$SERVE_SHARED_SHA" > "$BASE/$stamp/.shared-preview" || return
  fi
  printf '%s %s %s %s %s\n' "$1" "$2" "$BASE/$stamp" "$CALLER" "$3" > "$entry" || return
  mv "$entry" "$REG/$PORT"
}
if [ -n "${SERVE_RESERVED_PORT:-}" ]; then
  # The outer shell owns the OS lease until this mirror child has finished.
  read -r reserved_pid _ < "$REG/$PORT" || exit 1
  [ "$reserved_pid" = "${SERVE_RESERVATION_PID:?}" ] && kill -0 "$reserved_pid" 2>/dev/null || { echo 'serve-build: lost preview reservation before mirror admission' >&2; exit 1; }
  publish_reservation "$$" "$(( $(date +%s) + 3600 ))" "$NAME(building)" || exit 1
else
said=0
while :; do
  lock "$ROOM_DEADLINE" || exit 124
  n_live=0; mine=""; mine_exp=""; other=""; other_age=0
  for f in "$REG"/*; do
    [ -f "$f" ] || continue
    read -r pid exp out cwd name < "$f"
    kill -0 "$pid" 2>/dev/null || { rm -f "$f"; continue; }
    n_live=$((n_live + 1))
    # Shared previews retire on their last release, never during another lane's sample.
    [ -f "$out/.shared-preview" ] && continue
    if [ "$cwd" = "$CALLER" ]; then
      if [ -z "$mine_exp" ] || [ "$exp" -lt "$mine_exp" ]; then mine="$(basename "$f")"; mine_exp="$exp"; fi
    else
      a="$(age_min "$pid")"; if [ "$a" -gt "$other_age" ]; then other="$(basename "$f")"; other_age="$a"; fi
    fi
  done
  if [ "$n_live" -lt "$MAX_LIVE" ]; then
    reserve_port || { unlock; echo 'serve-build: no free preview port' >&2; exit 1; }
    # reserve it: this shell holds the entry until the preview's pid replaces it (an exit before that drops it)
    stamp="$(date +%Y%m%d-%H%M%S)-$PORT"
    publish_reservation "$$" "$(( $(date +%s) + 3600 ))" "$NAME(building)" || { unlock; exit 1; }
    unlock; break
  fi
  unlock
  remaining=$((ROOM_DEADLINE - SECONDS))
  if [ "$remaining" -le 0 ]; then
    echo "serve-build: timed out after 5 min waiting for preview room ($MAX_LIVE live); holders:" >&2
    for f in "$REG"/*; do
      [ -f "$f" ] || continue
      read -r pid exp out cwd name < "$f"
      printf 'slot=preview:%s pid=%s lane=%s age=%smin name=%s ' "$(basename "$f")" "$pid" "$cwd" "$(age_min "$pid")" "$name" >&2
      ps -p "$pid" -o command= -o lstart= >&2
    done
    exit 124
  fi
  if [ -n "$mine" ]; then
    echo "serve-build: $MAX_LIVE previews running — stopping your oldest, :$mine" >&2; bash "$0" stop "$mine" >/dev/null
  elif [ -n "$other" ] && [ "$other_age" -ge "$RECYCLE_MIN" ]; then
    echo "serve-build: $MAX_LIVE previews running — stopping :$other (up ${other_age} min)" >&2; bash "$0" stop "$other" >/dev/null
  else
    [ $said -eq 0 ] && { echo "serve-build: $MAX_LIVE previews running, all young and none yours — waiting (scripts/serve-build.sh list)" >&2; said=1; }
    [ "$remaining" -gt 15 ] && remaining=15
    sleep "$remaining"
  fi
done
fi
[ -n "$PORT" ] || { echo "serve-build.sh: no free port in 4400–4999" >&2; exit 1; }
[ -n "$REQUESTED_PORT" ] && [ "$PORT" != "$REQUESTED_PORT" ] && echo "serve-build: port $REQUESTED_PORT busy; using $PORT" >&2

# Preview admission precedes mirror admission. The parent keeps its reservation
# and port lease across the child; a failed mirror wait is returned once.
if [ $HEAD_ONLY -eq 1 ] && [ -z "${SERVE_IN_MIRROR:-}" ]; then
  SERVE_IN_MIRROR=1 SERVE_RESERVED_PORT="$PORT" SERVE_RESERVED_STAMP="$stamp" \
    SERVE_RESERVED_CHANNEL="$PORT_CHANNEL" SERVE_RESERVATION_PID="$$" \
    node "$REPO/scripts/build-mirror.mjs" run "$REV" -- bash "$REPO/scripts/serve-build.sh" "${ARGS[@]}"
  exit $?
fi

OUT="$BASE/$stamp/dist"
SRC="$REPO"
if [ $HEAD_ONLY -eq 1 ]; then
  # the mirror (cwd): build-mirror.mjs synced it to $REV, linked node_modules (E432) and set VERCEL_GIT_COMMIT_SHA
  SRC="$(pwd -P)"
fi
mkdir -p "$BASE/$stamp"
echo "serve-build: building $( [ $HEAD_ONLY -eq 1 ] && echo "$REV $(git -C "$REPO" rev-parse --short "$REV")" || echo "the working tree" ) → $OUT" >&2
# the repo's own config, with public/ left out of the copy (it is symlinked below)
CFG="$BASE/$stamp/vite.serve.mjs"
cat > "$CFG" <<JS
import { mergeConfig } from '$REPO/node_modules/vite/dist/node/index.js';
import base from '$SRC/vite.config.ts';
export default async (env) => {
  const b = typeof base === 'function' ? await base(env) : base;
  return mergeConfig(b, { root: '$SRC', build: { outDir: '$OUT', emptyOutDir: true, copyPublicDir: false } });
};
JS
# the generated files first, as CI's `pnpm build` does: without them a new asset (round 13: Sky Reach's LUT) had no
# bytes.generated entry, the build skipped it, and every capture scored a game the deploy doesn't ship (E399)
GEN_ARGS="--proof"; SHARDFILE_ARGS="--reuse"
# This pipeline owns the explicit product phase below; ordinary pnpm gen now
# includes products itself. Keep full previews from compiling them twice.
[ $FULL -eq 1 ] && { GEN_ARGS="--inputs-only"; SHARDFILE_ARGS=""; }
[ -n "$SHARDS" ] && SHARDFILE_ARGS="$SHARDFILE_ARGS --shard=$SHARDS"
( cd "$SRC" && python3 "$REPO/scripts/heavy-lane.py" build -- bash -c \
  'step() { local s=$SECONDS; "$@" || return; echo "serve-build step $1 $2: $((SECONDS - s))s"; }
   app="pnpm exec vite build"; [ -f scripts/build-app.mjs ] && app="node scripts/build-app.mjs"   # a --rev tree may predate it
   step node scripts/gen.mjs $3 && step node scripts/build-shardfiles.mjs $4 && step $app --mode "$1" --config "$2" --outDir "$5"' \
  bash "$MODE" "$CFG" "$GEN_ARGS" "$SHARDFILE_ARGS" "$OUT" ) > "$BASE/$stamp/build.log" 2>&1 \
  || { echo "serve-build: build failed; stderr/stdout tail from $BASE/$stamp/build.log:" >&2; tail -60 "$BASE/$stamp/build.log" >&2
         # the build directory goes with the failed preview: keep its whole log (a shard's first error sits above the tail)
         cp "$BASE/$stamp/build.log" "$BASE/failed-$stamp.log" 2>/dev/null && echo "serve-build: full log kept at $BASE/failed-$stamp.log" >&2
         exit 1; }
grep -h '^serve-build step\|^wildshard build: .* in \|^heavy-lane: acquired' "$BASE/$stamp/build.log" | sed 's/^/serve-build: /' >&2
# public/ by symlink (the preview server follows them): an entry the build didn't write is linked whole; a folder both have
# (assets/: the build's JS chunks + public's models) is merged one level down, recursively; a file the build wrote wins
link_tree() {
  local src="$1" dst="$2" e n
  # Generated v2 products are complete: never merge retired flat products or
  # stale shard directories from public/ back into a proof build.
  if [ "$src" = "$SRC/public/shardfiles" ]; then
    for e in "$dst"/*/shard.json; do
      [ -f "$e" ] && grep -q '"format":"wildshard.shardfile"' "$e" && return 0
    done
  fi
  for e in "$src"/* "$src"/.[!.]*; do
    [ -e "$e" ] || continue
    n="$dst/$(basename "$e")"
    if [ ! -e "$n" ]; then if [ $HEAD_ONLY -eq 1 ]; then cp -cR "$e" "$n"; else ln -s "$e" "$n"; fi
    elif [ -d "$e" ] && [ -d "$n" ] && [ ! -L "$n" ]; then link_tree "$e" "$n"; fi
  done
}
link_tree "$SRC/public" "$OUT"

# The host's plain preview server (D24: was `vite preview` with vite/preview.ts) serves any tree's already-built bytes
# with that tree's vercel.json headers, so older pinned trees need nothing of their own.
PREVIEW_SERVER="$REPO/scripts/preview-server.mjs"
cd "$SRC" || exit 1
# A tool runner retires its process group when the calling command exits. nohup ignores HUP, but stays in that
# group: the preview died and the lane reaper correctly deleted its registered export. Give it its own session.
start_preview() {
pid="$(node --input-type=module - "$PREVIEW_SERVER" "$SRC" "$OUT" "$PORT" "$BASE/$stamp/preview.log" <<'PREVIEW_NODE'
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
const [server, root, outDir, port, log] = process.argv.slice(2);
const fd = openSync(log, 'a');
const child = spawn('node', [server, '--root', root, '--outDir', outDir, '--port', port, '--host', '127.0.0.1'],
  { detached: true, stdio: ['ignore', fd, fd] });
child.once('error', error => { closeSync(fd); console.error(error); process.exitCode = 1; });
child.once('spawn', () => { closeSync(fd); console.log(child.pid); child.unref(); });
PREVIEW_NODE
)"
}
# An HTTP response from an older process is not readiness for this preview.
preview_owns_port() {
  local listener group
  for listener in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null); do
    group="$(ps -o pgid= -p "$listener" 2>/dev/null | tr -d ' ')"
    [ "$group" = "$pid" ] && return 0
  done
  return 1
}
# Retry only listener conflicts, with one startup budget and the same dist.
# No build work lives in this loop and no foreign listener is stopped.
deadline=$((SECONDS + 30))
while :; do
  : > "$BASE/$stamp/preview.log"
  start_preview || exit 1
  PREVIEW_PID=$pid
  ready=0
  while [ "$SECONDS" -lt "$deadline" ]; do
    kill -0 "$pid" 2>/dev/null || break
    if preview_owns_port && curl --fail --silent --output /dev/null "http://127.0.0.1:$PORT/"; then ready=1; break; fi
    grep -Eq 'EADDRINUSE|[Pp]ort .*already in use' "$BASE/$stamp/preview.log" && break
    sleep 0.5
  done
  [ "$ready" -eq 1 ] && break
  conflict=0
  if ! preview_owns_port && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then conflict=1; fi
  grep -Eq 'EADDRINUSE|[Pp]ort .*already in use' "$BASE/$stamp/preview.log" && conflict=1
  kill -TERM -- "-$pid" 2>/dev/null || true
  PREVIEW_PID=""
  if [ "$conflict" -ne 1 ] || [ "$SECONDS" -ge "$deadline" ]; then
    echo "serve-build: preview failed to become ready on port $PORT" >&2
    tail -30 "$BASE/$stamp/preview.log" >&2
    exit 1
  fi
  old_port=$PORT; PORT_START=$((PORT + 1))
  lock "$deadline" || exit 124
  if ! reserve_port; then unlock; echo 'serve-build: no free retry port' >&2; exit 1; fi
  [ -f "$REG/$old_port" ] && grep -q "^$$ " "$REG/$old_port" && rm "$REG/$old_port"
  publish_reservation "$$" "$(( $(date +%s) + 3600 ))" "$NAME(starting)" || { unlock; exit 1; }
  unlock
  echo "serve-build: port $old_port became busy; reusing finished dist on $PORT" >&2
done
publish_reservation "$pid" "$(( $(date +%s) + HOURS * 3600 ))" "$NAME" || { kill -TERM -- "-$pid" 2>/dev/null; exit 1; }
PREVIEW_PID=""
close_port_lease
echo "http://127.0.0.1:$PORT/"
echo "serve-build: pid $pid, reaped in ${HOURS} h; stop it with: scripts/serve-build.sh stop $PORT" >&2
