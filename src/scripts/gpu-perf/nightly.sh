#!/usr/bin/env bash
# E357: install.sh writes absolute tool paths; launchd and manual runs share one poller.
set -euo pipefail
GPU_PERF_DIR="${GPU_PERF_DIR:-$HOME/.wildshard/gpu-perf}"
if [ -f "$GPU_PERF_DIR/tools.sh" ]; then source "$GPU_PERF_DIR/tools.sh"; fi
NODE="${GPU_PERF_NODE:-$(command -v node)}"
exec /usr/bin/caffeinate -i "$NODE" "$(cd "$(dirname "$0")" && pwd)/nightly.mjs" "$@"
