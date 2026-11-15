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
