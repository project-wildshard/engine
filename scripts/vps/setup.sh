#!/usr/bin/env bash
# E7.2b: the VPS for the one world, run once by Jake, and safe to run again. Apt Postgres on its local socket, the `wildshard` user, the
# units, the quick tunnel (C22), the nightly dump (E7.8b) and the uptime check (E7.8c). It opens no public port.
#   sudo bash setup.sh           do what is missing
#   bash setup.sh --check        change nothing, and say what it would do. Works over `ssh wildshard bash -s -- --check < setup.sh`
# It never overwrites a filled-in env file, and it starts the server only once that file is complete. Until then a stub answers `/health`
# for 30 minutes, so the Tailscale and tunnel paths can be proved before there is a bundle to run.
set -euo pipefail

CHECK=0
if [ "${1:-}" = --check ]; then CHECK=1; fi
HERE=$(dirname "${BASH_SOURCE[0]:-$0}")
ETC=/etc/wildshard LIB=/usr/local/lib/wildshard HOME_DIR=/var/lib/wildshard LOGS=/var/log/wildshard SYSTEMD=/etc/systemd/system
PG_VERSION=16 PROD_PORT=8790 STAGING_PORT=8791
NODE=/usr/bin/node
PG_CHANGED=0

say() { printf '%-6s %s\n' "$1" "$2"; }
metadata_ok() { [ "$(stat -c '%a %U:%G' "$1" 2>/dev/null)" = "$2 $3" ]; }
repair_metadata() {
  if metadata_ok "$1" "$2" "$3"; then return; fi
  if [ "$CHECK" = 1 ]; then say would "repair metadata $1"; return; fi
  if ! { chmod "$2" "$1" && chown "$3" "$1"; }; then say stop "Cannot repair metadata $1"; exit 1; fi
}
# Run `make` unless `have` says it is already so.
step() {
  local what=$1 have=$2 make=$3
  if "$have"; then say ok "$what"
  elif [ "$CHECK" = 1 ]; then say would "$what"
  else say doing "$what"; "$make"; fi
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

# --- Before anything
if [ "$CHECK" = 0 ] && [ "$(id -u)" != 0 ]; then say stop 'Run this with sudo, or pass --check'; exit 1; fi
# shellcheck source=/dev/null
. /etc/os-release
if [ "${VERSION_CODENAME:-}" != noble ]; then say warn "Written for Ubuntu 24.04, and this is ${PRETTY_NAME:-unknown}"; fi
if [ "$(nproc)" -lt 16 ]; then say warn "The AllowedCPUs below assume 16 cores, and this has $(nproc)"; fi
if ! "$NODE" --version 2>/dev/null | grep -qE '^v(2[4-9]|[3-9][0-9])\.'; then say stop 'The server needs Node 24 or newer at /usr/bin/node'; exit 1; fi
say ok "node $("$NODE" --version)"

# --- Tailscale (J175). Joining a tailnet is Jake's to do, so this only says if it isn't up.
have_tailscale() { command -v tailscale >/dev/null; }
make_tailscale() { curl -fsSL https://tailscale.com/install.sh | sh; }
step 'tailscale installed' have_tailscale make_tailscale
if have_tailscale && ! tailscale status >/dev/null 2>&1; then say warn 'Tailscale is not logged in: run sudo tailscale up, then run this again'; fi

# --- Packages
have_cloudflared_repo() { [ -f /etc/apt/sources.list.d/cloudflared.list ]; }
make_cloudflared_repo() {
  install -d -m 755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -qq
}
have_packages() { [ -z "$(missing_packages)" ]; }
missing_packages() { local name; for name in postgresql rclone cloudflared; do dpkg-query -W -f='${Status}' "$name" 2>/dev/null | grep -q 'ok installed' || printf '%s ' "$name"; done; }
# shellcheck disable=SC2046 # One word a package.
make_packages() { apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $(missing_packages); }
step 'cloudflared apt source' have_cloudflared_repo make_cloudflared_repo
step 'postgresql, rclone and cloudflared' have_packages make_packages

# --- The user and its folders
have_user() { id wildshard >/dev/null 2>&1; }
make_user() { useradd --system --home-dir "$HOME_DIR" --shell /usr/sbin/nologin wildshard; }
step 'user wildshard' have_user make_user
have_folders() {
  local path
  for path in "$HOME_DIR" "$HOME_DIR/production" "$HOME_DIR/production/bundles" "$HOME_DIR/staging" "$HOME_DIR/staging/bundles" "$HOME_DIR/packs" "$HOME_DIR/dumps" "$LOGS"; do
    [ -d "$path" ] && metadata_ok "$path" 750 wildshard:wildshard || return 1
  done
  [ -d "$ETC" ] && metadata_ok "$ETC" 750 root:wildshard && [ -d "$LIB" ] && metadata_ok "$LIB" 755 root:root
}
make_folders() {
  install -d -m 750 -o wildshard -g wildshard "$HOME_DIR" "$HOME_DIR/production" "$HOME_DIR/production/bundles" "$HOME_DIR/staging" "$HOME_DIR/staging/bundles" "$HOME_DIR/packs" "$HOME_DIR/dumps" "$LOGS"
  install -d -m 750 -o root -g wildshard "$ETC"
  install -d -m 755 -o root -g root "$LIB"
}
step 'folders' have_folders make_folders

# --- Postgres: local socket only (Q92), and the CPUs it shares with the tunnel (E7.2)
if ! pg_lsclusters --no-header | awk -v version="$PG_VERSION" '$1 == version && $2 == "main" { found=1 } END { exit !found }'; then
  if [ "$CHECK" = 1 ]; then say would "need PostgreSQL $PG_VERSION/main"; else say stop "Missing PostgreSQL $PG_VERSION/main"; exit 1; fi
elif [ "$CHECK" = 0 ]; then
  PG_RUNNING_VERSION=$(pg 'show server_version_num')
  if [ "$PG_RUNNING_VERSION" -lt 160000 ] || [ "$PG_RUNNING_VERSION" -ge 170000 ] || [ "$(pg 'show config_file')" != "/etc/postgresql/$PG_VERSION/main/postgresql.conf" ]; then
    say stop 'Unexpected PostgreSQL version or configuration'; exit 1
  fi
fi
if put "/etc/postgresql/$PG_VERSION/main/conf.d/wildshard.conf" 644 postgres:postgres <<'EOF'
# E7.2b: local socket only. Nothing reaches this database over TCP.
listen_addresses = ''
EOF
then PG_CHANGED=1; fi
if put "$SYSTEMD/postgresql@.service.d/wildshard.conf" 644 root:root <<'EOF'
[Service]
AllowedCPUs=13-15
EOF
then PG_CHANGED=1; fi
have_role() { [ "$(pg "select 1 from pg_roles where rolname = 'wildshard'" 2>/dev/null)" = 1 ]; }
make_role() { pg 'create role wildshard login'; }
have_db() { [ "$(pg "select 1 from pg_database where datname = '$1'" 2>/dev/null)" = 1 ]; }
have_production() { have_db saves_production; }
have_staging() { have_db saves_staging; }
make_production() { runuser -u postgres -- createdb --cluster "$PG_VERSION/main" -O wildshard saves_production; }
make_staging() { runuser -u postgres -- createdb --cluster "$PG_VERSION/main" -O wildshard saves_staging; }
step 'postgres role wildshard' have_role make_role
step 'database saves_production' have_production make_production
step 'database saves_staging' have_staging make_staging

# --- Scripts
install_beside pull.mjs 755
install_beside dump.sh 755
install_beside restore-check.sh 755
install_beside uptime.sh 755

# --- Settings. A file that exists is Jake's and is never rewritten.
env_file() {
  local channel=$1 port=$2 workers=$3 seats=$4 path="$ETC/$1.env"
  if [ -f "$path" ]; then repair_metadata "$path" 640 root:wildshard; say ok "$path"; return; fi
  if [ "$CHECK" = 1 ]; then say would "write $path"; return; fi
  say doing "write $path"
  if put "$path" 640 root:wildshard <<EOF
# E7.2: the $channel server. Blank rows are Jake's. Nothing starts until they're filled, and rerunning setup.sh starts it.
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
if [ "$CHECK" = 1 ]; then say would "write $ETC/ops.env, unless it's there"
elif [ -f "$ETC/ops.env" ]; then repair_metadata "$ETC/ops.env" 600 root:root; say ok "$ETC/ops.env"
else
  say doing "write $ETC/ops.env"
  if put "$ETC/ops.env" 600 root:root <<'EOF'
# E7.8: the nightly dump and the uptime check. Both run with these blank: the dump stays on this disk, and a stopped server only logs.
# Where a stopped server is told. Any URL taking a POSTed line, such as https://ntfy.sh/<a long random topic>
ALERT_URL=
# The private bucket, for example r2:wildshard-backups. Blank keeps dumps local.
BACKUP_REMOTE=
RCLONE_CONFIG_R2_TYPE=s3
RCLONE_CONFIG_R2_PROVIDER=Cloudflare
RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
RCLONE_CONFIG_R2_ENDPOINT=
RCLONE_CONFIG_R2_ACCESS_KEY_ID=
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=
EOF
  then :; fi
fi

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
unit wildshard-tunnel.service <<EOF
[Unit]
Description=Wildshard quick tunnel (C22). It stays up across a game restart, so the name stays too
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
DynamicUser=yes
ExecStart=cloudflared tunnel --no-autoupdate --url http://127.0.0.1:$PROD_PORT
Restart=always
RestartSec=5
AllowedCPUs=13-15

[Install]
WantedBy=multi-user.target
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

if [ "$CHECK" = 1 ]; then
  say check "Done. --check changed nothing."
  exit 0
fi

# --- Bring it up
systemctl daemon-reload
if [ "$PG_CHANGED" = 1 ] || [ -n "$(pg 'show listen_addresses')" ] || [ "$(pg 'select exists (select 1 from pg_settings where pending_restart)')" = t ]; then
  say doing 'restart postgres'; systemctl restart "postgresql@$PG_VERSION-main"
fi
if [ -n "$(pg 'show listen_addresses')" ] || [ "$(pg 'select exists (select 1 from pg_settings where pending_restart)')" != f ]; then
  say stop 'PostgreSQL hardening is not active'; exit 1
fi
if ! check_listeners; then say stop 'Unexpected game or database TCP listener'; exit 1; fi
systemctl enable --now wildshard-tunnel.service wildshard-dump.timer

# /health over Tailscale only: this is tailnet-wide and never Funnel. It adds a port and leaves the rest of the serve config alone.
have_serve() { tailscale serve status --json 2>/dev/null | jq -e ".TCP[\"$PROD_PORT\"]" >/dev/null; }
make_serve() { tailscale serve --bg --yes --http="$PROD_PORT" "http://127.0.0.1:$PROD_PORT" >/dev/null || say warn "tailscale serve failed: /health is not on the tailnet"; }
step "/health on the tailnet, port $PROD_PORT" have_serve make_serve

blank_rows() { grep -E '^(PACK_ORIGIN|RELEASE_URL|RELEASE_PUBLIC_KEY|BUNDLE_ORIGIN)=$' "$ETC/production.env" | cut -d= -f1 | tr '\n' ' ' || true; }
BLANK=$(blank_rows)
if [ -z "$BLANK" ]; then
  systemctl stop wildshard-health-stub.service 2>/dev/null || true
  systemctl enable wildshard-server@production.service wildshard-uptime.timer
  systemctl start wildshard-uptime.timer
  if systemctl start wildshard-server@production.service; then say ok 'wildshard-server@production started'
  else say warn 'wildshard-server@production did not start. Look at journalctl -u wildshard-server@production'; fi
else
  say wait "The server waits on $ETC/production.env: $BLANK"
  if ! systemctl is-active --quiet wildshard-health-stub.service; then
    say doing "stub /health on $PROD_PORT for 30 minutes"
    systemd-run --quiet --unit=wildshard-health-stub --uid=wildshard --property=RuntimeMaxSec=1800 "$NODE" -e "http.createServer((q, r) => { r.writeHead(q.url === '/health' ? 200 : 404, { 'content-type': 'application/json' }).end(q.url === '/health' ? '{\"stub\":true}' : ''); }).listen($PROD_PORT, '127.0.0.1');"
  fi
fi

# --- Say where things stand
ANSWER=none
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if ANSWER=$(curl -fsS -m 2 "http://127.0.0.1:$PROD_PORT/health" 2>/dev/null); then break; fi
  ANSWER=none; sleep 1
done
say health "local: $ANSWER"
NAME=
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  NAME=$(journalctl -u wildshard-tunnel -n 200 --no-pager -o cat | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
  if [ -n "$NAME" ]; then break; fi
  sleep 1
done
say tunnel "${NAME:-no name yet: journalctl -u wildshard-tunnel}"
say next "From a phone on cellular: curl ${NAME:-<the tunnel>}/health"
say next "Over Tailscale: curl http://$(tailscale ip -4 2>/dev/null | head -1):$PROD_PORT/health"
if ! check_listeners; then say stop 'Unexpected game or database TCP listener. Look at ss -ltn'; exit 1; fi
say ok 'No game or database port is public'
