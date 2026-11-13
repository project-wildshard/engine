#!/usr/bin/env bash
# VPS-HARDENING VH1: read everything the 2026-11-09 audit couldn't without sudo, and say, row by row, how far this box is from
# VH2 to VH15. It changes nothing: it only reads files, `sshd -T`, `ufw status`, `fail2ban-client status`, `systemd-analyze security`,
# `sysctl`, `pro status`, PostgreSQL's catalogue, auth.log and, when `hcloud` is set up, the Hetzner Cloud Firewall.
#   sudo bash harden.sh --check   the full report; without root, what root alone can read says `unknown`
#   sudo bash harden.sh           apply VH3 to VH15 (harden-apply.sh beside it; --open-443 and --close-443 are its too)
# Exit 0 is a clean box, 1 is any `fail`, 2 is no `fail` but something unreadable. It never prints a secret: a secret search
# reports file names only, and env files are tested for a name, never read out.
# HARD STOP (Jake, 2026-11-09): nothing here touches the old VPS beyond reading it, and Jake runs it there, not an agent.
# HARDEN_ROOTFS prefixes every file it reads, so the engine's test can hand it a made-up box; commands come from PATH.
set -uo pipefail
if [ "${1:-}" != --check ]; then here=${BASH_SOURCE[0]%/*}; [ "$here" != "${BASH_SOURCE[0]}" ] || here=.; exec bash "$here/harden-apply.sh" "$@"; fi
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
      # Who and how, never the command text: a rule can carry a credential in its arguments.
      rules=$(grep -Ev '^[[:space:]]*(#|$|Defaults)' "$file" 2>/dev/null)
      count=$(printf '%s' "$rules" | grep -c . || true)
      who=$(printf '%s\n' "$rules" | awk 'NF {print $1}' | sort -u | tr '\n' ' ' | sed 's/ $//')
      nopasswd=$(printf '%s\n' "$rules" | grep -c NOPASSWD || true)
      if [ "$nopasswd" = 0 ]; then nopasswd=; else nopasswd=", $nopasswd NOPASSWD"; fi
      info VH1 "sudoers.d/$(basename "$file"): $count rules${who:+ for $who}$nopasswd"
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
  # J266: the agents' own account is the one other login.
  if [ "$shells" = 'raynos wildshard-agent' ]; then ok VH2 'raynos and wildshard-agent are the only login users'; else bad VH2 "login users: '${shells}'; want raynos and wildshard-agent"; fi
else unknown VH2 'getent is missing'; fi
if has snap && snap list ollama >/dev/null 2>&1; then bad VH2 'the third-party ollama snap is installed'; else ok VH2 'no ollama snap'; fi
if [ "$LISTENERS_OK" = 1 ]; then
  if listens_on 11434; then bad VH2 'something listens on 11434 (Ollama)'; else ok VH2 'nothing on 11434'; fi
else unknown VH2 'listeners: ss is missing'; fi
if [ "$ROOT" = 1 ]; then
  # A real token's shape, not the bare prefix: this script holds the pattern, so its copies (and the test's plants) matched
  # themselves (MS3.4, 2026-11-12: all four hits were harden.sh). Names are printed so Jake can delete them; contents never.
  files=$(grep -rlsIE --exclude=harden.sh --exclude=vps-harden-proof.sh --exclude=vps-harden.test.ts 'sk_claw_[A-Za-z0-9_-]{16,}' "$R/home" "$R/etc" 2>/dev/null | sed "s|^$R||" | sort)
  found=$(printf '%s' "$files" | grep -c . || true)
  if [ "$found" = 0 ]; then ok VH2 'no OpenClaw token under /home or /etc'
  else bad VH2 "$found files under /home or /etc hold an OpenClaw token (sk_claw_): $(printf '%s\n' "$files" | awk 'NF {printf "%s%s", (n++ ? ", " : ""), $0}'); delete them"; fi
else unknown VH2 "OpenClaw token search: $NEEDS_ROOT"; fi

# --- VH3: SSH.
if [ "$ROOT" = 1 ] && has sshd; then
  if config=$(sshd -T 2>&1); then
    want() { if printf '%s\n' "$config" | grep -qix "$1 $2"; then ok VH3 "sshd $1 $2"; else bad VH3 "sshd $1 is '$(printf '%s\n' "$config" | awk -v k="$1" 'tolower($1)==k {$1=""; sub(/^ /,""); print}')'; want $2"; fi; }
    want passwordauthentication no; want permitrootlogin no; want kbdinteractiveauthentication no; want x11forwarding no
    want maxauthtries 3; want allowtcpforwarding no; want allowagentforwarding no; want loglevel VERBOSE; want maxsessions 2
    # sshd -T writes one `allowusers` line per name; the set must be exactly raynos and the agents' account (J266).
    allowed=$(printf '%s\n' "$config" | awk 'tolower($1)=="allowusers" {print $2}' | sort | tr '\n' ' ' | sed 's/ $//')
    if [ "$allowed" = 'raynos wildshard-agent' ]; then ok VH3 'sshd allowusers raynos wildshard-agent'; else bad VH3 "sshd allowusers is '${allowed}'; want raynos wildshard-agent"; fi
  else unknown VH3 "sshd -T failed: $(printf '%s\n' "$config" | head -1)"; fi
elif [ "$ROOT" = 1 ]; then info VH3 'no sshd installed'
else unknown VH3 "sshd -T: $NEEDS_ROOT"; fi
if [ "$LISTENERS_OK" = 1 ] && wildcard_on 22; then info VH3 'sshd listens on every address; ufw and the Hetzner firewall decide who reaches it'; fi

# --- J266 (MS3.5): the agents' account. Key only, root's key file, the root-owned scripts its allowlist runs.
if id wildshard-agent >/dev/null 2>&1; then
  keys="$R/etc/ssh/authorized_keys/wildshard-agent"
  if [ "$(stat -c '%U %a' "$keys" 2>/dev/null)" = 'root 644' ]; then ok J266 'wildshard-agent key is root'"'"'s copy'; else bad J266 'no root-owned /etc/ssh/authorized_keys/wildshard-agent'; fi
  if [ "$ROOT" = 1 ] && has sshd; then
    agent_keys=$(sshd -T -C user=wildshard-agent,host=wildshard,addr=100.64.0.1 2>/dev/null | awk 'tolower($1)=="authorizedkeysfile" {$1=""; sub(/^ /,""); print}')
    if [ "$agent_keys" = /etc/ssh/authorized_keys/wildshard-agent ]; then ok J266 'sshd reads the agent'"'"'s key from root'"'"'s file alone'
    else bad J266 "sshd reads the agent's keys from '${agent_keys}': it could add its own"; fi
  fi
  if [ -d "$R/opt/wildshard-vps" ] && [ -z "$(find "$R/opt/wildshard-vps" \( ! -user root -o -perm /go=w \) 2>/dev/null | head -1)" ]; then ok J266 '/opt/wildshard-vps is root'"'"'s and nobody else writes it'
  else bad J266 '/opt/wildshard-vps is missing, or someone besides root can write it'; fi
  if [ "$ROOT" = 1 ]; then
    if [ -f "$R/etc/sudoers.d/21-wildshard-agent" ]; then ok J266 'sudoers.d/21-wildshard-agent'; else bad J266 'no sudoers.d/21-wildshard-agent'; fi
  fi
else bad J266 'no wildshard-agent account'; fi

# --- VH16's lynis floor: audit, accounting, the banner, the umask, the protocols never loaded.
if has systemctl; then
  for service in auditd acct sysstat; do
    if systemctl is-active --quiet "$service" 2>/dev/null; then ok VH16 "$service runs"; else bad VH16 "$service is not running"; fi
  done
fi
if grep -qi 'authorized' "$R/etc/issue" 2>/dev/null && grep -qi 'authorized' "$R/etc/issue.net" 2>/dev/null; then ok VH16 'legal banner'; else bad VH16 'no legal banner in /etc/issue and /etc/issue.net'; fi
if grep -Eq '^UMASK[[:space:]]+027$' "$R/etc/login.defs" 2>/dev/null; then ok VH16 'login.defs UMASK 027'; else bad VH16 'login.defs UMASK is not 027'; fi
if [ "$(grep -Ec '^install (dccp|sctp|rds|tipc|usb-storage) /bin/false$' "$R/etc/modprobe.d/90-wildshard.conf" 2>/dev/null)" = 5 ]; then ok VH16 'dccp, sctp, rds, tipc and usb-storage never load'
else bad VH16 'dccp, sctp, rds, tipc or usb-storage can load'; fi

# --- VH4: firewall, two layers.
CF_RANGES_RE='173\.245\.48\.0/20|103\.21\.244\.0/22|103\.22\.200\.0/22|103\.31\.4\.0/22|141\.101\.64\.0/18|108\.162\.192\.0/18|190\.93\.240\.0/20|188\.114\.96\.0/20|197\.234\.240\.0/22|198\.41\.128\.0/17|162\.158\.0\.0/15|104\.16\.0\.0/13|104\.24\.0\.0/14|172\.64\.0\.0/13|131\.0\.72\.0/22|2400:cb00::/32|2606:4700::/32|2803:f800::/32|2405:b500::/32|2405:8100::/32|2a06:98c0::/29|2c0f:f248::/32'
if [ "$ROOT" = 1 ] && has ufw; then
  status=$(ufw status verbose 2>/dev/null)
  if printf '%s\n' "$status" | grep -q '^Status: active'; then ok VH4 'ufw is active'; else bad VH4 'ufw is not active'; fi
  if printf '%s\n' "$status" | grep -q 'deny (incoming)'; then ok VH4 'ufw denies incoming by default'; else bad VH4 'ufw does not deny incoming by default'; fi
  # A rule line has an action column; keep the ones that are neither 443 nor the tailnet interface.
  # Beyond the tailnet and Tailscale's 41641/udp, only 443 from Cloudflare's ranges (J264).
  extra=$(printf '%s\n' "$status" | grep -E ' (ALLOW|DENY|REJECT|LIMIT)( IN| OUT)? ' | grep -Ev '^41641/udp( \(v6\))? |on tailscale0' \
    | grep -Ev "^443/tcp +ALLOW IN +($CF_RANGES_RE)( |$)" | sed 's/  */ /g; s/ $//' | tr '\n' ';' | sed 's/;$//')
  if [ -z "$extra" ]; then ok VH4 'ufw allows only tailscale0, 41641/udp and 443 from Cloudflare'; else bad VH4 "ufw rules beyond tailscale0, 41641/udp and Cloudflare's 443: $extra"; fi
  opened=$(printf '%s\n' "$status" | grep -cE '^443/tcp +ALLOW IN' || true)
  if [ "$opened" = 0 ]; then info VH4 '443 is shut in ufw'; else info VH4 "443 is open in ufw to $opened Cloudflare ranges"; fi
elif [ "$ROOT" = 1 ]; then bad VH4 'ufw is not installed'
else unknown VH4 "ufw rules: $NEEDS_ROOT"; fi
# This server is the one whose public IPv4 is one of ours; its attached firewalls' inbound rules must be TCP 443 and UDP 41641 alone.
if has hcloud && has python3; then
  if servers=$(hcloud server list -o json 2>/dev/null) && firewalls=$(hcloud firewall list -o json 2>/dev/null); then
    verdict=$(HARDEN_IPS="$(hostname -I 2>/dev/null)" HARDEN_SERVERS="$servers" HARDEN_FIREWALLS="$firewalls" python3 -I -c '
import json, os
ips = set(os.environ["HARDEN_IPS"].split())
servers = [s for s in json.loads(os.environ["HARDEN_SERVERS"] or "[]") if ((s.get("public_net") or {}).get("ipv4") or {}).get("ip") in ips]
if len(servers) != 1: print("unknown cannot tell which Hetzner server this is"); raise SystemExit
me = servers[0]["id"]
mine = [f for f in json.loads(os.environ["HARDEN_FIREWALLS"] or "[]") if any((a.get("server") or {}).get("id") == me for a in f.get("applied_to") or [])]
if not mine: print("fail no Hetzner Cloud Firewall is applied to this server"); raise SystemExit
rules = sorted({(r.get("protocol"), str(r.get("port"))) for f in mine for r in f.get("rules") or [] if r.get("direction") == "in"})
want = [("tcp", "443"), ("udp", "41641")]
names = ",".join(f["name"] for f in mine)
print(("ok Hetzner Cloud Firewall " + names + " lets in TCP 443 and UDP 41641 only") if rules == want else ("fail Hetzner Cloud Firewall " + names + " lets in " + " ".join(p + "/" + q for p, q in rules) + "; want tcp/443 udp/41641"))
' 2>/dev/null)
    verdict=${verdict:-unknown the hcloud answer could not be read}
    case $verdict in ok\ *) ok VH4 "${verdict#ok }" ;; fail\ *) bad VH4 "${verdict#fail }" ;; *) unknown VH4 "${verdict#unknown }" ;; esac
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
# `pro status` writes its own log, so read the status file its timer keeps instead.
pro_status="$R/var/lib/ubuntu-advantage/status.json"
if [ -r "$pro_status" ] && has python3; then
  for service in esm-apps livepatch; do
    state=$(python3 -I -c 'import json, sys; print(next((s.get("status", "?") for s in json.load(open(sys.argv[1])).get("services", []) if s.get("name") == sys.argv[2]), "absent"))' "$pro_status" "$service" 2>/dev/null)
    if [ "$state" = enabled ]; then ok VH5 "pro $service enabled"; else info VH5 "pro $service is ${state:-unreadable} (D6: Ubuntu Pro skipped)"; fi
  done
elif [ -e "$pro_status" ]; then unknown VH5 "pro status file: $NEEDS_ROOT"
else info VH5 'Ubuntu Pro is not attached (D6: skipped; the daily reboot takes new kernels)'; fi

# --- VH6: fail2ban.
if [ "$ROOT" = 1 ] && has fail2ban-client; then
  jails=$(fail2ban-client status 2>/dev/null | sed -n 's/.*Jail list:[[:space:]]*//p')
  if printf '%s\n' "$jails" | tr ', ' '\n\n' | grep -qx sshd; then ok VH6 'fail2ban jail sshd'; else bad VH6 "no fail2ban sshd jail (jails: ${jails:-none})"; fi
  # J264: behind Cloudflare a ban by source address would ban an edge; the per-player limits are the server's (VH10).
  info VH6 'no caddy jail: behind Cloudflare the server limits each player by CF-Connecting-IP'
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
  # ss writes a device suffix (`%tailscale0`) inside or after the brackets; it is dropped before the address is judged.
  exposed=$(printf '%s\n' "$LISTENERS" | grep -E ':(8790|8791|8792)$' | sed -E 's/%[^]:]+//' | grep -Ev "^(127\.0\.0\.1|\[::1\]${tails:+|\[?($tails)\]?}):" | tr '\n' ' ' | sed 's/ $//')
  if [ -z "$exposed" ]; then ok VH8 'game and cook ports listen on loopback or the tailnet only'; else bad VH8 "game or cook port on a public address: $exposed"; fi
fi

# --- VH9: the proxy.
if has caddy; then
  caddyfile=$(sed 's/#.*//' "$R/etc/caddy/Caddyfile" 2>/dev/null)
  for want in 'admin off' 'protocols h1 h2' '-CF-Connecting-IP' 'stream_close_delay' 'client_auth' 'require_and_verify' 'trusted_proxies static' 'client_ip_headers CF-Connecting-IP'; do
    if printf '%s\n' "$caddyfile" | grep -qF -- "$want"; then ok VH9 "Caddyfile has '$want'"; else bad VH9 "Caddyfile lacks '$want'"; fi
  done
else bad VH9 'Caddy is not installed'; fi
if [ "$ROOT" = 1 ] && has nft; then
  rules443=$(nft list ruleset 2>/dev/null | grep -E 'dport 443')
  # J264: every source is a Cloudflare edge carrying many players, so these are flood floors per edge, not per player.
  if printf '%s\n' "$rules443" | grep -Eq 'saddr ct count over 2000( |$)'; then ok VH9 'nftables floors 443 at 2000 concurrent per Cloudflare edge'
  else bad VH9 'no nftables floor of 2000 concurrent connections per source on 443'; fi
  if printf '%s\n' "$rules443" | grep -Eq 'saddr limit rate over 600/minute'; then ok VH9 'nftables floors 443 at 600 new connections a minute per Cloudflare edge'
  else bad VH9 'no nftables floor of 600 new connections a minute per source on 443'; fi
elif [ "$ROOT" = 1 ]; then bad VH9 'nft is not installed'
else unknown VH9 "nftables ruleset: $NEEDS_ROOT"; fi

# --- VH10: server-side trust. The unit names its proxy (setup.sh) and an env-file line overrides it; the code that reads it ships in
# the signed release. Behind Funnel or Caddy only `caddy` is right: `cloudflare` would believe a client's CF-Connecting-IP, and `none`
# puts every player behind the proxy on one address.
if has systemctl && systemctl cat wildshard-server@.service >/dev/null 2>&1; then
  for channel in production staging; do
    environment=$(systemctl show -p Environment "wildshard-server@$channel.service" 2>/dev/null)
    mode=$(printf '%s\n' "$environment" | grep -o 'TRUST_PROXY=[^ "]*' | tail -1 | cut -d= -f2)
    origins=$(printf '%s\n' "$environment" | grep -o 'ALLOWED_ORIGINS=[^"]*' | tail -1 | cut -d= -f2-)
    if [ "$ROOT" = 1 ] && [ -r "$R/etc/wildshard/$channel.env" ]; then
      # Only these two names are read from the env file; nothing else in it is printed or kept.
      file_mode=$(grep -E '^TRUST_PROXY=' "$R/etc/wildshard/$channel.env" | tail -1 | cut -d= -f2- | tr -d "\"' ")
      file_origins=$(grep -E '^ALLOWED_ORIGINS=' "$R/etc/wildshard/$channel.env" | tail -1 | cut -d= -f2- | tr -d "\"'")
      mode=${file_mode:-$mode}; origins=${file_origins:-$origins}
    elif [ "$ROOT" != 1 ]; then unknown VH10 "$channel env-file overrides: $NEEDS_ROOT"; fi
    # J266: the settings file is read after the .env, so its ALLOWED_ORIGINS (wildshard-config's) wins over both.
    if [ "$ROOT" = 1 ] && [ -r "$R/etc/wildshard/$channel.settings" ]; then
      settings_origins=$(grep -E '^ALLOWED_ORIGINS=' "$R/etc/wildshard/$channel.settings" | tail -1 | cut -d= -f2- | tr -d "\"'")
      origins=${settings_origins:-$origins}
    fi
    cloudflared=0; if systemctl cat cloudflared.service >/dev/null 2>&1; then cloudflared=1; fi
    if [ -z "$mode" ]; then bad VH10 "$channel sets no TRUST_PROXY: rerun setup.sh after the VH10 release"
    elif [ "$mode" = caddy ] || { [ "$mode" = cloudflare ] && [ "$cloudflared" = 1 ]; }; then ok VH10 "$channel TRUST_PROXY=$mode"
    else bad VH10 "$channel TRUST_PROXY=$mode; want caddy behind Funnel or Caddy (cloudflare only with a tunnel)"; fi
    if [ -z "$origins" ]; then bad VH10 "$channel sets no ALLOWED_ORIGINS"
    elif printf '%s\n' "$origins" | grep -q '\*'; then bad VH10 "$channel ALLOWED_ORIGINS lets any page in"
    elif printf '%s\n' "$origins" | tr ', ' '\n\n' | grep -v '^$' | grep -Evq '^https://(play|staging|preview)\.wildshard\.io$'; then
      bad VH10 "$channel ALLOWED_ORIGINS has a page outside the game's hosts: $origins"
    else ok VH10 "$channel ALLOWED_ORIGINS is the game's own hosts"; fi
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
    want_roles='wildshard_production wildshard_restore wildshard_staging'
    if [ "$roles" = "$want_roles" ]; then ok VH11 'one role per channel, and the restore check'"'"'s own'
    else bad VH11 "game roles are '${roles}'; want wildshard_production, wildshard_staging and wildshard_restore"; fi
    # Each channel's role reaches its own saves and not the other's, and the restore check's role reaches neither: not by
    # CONNECT, not by owning it, not by membership.
    cross=$(runuser -u postgres -- psql -XtAc "select r.rolname || '->' || d.datname from pg_roles r cross join pg_database d
      where r.rolname in ('wildshard_production','wildshard_staging','wildshard_restore') and d.datname in ('saves_production','saves_staging')
      and d.datname <> ('saves_' || substr(r.rolname, 11))
      and (has_database_privilege(r.oid, d.oid, 'CONNECT') or pg_has_role(r.oid, d.datdba, 'USAGE')) order by 1" 2>/dev/null | tr '\n' ' ' | sed 's/ $//')
    if [ "$roles" = "$want_roles" ] && [ -z "$cross" ]; then ok VH11 'neither channel can open the other channel'"'"'s saves, nor the restore check either'
    elif [ -n "$cross" ]; then bad VH11 "a channel can open the other's saves: $cross"; fi
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
if [ "$ROOT" = 1 ]; then
  if grep -Eqs '^AGE_RECIPIENT=age1[a-z0-9]{58}$' "$R/etc/wildshard/ops.env"; then ok VH13 'ops.env names an age recipient'; else bad VH13 'ops.env names no AGE_RECIPIENT: dumps go up unencrypted'; fi
fi

# --- VH14: alert on auth.
if [ -d "$R/var/log/journal" ] || grep -Eqs '^Storage=persistent' "$R"/etc/systemd/journald.conf "$R"/etc/systemd/journald.conf.d/*.conf; then ok VH14 'journald is persistent'
else bad VH14 'journald keeps no log across a reboot'; fi
if [ "$ROOT" = 1 ]; then
  # J252: auth events go to Sentry for the agents, not to ALERT_URL.
  if grep -Eqs '^SENTRY_CRON_DSN=https://.' "$R/etc/wildshard/ops.env"; then ok VH14 'ops.env names the Sentry DSN auth events go to (J252)'; else bad VH14 'ops.env names no SENTRY_CRON_DSN (J252)'; fi
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
  if has systemctl && systemctl list-unit-files apport.service >/dev/null 2>&1 && [ "$(systemctl is-enabled apport.service 2>/dev/null)" != masked ]; then
    bad VH15 'apport is not masked: it resets fs.suid_dumpable=2 at boot'
  fi
else unknown VH15 'sysctl is missing'; fi

printf '%-7s %-5s %s\n' summary '' "$FAILS fail, $UNKNOWNS unknown"
if [ "$FAILS" != 0 ]; then exit 1; elif [ "$UNKNOWNS" != 0 ]; then exit 2; fi
exit 0
