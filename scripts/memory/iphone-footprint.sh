#!/usr/bin/env bash
# The real-device memory readers (ENGINE-MEMORY EM10): see scripts/memory/iphone-footprint.mjs.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec node scripts/memory/iphone-footprint.mjs "$@"
