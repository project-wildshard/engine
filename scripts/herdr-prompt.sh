#!/usr/bin/env bash
# herdr-prompt.sh <agent> <message>: `herdr agent prompt`, but only when the target has no question open
# (scripts/herdr-question-open.sh). Refuses with exit 3 otherwise, so the message never answers Jake's question.
# Use this from Codex lanes; Claude lanes get the same check from the PreToolUse hook guard-herdr-prompt.sh.
set -uo pipefail
target="${1:-}"; shift || true
[ -z "$target" ] || [ $# -eq 0 ] && { echo "usage: herdr-prompt.sh <agent> <message>" >&2; exit 2; }
here="$(cd "$(dirname "$0")" && pwd)"
if why="$("$here/herdr-question-open.sh" "$target")"; then
  echo "herdr-prompt: not sent: $why. Put it in STATE.md or a commit message instead, or retry later." >&2
  exit 3
fi
exec herdr agent prompt "$target" "$@"
