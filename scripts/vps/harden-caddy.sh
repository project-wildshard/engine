#!/usr/bin/env bash
# VPS-HARDENING VH9 as J264 changed it: stock Caddy behind Cloudflare. Cloudflare's SSL mode is Full (strict) against a
# Cloudflare Origin CA certificate, and Caddy takes a connection only with Cloudflare's shared origin-pull client certificate
# (Authenticated Origin Pulls, zone-level). That proves the caller is Cloudflare's network, not that it is this zone: another
# Cloudflare customer could point a proxied name here. A per-zone client certificate closes that, later, if it matters.
#   rooms.wildshard.io          WebSocket upgrade on / to production 127.0.0.1:8790; /up is 200 while production's /health is
#   rooms-staging.wildshard.io  the same to staging 127.0.0.1:8791 (D2), /up included, so Sentry can watch staging from outside
# Everything else is 404, /health included (it stays tailnet-only); a page outside the game's own hosts gets 403.
# The client address is Cloudflare's CF-Connecting-IP, believed only from Cloudflare's ranges, and handed on as the one
# X-Forwarded-For hop, which the server's TRUST_PROXY=caddy reads (VH10); CF-Connecting-IP itself never reaches the server.
#   harden-caddy.sh --print <addresses>   print the Caddyfile for those bind addresses and stop (the engine's test reads it)
# Run by harden-apply.sh as root. The certificate and key come from the lane that minted them (J264, opus-dns), copied to
# /etc/caddy/origin/ by hand; until both are there, the file is written and Caddy stays off.
set -euo pipefail
say() { printf '%-7s %-5s %s\n' "$1" "$2" "$3"; }
ORIGIN=/etc/caddy/origin CERT=/etc/caddy/origin/rooms-origin.pem KEY=/etc/caddy/origin/rooms-origin.key
PULL_CA=/etc/caddy/origin/cloudflare-origin-pull-ca.pem
# https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem, read 2026-11-11 (valid to 2029-11-01).
PULL_CA_URL=https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem
PULL_CA_SHA256=c14fed0ce5210db0719fea11d1f10b33750dc17d609aeaf47c75e9eff0d7b843
CF_RANGES='173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32'
# The server unit's ALLOWED_ORIGINS (setup.sh), as one anchored pattern.
ORIGINS='^https://(play|staging|preview)\.wildshard\.io$|^https://wildshard-singleplayer\.vercel\.app$'
site() {
  local host=$1 port=$2
  cat <<EOF
https://$host {
	tls $CERT $KEY {
		protocols tls1.2 tls1.3
		client_auth {
			mode require_and_verify
			trust_pool file $PULL_CA
		}
	}
	log {
		output file /var/log/caddy/access.log {
			roll_size 50MiB
			roll_keep 5
		}
		format json
	}
	# D7: the outside check reads a bare 200 while this channel's /health answers 200; no body, nothing about the server.
	handle /up {
		rewrite * /health
		reverse_proxy 127.0.0.1:$port {
			@healthy status 2xx
			handle_response @healthy {
				respond 200
			}
			handle_response {
				respond 503
			}
		}
	}
	@socket {
		path /
		header Connection *Upgrade*
		header Upgrade websocket
	}
	@foreign not header_regexp Origin $ORIGINS
	handle @socket {
		respond @foreign 403
		reverse_proxy 127.0.0.1:$port {
			header_up X-Forwarded-For {client_ip}
			header_up -CF-Connecting-IP
			stream_close_delay 5m
		}
	}
	handle {
		respond 404
	}
	# A failed upstream is a bare status, never Caddy's error page; /up says only 503.
	handle_errors {
		@up path /up
		respond @up 503
		respond {err.status_code}
	}
}
EOF
}
render() {
  cat <<EOF
# VPS-HARDENING VH9 (J264), written by harden.sh. Behind Cloudflare: Origin CA certificate, origin-pull mTLS, 443 only.
{
	admin off
	auto_https off
	default_bind $1
	servers {
		protocols h1 h2
		trusted_proxies static $CF_RANGES
		client_ip_headers CF-Connecting-IP
		timeouts {
			read_header 10s
			idle 2m
		}
	}
}

$(site rooms.wildshard.io 8790)

$(site rooms-staging.wildshard.io 8791)
EOF
}
if [ "${1:-}" = --print ]; then
  if [ -z "${2:-}" ]; then say stop VH9 'usage: harden-caddy.sh --print <addresses>'; exit 1; fi
  render "$2"; exit 0
fi
if ! dpkg-query -W -f='${Status}' caddy 2>/dev/null | grep -q 'ok installed'; then say stop VH9 'Caddy is not installed (rebuild.sh Phase 1)'; exit 1; fi

install -d -m 750 -o root -g caddy "$ORIGIN"
if [ -f "$PULL_CA" ] && [ "$(sha256sum < "$PULL_CA" | cut -d' ' -f1)" = "$PULL_CA_SHA256" ]; then say ok VH9 "$PULL_CA"
else
  temporary=$(mktemp)
  curl -fsSL "$PULL_CA_URL" -o "$temporary"
  if [ "$(sha256sum < "$temporary" | cut -d' ' -f1)" != "$PULL_CA_SHA256" ]; then rm -f "$temporary"; say stop VH9 'Cloudflare origin-pull CA does not match its pinned hash'; exit 1; fi
  install -m 644 -o root -g caddy "$temporary" "$PULL_CA"; rm -f "$temporary"; say doing VH9 "write $PULL_CA"
fi
for file in "$CERT" "$KEY"; do if [ -f "$file" ]; then chown root:caddy "$file"; chmod 640 "$file"; fi; done
install -d -m 750 -o caddy -g caddy /var/log/caddy
# A log a root run of `caddy validate` opened would shut Caddy out of its own file.
find /var/log/caddy -maxdepth 1 -type f ! -user caddy -exec chown caddy:caddy {} +
# Bind the box's public addresses only: tailscaled holds 443 on the tailnet address while the Funnel lives (until MS8.3).
PUBLIC=$(ip -o addr show scope global | awk '$2 !~ /^tailscale/ {sub(/\/.*/, "", $4); print $4}' | tr '\n' ' ' | sed 's/ $//')
if [ -z "$PUBLIC" ]; then say stop VH9 'cannot read the public addresses'; exit 1; fi

caddyfile=$(render "$PUBLIC")
changed=0
if [ -r /etc/caddy/Caddyfile ] && [ "$(cat /etc/caddy/Caddyfile)" = "$caddyfile" ]; then say ok VH9 /etc/caddy/Caddyfile
else
  temporary=$(mktemp /etc/caddy/.harden.XXXXXX)
  printf '%s\n' "$caddyfile" > "$temporary"; chmod 644 "$temporary"; chown root:root "$temporary"
  # Validated as caddy, so any file it opens is caddy's.
  if [ -f "$CERT" ] && ! runuser -u caddy -- caddy validate --adapter caddyfile --config "$temporary" >/dev/null 2>&1; then
    runuser -u caddy -- caddy validate --adapter caddyfile --config "$temporary" 2>&1 | tail -3; rm -f "$temporary"; say stop VH9 'the Caddyfile does not validate; nothing written'; exit 1
  fi
  mv -f "$temporary" /etc/caddy/Caddyfile; changed=1; say doing VH9 'write /etc/caddy/Caddyfile'
fi

# nftables on 443, beside ufw. Behind Cloudflare every source is a Cloudflare edge, which carries many players, so these are
# floors against a flood through one edge, not per-player caps; those are the server's (SOCKETS_PER_IP, CONNECTS_PER_MINUTE,
# keyed by CF-Connecting-IP, VH10).
nft_rules='table inet wildshard
delete table inet wildshard
table inet wildshard {
	set edges443 { type ipv4_addr; size 65535; flags dynamic; }
	set edges443v6 { type ipv6_addr; size 65535; flags dynamic; }
	set rate443 { type ipv4_addr; size 65535; flags dynamic,timeout; timeout 2m; }
	set rate443v6 { type ipv6_addr; size 65535; flags dynamic,timeout; timeout 2m; }
	chain input {
		type filter hook input priority filter - 5; policy accept;
		tcp dport 443 ct state new add @edges443 { ip saddr ct count over 2000 } reject with tcp reset
		tcp dport 443 ct state new add @edges443v6 { ip6 saddr ct count over 2000 } reject with tcp reset
		tcp dport 443 ct state new update @rate443 { ip saddr limit rate over 600/minute burst 200 packets } drop
		tcp dport 443 ct state new update @rate443v6 { ip6 saddr limit rate over 600/minute burst 200 packets } drop
	}
}'
nft_file=/etc/wildshard/nft-443.nft
nft_changed=0
if [ -r "$nft_file" ] && [ "$(cat "$nft_file")" = "$nft_rules" ]; then say ok VH9 "$nft_file"
else
  # Checked by nft before it replaces the file, so a bad rule set never reaches the load below.
  temporary=$(umask 077; mktemp /etc/wildshard/.nft-443.XXXXXX)
  printf '%s\n' "$nft_rules" > "$temporary"
  if ! nft -c -f "$temporary"; then rm -f "$temporary"; say stop VH9 'the 443 floors do not parse; nothing written'; exit 1; fi
  chmod 640 "$temporary"; chown root:root "$temporary"; mv -f "$temporary" "$nft_file"; say doing VH9 "write $nft_file"; nft_changed=1
fi
unit='[Unit]
Description=Wildshard nftables floors on 443 (VPS-HARDENING VH9)
After=network-pre.target
Before=caddy.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/wildshard/nft-443.nft
ExecReload=/usr/sbin/nft -f /etc/wildshard/nft-443.nft
ExecStop=/usr/sbin/nft delete table inet wildshard

[Install]
WantedBy=multi-user.target'
if [ "$(cat /etc/systemd/system/wildshard-nft.service 2>/dev/null)" != "$unit" ]; then
  printf '%s\n' "$unit" > /etc/systemd/system/wildshard-nft.service; systemctl daemon-reload; say doing VH9 'write wildshard-nft.service'
fi
systemctl enable --quiet wildshard-nft.service
# The file swaps the table in one nft transaction (table, delete table, table { ... }), so a reload never leaves 443 without
# its floors. The live rules are compared too, by a stamp of their stateless listing taken at the last load: a rerun with
# the same file and the same live rules leaves the table, and its connection counts, alone.
# The stamp binds the rules file to the live chain it loaded, so a new file left half-applied is loaded again on the next run.
nft_live() { printf '%s %s\n' "$(sha256sum < "$nft_file" | cut -d' ' -f1)" "$(nft -s list chain inet wildshard input 2>/dev/null | sha256sum | cut -d' ' -f1)"; }
nft_stamp=/etc/wildshard/.nft-443.loaded
if ! systemctl is-active --quiet wildshard-nft.service; then
  systemctl start wildshard-nft.service; say doing VH9 'load the 443 floors'; (umask 077; nft_live > "$nft_stamp")
elif [ "$nft_changed" = 1 ] || ! nft list table inet wildshard >/dev/null 2>&1 || [ "$(cat "$nft_stamp" 2>/dev/null)" != "$(nft_live)" ]; then
  systemctl reload wildshard-nft.service; say doing VH9 'reload the 443 floors in one transaction'; (umask 077; nft_live > "$nft_stamp")
else say ok VH9 'the 443 floors are live as written'; fi

# Caddy starts only with its certificate. 443 is still shut by ufw until --open-443.
# A new certificate or key restarts Caddy too: their hash is kept beside them.
stamp=$ORIGIN/.loaded
if [ -f "$CERT" ] && [ -f "$KEY" ] && [ "$(cat "$stamp" 2>/dev/null)" != "$(cat "$CERT" "$KEY" "$PULL_CA" | sha256sum | cut -d' ' -f1)" ]; then changed=1; fi
if [ -f "$CERT" ] && [ -f "$KEY" ]; then
  systemctl enable --quiet caddy.service
  if [ "$changed" = 1 ] || ! systemctl is-active --quiet caddy.service; then
    # The whole configuration, certificate and key included, is validated before any restart, so a mismatched or half-copied
    # pair leaves a running Caddy as it is.
    if ! runuser -u caddy -- caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
      runuser -u caddy -- caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile 2>&1 | tail -3
      say stop VH9 'Caddy does not validate with this certificate and key; Caddy left as it is'; exit 1
    fi
    systemctl restart caddy.service; say doing VH9 'restart caddy'
    (umask 077; cat "$CERT" "$KEY" "$PULL_CA" | sha256sum | cut -d' ' -f1 > "$stamp")
  else say ok VH9 'caddy running'; fi
else
  say wait VH9 "copy the Origin CA certificate and key to $CERT and $KEY (root:caddy 640), then rerun harden.sh; Caddy stays off"
fi
