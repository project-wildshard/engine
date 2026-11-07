#!/usr/bin/env bash
# herdr-question-open.sh <agent-name|pane-id>: exit 0 (and print why) when that pane is showing a question to Jake, else 1.
# A herdr paste into a pane that has an AskUserQuestion (Claude) or a question (Codex) open lands in the answer field
# and picks for him (Jake, 2026-10-12, G232/G233 and again on 10-12). Read before write: check this before any
# `herdr agent prompt` / `herdr pane send-text|run` to another pane. The PreToolUse hook guard-herdr-prompt.sh calls it
# for Claude lanes; Codex lanes call it themselves (or use scripts/herdr-prompt.sh).
set -uo pipefail
target="${1:-}"
[ -z "$target" ] && { echo "usage: herdr-question-open.sh <agent|pane>" >&2; exit 2; }
command -v herdr >/dev/null 2>&1 || exit 1

status="$(herdr agent get "$target" 2>/dev/null | jq -r '.result.agent.agent_status // empty' 2>/dev/null || true)"
if [ "$status" = blocked ]; then
  echo "$target is blocked (herdr sees a question or approval prompt open)"
  exit 0
fi
screen="$(herdr agent read "$target" --source visible 2>/dev/null || herdr pane read "$target" --source visible 2>/dev/null || true)"
if printf '%s' "$screen" | grep -qE 'Enter to select|to navigate|Skip for now|Type something\.|\? [0-9]+ questions?|Do you want to proceed\?'; then
  echo "$target is showing a question on screen"
  exit 0
fi
exit 1
