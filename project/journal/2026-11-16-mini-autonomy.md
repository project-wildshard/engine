# 2026-11-16 mini-autonomy (meta MINI-AUTONOMY)

- MA6: the mini's reader App key went in as `github-reader.client-id`; gh-limit looked only for
  `github-reader-client-id`, so land and main-watch read as Jake's gh user. Both names work now.
- MA6: `scripts/gh-read.mjs` runs `gh` on the reader App's read-only token, so a lane's own CI polls
  (the forward fixer's `gh run list`) stop spending Jake's user quota. Lint refuses `process.exit`, so it sets
  `process.exitCode`; its test uses a stand-in `gh` on PATH.
