#!/usr/bin/env bash
# Every hosted Playwright browser install: `playwright install --with-deps <args>`, and when that fails (its apt-get
# half: on 2026-11-11 from ~09:20 Cancún the runners could not resolve *.archive.ubuntu.com or security.ubuntu.com),
# the same install without --with-deps and a warning. The runner image already carries most of Chromium's system
# libraries; if the browser really can't launch without them, the tests that need it still fail on their own.
#   bash scripts/ci-playwright-install.sh --no-shell chromium
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
if pnpm exec playwright install --with-deps "$@"; then exit 0; fi
echo "::warning title=playwright install::'playwright install --with-deps $*' failed (system packages); installing the browser without --with-deps"
exec pnpm exec playwright install "$@"
