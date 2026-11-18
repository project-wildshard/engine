# 2026-11-17: box workflows (meta MINI-AUTONOMY MA7a)

- opus-mamb: `box-probe.yml` (read-only: worst-worker tick p95, RSS and
  heap slope from the box's loopback Prometheus) and
  `staging-room-restart.yml` (staging only; production is refused
  before any key is read), both over `scripts/box-ops.mjs`. The mini
  dispatches them and holds no box key (J392). Secrets are in
  environment `box`, set from the MacBook's files.
- Hosted runners are off the tailnet, so both join it with a Tailscale
  OAuth client (`tag:ci`). That client is Jake's admin step; until
  `TS_OAUTH_CLIENT_ID` is set, both stop with an OPEN QUESTION error.
- Review fixes: pipefail on both run steps, the restart reads the state
  20 s after `restart` (Type=simple returns at fork), RSS is the 10 min
  max. Open: the agents' key can do more than probe and restart; a
  forced-command key on the box is the follow-up (MA7c).
