#!/usr/bin/env bash
# VPS-HARDENING VH3 to VH15 (MMO-SERVER-PLAN MS3.1): the apply half of harden.sh, which runs it for `sudo bash harden.sh`.
# Every step checks first and writes only what differs, so a rerun on a hardened box changes nothing.
#   sudo bash harden.sh                apply every row; 443 stays as it is in ufw
#   sudo bash harden.sh --open-443     also let Cloudflare's ranges (and only them) reach 443, after the pre-open gate
#   sudo bash harden.sh --close-443    take every 443 rule out of ufw again (a failed gate line, MS6.4)
# The steps that can cut the operator off (ufw, sshd, Tailscale SSH) arm a dead-man first: unless the operator runs
# `systemctl stop wildshard-harden-deadman.timer` within 10 minutes, from a new SSH session, the box undoes them by itself.
# Port 443 opens only by --open-443 (J264: Cloudflare in front; ufw is the last gate, Jake handed the opening to lanes).
# It never prints a secret: env files are tested for a name, never read out.
set -euo pipefail
MODE=apply
case "${1:-}" in '') ;; --open-443) MODE=open ;; --close-443) MODE=close ;; *) printf 'stop    Expected no arguments, --check, --open-443 or --close-443\n'; exit 1 ;; esac
if [ "$(id -u)" != 0 ]; then printf 'stop    Run with sudo; --check reads without it\n'; exit 1; fi
HERE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
say() { printf '%-7s %-5s %s\n' "$1" "$2" "$3"; }
CHANGED=0
# Write stdin to a path unless it already says that. Returns 0 if it wrote.
put() {
  local path=$1 mode=$2 owner=$3 row=$4 text temporary
  text=$(cat)
  if [ -r "$path" ] && [ "$(cat "$path")" = "$text" ]; then
    chmod "$mode" "$path"; chown "$owner" "$path"; say ok "$row" "$path"; return 1
  fi
  say doing "$row" "write $path"
  mkdir -p "$(dirname "$path")"
  temporary=$(umask 077; mktemp "$(dirname "$path")/.harden.XXXXXX")
  printf '%s\n' "$text" > "$temporary"; chmod "$mode" "$temporary"; chown "$owner" "$temporary"; mv -f -- "$temporary" "$path"
  CHANGED=1
}
installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'ok installed'; }
need_packages() {
  local missing=() name
  for name in "$@"; do installed "$name" || missing+=("$name"); done
  if [ "${#missing[@]}" = 0 ]; then return; fi
  say doing VH1 "install ${missing[*]}"
  apt-get update -qq; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}"
}

# Cloudflare's published ranges (https://www.cloudflare.com/ips-v4 and ips-v6, read 2026-11-11). 443 opens to these alone,
# and Caddy believes CF-Connecting-IP only from them. A change upstream is a code change here, reviewed like any other.
CF_V4=(173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20
  188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22)
CF_V6=(2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32)

# --- The dead-man, before anything that can cut the operator off.
DEADMAN=wildshard-harden-deadman
deadman_armed=0
arm_deadman() {
  if [ "$deadman_armed" = 1 ]; then return; fi
  systemctl stop "$DEADMAN.timer" 2>/dev/null || true; systemctl reset-failed "$DEADMAN.service" 2>/dev/null || true
  systemd-run --quiet --unit="$DEADMAN" --on-active=600 /bin/sh -c \
    'ufw --force disable; tailscale set --ssh=true; rm -f /etc/ssh/sshd_config.d/10-wildshard.conf; systemctl try-reload-or-restart ssh.service'
  deadman_armed=1
  say armed VH3 "dead-man: in 10 minutes ufw goes off, Tailscale SSH comes back and the sshd file goes, unless you run 'systemctl stop $DEADMAN.timer' from a new SSH session"
}

# The ufw rules that let anything in and are not ours, by number, highest first (deleting one never renumbers the next).
# Ours: anything on tailscale0, 41641/udp from anywhere, and with `443` 443/tcp from exactly one of Cloudflare's ranges.
# It reads each rule's port and source, never its comment, so a wide rule cannot pass by its label, and an all-port or
# port-range rule that covers 443 is drift too.
drift_rules() {
  local status
  status=$(ufw status numbered) || { say stop VH4 'ufw status did not answer; no rule changed' >&2; exit 1; }
  printf '%s\n' "$status" | python3 -I -c '
import re, sys
keep443, cloudflare, drift = sys.argv[1] == "443", set(sys.argv[2:]), []
for line in sys.stdin:
    rule = re.match(r"^\[ *(\d+)\] (.+?) +(?:ALLOW|LIMIT) IN +(.+?)(?: +#.*)?\s*$", line)
    if not rule: continue
    number, to, source = int(rule.group(1)), rule.group(2).strip(), rule.group(3).strip()
    if to in ("Anywhere on tailscale0", "Anywhere (v6) on tailscale0"): continue
    if to in ("41641/udp", "41641/udp (v6)") and source in ("Anywhere", "Anywhere (v6)"): continue
    if keep443 and to in ("443/tcp", "443/tcp (v6)") and source in cloudflare: continue
    drift.append(number)
print(" ".join(str(number) for number in sorted(drift, reverse=True)))
' "$1" "${CF_V4[@]}" "${CF_V6[@]}"
}

# --- 443 alone: open or close, then stop.
if [ "$MODE" = close ]; then
  # Every rule that is not ours goes, Cloudflare's 443 included, and so does an all-port or port-range rule that covers 443.
  drift=$(drift_rules shut) || exit 1
  for number in $drift; do
    arm_deadman
    say doing VH4 "delete ufw rule $number: $(ufw status numbered | grep -E "^\[ *$number\]" | sed 's/  */ /g')"; ufw --force delete "$number" >/dev/null
  done
  say ok VH4 'ufw has no rule that reaches 443: 443 is shut'; exit 0
fi
if [ "$MODE" = open ]; then
  # Every rule that is not ours goes first, so "nothing else" is true: a 443 rule from outside Cloudflare, an all-port or
  # port-range rule that covers 443, an old 22. A deletion can cut SSH, so the dead-man is armed before any.
  drift=$(drift_rules 443) || exit 1
  for number in $drift; do
    arm_deadman
    say doing VH4 "delete ufw rule $number: $(ufw status numbered | grep -E "^\[ *$number\]" | sed 's/  */ /g')"; ufw --force delete "$number" >/dev/null
  done
  for range in "${CF_V4[@]}" "${CF_V6[@]}"; do ufw allow proto tcp from "$range" to any port 443 comment 'Cloudflare (J264)' >/dev/null; done
  say ok VH4 "ufw lets ${#CF_V4[@]} IPv4 and ${#CF_V6[@]} IPv6 Cloudflare ranges reach 443, and nothing else"; exit 0
fi

need_packages ufw fail2ban nftables age unattended-upgrades python3 lynis auditd acct sysstat debsums apt-show-versions

# --- VH16's lynis floor (80, MS5.2): accounting, audit, a banner, password ages, a tighter umask, no rare protocols.
if [ "$(sed -n 's/^ENABLED="\(.*\)"$/\1/p' /etc/default/sysstat 2>/dev/null)" != true ]; then
  sed -i 's/^ENABLED=.*/ENABLED="true"/' /etc/default/sysstat; say doing VH16 'sysstat collects'
fi
for service in auditd acct sysstat; do
  if ! systemctl is-enabled --quiet "$service" 2>/dev/null || ! systemctl is-active --quiet "$service"; then systemctl enable --now --quiet "$service"; say doing VH16 "$service on"; fi
done
if put /etc/audit/rules.d/90-wildshard.rules 640 root:root VH16 <<'EOF'
## VPS-HARDENING VH16: who changed who may log in, who may be root, and the game's secrets.
-w /etc/passwd -p wa -k identity
-w /etc/group -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/sudoers -p wa -k sudoers
-w /etc/sudoers.d/ -p wa -k sudoers
-w /etc/ssh/sshd_config -p wa -k sshd
-w /etc/ssh/sshd_config.d/ -p wa -k sshd
-w /etc/wildshard/ -p wa -k wildshard
-w /opt/wildshard-vps/ -p wa -k wildshard
-w /usr/local/sbin/ -p wa -k wildshard
EOF
then audit_changed=1; fi
audit_changed=${audit_changed:-0}
banner='Authorized access only. Every session and command on this system is logged and monitored.
Disconnect now if you are not an authorized user.'
for file in /etc/issue /etc/issue.net; do if put "$file" 644 root:root VH16 <<<"$banner"; then :; fi; done
for pair in PASS_MAX_DAYS:365 PASS_MIN_DAYS:1 PASS_WARN_AGE:14 UMASK:027; do
  name=${pair%%:*} value=${pair#*:}
  if ! grep -Eq "^$name[[:space:]]+$value\$" /etc/login.defs; then
    if grep -Eq "^$name[[:space:]]" /etc/login.defs; then sed -i -E "s/^$name[[:space:]].*/$name\t$value/" /etc/login.defs
    else printf '%s\t%s\n' "$name" "$value" >> /etc/login.defs; fi
    say doing VH16 "login.defs $name $value"
  fi
done
if put /etc/modprobe.d/90-wildshard.conf 644 root:root VH16 <<'EOF'
# VPS-HARDENING VH16: protocols and storage this box never uses, never loaded.
install dccp /bin/false
install sctp /bin/false
install rds /bin/false
install tipc /bin/false
install usb-storage /bin/false
blacklist dccp
blacklist sctp
blacklist rds
blacklist tipc
blacklist usb-storage
EOF
then :; fi

# --- VH15: kernel and sysctl.
if put /etc/sysctl.d/90-wildshard.conf 644 root:root VH15 <<'EOF'
# VPS-HARDENING VH15. Docker is gone, so nothing here forwards or redirects.
net.ipv4.ip_forward = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv6.conf.default.accept_redirects = 0
net.ipv4.conf.all.log_martians = 1
fs.suid_dumpable = 0
net.ipv4.tcp_syncookies = 1
kernel.dmesg_restrict = 1
kernel.kptr_restrict = 1
kernel.unprivileged_bpf_disabled = 1
kernel.yama.ptrace_scope = 1
EOF
then sysctl -q -p /etc/sysctl.d/90-wildshard.conf; fi
# apport sets fs.suid_dumpable=2 each time it starts, after sysctl.d, so VH15 drifted at every boot: it stays off.
if systemctl list-unit-files apport.service >/dev/null 2>&1 && [ "$(systemctl is-enabled apport.service 2>/dev/null)" != masked ]; then
  systemctl disable --now --quiet apport.service 2>/dev/null || true; systemctl mask --quiet apport.service
  [ -f /etc/default/apport ] && sed -i 's/^enabled=.*/enabled=0/' /etc/default/apport
  say doing VH15 'apport off and masked: it no longer resets fs.suid_dumpable at boot'
fi

# --- J266 (MS3.5): the agents' own account. No password, key only, its key from the Mac's ~/.ssh/wildshard_agent_ed25519.
# sshd reads its key only from root's /etc/ssh/authorized_keys/wildshard-agent (a Match in VH3's file), never from its own
# home, so the account cannot add a key of its own (Codex J206). sudo and SSH sessions report to Sentry
# through the same PAM lines as raynos's (VH14). Off in one command: usermod --expiredate 1 wildshard-agent.
AGENT=wildshard-agent
if ! id "$AGENT" >/dev/null 2>&1; then useradd --create-home --shell /bin/bash "$AGENT"; say doing J266 "create $AGENT"; fi
if [ "$(passwd -S "$AGENT" | awk '{print $2}')" != L ]; then passwd -l "$AGENT" >/dev/null; say doing J266 "$AGENT has no password"; fi
install -d -m 755 -o root -g root /etc/ssh/authorized_keys
if put "/etc/ssh/authorized_keys/$AGENT" 644 root:root J266 < "$HERE/wildshard-agent.pub"; then :; fi
if ! id -nG "$AGENT" | tr ' ' '\n' | grep -qx systemd-journal; then usermod -aG systemd-journal "$AGENT"; say doing J266 "$AGENT reads the journal by group"; fi

# Shutting public SSH before the box is on the tailnet would lock everyone out of a fresh Rebuild, so VH3 and VH4 wait for it.
tailnet_up() { tailscale status --json 2>/dev/null | python3 -I -c 'import json, sys; j = json.load(sys.stdin); sys.exit(0 if j.get("BackendState") == "Running" else 1)'; }
if ! tailnet_up; then
  say wait VH3 'the box is not on the tailnet yet: ufw (VH4) and SSH (VH3) wait, so public SSH stays as it is; rerun after tailscale up'
else
# --- VH4: ufw. Deny in; the tailnet and Tailscale's direct-path port in; 443 only by --open-443.
ufw_rules=$(ufw status verbose 2>/dev/null || true)
if printf '%s\n' "$ufw_rules" | grep -q '^Status: active' && printf '%s\n' "$ufw_rules" | grep -q 'deny (incoming)' \
  && printf '%s\n' "$ufw_rules" | grep -q 'ALLOW IN.*on tailscale0\|on tailscale0.*ALLOW IN' && printf '%s\n' "$ufw_rules" | grep -q '^41641/udp '; then
  say ok VH4 'ufw is active: deny in, allow tailscale0 and 41641/udp'
else
  arm_deadman
  say doing VH4 'ufw: deny in, allow out, allow all on tailscale0 and udp 41641'
  ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null
  ufw allow in on tailscale0 comment 'tailnet (D1)' >/dev/null
  ufw allow 41641/udp comment 'Tailscale direct paths' >/dev/null
  ufw --force enable >/dev/null
fi
# Anything else ufw lets in is drift: an old 22, a stray port, a 443 rule from outside Cloudflare. --open-443's rules stay.
drift=$(drift_rules 443) || exit 1
for rule in $drift; do
  arm_deadman
  say doing VH4 "delete ufw rule $rule: $(ufw status numbered | grep -E "^\[ *$rule\]" | sed 's/  */ /g')"; ufw --force delete "$rule" >/dev/null
done

# --- VH3: sshd, and SSH over the tailnet to that sshd (D1). Tailscale SSH would bypass sshd's rules, root included.
if put /etc/ssh/sshd_config.d/10-wildshard.conf 644 root:root VH3 <<'EOF'
# VPS-HARDENING VH3: keys only, raynos and the agents' account (J266) only, over the tailnet only (ufw and the Hetzner
# firewall shut public 22; D1).
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
X11Forwarding no
AllowUsers raynos wildshard-agent
MaxAuthTries 3
# VH16's lynis floor: no tunnels or agent forwarding through the box, each key fingerprint logged, two sessions a connection.
AllowTcpForwarding no
AllowAgentForwarding no
LogLevel VERBOSE
MaxSessions 2
# J266: the agents' account reads root's copy of its key, never a file in its own home. Last in this file on purpose.
Match User wildshard-agent
    AuthorizedKeysFile /etc/ssh/authorized_keys/wildshard-agent
EOF
then
  arm_deadman
  sshd -t; systemctl try-reload-or-restart ssh.service
fi
# What sshd will really do for each account: the agent's Match must reach it alone, and raynos must keep his own keys.
sshd_keys() { sshd -T -C "user=$1,host=wildshard,addr=100.64.0.1" 2>/dev/null | awk 'tolower($1)=="authorizedkeysfile" {$1=""; sub(/^ /,""); print}'; }
if [ "$(sshd_keys "$AGENT")" != /etc/ssh/authorized_keys/wildshard-agent ] || ! sshd_keys raynos | grep -q '\.ssh/authorized_keys'; then
  say stop VH3 "sshd's key files are wrong (agent '$(sshd_keys "$AGENT")', raynos '$(sshd_keys raynos)'); the dead-man undoes the sshd file"; exit 1
fi
if ! [ -s /home/raynos/.ssh/authorized_keys ]; then say stop VH3 'raynos has no authorized_keys: refusing to turn Tailscale SSH off'; exit 1; fi
if tailscale debug prefs 2>/dev/null | grep -q '"RunSSH": true'; then
  arm_deadman
  say doing VH3 'turn Tailscale SSH off: tailnet SSH reaches sshd, which refuses root (MS3.3)'
  tailscale set --ssh=false
else say ok VH3 'Tailscale SSH is off; sshd answers on the tailnet'; fi
if [ "$(passwd -S raynos | awk '{print $2}')" != P ]; then say next VH3 'raynos has no password: the console break-glass needs one (MS3.2)'; fi

fi

# ufw sets its own sysctl file each time it starts, and Ubuntu's turns log_martians off: it says the same as ours (VH15).
if grep -Eq '^net/ipv4/conf/(all|default)/log_martians=0' /etc/ufw/sysctl.conf 2>/dev/null; then
  sed -i -E 's#^(net/ipv4/conf/(all|default)/log_martians)=0#\1=1#' /etc/ufw/sysctl.conf; say doing VH15 '/etc/ufw/sysctl.conf logs martians'
fi
sysctl -q -p /etc/sysctl.d/90-wildshard.conf

# --- J266: the root-owned copy of these scripts the agents' allowlist runs, refreshed from wherever this runs (Jake's sudo,
# or wildshard-apply's verified copy of a signed tag). Run from that copy, it is already current.
OPT=/opt/wildshard-vps
if [ "$HERE" != "$OPT" ] && ! diff -rq "$HERE" "$OPT" >/dev/null 2>&1; then
  rm -rf /opt/wildshard-vps.new; cp -R "$HERE" /opt/wildshard-vps.new; chown -R root:root /opt/wildshard-vps.new; chmod -R go-w /opt/wildshard-vps.new
  rm -rf /opt/wildshard-vps; mv /opt/wildshard-vps.new /opt/wildshard-vps; say doing J266 "refresh $OPT from $HERE"; audit_changed=1
else say ok J266 "$OPT"; fi
# The audit watches load after the folders they watch exist; a replaced /opt/wildshard-vps needs its watch again.
if [ "$audit_changed" = 1 ]; then
  if augenrules --load >/dev/null 2>&1 && auditctl -l 2>/dev/null | grep -q 'wildshard-vps'; then say ok VH16 'audit watches loaded'
  else say warn VH16 'the audit watches did not load; auditd keeps its old ones until it restarts'; fi
fi
# The two helpers (MS3.5): settings without secrets, and a signed tag's scripts.
for pair in wildshard-config:wildshard-config wildshard-apply.mjs:wildshard-apply; do
  if ! cmp -s "$HERE/${pair%%:*}" "/usr/local/sbin/${pair#*:}"; then
    install -m 755 -o root -g root "$HERE/${pair%%:*}" "/usr/local/sbin/${pair#*:}"; say doing J266 "install /usr/local/sbin/${pair#*:}"
  fi
done

# --- MS3.3 (VH8, VH12): raynos's narrow allowlist. Exact commands, exact arguments, no pager, no wildcard.
# Root-owned copies, so the allowlist names files raynos cannot change. wildshard-harden's apply half is only reachable
# through the allowlist as --open-443 and --close-443.
for pair in harden.sh:wildshard-harden harden-apply.sh:harden-apply.sh; do
  if ! cmp -s "$HERE/${pair%%:*}" "/usr/local/sbin/${pair#*:}"; then
    install -m 755 -o root -g root "$HERE/${pair%%:*}" "/usr/local/sbin/${pair#*:}"; say doing VH8 "install /usr/local/sbin/${pair#*:}"
  fi
done
if [ -f /etc/wildshard/lib/restore-check.sh ]; then
  if ! cmp -s /etc/wildshard/lib/restore-check.sh /usr/local/sbin/wildshard-restore-check; then
    install -m 755 -o root -g root /etc/wildshard/lib/restore-check.sh /usr/local/sbin/wildshard-restore-check; say doing VH8 'install /usr/local/sbin/wildshard-restore-check'
  fi
fi
# VH16: lynis needs root to see the box; the wrapper takes no arguments and prints only its findings and score.
if put /usr/local/sbin/wildshard-lynis 755 root:root VH8 <<'EOF'
#!/bin/bash
# VPS-HARDENING VH16: `lynis audit system` as root, for the pre-open gate. No arguments; its report stays in /var/log.
set -uo pipefail
# From /, so lynis finds no profile or plugin in the caller's folder (Codex J206).
cd / || exit 1
lynis audit system --quiet --no-colors >/dev/null 2>&1
grep -E '^(hardening_index|warning\[\]|suggestion\[\])=' /var/log/lynis-report.dat
EOF
then :; fi
units=(wildshard-server@production wildshard-server@staging wildshard-pull@production wildshard-pull@staging wildshard-cook)
rules=
for unit in "${units[@]}"; do
  for verb in start stop restart; do rules="$rules, /usr/bin/systemctl $verb $unit"; done
  rules="$rules, /usr/bin/systemctl --no-pager status $unit"
done
# The operator stops the dead-man from a new session once it has proved it still gets in.
rules="$rules, /usr/bin/systemctl stop wildshard-harden-deadman.timer, /usr/bin/systemctl start wildshard-dump, /usr/bin/systemctl restart caddy, /usr/bin/systemctl --no-pager status caddy"
rules="$rules, /usr/local/sbin/wildshard-lynis \"\", /usr/local/sbin/wildshard-harden --check, /usr/local/sbin/wildshard-harden --open-443, /usr/local/sbin/wildshard-harden --close-443"
# A dump path and the age key file are its arguments (sudo drops AGE_IDENTITY from the environment).
rules="$rules, /usr/local/sbin/wildshard-restore-check"
# MS8.3: the day Jake plays on the rooms address, the Funnel goes (D3).
rules="$rules, /usr/bin/tailscale funnel --https=443 off, /usr/bin/tailscale funnel --https=8443 off"
sudoers=$(umask 077; mktemp)
printf '# MMO-SERVER-PLAN MS3.3: what lanes may run as root with no password. Anything else needs raynos'"'"'s password.\nraynos ALL=(root) NOPASSWD: %s\n' "${rules#, }" > "$sudoers"
if visudo -cqf "$sudoers"; then
  if cmp -s "$sudoers" /etc/sudoers.d/20-wildshard-agents; then rm -f "$sudoers"; say ok VH8 '/etc/sudoers.d/20-wildshard-agents'
  else chmod 440 "$sudoers"; chown root:root "$sudoers"; mv -f "$sudoers" /etc/sudoers.d/20-wildshard-agents; say doing VH8 'write /etc/sudoers.d/20-wildshard-agents'; fi
else rm -f "$sudoers"; say stop VH8 'the allowlist does not parse; nothing written'; exit 1; fi
# J266: the agents' account gets the same list, the two helpers, and the root-owned scripts. raynos keeps its own password
# for everything else.
agent_rules="$rules, /usr/local/sbin/wildshard-config, /usr/local/sbin/wildshard-apply, /usr/bin/bash $OPT/rebuild.sh, /usr/bin/bash $OPT/harden.sh"
sudoers=$(umask 077; mktemp)
printf '# MMO-SERVER-PLAN MS3.5 (J266): what the agents'"'"' account may run as root with no password; sudo reports each to Sentry.\n%s ALL=(root) NOPASSWD: %s\n' "$AGENT" "${agent_rules#, }" > "$sudoers"
if visudo -cqf "$sudoers"; then
  if cmp -s "$sudoers" /etc/sudoers.d/21-wildshard-agent; then rm -f "$sudoers"; say ok J266 '/etc/sudoers.d/21-wildshard-agent'
  else chmod 440 "$sudoers"; chown root:root "$sudoers"; mv -f "$sudoers" /etc/sudoers.d/21-wildshard-agent; say doing J266 'write /etc/sudoers.d/21-wildshard-agent'; fi
else rm -f "$sudoers"; say stop J266 'the agent allowlist does not parse; nothing written'; exit 1; fi
if ! id -nG raynos | tr ' ' '\n' | grep -qx systemd-journal; then usermod -aG systemd-journal raynos; say doing VH8 'raynos reads the journal by group, not sudo'; fi

# --- VH5: updates and reboots. D6: no Ubuntu Pro.
if put /etc/apt/apt.conf.d/52wildshard-unattended 644 root:root VH5 <<'EOF'
// VPS-HARDENING VH5: the third-party sources too, and a reboot in the daily quiet window (04:30 UTC, 23:30 Cancún).
Unattended-Upgrade::Origins-Pattern {
	"site=deb.nodesource.com";
	"origin=Tailscale";
	"origin=cloudsmith/caddy/stable";
	"site=pkg.cloudflare.com";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
EOF
then :; fi
if put /etc/apt/apt.conf.d/20auto-upgrades 644 root:root VH5 <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
then :; fi

# --- VH14 (J252): auth events go to Sentry as events the agents read; never a phone.
if put /usr/local/sbin/wildshard-alert 755 root:root VH14 <<'EOF'
#!/bin/bash
# VPS-HARDENING VH14 (J252): one Sentry event (wildshard-server project, DSN from ops.env) per SSH or console login, sudo
# session or fail2ban ban, for the agents' hourly read. It never fails, and never delays, its caller.
#   wildshard-alert [<line>]   from PAM (pam_exec) it builds the line from PAM_* itself
# sudo runs PAM with an empty environment, so the path is its own.
PATH=/usr/sbin:/usr/bin:/sbin:/bin
[ "${PAM_TYPE:-open_session}" = open_session ] || exit 0
dsn=$(sed -n 's/^SENTRY_CRON_DSN=//p' /etc/wildshard/ops.env 2>/dev/null | tail -n 1)
[ -n "$dsn" ] || exit 0
line=${1:-"${PAM_SERVICE:-?}: ${PAM_USER:-?}${PAM_RUSER:+ (by $PAM_RUSER)} from ${PAM_RHOST:-the box}"}
key=${dsn#*://} key=${key%%@*} rest=${dsn#*@}
body=$(python3 -I -c 'import json, sys, socket, uuid; print(json.dumps({"event_id": uuid.uuid4().hex, "level": "warning", "logger": "wildshard-auth", "platform": "other", "server_name": socket.gethostname(), "environment": "production", "message": {"formatted": sys.argv[1]}, "tags": {"kind": "auth"}}))' "$line" 2>/dev/null) || exit 0
( curl -fsS -m 5 -o /dev/null -H 'Content-Type: application/json' \
    -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_key=$key, sentry_client=wildshard-alert/1" \
    --data "$body" "https://${rest%%/*}/api/${rest##*/}/store/" >/dev/null 2>&1 & ) >/dev/null 2>&1
exit 0
EOF
then :; fi
for service in sshd sudo login; do
  file=/etc/pam.d/$service
  [ -f "$file" ] || continue
  if grep -q 'wildshard-alert' "$file"; then say ok VH14 "$file alerts"
  else printf '# VPS-HARDENING VH14: every session tells Sentry (J252)\nsession optional pam_exec.so quiet /usr/local/sbin/wildshard-alert\n' >> "$file"; say doing VH14 "$file alerts"; fi
done
if [ ! -d /var/log/journal ]; then install -d -m 2755 -o root -g systemd-journal /var/log/journal; systemctl restart systemd-journald; say doing VH14 'journald keeps its log'; fi

# --- VH6: fail2ban. sshd only: behind Cloudflare a ban by source address would ban a Cloudflare edge, so per-player limits
# live in the server, keyed by CF-Connecting-IP (VH10).
fail2ban_changed=0
if put /etc/fail2ban/action.d/wildshard-alert.conf 644 root:root VH14 <<'EOF'
# VPS-HARDENING VH14: a ban tells Sentry (J252).
[Definition]
actionban = /usr/local/sbin/wildshard-alert "fail2ban <name> banned <ip> after <failures> tries"
actionunban =
EOF
then fail2ban_changed=1; fi
if put /etc/fail2ban/jail.d/wildshard.conf 644 root:root VH6 <<'EOF'
# VPS-HARDENING VH6: SSH, which only the tailnet reaches (D1); bans go to nftables and to Sentry.
[DEFAULT]
banaction = nftables
banaction_allports = nftables[type=allports]

[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
action = %(action_)s
         wildshard-alert[name=sshd]
EOF
then fail2ban_changed=1; fi
systemctl enable --quiet fail2ban
if [ "$fail2ban_changed" = 1 ] || ! systemctl is-active --quiet fail2ban; then systemctl restart fail2ban; fi

# --- VH7: systemd sandboxing, as drop-ins over the units setup.sh and rebuild.sh write. Never MemoryDenyWriteExecute (V8's JIT).
sandbox='CapabilityBoundingSet=
AmbientCapabilities=
PrivateDevices=yes
PrivateUsers=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
ProtectProc=invisible
RestrictSUIDSGID=yes
RestrictRealtime=yes
LockPersonality=yes
SystemCallFilter=@system-service
SystemCallFilter=~@privileged @resources
SystemCallArchitectures=native
UMask=0077
RemoveIPC=yes
DevicePolicy=closed
KeyringMode=private'
units_changed=0
if put /etc/systemd/system/wildshard-server@.service.d/90-harden.conf 644 root:root VH7 <<EOF
# VPS-HARDENING VH7
[Service]
$sandbox
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
RestrictNamespaces=yes
TasksMax=512
EOF
then units_changed=1; fi
for pair in production:18G staging:6G; do
  if put "/etc/systemd/system/wildshard-server@${pair%%:*}.service.d/90-memory.conf" 644 root:root VH7 <<EOF
# VPS-HARDENING VH7
[Service]
MemoryMax=${pair#*:}
EOF
  then units_changed=1; fi
done
# The cook's jobs each make a user and network namespace (C4), so it keeps exactly those two.
if put /etc/systemd/system/wildshard-cook.service.d/90-harden.conf 644 root:root VH7 <<EOF
# VPS-HARDENING VH7
[Service]
$(printf '%s\n' "$sandbox" | grep -v '^PrivateUsers=')
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=user net
MemoryMax=4G
EOF
then units_changed=1; fi
if put /etc/systemd/system/caddy.service.d/90-harden.conf 644 root:root VH7 <<EOF
# VPS-HARDENING VH7: Caddy binds 443 and nothing else; admin is off, so a config change is a restart.
[Service]
$(printf '%s\n' "$sandbox" | grep -Ev '^(CapabilityBoundingSet|AmbientCapabilities|PrivateUsers)=')
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/var/lib/caddy /var/log/caddy
ExecReload=
MemoryMax=1G
TasksMax=512
EOF
then units_changed=1; fi
if [ "$units_changed" = 1 ]; then
  systemctl daemon-reload
  say next VH7 'unit sandboxes changed: they take effect at each unit'"'"'s next restart (a deploy, or systemctl restart)'
fi

# --- VH9: the proxy (J264: Caddy behind Cloudflare, Full (strict) with an Origin CA certificate, mTLS from Cloudflare only).
"$HERE/harden-caddy.sh"

say 'done' '' "harden.sh applied$([ "$CHANGED" = 0 ] && printf ' (no change)'); now run: harden.sh --check"
if [ "$deadman_armed" = 1 ]; then say next VH3 "from a NEW ssh session check you still get in, then: systemctl stop $DEADMAN.timer"; fi
