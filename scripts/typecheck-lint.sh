#!/usr/bin/env bash
# One CI job, two complete checks. Drain both and preserve the original failures.
set -uo pipefail
{
  TIMEFORMAT='Typecheck: %3R seconds'
  time pnpm exec tsc -b tsconfig.layers.json --builders 1 --force
} &
typecheck_pid=$!
{
  TIMEFORMAT='Typed lint: %3R seconds'
  time pnpm run lint:typed --threads=4
} &
typed_lint_pid=$!
typecheck_status=0
typed_lint_status=0
wait "$typecheck_pid" || typecheck_status=$?
wait "$typed_lint_pid" || typed_lint_status=$?
if [ "$typecheck_status" -ne 0 ]; then
  exit "$typecheck_status"
fi
exit "$typed_lint_status"
