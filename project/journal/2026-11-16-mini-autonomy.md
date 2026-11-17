# 2026-11-16 mini-autonomy (meta MINI-AUTONOMY)

- MA6: the mini's reader App key went in as `github-reader.client-id`; gh-limit looked only for
  `github-reader-client-id`, so land and main-watch read as Jake's gh user. Both names work now.
- MA6: `scripts/gh-read.mjs` runs `gh` on the reader App's read-only token, so a lane's own CI polls
  (the forward fixer's `gh run list`) stop spending Jake's user quota. Lint refuses `process.exit`, so it sets
  `process.exitCode`; its test uses a stand-in `gh` on PATH.
- MA3: `scripts/live-status.mjs [<sha>] [--json]` prints what staging, production and preview serve (page build and
  version, release serial and server build, the staging box's own `/health` on the tailnet), the API build and npm's
  latest engine/sdk/shard-format, and answers yes/no per channel for a SHA (local git, else GitHub's compare API).
  First real run, 20:13 Cancún: staging's release is serial 96 on `12886742` while the box still runs serial 95
  `5e0fb5ef`, so it says "behind the release".
