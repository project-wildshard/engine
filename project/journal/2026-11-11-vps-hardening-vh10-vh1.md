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
