#!/usr/bin/env bash
# Temporary coordinator tools. start opens one Herdr pane; stop drains its ticks.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if [ "$#" -eq 0 ]; then set -- start; fi
exec python3 "$here/sp-tools.py" "$@"
