#!/usr/bin/env bash
# MMO-PLAN MP0.1: a blank Ubuntu 24.04 box to a serving Wildshard host, and safe to run again. In order:
#   1. Phase 1: packages (Node 24, apt PostgreSQL 16 (J180), rclone, Tailscale, Caddy left off), the users, PostgreSQL's
#      local-socket settings, role and saves databases, ops.env and the staged release public key.
#   2. harden.sh (VPS-HARDENING-PLAN). Its --check reads every row (VH1); its apply step comes with VH3 to VH15, so today it skips.
#   3. setup.sh, Phase 2: env files, units, health stubs and the tailnet-only Serve routes (no Funnel, MS8). It needs the box on the tailnet.
#   4. The cook worker (C4): an engine checkout at a tag, its user, its AppArmor allowance and its unit. It needs cook.env.
#      sudo bash rebuild.sh        do what is missing. Exit 0 is done; exit 2 is waiting for one of Jake's inputs
#      bash rebuild.sh --check     change nothing and say what it would do; protected state says `cannot verify`
# Keep this beside the other scripts/vps files. docs/vps-setup.md, "Rebuild from nothing", has the steps around it.
# HARD STOP (Jake, 2026-11-09): this never runs on the old VPS. Nothing there is rebuilt until OPENCLAW-EXTRACT's OX10
# is signed, so a host that still holds OpenClaw, Coolify, clawdbot or Ollama state is refused in both modes.
# Port 443 and `rooms.wildshard.io` are Jake's, after VPS-HARDENING VH16 (J179): Caddy is installed and left off.
set -euo pipefail
CHECK=0
if [ "${1:-}" = --check ]; then CHECK=1
elif [ "$#" != 0 ]; then printf 'stop   Expected no arguments or --check\n'; exit 1; fi
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ETC=/etc/wildshard HOME_DIR=/var/lib/wildshard SYSTEMD=/etc/systemd/system
PG_VERSION=16 NODE=/usr/bin/node NODE_MAJOR=24 PNPM=pnpm@10.34.9
KEY_DIR=/home/raynos/wildshard-e7 KEY_FILE=/home/raynos/wildshard-e7/release-public-key.hex
COOK_ENV=/etc/wildshard/cook.env COOK_HOME=/var/lib/wildshard-cook COOK_SRC=/opt/wildshard/engine COOK_LIB=/usr/local/lib/wildshard-cook
COOK_GROUP=wildshard-cook
# 8790 and 8791 are the game's loopback ports; the cook worker's own default was 8791 too.
COOK_PORT=8792
ENGINE_GIT=https://github.com/project-wildshard/engine.git
# What the old box holds and a fresh image doesn't (OPENCLAW-EXTRACT's survey, 2026-11-09). A glob covers every home.
LIVE_MARKERS=(/home/clawdbot /home/matt /var/snap/ollama /var/lib/docker/volumes/coolify-db /data/coolify /home/*/.openclaw /home/*/.config/systemd/user/openclaw-gateway.service)
PG_CHANGED=0 WAITING=()
say() { printf '%-6s %s\n' "$1" "$2"; }
wait_for() { WAITING+=("$1"); say wait "$1"; }

# --- The hard stop, before anything else, in both modes.
live_box() {
  local marker found=()
  for marker in "${LIVE_MARKERS[@]}"; do if [ -e "$marker" ] || [ -L "$marker" ]; then found+=("$marker"); fi; done
  if [ "${#found[@]}" = 0 ]; then return 1; fi
  say stop "This host still holds the old box's data: ${found[*]}"
  say stop 'MP0.1 runs only on a fresh image, after OPENCLAW-EXTRACT OX10 is signed and the Hetzner rebuild (VPS-HARDENING VH2)'
  return 0
}
if live_box; then exit 3; fi

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
  temporary=$(umask 077; mktemp "$(dirname "$path")/.rebuild.XXXXXX") || exit 1
  if ! { printf '%s\n' "$text" > "$temporary" && chmod "$mode" "$temporary" && chown "$owner" "$temporary" && mv -f -- "$temporary" "$path"; }; then
    rm -f -- "$temporary"; say stop "Cannot publish $path"; exit 1
  fi
}
# A file that exists is someone's, and only its metadata is repaired.
put_once() {
  local path=$1 mode=$2 owner=$3
  if [ -f "$path" ]; then cat >/dev/null; repair_metadata "$path" "$mode" "$owner"; say ok "$path"; return 1; fi
  if put "$path" "$mode" "$owner"; then return 0; fi
}
pg() { runuser -u postgres -- psql --cluster "$PG_VERSION/main" -v ON_ERROR_STOP=1 -qtAc "$1"; }
installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'ok installed'; }
# The value of NAME= in an env file, or nothing.
env_value() { sed -n "s/^$2=//p" "$1" 2>/dev/null | tail -n 1; }
# The cook worker starts only once its env file names a build, an API, a token and one store (R2's four rows or a folder).
cook_env_complete() {
  local file=$1 name
  for name in COOK_ENGINE_REF WILDSHARD_BUILD WILDSHARD_API_URL COOK_NOTIFY_TOKEN; do [ -n "$(env_value "$file" "$name")" ] || return 1; done
  if [ -n "$(env_value "$file" COOK_STORE_DIR)" ]; then return 0; fi
  for name in R2_ACCOUNT_ID R2_BUCKET_PACKS R2_PACKS_ACCESS_KEY_ID R2_PACKS_SECRET_ACCESS_KEY; do [ -n "$(env_value "$file" "$name")" ] || return 1; done
}
# Caddy's package ships a page on port 80. Only that file, byte for byte as dpkg recorded it, or this script's own
# placeholder is replaced; any other file is VH9's and is never touched.
CADDY_PLACEHOLDER="# MMO-PLAN MP0.1: Caddy is installed and off. VPS-HARDENING VH9 writes this file, and port 443 opens by Jake's hand
# after VH16's pre-open gate (J179). Until then nothing is served."
caddy_default() {
  local file=/etc/caddy/Caddyfile shipped
  [ -f "$file" ] || return 0
  [ "$(cat "$file")" = "$CADDY_PLACEHOLDER" ] && return 0
  shipped=$(dpkg-query -W -f='${Conffiles}\n' caddy 2>/dev/null | awk -v f="$file" '$1 == f { print $2 }')
  [ -n "$shipped" ] && [ "$(md5sum < "$file" | cut -d' ' -f1)" = "$shipped" ]
}
wait_http() {
  local url=$1 attempt
  for ((attempt=1; attempt<=60; attempt++)); do
    if curl -fsS --connect-timeout 1 --max-time 2 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

# --- Before anything
if [ "$CHECK" = 0 ] && [ "$(id -u)" != 0 ]; then say stop 'Run with sudo, or pass --check'; exit 1; fi
for name in setup.sh setup-state.mjs pull.mjs dump.sh restore-check.sh uptime.sh health-stub.mjs wildshard-config wildshard-apply.mjs wildshard-agent.pub; do
  if [ ! -f "$HERE/$name" ]; then say stop "$name must sit beside rebuild.sh"; exit 1; fi
done
# The one trusted public key lives in setup.sh; this stages a copy of it, never another.
EXPECTED_KEY=$(sed -n 's/^EXPECTED_RELEASE_PUBLIC_KEY=\([0-9a-f]*\)$/\1/p' "$HERE/setup.sh")
if ! [[ "$EXPECTED_KEY" =~ ^302a300506032b6570032100[0-9a-f]{64}$ ]]; then say stop 'Cannot read the release public key from setup.sh'; exit 1; fi
# shellcheck source=/dev/null
. /etc/os-release
if [ "${VERSION_CODENAME:-}" != noble ]; then say stop "Written for Ubuntu 24.04 (noble), and this is ${PRETTY_NAME:-unknown}"; exit 1; fi
if [ "$(uname -m)" != x86_64 ]; then say warn "The VPS is x86_64, and this is $(uname -m)"; fi
# The plan's CPU split (E7.2, MP1.8) needs the VPS's 16 cores. A smaller box runs Postgres and the cook worker unpinned,
# since AllowedCPUs naming only absent CPUs stops a unit from starting at all.
CPUS=$(nproc) SHARED_CPUS='AllowedCPUs=13-15'
if [ "$CPUS" -lt 16 ]; then say warn "The units' AllowedCPUs assume 16 cores, and this has $CPUS"; SHARED_CPUS="# AllowedCPUs=13-15 needs 16 cores; this box has $CPUS"; fi

# --- 1. Packages
APT_UPDATED=0
apt_update() { if [ "$APT_UPDATED" = 0 ]; then apt-get update -qq; APT_UPDATED=1; fi; }
# An apt source: its key, dearmored, and its one line. Re-fetched only when missing.
source_ok() { [ -s "/usr/share/keyrings/$1.gpg" ] && [ -f "/etc/apt/sources.list.d/$1.list" ] && [ "$(cat "/etc/apt/sources.list.d/$1.list")" = "$3" ]; }
make_source() {
  local name=$1 key=$2 line=$3 temporary
  install -d -m 755 /usr/share/keyrings
  temporary=$(mktemp)
  curl -fsSL "$key" -o "$temporary"
  if grep -q 'BEGIN PGP' "$temporary"; then gpg --batch --yes --dearmor -o "/usr/share/keyrings/$name.gpg" "$temporary"; else install -m 644 "$temporary" "/usr/share/keyrings/$name.gpg"; fi
  rm -f "$temporary"; chmod 644 "/usr/share/keyrings/$name.gpg"
  printf '%s\n' "$line" > "/etc/apt/sources.list.d/$name.list"
  APT_UPDATED=0
}
apt_source() {
  local name=$1 key=$2 line=$3
  if source_ok "$name" "$key" "$line"; then say ok "apt source $name"
  elif [ "$CHECK" = 1 ]; then say would "add apt source $name"
  else say doing "add apt source $name"; make_source "$name" "$key" "$line"; fi
}
BASE_PACKAGES=(ca-certificates curl gnupg git iproute2 openssl procps util-linux sudo)
missing() { local name; for name in "$@"; do installed "$name" || printf '%s ' "$name"; done; }
have_base() { [ -z "$(missing "${BASE_PACKAGES[@]}")" ]; }
# shellcheck disable=SC2046 # One word a package.
make_base() { apt_update; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $(missing "${BASE_PACKAGES[@]}"); }
step "base tools: ${BASE_PACKAGES[*]}" have_base make_base

apt_source nodesource https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  "deb [signed-by=/usr/share/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main"
apt_source tailscale "https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg" \
  'deb [signed-by=/usr/share/keyrings/tailscale.gpg] https://pkgs.tailscale.com/stable/ubuntu noble main'
apt_source caddy https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  'deb [signed-by=/usr/share/keyrings/caddy.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main'

PACKAGES=(nodejs "postgresql-$PG_VERSION" "postgresql-client-$PG_VERSION" rclone tailscale age)
have_packages() { [ -z "$(missing "${PACKAGES[@]}")" ]; }
# shellcheck disable=SC2046 # One word a package.
make_packages() { apt_update; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $(missing "${PACKAGES[@]}"); }
step "packages: ${PACKAGES[*]}" have_packages make_packages
# Caddy installs with its starts refused, so its default page never listens on port 80.
have_caddy() { installed caddy; }
# A policy-rc.d already there is the box's, and goes back afterwards.
make_caddy() {
  local policy=/usr/sbin/policy-rc.d saved=/usr/sbin/policy-rc.d.wildshard-saved status=0
  apt_update
  if [ -e "$policy" ] || [ -L "$policy" ]; then mv -f -- "$policy" "$saved"; fi
  # Put the box's policy back however this ends, an interrupt included.
  trap 'rm -f -- /usr/sbin/policy-rc.d; if [ -e /usr/sbin/policy-rc.d.wildshard-saved ] || [ -L /usr/sbin/policy-rc.d.wildshard-saved ]; then mv -f -- /usr/sbin/policy-rc.d.wildshard-saved /usr/sbin/policy-rc.d; fi' EXIT INT TERM
  printf '#!/bin/sh\nexit 101\n' > "$policy"; chmod 755 "$policy"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy || status=$?
  rm -f -- "$policy"
  if [ -e "$saved" ] || [ -L "$saved" ]; then mv -f -- "$saved" "$policy"; fi
  trap - EXIT INT TERM
  if [ "$status" != 0 ]; then say stop 'Cannot install caddy'; exit 1; fi
}
step 'caddy, installed and not started' have_caddy make_caddy
if [ "$CHECK" = 0 ] || [ -x "$NODE" ]; then
  if ! "$NODE" --version 2>/dev/null | grep -qE "^v(2[4-9]|[3-9][0-9])\."; then say stop "The server needs Node $NODE_MAJOR or newer at $NODE"; exit 1; fi
  say ok "node $("$NODE" --version)"
fi

# Caddy stays off until VH9 writes its file and VH16 passes; port 443 is opened by Jake's hand (J179).
if installed caddy && caddy_default; then
  if put /etc/caddy/Caddyfile 644 root:root <<<"$CADDY_PLACEHOLDER"; then :; fi
  if systemctl is-enabled --quiet caddy.service 2>/dev/null || systemctl is-active --quiet caddy.service; then
    if [ "$CHECK" = 1 ]; then say would 'stop and disable caddy until VH9'
    else say doing 'stop and disable caddy until VH9'; systemctl disable --now --quiet caddy.service; fi
  else say ok 'caddy is off'; fi
elif installed caddy; then say ok 'caddy has its VH9 file; left as it is'; fi

# Joining the tailnet is Jake's (J175). Phase 2 reads the node's name and owns its tailnet-only Serve routes.
tailnet_up() { tailscale status --json 2>/dev/null | "$NODE" -e 'let s="";for await(const b of process.stdin)s+=b;const j=JSON.parse(s);process.exit(j.BackendState==="Running"&&typeof j.Self?.DNSName==="string"?0:1)' --input-type=module 2>/dev/null; }
if [ "$CHECK" = 0 ] && installed tailscale; then systemctl enable --now --quiet tailscaled.service; fi

# --- The users and their folders
have_admin() { id raynos >/dev/null 2>&1; }
make_admin() { useradd --create-home --shell /bin/bash --groups sudo raynos; }
step 'admin user raynos (sudo)' have_admin make_admin
# A fresh Hetzner image lets root in by key. raynos gets the same keys, once.
if id raynos >/dev/null 2>&1 && [ -s /root/.ssh/authorized_keys ] && [ ! -s /home/raynos/.ssh/authorized_keys ]; then
  if [ "$CHECK" = 1 ]; then say would 'give raynos root'"'"'s SSH keys'
  else
    say doing 'give raynos root'"'"'s SSH keys'
    install -d -m 700 -o raynos -g raynos /home/raynos/.ssh
    install -m 600 -o raynos -g raynos /root/.ssh/authorized_keys /home/raynos/.ssh/authorized_keys
  fi
fi
if [ "$(id -u)" = 0 ] && id raynos >/dev/null 2>&1 && [ "$(passwd -S raynos | awk '{print $2}')" != P ]; then
  say next 'raynos has no password yet: run `passwd raynos` for sudo and the Hetzner console (VH3 break-glass)'
fi
have_user() { id wildshard >/dev/null 2>&1 && getent group wildshard >/dev/null; }
make_user() { useradd --system --user-group --home-dir "$HOME_DIR" --shell /usr/sbin/nologin wildshard; }
step 'user wildshard' have_user make_user
# VPS-HARDENING VH11: each channel runs as its own user, so a staging bug cannot reach production's saves. Both are in the
# wildshard group, which only lets them into the shared roots.
have_channel_user() { id "wildshard-$CHANNEL" >/dev/null 2>&1 && id -nG "wildshard-$CHANNEL" | tr ' ' '\n' | grep -qx wildshard; }
make_channel_user() {
  if id "wildshard-$CHANNEL" >/dev/null 2>&1; then usermod -aG wildshard "wildshard-$CHANNEL"
  else useradd --system --user-group --groups wildshard --home-dir "$HOME_DIR/$CHANNEL" --shell /usr/sbin/nologin "wildshard-$CHANNEL"; fi
}
for CHANNEL in production staging; do step "user wildshard-$CHANNEL" have_channel_user make_channel_user; done
FOLDERS=("$HOME_DIR" "$HOME_DIR/production" "$HOME_DIR/staging" "$HOME_DIR/packs" "$HOME_DIR/dumps" "$HOME_DIR/logs")
have_folders() {
  local path
  for path in "${FOLDERS[@]}"; do [ -d "$path" ] || return 1; done
  metadata_ok "$HOME_DIR" 750 wildshard:wildshard && [ -d "$ETC" ] && metadata_ok "$ETC" 750 root:wildshard
}
# The channel folders' owners, and everything inside them, are Phase 2's (setup.sh, VH11, no-follow); this only makes them.
make_folders() {
  install -d -m 750 -o wildshard -g wildshard "$HOME_DIR"
  local path; for path in "${FOLDERS[@]}"; do [ -d "$path" ] || install -d -m 750 -o wildshard -g wildshard "$path"; done
  install -d -m 750 -o root -g wildshard "$ETC"
}
step 'folders' have_folders make_folders

# --- PostgreSQL: local socket only (Q92), and the CPUs it shares with the cook worker (E7.2)
if [ "$(id -u)" != 0 ]; then say 'cannot verify' 'PostgreSQL settings, role and saves databases (needs sudo)'
elif ! pg_lsclusters --no-header 2>/dev/null | awk -v version="$PG_VERSION" '$1==version && $2=="main" {found=1} END {exit !found}'; then
  if [ "$CHECK" = 1 ]; then say would "need PostgreSQL $PG_VERSION/main"; else say stop "Missing PostgreSQL $PG_VERSION/main after install"; exit 1; fi
else
  if put "/etc/postgresql/$PG_VERSION/main/conf.d/wildshard.conf" 644 postgres:postgres <<'EOF'
# E7.2b: local socket only. Nothing reaches this database over TCP.
listen_addresses = ''
EOF
  then PG_CHANGED=1; fi
  if put "$SYSTEMD/postgresql@.service.d/wildshard.conf" 644 root:root <<EOF
[Service]
$SHARED_CPUS
EOF
  then PG_CHANGED=1; fi
  if [ "$CHECK" = 0 ]; then
    systemctl daemon-reload
    # A fresh box has no saves yet, so this one restart is free. Phase 2 refuses a pending restart, and never restarts.
    if [ "$PG_CHANGED" = 1 ] || [ "$(pg 'select exists (select 1 from pg_settings where pending_restart)' 2>/dev/null)" = t ]; then
      say doing "restart postgresql@$PG_VERSION-main"; systemctl restart "postgresql@$PG_VERSION-main.service"
    fi
    systemctl enable --quiet postgresql.service
    # VH11: one login role per channel, owning its one database; nobody else may connect to it. OS user wildshard-<channel>
    # maps to role wildshard_<channel> by peer and pg_ident, over the local socket only.
    have_db() { [ "$(pg "select 1 from pg_database where datname = '$1'")" = 1 ]; }
    # step() takes names, so these read the loop's CHANNEL, ROLE and DB.
    have_role() { [ "$(pg "select 1 from pg_roles where rolname = '$ROLE'")" = 1 ]; }
    make_role() { pg "create role $ROLE login"; }
    have_channel_db() {
      have_db "$DB" && [ "$(pg "select pg_get_userbyid(datdba) from pg_database where datname = '$DB'")" = "$ROLE" ] \
        && [ "$(pg "select has_database_privilege('public', '$DB', 'CONNECT')")" = f ]
    }
    # A box from before VH11 has its database under the one shared role: hand it, and every object in it, to the channel's.
    make_channel_db() {
      if ! have_db "$DB"; then runuser -u postgres -- createdb --cluster "$PG_VERSION/main" -O "$ROLE" "$DB"; fi
      pg "alter database $DB owner to $ROLE"
      if [ "$(pg "select 1 from pg_roles where rolname = 'wildshard'")" = 1 ]; then
        runuser -u postgres -- psql --cluster "$PG_VERSION/main" -v ON_ERROR_STOP=1 -qtAc "reassign owned by wildshard to $ROLE" "$DB"
      fi
      pg "revoke connect, temporary on database $DB from public"
    }
    # A box from before VH11 hands its saves over with nothing using them: the servers, their pull timers (which would start
    # them again) and the dump all stop before any ownership moves, and the hand-over waits until none is active. Phase 2
    # (setup.sh) starts them again as their own users.
    if [ "$(pg "select 1 from pg_roles where rolname = 'wildshard'")" = 1 ]; then
      QUIET=(wildshard-pull@production.timer wildshard-pull@staging.timer wildshard-dump.timer
        wildshard-pull@production.service wildshard-pull@staging.service wildshard-dump.service
        wildshard-server@production.service wildshard-server@staging.service)
      say doing 'stop the servers, their pull timers and the dump for the VH11 hand-over'
      systemctl stop "${QUIET[@]}" 2>/dev/null || true
      for name in "${QUIET[@]}"; do
        if systemctl is-active --quiet "$name"; then say stop "$name is still active; the VH11 hand-over did not start"; exit 1; fi
      done
    fi
    # The restore check's own role: it owns only the scratch database and is no superuser (restore-check.sh).
    ROLE=wildshard_restore
    step "postgres role $ROLE" have_role make_role
    for CHANNEL in production staging; do
      ROLE=wildshard_$CHANNEL DB=saves_$CHANNEL
      step "postgres role $ROLE" have_role make_role
      step "database $DB, owned by $ROLE alone" have_channel_db make_channel_db
    done
    # The shared role from before VH11 goes once it owns nothing.
    if [ "$(pg "select 1 from pg_roles where rolname = 'wildshard'")" = 1 ]; then
      say doing 'drop the shared role wildshard (VH11)'
      for DB in saves_production saves_staging; do runuser -u postgres -- psql --cluster "$PG_VERSION/main" -qtAc 'drop owned by wildshard' "$DB"; done
      pg 'drop role wildshard'
    fi
    if put "/etc/postgresql/$PG_VERSION/main/pg_ident.conf" 640 postgres:postgres <<'EOF'
# VPS-HARDENING VH11: each channel's OS user is its database role.
# MAPNAME   SYSTEM-USERNAME        PG-USERNAME
wildshard   wildshard-production   wildshard_production
wildshard   wildshard-staging      wildshard_staging
wildshard   postgres               wildshard_restore
EOF
    then PG_RELOAD=1; fi
    if put "/etc/postgresql/$PG_VERSION/main/pg_hba.conf" 640 postgres:postgres <<'EOF'
# VPS-HARDENING VH11: the local socket only, by peer. postgres administers; each channel reaches its own saves; nothing else.
# TYPE  DATABASE          USER                   METHOD
local   all               postgres               peer
local   saves_production  wildshard_production   peer map=wildshard
local   saves_staging     wildshard_staging      peer map=wildshard
local   saves_restore_check wildshard_restore    peer map=wildshard
local   all               all                    reject
EOF
    then PG_RELOAD=1; fi
    if [ "${PG_RELOAD:-0}" = 1 ]; then say doing "reload postgresql@$PG_VERSION-main"; systemctl reload "postgresql@$PG_VERSION-main.service"; fi
  else say would 'check the role and both saves databases'; fi
fi

# --- ops.env: the dump's and the uptime check's settings. Blank runs both locally; Jake fills it (MP0.2, MP0.3).
if [ "$(id -u)" != 0 ] && [ -d "$ETC" ] && [ ! -x "$ETC" ]; then say 'cannot verify' "$ETC/ops.env (needs sudo)"
elif put_once "$ETC/ops.env" 600 root:root <<'EOF'
# E7.8: the nightly dump and the uptime check. Both run with these blank: the dump stays on this disk, and a stopped server only logs.
# Where a stopped server is told. Any URL taking a POSTed line, such as https://ntfy.sh/<a long random topic>
ALERT_URL=
# J252: the wildshard-server project's Sentry DSN, so the dump checks in to the Crons monitor wildshard-dump. Blank skips it.
SENTRY_CRON_DSN=
# VH13: the age public key the dump is encrypted to. Its private half stays off the box. Blank leaves the dump unencrypted.
AGE_RECIPIENT=
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

# --- The staged release public key Phase 2 checks: raynos's, not group or world writable, equal to setup.sh's.
if id raynos >/dev/null 2>&1; then
  if [ ! -d "$KEY_DIR" ]; then
    if [ "$CHECK" = 1 ]; then say would "make $KEY_DIR"; else install -d -m 755 -o raynos -g raynos "$KEY_DIR"; fi
  fi
  if put "$KEY_FILE" 644 raynos:raynos <<<"$EXPECTED_KEY"; then :; fi
else say would "stage $KEY_FILE once raynos exists"; fi

# --- 2. Hardening, when VPS-HARDENING has written it
if [ -f "$HERE/harden.sh" ]; then
  if [ "$CHECK" = 1 ]; then say run 'harden.sh --check'; bash "$HERE/harden.sh" --check || say warn 'harden.sh --check reports drift'
  else say run 'harden.sh'; bash "$HERE/harden.sh"; fi
else say skip 'harden.sh is not written yet (VPS-HARDENING-PLAN); it must pass VH16 before port 443'; fi

# --- 3. Phase 2, once the box is on the tailnet
PHASE2=0
if ! tailnet_up; then
  if [ "$CHECK" = 1 ] && [ ! -x "$NODE" ]; then say would 'run setup.sh once Tailscale is installed and up'
  else wait_for 'Tailscale is not logged in: run `sudo tailscale up --ssh`, then run rebuild.sh again (Phase 2 needs the node name)'; fi
elif [ "$CHECK" = 1 ]; then
  say run 'setup.sh --check'
  if bash "$HERE/setup.sh" --check; then PHASE2=1; else say warn 'setup.sh --check reports what Phase 2 would change'; fi
else
  say run 'setup.sh (Phase 2)'
  bash "$HERE/setup.sh"
  PHASE2=1
fi

# --- 4. The cook worker (C4, J28): its own user, an engine checkout it can read and not write, and its unit.
have_cook_user() { id wildshard-cook >/dev/null 2>&1 && getent group wildshard-cook >/dev/null; }
make_cook_user() { useradd --system --user-group --home-dir "$COOK_HOME" --shell /usr/sbin/nologin wildshard-cook; }
step 'user wildshard-cook' have_cook_user make_cook_user
COOK_FOLDERS=("$COOK_HOME" "$COOK_HOME/scratch" "$COOK_HOME/server" "$COOK_HOME/store")
have_cook_folders() { local path; for path in "${COOK_FOLDERS[@]}"; do [ -d "$path" ] && metadata_ok "$path" 750 wildshard-cook:wildshard-cook || return 1; done; }
make_cook_folders() { install -d -m 750 -o wildshard-cook -g wildshard-cook "${COOK_FOLDERS[@]}"; }
step 'cook folders' have_cook_folders make_cook_folders
if [ "$(id -u)" != 0 ] && [ -d "$ETC" ] && [ ! -x "$ETC" ]; then say 'cannot verify' "$COOK_ENV (needs sudo)"
elif put_once "$COOK_ENV" 600 root:root <<'EOF'
# C4: the cook worker. It starts once the rows below are filled; then run rebuild.sh again.
# The engine tag it runs, and that build's id: the same build production serves (its version.json `build`).
COOK_ENGINE_REF=
WILDSHARD_BUILD=
# Where it lists the catalogue and downloads shardfiles
WILDSHARD_API_URL=https://api.wildshard.io
# The bearer token api-server's notify call sends (J30). The same value goes in api-server's settings.
COOK_NOTIFY_TOKEN=
# Where packs go: the four R2 rows, or, on a scratch box only, COOK_STORE_DIR (a folder under /var/lib/wildshard-cook).
R2_ACCOUNT_ID=
R2_BUCKET_PACKS=wildshard-packs
R2_PACKS_ACCESS_KEY_ID=
R2_PACKS_SECRET_ACCESS_KEY=
# COOK_STORE_DIR=/var/lib/wildshard-cook/store
EOF
then :; fi

# Ubuntu 24.04 refuses unprivileged user namespaces to unconfined programs, and each cook runs in one with no network.
# The worker gets its own copy of unshare and one AppArmor profile that allows exactly that copy.
have_cook_wrap() { [ -x "$COOK_LIB/unshare" ] && cmp -s /usr/bin/unshare "$COOK_LIB/unshare" && metadata_ok "$COOK_LIB/unshare" 750 root:wildshard-cook; }
make_cook_wrap() {
  install -d -m 755 -o root -g root "$COOK_LIB"
  install -m 750 -o root -g wildshard-cook /usr/bin/unshare "$COOK_LIB/unshare"
}
step "cook job wrap $COOK_LIB/unshare" have_cook_wrap make_cook_wrap
RESTRICTED=$(sysctl -n kernel.apparmor_restrict_unprivileged_userns 2>/dev/null || printf 0)
if [ "$RESTRICTED" = 1 ]; then
  if put /etc/apparmor.d/wildshard-cook-unshare 644 root:root <<EOF
# MP0.1: the cook worker's jobs each run in a user and network namespace of their own (C4). Only this copy may make one.
abi <abi/4.0>,
include <tunables/global>
profile wildshard-cook-unshare $COOK_LIB/unshare flags=(unconfined) {
  userns,
  include if exists <local/wildshard-cook-unshare>
}
EOF
  then if [ "$CHECK" = 0 ]; then apparmor_parser -r /etc/apparmor.d/wildshard-cook-unshare; fi; fi
else say ok 'unprivileged user namespaces are not restricted here; no AppArmor profile needed'; fi

COOK_REF='' COOK_READY=0
if [ -r "$COOK_ENV" ] && cook_env_complete "$COOK_ENV"; then COOK_READY=1; COOK_REF=$(env_value "$COOK_ENV" COOK_ENGINE_REF); fi
if [ "$COOK_READY" = 0 ]; then
  if [ -r "$COOK_ENV" ] || [ "$CHECK" = 0 ]; then wait_for "Fill $COOK_ENV (engine tag, build, notify token, and R2 or a folder), then run rebuild.sh again"
  elif [ "$(id -u)" = 0 ]; then say would "wait for $COOK_ENV to be filled"
  else say 'cannot verify' "$COOK_ENV (needs sudo)"; fi
fi

# The checkout: CI's sparse set, at the tag, installed once per commit. No package's
# install script runs as root here; the cook needs none.
org_git() { env GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=url.https://github.com/project-wildshard/.insteadOf GIT_CONFIG_VALUE_0=git@github.com:project-wildshard/ \
  GIT_CONFIG_KEY_1=url.https://github.com/project-wildshard/.insteadof GIT_CONFIG_VALUE_1=ssh://git@github.com/project-wildshard/ "$@"; }
cook_commit() { git -c safe.directory="$COOK_SRC" -C "$COOK_SRC" rev-parse HEAD 2>/dev/null; }
have_cook_source() {
  [ -f "$COOK_SRC/.wildshard-installed" ] && [ "$(cat "$COOK_SRC/.wildshard-installed")" = "$COOK_REF $(cook_commit)" ] \
    && [ "$(git -c safe.directory="$COOK_SRC" -C "$COOK_SRC" rev-parse "$COOK_REF^{commit}" 2>/dev/null)" = "$(cook_commit)" ]
}
make_cook_source() {
  install -d -m 755 -o root -g root "$(dirname "$COOK_SRC")"
  if [ ! -d "$COOK_SRC/.git" ]; then
    git clone --quiet --no-checkout --filter=blob:none "$ENGINE_GIT" "$COOK_SRC"
    git -C "$COOK_SRC" sparse-checkout set --no-cone '/*' '!/progress/' '!/art/' '!/sources/'
  fi
  git -c safe.directory="$COOK_SRC" -C "$COOK_SRC" fetch --quiet --tags origin
  git -c safe.directory="$COOK_SRC" -C "$COOK_SRC" checkout --quiet --force --detach "$COOK_REF^{commit}"
  rm -f "$COOK_SRC/.wildshard-installed"
  (cd "$COOK_SRC" && org_git env CI=1 HOME=/root COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack "$PNPM" install --frozen-lockfile --ignore-scripts --config.confirmModulesPurge=false)
  printf '%s %s\n' "$COOK_REF" "$(cook_commit)" > "$COOK_SRC/.wildshard-installed"
  chmod -R go-w "$COOK_SRC"
}
# MMO-SERVER MS2.4b: root clones under the box's umask 027, so the checkout came out 750 root:root and the cook, its own user,
# could not enter its WorkingDirectory (200/CHDIR). Root keeps owning it; the cook's group reads and traverses, and neither the
# group nor anyone else writes. The worker's own hash of cook.env stays root's. Symlinks (pnpm's) carry no mode of their own.
cook_unreadable() {
  find "$COOK_SRC" -name .wildshard-env -prune -o ! -type l \( ! -group "$COOK_GROUP" -o ! -perm -g+r -o -perm -g+w -o -perm -o+w \
    -o \( -type d ! -perm -g+x \) \) -print -quit
}
have_cook_read() { [ -d "$COOK_SRC" ] && [ -z "$(cook_unreadable)" ]; }
make_cook_read() {
  find "$COOK_SRC" -name .wildshard-env -prune -o -exec chgrp -h "$COOK_GROUP" {} + || return 1
  find "$COOK_SRC" -name .wildshard-env -prune -o ! -type l -exec chmod g+rX,g-w,o-w {} +
}
COOK_SOURCE_CHANGED=0
if [ "$COOK_READY" = 1 ]; then
  if [ "$CHECK" = 0 ] && ! have_cook_source; then COOK_SOURCE_CHANGED=1; fi
  step "cook source $COOK_SRC at $COOK_REF" have_cook_source make_cook_source
  if [ "$CHECK" = 0 ] && ! have_cook_read; then COOK_SOURCE_CHANGED=1; fi
  step "cook source readable by $COOK_GROUP" have_cook_read make_cook_read
fi
# What the running worker last read of cook.env, as a hash in its root-owned checkout: a changed file restarts it.
cook_env_hash() { sha256sum < "$COOK_ENV" | cut -d' ' -f1; }

if put "$SYSTEMD/wildshard-cook.service" 644 root:root <<EOF
[Unit]
Description=Wildshard cook worker (C4): api-server's notices in, packs out
After=network-online.target
Wants=network-online.target
# It starts only once rebuild.sh has the checkout and a complete cook.env.
ConditionPathExists=$COOK_SRC/.wildshard-installed

[Service]
User=wildshard-cook
Group=wildshard-cook
WorkingDirectory=$COOK_SRC
EnvironmentFile=$COOK_ENV
# MS2.4b: the checkout is root's and the worker runs git in it as wildshard-cook, which git refuses ("dubious ownership")
# unless the path is a safe.directory. Set here, not in a gitconfig the worker's home would have to hold.
Environment=GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0=$COOK_SRC
Environment=COOK_PORT=$COOK_PORT
Environment=COOK_HOST=127.0.0.1
Environment=COOK_SCRATCH=$COOK_HOME/scratch
Environment=COOK_SERVER_PACKS=$COOK_HOME/server
# Each job's prefix: a user and network namespace of its own, so nothing that reads a shardfile has a route out. The single
# quotes keep the JSON's double quotes, which systemd would otherwise strip.
Environment='COOK_JOB_WRAP=["$COOK_LIB/unshare","--user","--map-root-user","--net"]'
# A wrap that can't make its namespace fails here, once, and not in every cook.
ExecStartPre=$COOK_LIB/unshare --user --map-root-user --net /bin/true
ExecStart=$NODE --import ./scripts/bake-loader.mjs scripts/cook-worker.mjs serve
Restart=on-failure
RestartSec=5
# The plan's CPUs for Postgres and the cook worker; every job is a child, so these hold for all of them at once.
$SHARED_CPUS
MemoryMax=12G
TasksMax=512
LimitCORE=0
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ReadWritePaths=$COOK_HOME

[Install]
WantedBy=multi-user.target
EOF
then COOK_UNIT_CHANGED=1; else COOK_UNIT_CHANGED=0; fi

if [ "$CHECK" = 0 ]; then
  systemctl daemon-reload
  if [ "$COOK_READY" = 1 ]; then
    if systemctl is-active --quiet wildshard-cook.service && [ "$COOK_UNIT_CHANGED" = 0 ] && [ "$COOK_SOURCE_CHANGED" = 0 ] \
      && [ "$(cat "$COOK_SRC/.wildshard-env" 2>/dev/null)" = "$(cook_env_hash)" ]; then say ok 'cook worker running'
    else
      say doing 'start the cook worker'; systemctl enable --quiet wildshard-cook.service; systemctl restart wildshard-cook.service
      (umask 077; cook_env_hash > "$COOK_SRC/.wildshard-env")
    fi
    if wait_http "http://127.0.0.1:$COOK_PORT/health"; then say ok "cook worker answers on 127.0.0.1:$COOK_PORT"
    else say stop 'The cook worker is not answering /health; see journalctl -u wildshard-cook'; exit 1; fi
  fi
fi

# --- What is left, if anything
if [ "$PHASE2" = 1 ] && [ "$CHECK" = 0 ]; then
  for channel in production staging; do
    port=$([ "$channel" = production ] && printf 8790 || printf 8791)
    if wait_http "http://127.0.0.1:$port/health"; then say ok "$channel answers /health on 127.0.0.1:$port"
    else say warn "$channel is not answering /health on 127.0.0.1:$port yet"; fi
  done
fi
if [ "${#WAITING[@]}" != 0 ]; then say waiting "${#WAITING[@]} input(s) above; everything else is done"; exit 2; fi
if [ "$CHECK" = 1 ]; then say check 'Read-only pass complete'; exit 0; fi
say 'done' 'Rebuild complete: Phase 1, Phase 2 and the cook worker'
