# Nine golden reader finds its chunk in b/c

- mini-goldens (SH-ALL-11): Nine Dragon's golden capture stopped before
  entry with "Native refinement chunk is missing or ambiguous". J217 LD6
  put non-entry chunks in the shared `b/c`, and `native-residency.mjs`
  only scanned `b/<build>`. It now scans that folder plus the `b/c`
  chunks this build's `importmap.json` names. Listing `b/c` would be
  wrong: a deploy's shared folder holds older builds' chunks too.

- Engine's published scripts (`chromium-memory-browser.mjs` and most proofs) import `playwright`, which engine
  listed only as a devDependency, so a shard repo running them from the pnpm store could not resolve it (mini-shardgfx
  needed a node `--import` resolve hook for Open Plots). Now an optional peer at 1.65.0, like `sharp`: a shard repo's
  own `playwright` devDependency satisfies it; nothing installs it for players.

- Open-plot boards score the plot alone. Views 3 and 4 (and Night Market 1) went low or RED on whole-frame SSIM because
  J305 moved the neighbours (Nine Dragon's towers now stand behind Night Market). Hiding the other cells to match was
  wrong: the void under a hidden cell shows sky, not the old grid floor. Instead the capture shoots two extra frames per
  view (other cells hidden, every cell hidden); `board.py` scores only where they differ, filling outside the mask with
  one flat value in both images so SSIM's window never sees a neighbour, and adds a SCORED column.
