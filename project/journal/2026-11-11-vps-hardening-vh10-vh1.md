# VPS-HARDENING VH10 and VH1 (opus-vh10)

- VH10: the dedicated door read `CF-Connecting-IP`, else the first
  `X-Forwarded-For` hop, from any loopback peer. Tailscale Funnel's
  proxy (`ipn/ipnlocal/serve.go`, `httputil.ReverseProxy` with
  `Rewrite`) drops client `X-Forwarded-*` and sets one
  `X-Forwarded-For` from the ingress source, but passes
  `CF-Connecting-IP` through, so a Funnel client could choose its own
  per-address key. New `doorTrust.ts`: `TRUST_PROXY=caddy|cloudflare|none`,
  default `caddy` (last XFF hop, safe for Funnel and for VH9's Caddy);
  `ALLOWED_ORIGINS` gates a browser `Origin` with 403. `setup.sh` sets
  both in the server unit. Test fixtures now send `X-Forwarded-For`,
  as production does.
- VH1: `scripts/vps/harden.sh --check`, read-only, one tagged line per
  finding for VH1 to VH15 (sudoers.d, auth.log, `sshd -T`, ufw,
  fail2ban, `systemd-analyze security`, Caddyfile and nftables,
  the units' TRUST_PROXY, PostgreSQL roles, `/etc/wildshard` modes,
  age dumps, alert hooks, sysctl, hcloud when set up). Without
  `--check` it applies nothing yet, so `rebuild.sh`'s call is a skip.
  A secret search prints a count, never a name or value. An old root
  login in auth.log is a loud `info`, not a fail: it is history, and
  VH16 needs a clean report. Proof: `scripts/vps-harden-proof.sh`
  (systemd container dressed as the audited box, real sshd, ufw and
  fail2ban; nothing under /etc /home /root /usr /opt /var/lib changes;
  hand fixes turn VH2 and VH3 clean). The first proof run caught a
  container-only `sshd -T` failure (no /run/sshd), so the unknown line
  now carries sshd's own error.
- J206 review (Codex, read-only): six MUSTs in harden.sh, all fixed.
  `pro status` writes a log, so VH5 reads pro's status.json instead;
  sudoers.d lines print principals and counts, never command text;
  VH10 reads the effective mode (env file over unit) and fails
  `cloudflare` without a tunnel, `none`, `*` or a foreign origin;
  VH11 asks PostgreSQL whether either channel's role can open the
  other's saves; VH4 finds this server by its IPv4 and checks its own
  firewall's inbound rules; VH9 ignores commented Caddy lines and
  wants both per-source nftables caps.
