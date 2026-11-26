#!/usr/bin/env bash
# MMO-OBSERVABILITY OB3 (meta docs/plans/MMO-OBSERVABILITY-PLAN.md; Jake, 2026-11-24: "A dashboard to see last 24hr & last 7d data,
# tailscale or wildshard admin"): Grafana over the box's own Prometheus, on loopback, reached only through a tailnet-only Serve route
# (https on the box's tailnet name, port 10000). Nothing public: no Caddy site, no new port, Funnel never on. Nothing leaves the box:
# no update checks, no analytics, no plugin downloads, no initial admin and no login (an anonymous Viewer on a private tailnet).
# The dashboard and the datasource are provisioned from this checkout (src/scripts/vps/grafana/); a hand edit in Grafana can't be saved.
#   harden-grafana.sh --print     print every file it writes and stop (test/vps-grafana.test.ts reads them)
# Run by harden-apply.sh as root. A rerun on a box that has it changes nothing and restarts nothing.
set -euo pipefail
matches() { grep "$@" >/dev/null; }
say() { printf '%-7s %-5s %s\n' "$1" "$2" "$3"; }
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# The official OSS build, pinned to its published SHA-256 (dl.grafana.com's .sha256 beside the tarball). A new version is a new pair.
VERSION=13.3.1
SHA256=6acf8939dd2f73332cbcafc27a33973fb1115b8867e7ffa3223c6e2ecbed8531
TARBALL_URL="https://dl.grafana.com/oss/release/grafana-$VERSION.linux-amd64.tar.gz"
OPT=/opt/wildshard-grafana PREFIX=/opt/wildshard-grafana/grafana-$VERSION CACHE=/var/cache/wildshard-grafana
ETC=/etc/wildshard-grafana STATE=/var/lib/wildshard-grafana
UNIT=/etc/systemd/system/wildshard-grafana.service
GRAFANA=127.0.0.1:3000 PROMETHEUS=127.0.0.1:9090 SERVE_PORT=10000
NODE=${NODE:-/usr/bin/node}

# The box's tailnet name: Grafana's own address for its links and its cross-site check (a query is a POST from that page).
tailnet_name() {
  if [ -n "${WILDSHARD_GRAFANA_TEST_HOST:-}" ]; then printf '%s' "$WILDSHARD_GRAFANA_TEST_HOST"; return; fi
  tailscale status --json | "$NODE" -e 'let s="";for await(const b of process.stdin)s+=b;const n=JSON.parse(s).Self.DNSName;if(typeof n!=="string")process.exit(1);process.stdout.write(n.replace(/\.$/,""));' --input-type=module
}

ini() {
  cat <<EOF
; MMO-OBSERVABILITY OB3: written by harden-grafana.sh; a hand edit is undone by the next harden.
[paths]
data = $STATE
logs = $STATE/log
plugins = $STATE/plugins
provisioning = $ETC/provisioning

[server]
http_addr = ${GRAFANA%:*}
http_port = ${GRAFANA#*:}
domain = $1
root_url = https://$1:$SERVE_PORT/
enforce_domain = false

[security]
disable_initial_admin_creation = true
cookie_secure = true
cookie_samesite = strict
; the page reaches Grafana through Serve, which may hand it another Host
csrf_trusted_origins = $1:$SERVE_PORT
disable_gravatar = true
allow_embedding = false

[auth]
disable_login_form = true
disable_signout_menu = true

[auth.anonymous]
enabled = true
org_role = Viewer
hide_version = true

[auth.basic]
enabled = false

[users]
allow_sign_up = false
allow_org_create = false

[analytics]
reporting_enabled = false
check_for_updates = false
check_for_plugin_updates = false
feedback_links_enabled = false

[news]
news_feed_enabled = false

[snapshots]
enabled = false
external_enabled = false

[public_dashboards]
enabled = false

[plugins]
preinstall_disabled = true
plugin_admin_enabled = false

[unified_alerting]
enabled = false

[dashboards]
default_home_dashboard_path = $ETC/dashboards/wildshard.json

[log]
mode = console
level = warn
EOF
}
datasource() {
  cat <<EOF
# MMO-OBSERVABILITY OB3: written by harden-grafana.sh. The box's own Prometheus, on loopback.
apiVersion: 1
datasources:
  - name: Prometheus
    uid: wildshard-prometheus
    type: prometheus
    access: proxy
    url: http://$PROMETHEUS
    isDefault: true
    editable: false
    jsonData:
      timeInterval: 15s
EOF
}
provider() {
  cat <<EOF
# MMO-OBSERVABILITY OB3: written by harden-grafana.sh. The dashboard from the engine checkout (src/scripts/vps/grafana/wildshard.json).
apiVersion: 1
providers:
  - name: wildshard
    type: file
    disableDeletion: true
    allowUiUpdates: false
    updateIntervalSeconds: 60
    options:
      path: $ETC/dashboards
EOF
}
# A unit of its own: a user made for the run, its state its only writable place, a quarter of one core at most, half a GiB.
unit() {
  cat <<EOF
# MMO-OBSERVABILITY OB3: written by harden-grafana.sh. Grafana on loopback; the tailnet reaches it through Serve only.
[Unit]
Description=Wildshard Grafana (the box's dashboard, loopback only)
After=network-online.target prometheus.service
Wants=network-online.target

[Service]
DynamicUser=yes
StateDirectory=wildshard-grafana
WorkingDirectory=$PREFIX
ExecStart=$PREFIX/bin/grafana server --homepath=$PREFIX --config=$ETC/grafana.ini
Restart=on-failure
RestartSec=5
MemoryMax=512M
CPUQuota=25%
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
LockPersonality=yes

[Install]
WantedBy=multi-user.target
EOF
}

case "${1:-}" in
  --print)
    host=$(tailnet_name)
    printf '# --- %s\n' "$ETC/grafana.ini"; ini "$host"
    printf '# --- %s\n' "$ETC/provisioning/datasources/wildshard.yaml"; datasource
    printf '# --- %s\n' "$ETC/provisioning/dashboards/wildshard.yaml"; provider
    printf '# --- %s\n' "$UNIT"; unit
    printf '# --- serve\n'; printf 'tailscale serve --bg --yes --https=%s http://%s\n' "$SERVE_PORT" "$GRAFANA"
    exit 0 ;;
  '') ;;
  *) say stop OB3 'usage: harden-grafana.sh [--print]'; exit 1 ;;
esac
if [ "$(id -u)" != 0 ]; then say stop OB3 'Run with sudo (harden.sh runs it)'; exit 1; fi

put() {
  local path=$1 text temporary
  text=$(cat)
  if [ -r "$path" ] && [ "$(cat "$path")" = "$text" ]; then chmod 644 "$path" && chown root:root "$path" || exit 1; say ok OB3 "$path"; return 1; fi
  say doing OB3 "write $path"
  mkdir -p "$(dirname "$path")" || exit 1
  temporary=$(umask 077; mktemp "$(dirname "$path")/.harden.XXXXXX") || exit 1
  { printf '%s\n' "$text" > "$temporary" && chmod 644 "$temporary" && chown root:root "$temporary"; } || { rm -f "$temporary"; exit 1; }
  mv -f -- "$temporary" "$path" || exit 1
}

# 1. The build: fetched once per version into the cache (kept, so a rerun never fetches again), checked, unpacked root-owned.
if [ ! -x "$PREFIX/bin/grafana" ]; then
  mkdir -p "$CACHE" "$OPT"; chmod 755 "$OPT"
  if [ ! -f "$CACHE/grafana-$VERSION.tar.gz" ]; then
    say doing OB3 "fetch Grafana $VERSION"
    curl -fsSL --proto '=https' --tlsv1.2 --max-time 900 -o "$CACHE/grafana-$VERSION.tar.gz.part" "$TARBALL_URL"
    mv -f -- "$CACHE/grafana-$VERSION.tar.gz.part" "$CACHE/grafana-$VERSION.tar.gz"
  fi
  if ! printf '%s  %s\n' "$SHA256" "$CACHE/grafana-$VERSION.tar.gz" | sha256sum -c --status; then
    mv -f -- "$CACHE/grafana-$VERSION.tar.gz" "$CACHE/grafana-$VERSION.tar.gz.bad"
    say stop OB3 "Grafana $VERSION does not match its pinned SHA-256; nothing installed (the file is kept as .bad)"; exit 1
  fi
  mkdir -p "$PREFIX.unpack"; chmod 755 "$PREFIX.unpack"
  tar -xzf "$CACHE/grafana-$VERSION.tar.gz" -C "$PREFIX.unpack" --strip-components=1 --no-same-owner
  chown -R root:root "$PREFIX.unpack"; chmod -R go-w "$PREFIX.unpack"
  mv -- "$PREFIX.unpack" "$PREFIX"
  say doing OB3 "installed Grafana $VERSION in $PREFIX"
else say ok OB3 "Grafana $VERSION installed"; fi

# 2. Its files.
host=$(tailnet_name) || { say stop OB3 'cannot read the tailnet name (tailscale status)'; exit 1; }
changed=0
if put "$ETC/grafana.ini" < <(ini "$host"); then changed=1; fi
if put "$ETC/provisioning/datasources/wildshard.yaml" < <(datasource); then changed=1; fi
if put "$ETC/provisioning/dashboards/wildshard.yaml" < <(provider); then changed=1; fi
# The dashboard itself is read live (every 60 s): a new one needs no restart.
put "$ETC/dashboards/wildshard.json" < "$HERE/grafana/wildshard.json" || true
units_changed=0
if put "$UNIT" < <(unit); then units_changed=1; fi
# Grafana reads every provisioning kind; the ones this box has none of are empty folders, not errors in its log.
mkdir -p "$ETC/provisioning/plugins" "$ETC/provisioning/alerting"
chmod 755 "$ETC" "$ETC/provisioning" "$ETC/provisioning/datasources" "$ETC/provisioning/dashboards" "$ETC/provisioning/plugins" "$ETC/provisioning/alerting" "$ETC/dashboards"
if [ "$units_changed" = 1 ]; then systemctl daemon-reload; fi
systemctl enable --quiet wildshard-grafana.service
if [ "$units_changed" = 1 ] || [ "$changed" = 1 ] || ! systemctl is-active --quiet wildshard-grafana.service; then
  systemctl restart wildshard-grafana.service; say doing OB3 'restart wildshard-grafana'
else say ok OB3 'wildshard-grafana running'; fi

# 3. Loopback alone, before the tailnet ever sees it.
listeners() { ss -ltnH | awk '{print $4}' | sed -E 's/%[^]:]+//'; }
for _ in $(seq 1 30); do if listeners | matches -x "$GRAFANA"; then break; fi; sleep 1; done
exposed=$(listeners | grep -E ':3000$' | grep -Ev '^(127\.0\.0\.1|\[::1\]):' | tr '\n' ' ' | sed 's/ $//' || true)
if [ -n "$exposed" ]; then systemctl stop wildshard-grafana.service; say stop OB3 "Grafana listens off loopback, so it is stopped: $exposed"; exit 1; fi
if ! listeners | matches -x "$GRAFANA"; then say warn OB3 "Grafana is not listening yet: journalctl -u wildshard-grafana"; exit 1; fi
say ok OB3 "Grafana on $GRAFANA only"

# 4. The tailnet route: Serve, never Funnel; setup-state.mjs checks the whole Serve state before and after.
guard() { tailscale serve status --json | "$NODE" "$HERE/setup-state.mjs" network "$host"; }
if ! guard >/dev/null; then say stop OB3 'Serve state has drift (setup-state.mjs network); no route added'; exit 1; fi
if tailscale serve status --json | "$NODE" -e 'let s="";for await(const b of process.stdin)s+=b;const w=JSON.parse(s).Web??{};process.exit(Object.keys(w).some(k=>k.endsWith(":'"$SERVE_PORT"'"))?0:1);' --input-type=module; then
  say ok OB3 "tailnet-only Serve on $SERVE_PORT"
else
  tailscale serve --bg --yes --https="$SERVE_PORT" "http://$GRAFANA" >/dev/null
  say doing OB3 "tailnet-only Serve https://$host:$SERVE_PORT -> $GRAFANA"
fi
guard >/dev/null || { say stop OB3 'Serve state has drift after the route; inspect tailscale serve status --json'; exit 1; }
say ok OB3 "dashboard: https://$host:$SERVE_PORT/ (tailnet only)"
