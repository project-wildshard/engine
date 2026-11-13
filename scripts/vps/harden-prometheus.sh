#!/usr/bin/env bash
# SERVER-CELLS SC2 (J328; Jake, 2026-11-13, grill Q9: "now or you do it"): a box-local Prometheus, loopback only.
# The distro's prometheus and prometheus-node-exporter, each held to 127.0.0.1 by a systemd drop-in written before the
# package installs, so even the first start never listens anywhere else. 15 days of samples, no remote write: nothing leaves
# the box. Every 15 s it scrapes production's and staging's `/metrics` (SC1: the server's METRICS_PORT, which this sets in
# each channel's .settings when it is absent) and the node's. Agents read it on the box without sudo:
#   curl -s 127.0.0.1:9090/api/v1/targets      curl -s '127.0.0.1:9090/api/v1/query?query=wildshard_cells_resident'
#   harden-prometheus.sh --print               print every file it writes and stop (the engine's test reads them)
# Run by harden-apply.sh as root. A rerun on a box that has it changes nothing and restarts nothing.
set -euo pipefail
say() { printf '%-7s %-5s %s\n' "$1" "$2" "$3"; }
# Each channel's METRICS_PORT; wildshard-config pins the same two (the engine's test holds them equal).
PRODUCTION_METRICS=9790 STAGING_METRICS=9791
PROMETHEUS=127.0.0.1:9090 NODE=127.0.0.1:9100
CONFIG=/etc/prometheus/wildshard.yml
PROMETHEUS_DROPIN=/etc/systemd/system/prometheus.service.d/90-wildshard.conf
NODE_DROPIN=/etc/systemd/system/prometheus-node-exporter.service.d/90-wildshard.conf
# The engine's test hands it a made-up /etc/wildshard for the settings step; never as root.
TEST=
if [ "$(id -u)" != 0 ] && [ -n "${WILDSHARD_PROMETHEUS_TEST_ROOT:-}" ]; then TEST=$WILDSHARD_PROMETHEUS_TEST_ROOT; fi
ETC=$TEST/etc/wildshard

config() {
  cat <<EOF
# SERVER-CELLS SC2: written by harden-prometheus.sh; a hand edit is undone by the next harden.
# Loopback targets only, and no remote write: nothing leaves the box.
global:
  scrape_interval: 15s
  evaluation_interval: 15s
scrape_configs:
  - job_name: wildshard
    static_configs:
      - targets: ['127.0.0.1:$PRODUCTION_METRICS']
        labels:
          channel: production
      - targets: ['127.0.0.1:$STAGING_METRICS']
        labels:
          channel: staging
  - job_name: node
    static_configs:
      - targets: ['$NODE']
EOF
}
# The packaged units read \$ARGS from /etc/default; these replace the whole command line, so nothing there can widen a bind.
prometheus_dropin() {
  cat <<EOF
# SERVER-CELLS SC2: loopback only, 15 days kept (harden-prometheus.sh).
[Service]
ExecStart=
ExecStart=/usr/bin/prometheus --config.file=$CONFIG --storage.tsdb.path=/var/lib/prometheus/metrics2/ --storage.tsdb.retention.time=15d --web.listen-address=$PROMETHEUS
MemoryMax=2G
EOF
}
node_dropin() {
  cat <<EOF
# SERVER-CELLS SC2: loopback only (harden-prometheus.sh).
[Service]
ExecStart=
ExecStart=/usr/bin/prometheus-node-exporter --web.listen-address=$NODE
MemoryMax=256M
EOF
}

# Each channel's METRICS_PORT, added to its settings file only when the file names none: a value an agent set, blank (off)
# included, stays. The server reads it at its next start; this never restarts a game server.
metrics_setting() {
  local channel=$1 port=$2 file temporary
  file=$ETC/$channel.settings
  if [ -L "$file" ]; then say stop SC2 "$file is a link; not written"; exit 1; fi
  if [ -f "$file" ] && grep -Eq '^[[:space:]]*METRICS_PORT[[:space:]]*=' "$file"; then say ok SC2 "$channel.settings names METRICS_PORT"; return; fi
  if [ ! -d "$ETC" ]; then say wait SC2 "no $ETC yet: $channel's METRICS_PORT waits for setup.sh"; return; fi
  temporary=$(umask 077; mktemp "$ETC/.harden-prometheus.XXXXXX")
  if [ -f "$file" ]; then
    cat "$file" > "$temporary"
    if [ -s "$temporary" ] && [ -n "$(tail -c 1 "$temporary")" ]; then printf '\n' >> "$temporary"; fi
  else
    printf '%s\n' "# MMO-SERVER-PLAN MS3.5 (J266): this channel's non-secret settings, read after its .env. Change them with" \
      '# `sudo wildshard-config set <channel> <KEY> <value>`; secrets stay in the .env.' > "$temporary"
  fi
  printf 'METRICS_PORT=%s\n' "$port" >> "$temporary"
  chmod 640 "$temporary"
  if [ -z "$TEST" ]; then chown "root:wildshard-$channel" "$temporary"; fi
  mv -f -- "$temporary" "$file"
  say doing SC2 "$channel METRICS_PORT=$port: its /metrics comes on at its next start (a release, or sudo -n systemctl restart wildshard-server@$channel)"
}

case "${1:-}" in
  --print)
    printf '# --- %s\n' "$CONFIG"; config
    printf '# --- %s\n' "$PROMETHEUS_DROPIN"; prometheus_dropin
    printf '# --- %s\n' "$NODE_DROPIN"; node_dropin
    exit 0 ;;
  --settings)
    if [ -z "$TEST" ]; then say stop SC2 '--settings is the engine test'"'"'s; harden.sh runs the whole step'; exit 1; fi
    metrics_setting production "$PRODUCTION_METRICS"; metrics_setting staging "$STAGING_METRICS"; exit 0 ;;
  '') ;;
  *) say stop SC2 'usage: harden-prometheus.sh [--print]'; exit 1 ;;
esac
if [ "$(id -u)" != 0 ]; then say stop SC2 'Run with sudo (harden.sh runs it)'; exit 1; fi

# Write stdin to a path unless it already says that. Returns 0 if it wrote.
put() {
  local path=$1 text temporary
  text=$(cat)
  if [ -r "$path" ] && [ "$(cat "$path")" = "$text" ]; then say ok SC2 "$path"; return 1; fi
  say doing SC2 "write $path"
  mkdir -p "$(dirname "$path")"
  temporary=$(umask 077; mktemp "$(dirname "$path")/.harden.XXXXXX")
  printf '%s\n' "$text" > "$temporary"; chmod 644 "$temporary"; chown root:root "$temporary"; mv -f -- "$temporary" "$path"
}
units_changed=0 config_changed=0
if prometheus_dropin | put "$PROMETHEUS_DROPIN"; then units_changed=1; fi
if node_dropin | put "$NODE_DROPIN"; then units_changed=1; fi
if config | put "$CONFIG"; then config_changed=1; fi
if [ "$units_changed" = 1 ]; then systemctl daemon-reload; fi

installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'ok installed'; }
missing=()
for name in prometheus prometheus-node-exporter; do installed "$name" || missing+=("$name"); done
if [ "${#missing[@]}" != 0 ]; then
  # No recommends: no Alertmanager, no Pushgateway, no textfile collectors with their own timers.
  say doing SC2 "install ${missing[*]}"
  apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}"
fi
if ! promtool check config "$CONFIG" >/dev/null 2>&1; then
  promtool check config "$CONFIG" 2>&1 | tail -3
  say stop SC2 "$CONFIG does not check; Prometheus left as it is"; exit 1
fi

systemctl enable --quiet prometheus.service prometheus-node-exporter.service
for unit in prometheus-node-exporter.service prometheus.service; do
  if [ "$units_changed" = 1 ] || ! systemctl is-active --quiet "$unit"; then systemctl restart "$unit"; say doing SC2 "restart $unit"
  elif [ "$unit" = prometheus.service ] && [ "$config_changed" = 1 ]; then systemctl reload "$unit"; say doing SC2 "reload $unit"
  else say ok SC2 "$unit running"; fi
done

metrics_setting production "$PRODUCTION_METRICS"
metrics_setting staging "$STAGING_METRICS"

# The proof: Prometheus, the node's metrics and both /metrics listen on loopback alone. A wider bind stops both units.
exposed=
for attempt in 1 2 3 4 5; do
  exposed=$(ss -ltnH | awk '{print $4}' | grep -E ":(9090|9100|$PRODUCTION_METRICS|$STAGING_METRICS)\$" | grep -Ev '^(127\.0\.0\.1|\[::1\]):' | tr '\n' ' ' | sed 's/ $//') || true
  if ss -ltnH | awk '{print $4}' | grep -qx "$PROMETHEUS"; then break; fi
  sleep 2
done
if [ -n "$exposed" ]; then
  systemctl stop prometheus.service prometheus-node-exporter.service
  say stop SC2 "a metrics port listens off loopback, so Prometheus and the node exporter are stopped: $exposed"; exit 1
fi
if ss -ltnH | awk '{print $4}' | grep -qx "$PROMETHEUS"; then say ok SC2 "Prometheus on $PROMETHEUS only, node metrics on $NODE only"
else say warn SC2 "Prometheus is not listening on $PROMETHEUS yet: journalctl -u prometheus"; fi
