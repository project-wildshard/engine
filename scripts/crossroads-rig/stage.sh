#!/usr/bin/env bash
# stage.sh: put the crossroads rig (SF22a) next to a served build, so the game and the rig share one origin.
#   scripts/crossroads-rig/stage.sh <served dist dir>      e.g. /private/tmp/wildshard-serve/<stamp>-<port>/dist
# → <dir>/crossroads-rig/{index.html,rig.js,three.module.js,three.core.js}; open http://127.0.0.1:<port>/crossroads-rig/
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="${1:?stage.sh <served dist dir>}"
mkdir -p "$DIR/crossroads-rig"
cp "$REPO/scripts/crossroads-rig/index.html" "$REPO/scripts/crossroads-rig/rig.js" "$REPO/scripts/crossroads-rig/core.js" "$DIR/crossroads-rig/"
cp "$REPO/node_modules/three/build/three.module.js" "$REPO/node_modules/three/build/three.core.js" "$DIR/crossroads-rig/"
echo "$DIR/crossroads-rig"
