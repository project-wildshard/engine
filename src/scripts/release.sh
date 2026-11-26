#!/usr/bin/env bash
# FS28 engine train. The repo-kit release helper still owns prepare, finish and merge-back.
set -euo pipefail
exec node "$(dirname "$0")/release-train.ts" "$@"
