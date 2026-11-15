# Nine golden reader finds its chunk in b/c

- mini-goldens (SH-ALL-11): Nine Dragon's golden capture stopped before
  entry with "Native refinement chunk is missing or ambiguous". J217 LD6
  put non-entry chunks in the shared `b/c`, and `native-residency.mjs`
  only scanned `b/<build>`. It now scans that folder plus the `b/c`
  chunks this build's `importmap.json` names. Listing `b/c` would be
  wrong: a deploy's shared folder holds older builds' chunks too.
