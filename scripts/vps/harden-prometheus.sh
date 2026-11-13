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
  if [ ! -d "$ETC" ]; then say wait SC2 "no $ETC yet: $channel's METRICS_PORT waits for setup.sh"; return; fi
  # wildshard-config's own lock, so a `set` (or its rollback) running now never loses this row or loses its own.
  if command -v flock >/dev/null 2>&1; then
    exec 9>>"$ETC/.$channel.settings.lock"; chmod 600 "$ETC/.$channel.settings.lock"; flock 9
  fi
  if [ -L "$file" ]; then say stop SC2 "$file is a link; not written"; exit 1; fi
  # A METRICS_PORT anywhere the unit reads it, the root-only .env included (its name only, never its value), is left alone.
  if grep -Eqs '^[[:space:]]*METRICS_PORT[[:space:]]*=' "$file" "$ETC/$channel.env"; then
    say ok SC2 "$channel names METRICS_PORT"; exec 9>&-; return
  fi
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
  exec 9>&-
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

# Write stdin to a path unless it already says that: 0 wrote, 1 already so. Any failure stops the whole script, so a drop-in
# that did not land never lets the package start on every address. With a check command, the new text is checked in its
# temporary file before it replaces the old one.
put() {
  local path=$1 check=${2:-} text temporary
  text=$(cat)
  if [ -r "$path" ] && [ "$(cat "$path")" = "$text" ]; then chmod 644 "$path" && chown root:root "$path" || exit 1; say ok SC2 "$path"; return 1; fi
  say doing SC2 "write $path"
  mkdir -p "$(dirname "$path")" || exit 1
  temporary=$(umask 077; mktemp "$(dirname "$path")/.harden.XXXXXX") || exit 1
  { printf '%s\n' "$text" > "$temporary" && chmod 644 "$temporary" && chown root:root "$temporary"; } || { rm -f "$temporary"; exit 1; }
  if [ -n "$check" ] && ! $check "$temporary" >/dev/null 2>&1; then
    $check "$temporary" 2>&1 | tail -3 || true
    rm -f "$temporary"; say stop SC2 "$path does not check; the old one stays"; exit 1
  fi
  mv -f -- "$temporary" "$path" || exit 1
}
units_changed=0 config_changed=0
if put "$PROMETHEUS_DROPIN" < <(prometheus_dropin); then units_changed=1; fi
if put "$NODE_DROPIN" < <(node_dropin); then units_changed=1; fi
# promtool comes with the package, so the very first config is checked after the install, before anything restarts.
check=; if command -v promtool >/dev/null 2>&1; then check='promtool check config'; fi
if put "$CONFIG" "$check" < <(config); then config_changed=1; fi
if [ "$units_changed" = 1 ]; then systemctl daemon-reload; fi

installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'ok installed'; }
missing=()
for name in prometheus prometheus-node-exporter; do installed "$name" || missing+=("$name"); done
if [ "${#missing[@]}" != 0 ]; then
  # No recommends: no Alertmanager, no Pushgateway, no textfile collectors with their own timers. needrestart only lists, so
  # an install never restarts a game server or PostgreSQL that holds an old library.
  say doing SC2 "install ${missing[*]}"
  apt-get update -qq
  NEEDRESTART_MODE=l NEEDRESTART_SUSPEND=1 DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "${missing[@]}"
fi
if ! promtool check config "$CONFIG" >/dev/null 2>&1; then
  promtool check config "$CONFIG" 2>&1 | tail -3 || true
  systemctl stop prometheus.service || true
  say stop SC2 "$CONFIG does not check; Prometheus is stopped"; exit 1
fi

systemctl enable --quiet prometheus.service prometheus-node-exporter.service
for unit in prometheus-node-exporter.service prometheus.service; do
  if [ "$units_changed" = 1 ] || ! systemctl is-active --quiet "$unit"; then systemctl restart "$unit"; say doing SC2 "restart $unit"
  elif [ "$unit" = prometheus.service ] && [ "$config_changed" = 1 ]; then systemctl reload "$unit"; say doing SC2 "reload $unit"
  else say ok SC2 "$unit running"; fi
done

metrics_setting production "$PRODUCTION_METRICS"
metrics_setting staging "$STAGING_METRICS"

# The proof, once both have bound: Prometheus and the node's metrics listen on loopback alone. A wider bind stops both units;
# a game server's /metrics off loopback is reported (harden.sh --check fails it too), and the rest of harden goes on.
listeners() { ss -ltnH | awk '{print $4}' | sed -E 's/%[^]:]+//'; }
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if listeners | grep -qx "$PROMETHEUS" && listeners | grep -qx "$NODE"; then break; fi
  sleep 1
done
off_loopback() { listeners | grep -E ":($1)\$" | grep -Ev '^(127\.0\.0\.1|\[::1\]):' | tr '\n' ' ' | sed 's/ $//' || true; }
exposed=$(off_loopback '9090|9100')
if [ -n "$exposed" ]; then
  systemctl stop prometheus.service prometheus-node-exporter.service
  say stop SC2 "Prometheus or the node exporter listens off loopback, so both are stopped: $exposed"; exit 1
fi
servers=$(off_loopback "$PRODUCTION_METRICS|$STAGING_METRICS")
if [ -n "$servers" ]; then say warn SC2 "a game server's /metrics listens off loopback: $servers"; fi
if listeners | grep -qx "$PROMETHEUS" && listeners | grep -qx "$NODE"; then say ok SC2 "Prometheus on $PROMETHEUS only, node metrics on $NODE only"
else say warn SC2 "Prometheus or the node exporter is not listening yet: journalctl -u prometheus -u prometheus-node-exporter"; fi
