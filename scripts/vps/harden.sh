#!/usr/bin/env bash
# The lean bridge (meta QA 11-25 row 88). A box whose root-owned wildshard-apply predates the lean move unpacks
# `scripts/vps` from the signed commit and runs scripts/vps/harden.sh from it, with the commit's folder as its working
# directory (/var/lib/wildshard-apply/<commit>, beside the bare engine.git it fetched into). The lean tree keeps the box
# scripts in src/scripts/vps, so this file alone stays here: it unpacks src/scripts/vps from the same verified commit and
# runs that harden.sh, which installs the lean wildshard-apply and refreshes /opt/wildshard-vps. Remove it once every box
# has hardened from a lean tag (/var/lib/wildshard-harden-applied names a commit that carries src/scripts/vps).
set -euo pipefail
work=$PWD commit=${PWD##*/} repo=${PWD%/*}/engine.git
[[ $commit =~ ^[0-9a-f]{40}$ ]] || { echo "stop    the lean bridge runs only in wildshard-apply's folder for a commit" >&2; exit 1; }
[ "$(git -C "$repo" rev-parse --verify --quiet "$commit^{commit}")" = "$commit" ] || { echo "stop    $commit is not in $repo" >&2; exit 1; }
git -C "$repo" archive "$commit" src/scripts/vps | tar -x -C "$work" --no-same-owner
if [ "$(id -u)" = 0 ]; then chown -R root:root "$work/src"; fi
chmod -R go-w "$work/src"
echo "run     $work/src/scripts/vps/harden.sh (the lean bridge, engine ${commit:0:8})"
exec /usr/bin/env bash "$work/src/scripts/vps/harden.sh" "$@"
