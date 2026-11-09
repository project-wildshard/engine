#!/usr/bin/env bash
# E7 Phase 2, on the existing Phase 1 VPS only (J203). No packages, users,
# PostgreSQL settings, Docker objects or unrelated services are changed.
# sudo bash setup.sh       install our settings/units and add owned Funnel routes
# bash setup.sh --check    run every read-only probe; unreadable state is unknown
# Keep this script beside the other scripts/vps files. A fresh VPS needs Phase 1.
set -euo pipefail
CHECK=0
if [ "${1:-}" = --check ]; then CHECK=1
elif [ "$#" != 0 ]; then printf 'stop   Expected no arguments or --check\n'; exit 1; fi
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ETC=/etc/wildshard HOME_DIR=/var/lib/wildshard SYSTEMD=/etc/systemd/system
LIB=$ETC/lib LOGS=$HOME_DIR/logs
PG_VERSION=16 PROD_PORT=8790 STAGING_PORT=8791 NODE=/usr/bin/node
# Public SPKI DER, equal to GitHub E7_RELEASE_PUBLIC_KEY. Never a signing key.
EXPECTED_RELEASE_PUBLIC_KEY=302a300506032b657003210012e17122631777e2a6ad68e2fb4883d856def46f812aa9a3e49d701ed44ad17b
KEY_FILE=/home/raynos/wildshard-e7/release-public-key.hex
ERRORS=0
say() { printf '%-6s %s\n' "$1" "$2"; }
metadata_ok() { [ "$(stat -c '%a %U:%G' "$1" 2>/dev/null)" = "$2 $3" ]; }
repair_metadata() {
  if metadata_ok "$1" "$2" "$3"; then return; fi
  if [ "$CHECK" = 1 ]; then say would "repair metadata $1"; return; fi
  if ! { chmod "$2" "$1" && chown "$3" "$1"; }; then say stop "Cannot repair metadata $1"; exit 1; fi
}
# Write stdin to a path unless it already says that. Returns 0 if it wrote, or would have.
put() {
  local path=$1 mode=$2 owner=$3 text temporary
  text=$(cat)
  if [ -r "$path" ] && [ "$(cat "$path")" = "$text" ]; then repair_metadata "$path" "$mode" "$owner"; say ok "$path"; return 1; fi
  if [ "$CHECK" = 1 ]; then say would "write $path"; return 0; fi
  say doing "write $path"
  mkdir -p "$(dirname "$path")" || exit 1
  temporary=$(umask 077; mktemp "$(dirname "$path")/.setup.XXXXXX") || exit 1
  if ! { printf '%s\n' "$text" > "$temporary" && chmod "$mode" "$temporary" && chown "$owner" "$temporary" && mv -f -- "$temporary" "$path"; }; then
    rm -f -- "$temporary"; say stop "Cannot publish $path"; exit 1
  fi
}
unit() { if put "$SYSTEMD/$1" 644 root:root; then :; fi; }
# Copy a file from beside this script. Piped over ssh there is no folder beside it, and `--check` says so.
install_beside() {
  local name=$1 mode=$2
  if [ ! -f "$HERE/$name" ]; then
    if [ "$CHECK" = 1 ]; then say skip "$name: not beside this script"; return; fi
    say stop "$name must sit beside setup.sh"; exit 1
  fi
  if cmp -s "$HERE/$name" "$LIB/$name"; then repair_metadata "$LIB/$name" "$mode" root:root; say ok "$LIB/$name"
  elif [ "$CHECK" = 1 ]; then say would "install $LIB/$name"
  else say doing "install $LIB/$name"; install -D -m "$mode" -o root -g root "$HERE/$name" "$LIB/$name"; fi
}
pg() { runuser -u postgres -- psql --cluster "$PG_VERSION/main" -v ON_ERROR_STOP=1 -qtAc "$1"; }
check_listeners() {
  local listeners tail4 tail6
  listeners=$(ss -ltnH) || return 1
  tail4=$(tailscale ip -4 2>/dev/null) || tail4=
  tail6=$(tailscale ip -6 2>/dev/null) || tail6=
  WS_SETUP_TAIL4="$tail4" WS_SETUP_TAIL6="$tail6" awk -v prod="$PROD_PORT" -v stage="$STAGING_PORT" '
    BEGIN {
      count=split(ENVIRON["WS_SETUP_TAIL4"] "\n" ENVIRON["WS_SETUP_TAIL6"], lines, "\n")
      for (i=1; i<=count; i++) if (lines[i] != "") tails[lines[i]]=1
    }
    NF == 0 { next }
    NF < 4 { exit 1 }
    {
      endpoint=$4; port=endpoint; sub(/^.*:/, "", port)
      if (port != prod && port != stage && port != "5432") next
      address=endpoint; sub(/:[^:]*$/, "", address)
      # ss puts a device suffix outside IPv6 brackets, or inside them.
      device=""
      if (match(address, /%[^]]+/)) {
        device=substr(address, RSTART+1, RLENGTH-1)
        address=substr(address, 1, RSTART-1) substr(address, RSTART+RLENGTH)
      }
      gsub(/^\[|\]$/, "", address)
      if (port == "5432") exit 1
      if (device != "" && device != "tailscale0") exit 1
      if (address == "127.0.0.1" || address == "::1") next
      if (port == prod && address in tails) next
      exit 1
    }' <<< "$listeners"
}

check_node() {
  "$NODE" --version 2>/dev/null | grep -qE '^v(2[4-9]|[3-9][0-9])\.'
}
wait_health() {
  local port=$1 attempt
  for ((attempt=1; attempt<=20; attempt++)); do
    if curl -fsS --connect-timeout 1 --max-time 2 "http://127.0.0.1:$port/health" >/dev/null 2>&1; then return 0; fi
    if [ "$attempt" -lt 20 ]; then sleep 0.5; fi
  done
  return 1
}
check_postgres() {
  if [ "$(id -u)" != 0 ]; then
    say 'cannot verify' 'PostgreSQL role, saves databases, hardening and protected folders (needs sudo)'; return
  fi
  if ! pg_lsclusters --no-header | awk -v version="$PG_VERSION" '$1==version && $2=="main" {found=1} END {exit !found}'; then say stop 'Phase 1 PostgreSQL 16/main is missing'; return 1; fi
  if ! { [ "$(pg 'show server_version_num')" -ge 160000 ] && [ "$(pg 'show server_version_num')" -lt 170000 ] && [ "$(pg 'show config_file')" = "/etc/postgresql/$PG_VERSION/main/postgresql.conf" ] && [ -z "$(pg 'show listen_addresses')" ] && [ "$(pg 'select exists (select 1 from pg_settings where pending_restart)')" = f ]; }; then
    say stop 'PostgreSQL Phase 1 hardening is not active; nothing was restarted'; return 1
  fi
  if [ "$(pg "select count(*) from pg_database where datname in ('saves_production','saves_staging')")" != 2 ] || [ "$(pg "select count(*) from pg_roles where rolname='wildshard'")" != 1 ]; then say stop 'Phase 1 role or saves databases missing'; return 1; fi
  say ok 'PostgreSQL 16, local socket only, saves databases and role'
}

# --- Read every prerequisite before changing anything, including in --check.
fail() { say stop "$1"; ERRORS=1; }
if [ "$CHECK" = 0 ] && [ "$(id -u)" != 0 ]; then say stop 'Run with sudo, or pass --check'; exit 1; fi
for command in tailscale ss getent systemctl pg_lsclusters runuser curl; do
  if ! command -v "$command" >/dev/null; then fail "Missing Phase 1 prerequisite: $command"; fi
done
if ! check_node; then fail 'The server needs Node 24 or newer at /usr/bin/node'; fi
if ! id wildshard >/dev/null 2>&1; then fail 'Phase 1 user wildshard is missing'; fi
RAYNOS_UID=$(id -u raynos 2>/dev/null) || { RAYNOS_UID=-1; fail 'Cannot identify the staged key owner raynos'; }
WILDSHARD_GID=$(getent group wildshard | cut -d: -f3) || WILDSHARD_GID=
if [ -z "$WILDSHARD_GID" ]; then fail 'Phase 1 group wildshard is missing'; fi
if [ -L "$ETC" ] || [ -L "$HOME_DIR" ]; then fail 'Refuse symlinked Wildshard roots'; fi
for path in "$LIB" "$LOGS" "$HOME_DIR/production" "$HOME_DIR/production/bundles" "$HOME_DIR/staging" "$HOME_DIR/staging/bundles" "$HOME_DIR/packs" "$HOME_DIR/dumps"; do
  if [ -L "$path" ]; then fail "Refuse symlinked owned folder: $path"; fi
done
for name in setup-state.mjs pull.mjs dump.sh restore-check.sh uptime.sh health-stub.mjs; do
  if [ ! -f "$HERE/$name" ]; then fail "$name must sit beside setup.sh"; fi
done
if check_listeners; then say ok 'no public game or database TCP listener'
else fail 'Unexpected game or database TCP listener (ss -ltnH)'; fi

# Private health Serve and both public host:ports are inspected together.
NODE_NAME=$({ tailscale status --json | "$NODE" -e 'let s="";for await(const b of process.stdin)s+=b;const n=JSON.parse(s).Self.DNSName;if(typeof n!=="string")process.exit(1);process.stdout.write(n.replace(/\.$/,""));' --input-type=module; } 2>/dev/null) || NODE_NAME=
SERVE_STATE=$(tailscale serve status --json 2>/dev/null) || SERVE_STATE=
if [ -z "$NODE_NAME" ] || [ -z "$SERVE_STATE" ]; then fail 'Cannot verify Tailscale identity, private Serve or Funnel state'
elif ! "$NODE" "$HERE/setup-state.mjs" network "$NODE_NAME" <<< "$SERVE_STATE"; then fail 'Serve/Funnel ownership conflict; inspect tailscale serve status --json'; fi
if ! "$NODE" "$HERE/setup-state.mjs" pin "$KEY_FILE" "$EXPECTED_RELEASE_PUBLIC_KEY" "$RAYNOS_UID"; then fail 'Cannot verify the staged release public key'; fi

for channel in production staging; do
  if [ -x "$ETC" ] && [ ! -e "$ETC/$channel.env" ] && [ ! -L "$ETC/$channel.env" ]; then say would "create $channel env with the verified pin and channel URLs"
  elif ! "$NODE" "$HERE/setup-state.mjs" prefill "$ETC/$channel.env" "$channel" "$EXPECTED_RELEASE_PUBLIC_KEY" --check 0 "$WILDSHARD_GID"; then fail "Cannot safely inspect $channel env"; fi
done
if [ -x "$ETC" ]; then
  if [ ! -f "$ETC/ops.env" ] || [ -L "$ETC/ops.env" ]; then fail 'Phase 1 regular ops.env missing'; fi
else say 'cannot verify' 'private ops.env and folder metadata (needs sudo)'; fi
if ! check_postgres; then ERRORS=1; fi
if systemctl is-active --quiet wildshard-tunnel.service; then say warn 'Legacy quick tunnel remains active; Phase 2 never stops or rewrites it'; fi
for channel in production staging; do
  if systemctl is-active --quiet "wildshard-server@$channel.service"; then say ok "$channel server owns its loopback port"
  else say would "$channel signed-release wait and owned health stub"; fi
done
say next "production socket wss://${NODE_NAME:-<unknown>}"
say next "staging socket wss://${NODE_NAME:-<unknown>}:8443"
if [ "$CHECK" = 1 ]; then say check 'All read-only probes completed. Protected state marked cannot verify needs sudo.'; exit "$ERRORS"; fi
if [ "$ERRORS" != 0 ]; then say stop 'Phase 2 preflight refused; no files or services changed'; exit 1; fi

# --- Only our roots and our units below this point. Phase 1 owns everything else.
install -d -m 750 -o root -g wildshard "$ETC"
install -d -m 755 -o root -g root "$LIB"
install -d -m 750 -o wildshard -g wildshard "$HOME_DIR" "$HOME_DIR/production" "$HOME_DIR/production/bundles" "$HOME_DIR/staging" "$HOME_DIR/staging/bundles" "$HOME_DIR/packs" "$HOME_DIR/dumps" "$LOGS"
for name in pull.mjs dump.sh restore-check.sh uptime.sh setup-state.mjs health-stub.mjs; do install_beside "$name" 755; done

env_file() {
  local channel=$1 port=$2 workers=$3 seats=$4 path="$ETC/$1.env"
  if [ -f "$path" ]; then repair_metadata "$path" 640 root:wildshard; say ok "$path"; return; fi
  if [ "$CHECK" = 1 ]; then say would "write $path"; return; fi
  say doing "write $path"
  if put "$path" 640 root:wildshard <<EOF
# E7.2: the $channel server. Phase 2 fills only exact blank rows from verified defaults.
# The R2 folder of \`assets/spawn/server-<build>.json\` (E7.3f)
PACK_ORIGIN=
# The signed release file on R2
RELEASE_URL=
# The public half of the release key, SPKI DER in hex
RELEASE_PUBLIC_KEY=
# Where bundles are fetched from: the tag's GitHub release
BUNDLE_ORIGIN=https://github.com/project-wildshard/engine/releases/download
# E7.8a: what leaves the box. Room records are refused until api-server's telemetry lists them.
TELEMETRY_URL=https://api.wildshard.io/api/telemetry
ERRORS_URL=https://api.wildshard.io/api/errors
RECORD_TAG=
HOST=127.0.0.1
PORT=$port
WORLD_CELLS=driftwood-isle
WORLD_WORKERS=$workers
WORLD_SEATS=$seats
SEAT_SECRET=$(openssl rand -hex 32)
EOF
  then :; fi
}
env_file production "$PROD_PORT" 4 32
env_file staging "$STAGING_PORT" 2 16
for channel in production staging; do
  "$NODE" "$HERE/setup-state.mjs" prefill "$ETC/$channel.env" "$channel" "$EXPECTED_RELEASE_PUBLIC_KEY" --apply 0 "$WILDSHARD_GID"
done
# The Phase 1 private backup credentials are left byte-for-byte alone.
if [ ! -f "$ETC/ops.env" ]; then say stop 'Phase 1 ops.env missing'; exit 1; fi
repair_metadata "$ETC/ops.env" 600 root:root

# --- Units
unit wildshard-server@.service <<EOF
[Unit]
Description=Wildshard server, %i channel
After=network-online.target postgresql.service
Wants=network-online.target postgresql.service
# Q77: a failed worker ends the process, and this always starts it again.
StartLimitIntervalSec=0

[Service]
User=wildshard
Group=wildshard
Environment=WILDSHARD_HOME=$HOME_DIR/%i
Environment=RELEASE_CHANNEL=%i
Environment=PULL_SCRIPT=$LIB/pull.mjs
Environment=PLAYTEST_DIR=$LOGS
EnvironmentFile=$ETC/%i.env
# It exits 0 on a bad hash, so the old bundle comes back up (E7.2c).
ExecStartPre=$NODE $LIB/pull.mjs
ExecStart=$NODE $HOME_DIR/%i/current/main.mjs
Restart=always
RestartSec=2
LimitNOFILE=65536
TimeoutStartSec=300
TimeoutStopSec=30
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$HOME_DIR $LOGS

[Install]
WantedBy=multi-user.target
EOF
unit wildshard-server@production.service.d/cpus.conf <<'EOF'
[Service]
AllowedCPUs=0-8
EOF
unit wildshard-server@staging.service.d/cpus.conf <<'EOF'
[Service]
AllowedCPUs=9-12
EOF
unit wildshard-dump.service <<EOF
[Unit]
Description=Wildshard nightly dump of saves_production
After=postgresql.service

[Service]
Type=oneshot
User=wildshard
Group=wildshard
EnvironmentFile=$ETC/ops.env
Environment=DUMP_DIR=$HOME_DIR/dumps
ExecStart=$LIB/dump.sh
AllowedCPUs=13-15
EOF
unit wildshard-dump.timer <<'EOF'
[Unit]
Description=Wildshard nightly dump

[Timer]
OnCalendar=*-*-* 03:30:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF
unit wildshard-uptime.service <<EOF
[Unit]
Description=Wildshard uptime check

[Service]
Type=oneshot
User=wildshard
Group=wildshard
EnvironmentFile=$ETC/ops.env
Environment=HEALTH_URL=http://127.0.0.1:$PROD_PORT/health
Environment=UPTIME_STATE=$HOME_DIR/uptime.state
ExecStart=$LIB/uptime.sh
AllowedCPUs=13-15
EOF
unit wildshard-uptime.timer <<'EOF'
[Unit]
Description=Wildshard uptime check, each minute

[Timer]
OnCalendar=minutely
AccuracySec=5s

[Install]
WantedBy=timers.target
EOF

# A verified first release starts the game without a second sudo sitting.
# An unpublished channel fails this preparatory unit, never loops the game.
unit wildshard-pull@.service <<EOF
[Unit]
Description=Wildshard first verified release, %i
OnSuccess=wildshard-server@%i.service
StartLimitIntervalSec=0
[Service]
Type=oneshot
User=wildshard
Group=wildshard
Environment=WILDSHARD_HOME=$HOME_DIR/%i
Environment=RELEASE_CHANNEL=%i
EnvironmentFile=$ETC/%i.env
ExecCondition=/bin/sh -c '! systemctl is-active --quiet wildshard-server@%i.service'
ExecStart=$NODE $LIB/pull.mjs --fetch
TimeoutStartSec=300
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$HOME_DIR
EOF
unit wildshard-pull@.timer <<'EOF'
[Unit]
Description=Wait for Wildshard's first signed release, %i
[Timer]
OnBootSec=30s
OnUnitInactiveSec=60s
Unit=wildshard-pull@%i.service
[Install]
WantedBy=timers.target
EOF
unit wildshard-health@.service <<EOF
[Unit]
Description=Wildshard waiting health stub, %i
After=network-online.target
[Service]
User=wildshard
Group=wildshard
EnvironmentFile=$ETC/%i.env
ExecStart=$NODE $LIB/health-stub.mjs %i
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
[Install]
WantedBy=multi-user.target
EOF
unit wildshard-server@.service.d/health.conf <<'EOF'
[Unit]
Conflicts=wildshard-health@%i.service
EOF
unit wildshard-server@production.service.d/legacy-health.conf <<'EOF'
[Unit]
Conflicts=wildshard-health-stub.service
EOF

# --- Bring up only Wildshard objects, then recheck ownership before each route.
systemctl daemon-reload
for channel in production staging; do
  if ! systemctl is-active --quiet "wildshard-server@$channel.service"; then
    if [ "$channel" != production ] || ! systemctl is-active --quiet wildshard-health-stub.service; then
      systemctl enable --now "wildshard-health@$channel.service"
    fi
  fi
done
for port in "$PROD_PORT" "$STAGING_PORT"; do
  if ! wait_health "$port"; then say stop "Our loopback health owner on $port is not ready after 20 bounded probes; no new Funnel was added"; exit 1; fi
done
network_guard() {
  tailscale serve status --json | "$NODE" "$HERE/setup-state.mjs" network "$NODE_NAME" "${1:-}"
}
network_guard
tailscale serve --bg --yes --http="$PROD_PORT" "http://127.0.0.1:$PROD_PORT"
network_guard
tailscale funnel --bg --yes --https=443 "http://127.0.0.1:$PROD_PORT"
network_guard
tailscale funnel --bg --yes --https=8443 "http://127.0.0.1:$STAGING_PORT"
network_guard --complete
if ! check_listeners; then say stop 'Unexpected game or database TCP listener after setup'; exit 1; fi
systemctl enable --now wildshard-dump.timer wildshard-uptime.timer wildshard-pull@production.timer wildshard-pull@staging.timer
say socket "production wss://$NODE_NAME"
say socket "staging wss://$NODE_NAME:8443"
say health "tailnet-only Serve: http://$NODE_NAME:$PROD_PORT/health"
say ok 'Phase 2 complete; signed release timers will start the owned game units'
