# Page census (EG-15, EG-16, EG-17, EG-20)

Meta TEST-COVERAGE row 32, lane mini-pages on the Mac mini.

- EG-15 `scripts/fight-page-census.mjs` keeps `worker-client-fights` and runs its journeys on full Nalati, Pine, Far Reach and
  Dunes. The page now counts every view word it hears at the wire (`__workerClient().heard`), and each view that takes a word
  counts it as drawn at its dispatch (`roaming.*`, a room arena's binding, the tie toast, creature signals, spawn cues, poses,
  the lane telegraph). A room the player never entered counts its words `offstage`, not dark. Each fight row says whether the
  page holds a visible body for it (`shown`); `__audioTally` keeps every sound trigger since boot (the 400-row log forgets).
- First census: only two words were counted as drawn on most heads. Every other view drew without saying so, which is why
  the census counts at the dispatch, not by hand in each view.
- BUG-28 planted (the page drops `open-arena.*`): `open-arena.look` heard 163, drawn 0; the Titan's bar with no body; the
  `--titanlook` step red. Restored, all green.
- EG-16 `scripts/no-astc-boot.mjs`: Pine on an iPhone profile with ASTC hidden loads images by the raw-ASTC veto and reads no
  raw ASTC; the control with ASTC reads 71. A harness texture pin is no plant (the veto overrules it); `rawAstcVeto` returning
  null is, and the page then dies on GL error 1280 after 16 raw ASTC reads.
- EG-20: `catalogue-all-heads` never ran on a schedule since at least 11-12: the step before it died at Vitest startup on a
  shallow clone (lift-pending ownership needs history), and the job's `continue-on-error` called that green. The catalogue
  census is its own blocking job now, and the report job checks out full history.

- Census commit: Qara and Qyran save steps reboot by URL (a reload lost `?chunk=` and sat on the title 150 s); qara is out of
  the census set (its captain comes only after a thinned patrol, and one run in three it never came).
- No-ASTC commit: the boot case and its control, typed for scripts/tsconfig.json.
