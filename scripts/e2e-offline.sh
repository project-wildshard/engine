#!/usr/bin/env bash
# T2E-1 (TEMPLATE-E2E-PLAN): `pnpm test:e2e` with outbound networking denied by macOS, loopback allowed. A pass proves
# the smoke reads no API, no sharddev and no CDN: Template 2 comes from the @wildshard/format dependency. `ps` runs
# outside the sandbox (heavy-lane's lease check walks the process tree; a sandboxed process cannot run the setuid ps).
# Stop a warm watcher first (node scripts/e2e-client.mjs stop) to prove the cold path too.
set -euo pipefail
if [ "$(uname)" != Darwin ]; then echo "e2e-offline: macOS only (sandbox-exec)" >&2; exit 2; fi
profile='(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))(allow network-outbound (remote unix-socket))(allow process-exec (literal "/bin/ps") (with no-sandbox))'
exec /usr/bin/sandbox-exec -p "$profile" pnpm -s test:e2e "$@"
