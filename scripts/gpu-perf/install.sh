#!/usr/bin/env bash
# The lead runs this once. Existing gh login only; no credential is written here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$HOME/.wildshard/gpu-perf"
CACHE="$HOME/.cache/wildshard-gpu-perf"
NODE="$(command -v node)"; PNPM="$(command -v pnpm)"; GH="$(command -v gh)"
"$GH" auth status
command -v ios_webkit_debug_proxy >/dev/null
mkdir -p "$DIR" "$CACHE" "$HOME/Library/LaunchAgents"
if [ ! -d "$CACHE/repo.git" ]; then
  git clone --filter=blob:none --mirror "$(git -C "$ROOT" remote get-url origin)" "$CACHE/repo.git"
fi
# %q preserves absolute binary paths, including a path with spaces.
printf 'export GPU_PERF_NODE=%q\nexport GPU_PERF_PNPM=%q\nexport GPU_PERF_GH=%q\n' "$NODE" "$PNPM" "$GH" > "$DIR/tools.sh"
"$NODE" --input-type=module - "$ROOT" "$DIR" "$NODE" "$PNPM" "$GH" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
const [root, dir, ...bins] = process.argv.slice(2);
const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const paths = [...new Set([...bins.map(dirname), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(':');
const template = readFileSync(join(root, 'scripts/gpu-perf/com.wildshard.gpu-perf.plist'), 'utf8');
const plist = template.replaceAll('__NIGHTLY__', xml(join(root, 'scripts/gpu-perf/nightly.sh'))).replaceAll('__REPO__', xml(root)).replaceAll('__REPORTS__', xml(dir)).replaceAll('__PATH__', xml(paths));
writeFileSync(join(homedir(), 'Library/LaunchAgents/com.wildshard.gpu-perf.plist'), plist);
JS
PLIST="$HOME/Library/LaunchAgents/com.wildshard.gpu-perf.plist"
plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/com.wildshard.gpu-perf" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo 'Installed com.wildshard.gpu-perf (04:00; missed runs execute on wake).'
