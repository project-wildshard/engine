#!/usr/bin/env bash
# BROWSER-TESTS-BENCH BB2 (J231): a hosted job installs Playwright's Chromium beside its build, off the job's path.
#   bash scripts/ci-browser.sh start   begin `playwright install --with-deps` in the background (logs in tmp/ci-browser/);
#                                      scripts/ci-playwright-install.sh falls back to no --with-deps when apt fails
#   bash scripts/ci-browser.sh wait    block until it ends, print its log and seconds, and fail when it failed
# It installs only the full Chromium that scripts/parity/lane-browser.mjs launches (`channel: 'chromium'`), not the
# headless shell: on the 4-vCPU runner the shell missed boot-smoke's title and capture deadlines (bench run 42913701526).
# The job caches ~/.cache/ms-playwright, so a warm run downloads nothing and only the apt half is left.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
dir=tmp/ci-browser

case "${1:-}" in
  start)
    rm -rf "$dir" && mkdir -p "$dir"
    # Detached, so the next step's build runs while this downloads; the status file is written last, by rename.
    nohup bash -c '
      dir=$1 started=$(date +%s)
      bash scripts/ci-playwright-install.sh --no-shell chromium >"$dir/install.log" 2>&1
      code=$?
      echo "$code $(( $(date +%s) - started ))" >"$dir/status.tmp" && mv "$dir/status.tmp" "$dir/status"
    ' ci-browser "$dir" >/dev/null 2>&1 &
    echo 'ci-browser: install started (--no-shell chromium)'
    ;;
  wait)
    waited=$SECONDS
    # The job's own timeout bounds this too; ten minutes is far past the worst install seen (202 s).
    while [ ! -f "$dir/status" ]; do
      if [ $((SECONDS - waited)) -ge 600 ]; then
        echo 'ci-browser: install still running after 600 s' >&2
        cat "$dir/install.log" 2>/dev/null
        exit 1
      fi
      sleep 1
    done
    read -r code seconds <"$dir/status"
    cat "$dir/install.log"
    echo "ci-browser: install exited $code after ${seconds}s; waited $((SECONDS - waited))s for it"
    exit "$code"
    ;;
  *)
    echo 'usage: ci-browser.sh start|wait' >&2
    exit 2
    ;;
esac
