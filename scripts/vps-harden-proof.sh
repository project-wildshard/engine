#!/usr/bin/env bash
# VPS-HARDENING VH1's proof: scripts/vps/harden.sh --check on a throwaway box, never the VPS. An Ubuntu 24.04 container that boots
# systemd, with the real sshd, ufw, fail2ban and sudo, is dressed as the box the 2026-11-09 audit found (matt in sudo, a docker group,
# clawdbot, an OpenClaw unit holding a planted token, a pending reboot, the server unit without VH10's trust). It runs on the Mac's
# own architecture, as scripts/vps-rebuild-proof.sh does.
#   bash scripts/vps-harden-proof.sh [--keep]     needs Docker; writes tmp/vps-harden-proof/<stamp>/; removes its container
# The runs: --check as root (must fail, row by row); --check as raynos (root-only reads must say unknown); the apply mode (must say it
# applies nothing); then a few VH2 and VH3 fixes by hand and --check again (those rows must turn ok). After every run, nothing under
# /etc, /home, /root, /usr, /opt or /var/lib may be newer than the marker set before the first, and the planted token never prints.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
KEEP=0; if [ "${1:-}" = --keep ]; then KEEP=1; fi
STAMP=$(date -u +%Y%m%dT%H%M%SZ) NAME=ws-harden-proof-$$ IMAGE=ws-harden-proof:noble
OUT=$ROOT/tmp/vps-harden-proof/$STAMP
mkdir -p "$OUT/image"
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$OUT/proof.log"; }
fail() { log "FAIL $*"; exit 1; }
cleanup() {
  if [ "$KEEP" = 1 ]; then log "kept container $NAME"; return; fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker image rm "$IMAGE" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- The audited box, as near as a container gets.
cat > "$OUT/image/Dockerfile" <<'EOF'
FROM ubuntu:24.04
RUN apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends systemd systemd-sysv dbus \
    openssh-server ufw fail2ban sudo iproute2 procps python3-systemd \
 && rm -rf /var/lib/apt/lists/*
RUN userdel -r ubuntu 2>/dev/null || true; \
    for user in raynos clawdbot matt; do useradd -m -s /bin/bash "$user"; done \
 && usermod -aG sudo raynos && usermod -aG sudo matt && groupadd docker && for user in clawdbot matt raynos; do usermod -aG docker "$user"; done \
 && printf '# Created by cloud-init\nmatt ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/90-cloud-init-users && chmod 440 /etc/sudoers.d/90-cloud-init-users \
 && mkdir -p /home/raynos/.config/systemd/user \
 && printf '[Service]\nEnvironment=OPENCLAW_GATEWAY_TOKEN=sk_claw_PROOFPLANTEDVALUE\n' > /home/raynos/.config/systemd/user/openclaw-gateway.service \
 && printf '[Service]\nUser=nobody\nEnvironment=RELEASE_CHANNEL=%%i\nExecStart=/bin/sleep infinity\n' > /etc/systemd/system/wildshard-server@.service \
 && mkdir -p /etc/wildshard && printf 'SEAT_SECRET=proof-not-printed\n' > /etc/wildshard/production.env && chmod 640 /etc/wildshard/production.env \
 && printf 'Nov 9 00:00:01 box sshd[1]: Accepted publickey for raynos from 100.101.1.2 port 5 ssh2\nNov 9 00:00:02 box sshd[2]: Invalid user admin from 203.0.113.9 port 6\nJan 31 00:00:03 box sshd[3]: Accepted publickey for root from 198.51.100.7 port 7 ssh2\n' > /var/log/auth.log \
 && chmod 640 /var/log/auth.log
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
EOF
log "build $IMAGE"
docker build -q -t "$IMAGE" "$OUT/image" >/dev/null
log "start $NAME"
docker run -d --name "$NAME" --hostname scratch-box --privileged --cgroupns=private --tmpfs /run --tmpfs /run/lock "$IMAGE" >/dev/null
box() { docker exec "$NAME" "$@"; }
for _ in $(seq 1 60); do if box systemctl is-system-running 2>/dev/null | grep -qE 'running|degraded'; then break; fi; sleep 1; done
box systemctl is-system-running 2>&1 | tee -a "$OUT/proof.log" || true
# Today's firewall (22 open to anyone, deny by default), fail2ban's sshd jail, and the reboot the kernel waits for.
box sh -c 'ufw allow 22/tcp >/dev/null && ufw --force enable >/dev/null' 2>&1 | tee -a "$OUT/proof.log" || log 'ufw could not enable in this container'
box sh -c 'printf "[sshd]\nenabled = true\nbackend = systemd\n" > /etc/fail2ban/jail.d/proof.conf && systemctl restart fail2ban'
for _ in $(seq 1 30); do if box fail2ban-client ping >/dev/null 2>&1; then break; fi; sleep 1; done
box sh -c 'echo "*** System restart required ***" > /run/reboot-required'
# The VPS runs sshd; a socket-activated container has no /run/sshd until it starts, and `sshd -T` needs it.
box systemctl start ssh.service
box mkdir -p /root/wildshard/scripts
docker cp "$ROOT/scripts/vps" "$NAME:/root/wildshard/scripts/vps"
box chmod -R a+rX /root/wildshard
box chmod o+x /root
box sh -c 'sleep 1; touch /root/marker; sleep 1'

# Nothing a run may touch, against the marker.
unchanged() {
  local newer
  newer=$(box sh -c 'find /etc /home /root /usr /opt /var/lib -xdev -newer /root/marker ! -path /var/lib/fail2ban/fail2ban.sqlite3 ! -path "/var/lib/systemd/*" ! -path "/var/lib/private/*" 2>/dev/null' || true)
  printf '%s\n' "$newer" > "$OUT/$1.newer.txt"
  if [ -n "$newer" ]; then fail "$1 changed: $newer"; fi
  log "$1 changed nothing under /etc /home /root /usr /opt /var/lib"
}
run() {
  local label=$1 status; shift
  set +e; box "$@" > "$OUT/$label.txt" 2>&1; status=$?; set -e
  printf '%s' "$status" > "$OUT/$label.exit"
  log "run $label exit $status: $(grep -c '^fail' "$OUT/$label.txt" || true) fail, $(grep -c '^unknown' "$OUT/$label.txt" || true) unknown, $(grep -c '^ok' "$OUT/$label.txt" || true) ok"
  if grep -qE 'PROOFPLANTEDVALUE|proof-not-printed' "$OUT/$label.txt"; then fail "$label printed a planted secret"; fi
  unchanged "$label"
}
has() { grep -qF -- "$2" "$OUT/$1.txt" || { cat "$OUT/$1.txt"; fail "$1 lacks: $2"; }; }
row_fails() { grep -qE "^fail +$2 " "$OUT/$1.txt" || { cat "$OUT/$1.txt"; fail "$1 has no failure for $2"; }; }
row_clean() { if grep -qE "^fail +$2 " "$OUT/$1.txt"; then grep -E "^fail +$2 " "$OUT/$1.txt"; fail "$1 still fails $2"; fi; }

run 1-root bash /root/wildshard/scripts/vps/harden.sh --check
[ "$(cat "$OUT/1-root.exit")" = 1 ] || fail '--check as root did not exit 1'
for row in VH2 VH3 VH5 VH6 VH7 VH9 VH10 VH11 VH12 VH13 VH14 VH15; do row_fails 1-root "$row"; done
has 1-root "sudo group is 'raynos,matt'"
has 1-root 'a docker group exists'
has 1-root '1 files under /home or /etc hold an OpenClaw token (sk_claw); names withheld'
has 1-root "sshd x11forwarding is 'yes'; want no"
has 1-root 'no fail2ban caddy jail (jails: sshd)'
has 1-root 'WARNING auth.log has 1 accepted SSH logins as root'
has 1-root 'sudoers.d/90-cloud-init-users: matt ALL=(ALL) NOPASSWD:ALL'
has 1-root 'production unit sets no TRUST_PROXY or ALLOWED_ORIGINS'
if grep -q 'ufw is active' "$OUT/1-root.txt"; then has 1-root 'ufw rules beyond 443 and tailscale0: 22/tcp'; fi

run 2-raynos runuser -u raynos -- bash /root/wildshard/scripts/vps/harden.sh --check
[ "$(cat "$OUT/2-raynos.exit")" != 0 ] || fail '--check without root exited 0'
has 2-raynos 'unknown VH3   sshd -T: needs sudo'
has 2-raynos 'unknown VH6   fail2ban-client status: needs sudo'
has 2-raynos 'unknown VH2   OpenClaw token search: needs sudo'

run 3-apply bash /root/wildshard/scripts/vps/harden.sh
[ "$(cat "$OUT/3-apply.exit")" = 0 ] || fail 'the apply mode did not exit 0'
has 3-apply 'applies nothing yet'

# --- A few of VH2's and VH3's fixes by hand: the rows they belong to must read clean.
box sh -c "gpasswd -d matt sudo >/dev/null && groupdel docker && userdel -r clawdbot 2>/dev/null; usermod -s /usr/sbin/nologin matt \
  && rm /home/raynos/.config/systemd/user/openclaw-gateway.service \
  && printf 'PasswordAuthentication no\nPermitRootLogin no\nKbdInteractiveAuthentication no\nX11Forwarding no\nAllowUsers raynos\nMaxAuthTries 3\n' > /etc/ssh/sshd_config.d/10-wildshard.conf"
box sh -c 'sleep 1; touch /root/marker; sleep 1'
run 4-fixed bash /root/wildshard/scripts/vps/harden.sh --check
for row in VH2 VH3; do row_clean 4-fixed "$row"; done
has 4-fixed 'ok      VH3   sshd x11forwarding no'
has 4-fixed 'ok      VH2   sudo group is raynos alone'
log "PASS: --check reads the audited box row by row, changes nothing, and turns clean as rows are fixed; evidence in $OUT"
