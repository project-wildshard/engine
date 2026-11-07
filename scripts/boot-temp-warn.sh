#!/usr/bin/env bash
# boot-temp-warn.sh: a pre-commit warning (it never refuses a commit) for the two things that make a reboot hurt.
#   1. A folder macOS empties at boot before login holds over 500,000 files: /private/tmp and $TMPDIR, each counted on
#      its own (Jake, 2026-10-15: two separate thresholds). On 2026-10-15
#      millions of leftover export files there held the laptop at the login progress bar for hours.
#   2. ./tmp/build-mirror holds a slot outside gate, commit, check..check5 (G547: seven shared slots).
# Counting takes seconds, so the hook prints the last count at once and starts a background recount when that count is
# over 10 minutes old. The recount also sweeps ./tmp/vitest (Vitest's module cache, scripts/vitest-tmp.ts): a run's
# <pid> dir goes once that process is gone and nothing in it changed for an hour (a killed run leaves one behind). `scripts/boot-temp-warn.sh --top` lists the biggest folders by file count.
# Rules: docs/process/MACHINE.md "Disk and boot".
set -u
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
stamp="$root/tmp/.boot-temp-count"
limit=500000
temp_dirs=(/private/tmp)
[ -n "${TMPDIR:-}" ] && [ -d "${TMPDIR}" ] && temp_dirs+=("${TMPDIR%/}")

count_files() { find "$1" -xdev 2>/dev/null | wc -l | tr -d ' '; }

sweep_vitest() {
  local d name
  for d in "$root"/tmp/vitest/* "$root"/tmp/build-mirror/*/tmp/vitest/*; do
    [ -d "$d" ] || continue
    name="${d##*/}"
    case "$name" in *[!0-9]*) ;; *) ps -p "$name" >/dev/null 2>&1 && continue ;; esac
    [ -n "$(find "$d" -mmin -60 -print -quit 2>/dev/null)" ] && continue
    rm -rf "$d"
  done
}

case "${1:-}" in
  --count)
    sweep_vitest
    line="$(date +%s)"
    for d in "${temp_dirs[@]}"; do line="$line $(count_files "$d")"; done
    mkdir -p "$root/tmp"
    printf '%s\n' "$line" > "$stamp.new.$$" && mv "$stamp.new.$$" "$stamp"
    exit 0 ;;
  --top)
    for d in "${temp_dirs[@]}"; do
      for sub in "$d"/*/; do [ -d "$sub" ] && printf '%s %s\n' "$(count_files "$sub")" "$sub"; done
    done | sort -rn | head -10
    exit 0 ;;
esac

at=0; rest=""; counts=()
[ -f "$stamp" ] && read -r at rest < "$stamp"
read -r -a counts <<< "$rest"
if [ $(( $(date +%s) - ${at:-0} )) -gt 600 ]; then
  mkdir -p "$root/tmp" && printf '%s %s\n' "$(date +%s)" "$rest" > "$stamp"
  nohup "$0" --count >/dev/null 2>&1 &
fi
warned=""
for i in "${!temp_dirs[@]}"; do
  n="${counts[$i]:-0}"
  if [ "$n" -gt "$limit" ]; then
    echo "boot-temp: WARNING ${n} files in ${temp_dirs[$i]} (over ${limit}); macOS deletes them all at boot before login." >&2
    warned=1
  fi
done
[ -n "$warned" ] && echo "boot-temp: find the biggest with scripts/boot-temp-warn.sh --top and delete your own (docs/process/MACHINE.md)." >&2
extra=""
if [ -d "$root/tmp/build-mirror" ]; then
  for slot in "$root"/tmp/build-mirror/*/; do
    name="$(basename "$slot")"
    case "$name" in gate|commit|check|check2|check3|check4|check5|*.lock|*.queue) ;; *) extra="$extra $name" ;; esac
  done
fi
[ -n "$extra" ] && echo "boot-temp: WARNING build-mirror slots beyond gate/commit/check..check5 (G547):$extra; delete the ones no process holds." >&2
exit 0
