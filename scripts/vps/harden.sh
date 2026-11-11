#!/usr/bin/env bash
# VPS-HARDENING VH1: read everything the 2026-11-09 audit couldn't without sudo, and say, row by row, how far this box is from
# VH2 to VH15. It changes nothing: it only reads files, `sshd -T`, `ufw status`, `fail2ban-client status`, `systemd-analyze security`,
# `sysctl`, `pro status`, PostgreSQL's catalogue, auth.log and, when `hcloud` is set up, the Hetzner Cloud Firewall.
#   sudo bash harden.sh --check   the full report; without root, what root alone can read says `unknown`
#   sudo bash harden.sh           applies nothing yet: VH3 to VH15 are scripted into it next, and proved in a container first
# Exit 0 is a clean box, 1 is any `fail`, 2 is no `fail` but something unreadable. It never prints a secret: a secret search
# reports a count of files, and env files are tested for a name, never read out.
# HARD STOP (Jake, 2026-11-09): nothing here touches the old VPS beyond reading it, and Jake runs it there, not an agent.
# HARDEN_ROOTFS prefixes every file it reads, so the engine's test can hand it a made-up box; commands come from PATH.
set -uo pipefail
if [ "${1:-}" != --check ]; then
  if [ "$#" != 0 ]; then printf 'stop    Expected no arguments or --check\n'; exit 1; fi
  printf 'skip    harden.sh applies nothing yet (VPS-HARDENING VH3 to VH15 come next); run it with --check for the report\n'; exit 0
fi
R=${HARDEN_ROOTFS:-}
FAILS=0 UNKNOWNS=0
line() { printf '%-7s %-5s %s\n' "$1" "$2" "$3"; }
ok() { line ok "$1" "$2"; }
bad() { line fail "$1" "$2"; FAILS=$((FAILS + 1)); }
unknown() { line unknown "$1" "$2"; UNKNOWNS=$((UNKNOWNS + 1)); }
info() { line info "$1" "$2"; }
has() { command -v "$1" >/dev/null 2>&1; }
ROOT=0; if [ "$(id -u 2>/dev/null)" = 0 ]; then ROOT=1; fi
NEEDS_ROOT='needs sudo'
# Every listener once: "address:port" per line.
LISTENERS=; LISTENERS_OK=0
if has ss && LISTENERS=$(ss -ltnH 2>/dev/null | awk '{print $4}'); then LISTENERS_OK=1; fi
listens_on() { printf '%s\n' "$LISTENERS" | grep -Eq ":$1\$"; }
# A listener on every address, not loopback or one interface.
wildcard_on() { printf '%s\n' "$LISTENERS" | grep -Eq "^(0\.0\.0\.0|\*|\[::\]|::):$1\$"; }

info VH1 "host $(hostname 2>/dev/null || echo '?'), kernel $(uname -r 2>/dev/null || echo '?'), $([ "$ROOT" = 1 ] && echo 'as root' || echo 'not root: root-only reads say unknown')"

# --- VH1's own reads: who may do what, and who came in.
if [ "$ROOT" = 1 ]; then
  if [ -d "$R/etc/sudoers.d" ]; then
    for file in "$R"/etc/sudoers.d/*; do
      [ -f "$file" ] || continue
      rules=$(grep -Ev '^[[:space:]]*(#|$)' "$file" 2>/dev/null | tr '\n' ';' | sed 's/;$//')
      info VH1 "sudoers.d/$(basename "$file"): ${rules:-no rules}"
    done
  fi
  if [ -r "$R/var/log/auth.log" ]; then
    logs=("$R/var/log/auth.log"); [ -r "$R/var/log/auth.log.1" ] && logs+=("$R/var/log/auth.log.1")
    accepted=$(cat "${logs[@]}" | grep -c 'sshd.*Accepted ' || true)
    failed=$(cat "${logs[@]}" | grep -Ec 'sshd.*(Failed |Invalid user)' || true)
    rootin=$(cat "${logs[@]}" | grep -c 'sshd.*Accepted .* for root ' || true)
    sudos=$(cat "${logs[@]}" | grep -c 'sudo: .*COMMAND=' || true)
    from=$(cat "${logs[@]}" | grep 'sshd.*Accepted ' | sed -n 's/.* for \([^ ]*\) from \([^ ]*\) .*/\1@\2/p' | sort | uniq -c | sort -rn | head -5 | awk '{printf "%s%s x%s", (NR > 1 ? ", " : ""), $2, $1}')
    info VH1 "auth.log: $accepted accepted SSH logins (${from:-none}), $failed failed or invalid, $rootin as root, $sudos sudo commands"
    # History, not drift: VH3's permitrootlogin check is what stops the next one. Loud, but it never blocks a clean report.
    if [ "$rootin" != 0 ]; then info VH3 "WARNING auth.log has $rootin accepted SSH logins as root: find out whose"; fi
  else unknown VH1 'auth.log is missing or unreadable'; fi
else unknown VH1 "sudoers.d and auth.log: $NEEDS_ROOT"; fi

# --- VH2: a clean box.
if has getent; then
  sudoers=$(getent group sudo | cut -d: -f4)
  if [ "$sudoers" = raynos ]; then ok VH2 'sudo group is raynos alone'; else bad VH2 "sudo group is '${sudoers}'; want raynos alone"; fi
  if getent group docker >/dev/null; then bad VH2 "a docker group exists (members '$(getent group docker | cut -d: -f4)'): docker is root without a password"
  else ok VH2 'no docker group'; fi
  shells=$(getent passwd | awk -F: '$3 >= 1000 && $3 < 60000 && $7 !~ /(nologin|false|sync)$/ {print $1}' | sort | tr '\n' ' ' | sed 's/ $//')
  if [ "$shells" = raynos ]; then ok VH2 'raynos is the only login user'; else bad VH2 "login users: '${shells}'; want raynos alone"; fi
else unknown VH2 'getent is missing'; fi
if has snap && snap list ollama >/dev/null 2>&1; then bad VH2 'the third-party ollama snap is installed'; else ok VH2 'no ollama snap'; fi
if [ "$LISTENERS_OK" = 1 ]; then
  if listens_on 11434; then bad VH2 'something listens on 11434 (Ollama)'; else ok VH2 'nothing on 11434'; fi
else unknown VH2 'listeners: ss is missing'; fi
if [ "$ROOT" = 1 ]; then
  found=$(grep -rlsI sk_claw "$R/home" "$R/etc" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$found" = 0 ]; then ok VH2 'no OpenClaw token under /home or /etc'; else bad VH2 "$found files under /home or /etc hold an OpenClaw token (sk_claw); names withheld"; fi
else unknown VH2 "OpenClaw token search: $NEEDS_ROOT"; fi

# --- VH3: SSH.
if [ "$ROOT" = 1 ] && has sshd; then
  if config=$(sshd -T 2>&1); then
    want() { if printf '%s\n' "$config" | grep -qix "$1 $2"; then ok VH3 "sshd $1 $2"; else bad VH3 "sshd $1 is '$(printf '%s\n' "$config" | awk -v k="$1" 'tolower($1)==k {$1=""; sub(/^ /,""); print}')'; want $2"; fi; }
    want passwordauthentication no; want permitrootlogin no; want kbdinteractiveauthentication no; want x11forwarding no
    want maxauthtries 3; want allowusers raynos
  else unknown VH3 "sshd -T failed: $(printf '%s\n' "$config" | head -1)"; fi
elif [ "$ROOT" = 1 ]; then info VH3 'no sshd installed'
else unknown VH3 "sshd -T: $NEEDS_ROOT"; fi
if [ "$LISTENERS_OK" = 1 ] && wildcard_on 22; then info VH3 'sshd listens on every address; ufw and the Hetzner firewall decide who reaches it'; fi

# --- VH4: firewall, two layers.
if [ "$ROOT" = 1 ] && has ufw; then
  status=$(ufw status verbose 2>/dev/null)
  if printf '%s\n' "$status" | grep -q '^Status: active'; then ok VH4 'ufw is active'; else bad VH4 'ufw is not active'; fi
  if printf '%s\n' "$status" | grep -q 'deny (incoming)'; then ok VH4 'ufw denies incoming by default'; else bad VH4 'ufw does not deny incoming by default'; fi
  # A rule line has an action column; keep the ones that are neither 443 nor the tailnet interface.
  extra=$(printf '%s\n' "$status" | grep -E ' (ALLOW|DENY|REJECT|LIMIT)( IN| OUT)? ' | grep -Ev '^443(/tcp)?( \(v6\))? |on tailscale0' | sed 's/  */ /g; s/ $//' | tr '\n' ';' | sed 's/;$//')
  if [ -z "$extra" ]; then ok VH4 'ufw allows only 443 and tailscale0'; else bad VH4 "ufw rules beyond 443 and tailscale0: $extra"; fi
elif [ "$ROOT" = 1 ]; then bad VH4 'ufw is not installed'
else unknown VH4 "ufw rules: $NEEDS_ROOT"; fi
if has hcloud; then
  if firewalls=$(hcloud firewall list -o noheader -o columns=name,applied_to_count 2>/dev/null); then
    if printf '%s\n' "$firewalls" | awk '$2 > 0 {found=1} END {exit !found}'; then ok VH4 "Hetzner Cloud Firewall attached: $(printf '%s' "$firewalls" | tr '\n' ';')"
    else bad VH4 'no Hetzner Cloud Firewall is applied to any server'; fi
  else unknown VH4 'hcloud has no working context (no token on this box is right; check the console)'; fi
else unknown VH4 'Hetzner Cloud Firewall: no hcloud here; check the console'; fi

# --- VH5: updates and reboots.
running=$(uname -r 2>/dev/null)
newest=$(find "$R/boot" -maxdepth 1 -name 'vmlinuz-*' 2>/dev/null | sed 's|.*/vmlinuz-||' | sort -V | tail -1)
if [ -z "$newest" ]; then unknown VH5 'no installed kernel under /boot'
elif [ "$running" = "$newest" ]; then ok VH5 "running the newest installed kernel $running"
else bad VH5 "running kernel $running; $newest is installed (reboot)"; fi
if [ -e "$R/var/run/reboot-required" ]; then bad VH5 "a reboot has been required since $(date -r "$R/var/run/reboot-required" +%F 2>/dev/null || echo '?')"
else ok VH5 'no reboot pending'; fi
apt_conf=$(cat "$R"/etc/apt/apt.conf.d/* 2>/dev/null | grep -Ev '^[[:space:]]*//')
if printf '%s\n' "$apt_conf" | grep -Eq 'Unattended-Upgrade::Automatic-Reboot[[:space:]]+"true"'; then ok VH5 'unattended-upgrades reboots by itself'
else bad VH5 'unattended-upgrades never reboots (Automatic-Reboot is not "true")'; fi
missing=
for origin in nodesource tailscale caddy cloudflare; do
  if ! printf '%s\n' "$apt_conf" | grep -A40 -E 'Unattended-Upgrade::(Allowed-Origins|Origins-Pattern)' | grep -qi "$origin"; then missing="$missing $origin"; fi
done
if [ -z "$missing" ]; then ok VH5 'unattended-upgrades covers nodesource, Tailscale, Caddy and cloudflared'
else bad VH5 "unattended-upgrades never updates:$missing"; fi
if has pro; then
  pro=$(pro status 2>/dev/null)
  for service in esm-apps livepatch; do
    if printf '%s\n' "$pro" | grep -Eq "^$service +yes +enabled"; then ok VH5 "pro $service enabled"; else bad VH5 "pro $service is not enabled"; fi
  done
else unknown VH5 'no pro client'; fi

# --- VH6: fail2ban.
if [ "$ROOT" = 1 ] && has fail2ban-client; then
  jails=$(fail2ban-client status 2>/dev/null | sed -n 's/.*Jail list:[[:space:]]*//p')
  for jail in sshd caddy; do
    if printf '%s\n' "$jails" | tr ', ' '\n\n' | grep -qx "$jail"; then ok VH6 "fail2ban jail $jail"; else bad VH6 "no fail2ban $jail jail (jails: ${jails:-none})"; fi
  done
elif [ "$ROOT" = 1 ]; then bad VH6 'fail2ban is not installed'
else unknown VH6 "fail2ban-client status: $NEEDS_ROOT"; fi

# --- VH7: systemd sandboxing. Exposure 3.0 or lower is systemd's "OK".
if has systemctl && has systemd-analyze; then
  for unit in wildshard-server@production.service wildshard-server@staging.service wildshard-cook.service caddy.service cloudflared.service; do
    if ! systemctl cat "$unit" >/dev/null 2>&1; then info VH7 "$unit is not installed"; continue; fi
    score=$(systemd-analyze security --no-pager "$unit" 2>/dev/null | sed -n 's/.*Overall exposure level for [^:]*: \([0-9.]*\).*/\1/p' | tail -1)
    if [ -z "$score" ]; then unknown VH7 "$unit: no exposure score"
    elif awk -v s="$score" 'BEGIN {exit !(s <= 3.0)}'; then ok VH7 "$unit exposure $score"
    else bad VH7 "$unit exposure $score; want 3.0 or lower"; fi
  done
else unknown VH7 'no systemd here'; fi

# --- VH8: Node never root, never exposed.
if has ps; then
  if ps -o user= -C node 2>/dev/null | grep -qx root; then bad VH8 'a node process runs as root'; else ok VH8 'no node process runs as root'; fi
else unknown VH8 'ps is missing'; fi
if [ "$LISTENERS_OK" = 1 ]; then
  tails=$( { tailscale ip -4; tailscale ip -6; } 2>/dev/null | tr '\n' '|' | sed 's/|$//' | sed 's/\./\\./g')
  exposed=$(printf '%s\n' "$LISTENERS" | grep -E ':(8790|8791|8792)$' | grep -Ev "^(127\.0\.0\.1|\[::1\]${tails:+|\[?($tails)\]?}):" | tr '\n' ' ' | sed 's/ $//')
  if [ -z "$exposed" ]; then ok VH8 'game and cook ports listen on loopback or the tailnet only'; else bad VH8 "game or cook port on a public address: $exposed"; fi
fi

# --- VH9: the proxy.
if has caddy; then
  caddyfile=$(cat "$R/etc/caddy/Caddyfile" 2>/dev/null)
  for want in 'admin off' 'protocols h1 h2' '-CF-Connecting-IP' 'stream_close_delay'; do
    if printf '%s\n' "$caddyfile" | grep -qF -- "$want"; then ok VH9 "Caddyfile has '$want'"; else bad VH9 "Caddyfile lacks '$want'"; fi
  done
else bad VH9 'Caddy is not installed'; fi
if [ "$ROOT" = 1 ] && has nft; then
  if nft list ruleset 2>/dev/null | grep -E 'dport 443' | grep -q 'ct count'; then ok VH9 'nftables caps concurrent connections on 443'
  else bad VH9 'no nftables per-address cap on 443'; fi
elif [ "$ROOT" = 1 ]; then bad VH9 'nft is not installed'
else unknown VH9 "nftables ruleset: $NEEDS_ROOT"; fi

# --- VH10: server-side trust. The unit names its proxy (setup.sh); the code that reads it ships in the signed release.
if has systemctl && systemctl cat wildshard-server@.service >/dev/null 2>&1; then
  for channel in production staging; do
    environment=$(systemctl show -p Environment "wildshard-server@$channel.service" 2>/dev/null)
    mode=$(printf '%s\n' "$environment" | grep -o 'TRUST_PROXY=[a-z]*' | head -1)
    if [ -n "$mode" ] && printf '%s\n' "$environment" | grep -q 'ALLOWED_ORIGINS='; then ok VH10 "$channel unit sets $mode and ALLOWED_ORIGINS"
    else bad VH10 "$channel unit sets no TRUST_PROXY or ALLOWED_ORIGINS: rerun setup.sh after the VH10 release"; fi
  done
else bad VH10 'no wildshard-server@ unit'; fi

# --- VH11: PostgreSQL least privilege.
if [ "$LISTENERS_OK" = 1 ]; then
  if listens_on 5432; then bad VH11 "PostgreSQL listens on TCP: $(printf '%s\n' "$LISTENERS" | grep ':5432$' | tr '\n' ' ' | sed 's/ $//')"; else ok VH11 'nothing on TCP 5432'; fi
fi
if [ "$ROOT" = 1 ] && has runuser && id postgres >/dev/null 2>&1 && has psql; then
  if supers=$(runuser -u postgres -- psql -XtAc 'select rolname from pg_roles where rolsuper order by 1' 2>/dev/null); then
    supers=$(printf '%s' "$supers" | tr '\n' ' ' | sed 's/ $//')
    if [ "$supers" = postgres ]; then ok VH11 'postgres is the only superuser'; else bad VH11 "superusers: $supers"; fi
    roles=$(runuser -u postgres -- psql -XtAc "select rolname from pg_roles where rolname like 'wildshard%' order by 1" 2>/dev/null | tr '\n' ' ' | sed 's/ $//')
    if [ "$roles" = 'wildshard_production wildshard_staging' ]; then ok VH11 'one role per channel'; else bad VH11 "game roles are '${roles}'; want wildshard_production and wildshard_staging"; fi
  else unknown VH11 'PostgreSQL did not answer'; fi
elif [ "$ROOT" = 1 ]; then bad VH11 'no PostgreSQL server: the per-channel roles do not exist'
else unknown VH11 "PostgreSQL roles: $NEEDS_ROOT"; fi

# --- VH12: secrets.
if [ "$ROOT" = 1 ] && [ -d "$R/etc/wildshard" ]; then
  open=$(find "$R/etc/wildshard" -perm /o=rwx 2>/dev/null | sed "s|^$R||" | tr '\n' ' ' | sed 's/ $//')
  if [ -z "$open" ]; then ok VH12 'nothing in /etc/wildshard is world-readable'; else bad VH12 "world-accessible: $open"; fi
  for file in "$R"/etc/wildshard/*.env; do
    [ -f "$file" ] || continue
    name=$(basename "$file" .env); have=$(stat -c '%a %U:%G' "$file" 2>/dev/null)
    case $name in ops) want='600 root:root' ;; cook) want='600 root:root' ;; *) want="640 root:wildshard-$name" ;; esac
    if [ "$have" = "$want" ]; then ok VH12 "$name.env $have"; else bad VH12 "$name.env is $have; want $want"; fi
  done
  if find "$R/etc/wildshard" "$R/home" "$R/root" -name '*release*sign*key*' 2>/dev/null | grep -q .; then bad VH12 'a release signing key sits on the box'
  else ok VH12 'no release signing key on the box'; fi
elif [ "$ROOT" = 1 ]; then bad VH12 'no /etc/wildshard'
else unknown VH12 "/etc/wildshard modes: $NEEDS_ROOT"; fi
info VH12 'the gitleaks sweep of /home /etc /var/lib is VH16, by hand'

# --- VH13: encrypted backups.
dump="$R/etc/wildshard/lib/dump.sh"
if [ -r "$dump" ]; then
  if grep -Eq '(^|[|[:space:]])age[[:space:]]+(-r|-R|--recipient)' "$dump"; then ok VH13 'dump.sh encrypts to an age recipient'; else bad VH13 'dump.sh uploads without age encryption'; fi
elif [ -e "$dump" ]; then unknown VH13 "dump.sh: $NEEDS_ROOT"
else bad VH13 'no installed dump.sh'; fi
if has age; then ok VH13 'age is installed'; else bad VH13 'age is not installed'; fi

# --- VH14: alert on auth.
if [ -d "$R/var/log/journal" ] || grep -Eqs '^Storage=persistent' "$R"/etc/systemd/journald.conf "$R"/etc/systemd/journald.conf.d/*.conf; then ok VH14 'journald is persistent'
else bad VH14 'journald keeps no log across a reboot'; fi
if [ "$ROOT" = 1 ]; then
  if grep -Eqs '^ALERT_URL=.' "$R/etc/wildshard/ops.env"; then ok VH14 'ops.env names an ALERT_URL'; else bad VH14 'ops.env names no ALERT_URL'; fi
  if grep -rqs 'ALERT_URL\|wildshard-alert' "$R/etc/pam.d" "$R/etc/ssh/sshrc"; then ok VH14 'SSH logins and sudo alert'; else bad VH14 'SSH logins and sudo raise no alert'; fi
  if grep -rqs 'ALERT_URL\|wildshard-alert' "$R/etc/fail2ban"; then ok VH14 'fail2ban bans alert'; else bad VH14 'fail2ban bans raise no alert'; fi
else unknown VH14 "alert hooks: $NEEDS_ROOT"; fi

# --- VH15: kernel and sysctl. `=` is exact; `>=` keeps today's good values.
if [ -f "$R/etc/sysctl.d/90-wildshard.conf" ]; then ok VH15 '/etc/sysctl.d/90-wildshard.conf exists'; else bad VH15 'no /etc/sysctl.d/90-wildshard.conf'; fi
if has sysctl; then
  drift=
  while read -r key op value; do
    have=$(sysctl -n "$key" 2>/dev/null) || { drift="$drift $key=?"; continue; }
    if [ "$op" = '=' ] && [ "$have" != "$value" ]; then drift="$drift $key=$have"
    elif [ "$op" = '>=' ] && ! [ "$have" -ge "$value" ] 2>/dev/null; then drift="$drift $key=$have"; fi
  done <<'EOF'
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
kernel.kptr_restrict >= 1
kernel.unprivileged_bpf_disabled >= 1
kernel.yama.ptrace_scope >= 1
EOF
  if [ -z "$drift" ]; then ok VH15 'sysctl matches'; else bad VH15 "sysctl drift:$drift"; fi
else unknown VH15 'sysctl is missing'; fi

printf '%-7s %-5s %s\n' summary '' "$FAILS fail, $UNKNOWNS unknown"
if [ "$FAILS" != 0 ]; then exit 1; elif [ "$UNKNOWNS" != 0 ]; then exit 2; fi
exit 0
