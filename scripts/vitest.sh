#!/usr/bin/env bash
# Focused tests stay unrestricted; full suites still require the existing heavy lane.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "$ROOT/scripts/quiet_logs.py" --label vitest -- node "$ROOT/scripts/vitest-tmp.ts" "$@"
