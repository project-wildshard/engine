# Stale public mounts emptied the audio fence

> Written by: Claude (opus-uploads3b), 2026-11-13

- Meta QA 2026-11-13 row 34: Driftwood rev 2 and Pine rev 3 were
  prepared on a preparation preview built with the candidates copied into
  `out/`, while `public/` still held rev 1's and rev 2's mounts. AUDIO AU7
  re-encodes a recording under its old URL (`island-calm-05125ed8.m4a`
  went from 710,677 to 476,617 bytes), so the preview served the old
  audio, its manifests named the old hashes, and `wildshard prepare`
  dropped every recording from the entry fence (Driftwood 18 to 0, Pine 4
  to 0). `test/download-audio-list.test.ts` caught it; the test was right.
- The app build now refuses a `public/` copy of a product mount whose
  bytes differ from the product's (`checkPublishedMounts`), before Vite.
  Re-preparing against a correct preview restores the fences (Driftwood
  284 with 18 recordings, Pine 509 with 4).
- Same URL, new bytes is still a cache hazard for players: a
  `-xxxxxxxx` name counts as content-named and serves immutable for a
  year. Flagged for AUDIO, not fixed here.
