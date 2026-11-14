#!/usr/bin/env bash
# CI7: the sha256 of every generated file in this CI job's tree: the ignored, untracked or modified files under the
# roots scripts/ci-folders.py packs, sorted by path. The fixtures job writes it beside its snapshots; a test shard reads
# those snapshots only when its own tree (prepare's unpacked products) hashes the same.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${GITHUB_JOB:-}" = fixtures ]; then
  # Keep the before-snapshot census in check annotations too: a disk-full
  # runner can lose its job log. Stderr leaves the hash manifest unchanged.
  python3 scripts/ci-disk-census.py fixture-before-snapshots >&2
fi
roots=(src public out docs/api lint)
{
  git ls-files -z --others --ignored --exclude-standard -- "${roots[@]}"
  git ls-files -z --others --exclude-standard -- "${roots[@]}"
  git diff --name-only -z --diff-filter=AM
} | sort -zu | grep -zvE '(^|/)(\.git|node_modules|\.cache|__pycache__)(/|$)' \
  | xargs -0 -r -P4 -n64 sha256sum | LC_ALL=C sort -k2
