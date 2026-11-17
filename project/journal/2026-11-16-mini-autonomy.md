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
- MA3 lint: the gate's typed lint refused shadowed names, async with no await and String() of unknown values; fixed.
- MA4: `.github/workflows/verify-staging.yml` (dispatch only, no secret) runs `scripts/verify-staging.sh <browser>`:
  journey-proof per card, Doctor and the live two-player proof against staging, Chromium on ubuntu-24.04 and WebKit
  on macos-15, one row per proof in the run summary plus live-status. Hosted runners are off the tailnet, so the two
  e7 proofs take `WS_PRIVATE_HEALTH=skip` (staging-proof-lines.mjs `privateHealthURL`) and say they skipped the box's
  private /health; Doctor takes `--engine=` to run one browser per runner.
- MA4 first run 43995224677 (v0.1.32 `12886742` went live on staging mid-run): journeys PASS on both browsers, live PASS on WebKit; Doctor failed on both because SB20 (`336f2cb1`) made the page's server row a skip ("health is private, Join checks the door") and the proof still wanted every row pass. The proof now takes that one skip on rooms-staging. Chromium's live proof hit a real page error on v32: "Frame scheduling is unavailable in this host" (meta mini QA).
