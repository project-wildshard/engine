# 2026-11-17 opus-mfm3: the second-build rig (meta MMO-FAILURE-MODES-PLAN)

- `online-rig.mjs` gains `pageView`, `retain` and `move`: two builds from one signed release flow, so a proof can retire build A
  (FM5b4), deploy under a title tap (FM4 10b) or under play (mode 10). The page view lives at `/__release.json`, the plan's
  second signed view; the world only reads `/release.json`. `signRetention` is shared with the page publisher's signer.
- The preview server's SPA fallback answered a missing `/code-retention.json` with the page (200); production's asset host
  answers 404, which the page reads as a legacy page. Now the preview server does too.
- `reloadPastWorker` (too-old's Update, the new-build panel, Play here) never raised the RELOADING cover, so a player's tap left
  the old page standing for up to the worker drop's 3 s. It now puts the cover up first (R3/RL3), as the stale-build reload does.
