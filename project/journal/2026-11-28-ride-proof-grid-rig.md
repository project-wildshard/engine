# 2026-11-28: online-ride-proof reaches the camp horses

- Meta QA 11-26 row 83 (found by opus-rig on row 80): both pages "seated" on Nalati at server x 0, z 0, cell 0, and the walk
  to the saddled horses ended 223 to 226 m short. Row 79's kind was the guess. It was three things, met one after another.
- First: a relative work folder. The world reads its packs at a file URL of `<work>/origin`; `tmp/qa26/work` made the URL's
  host `tmp`, and Node on darwin refuses a file URL with a host, so the world crashed at boot ("File URL host must be
  localhost or empty"). The pages, hearing no world, took the grid alone (J300) at x 0, z 0, cell 0. That is exactly the
  223 to 226 m reading. `openRig` resolves `work` and builds the URL with `pathToFileURL` (`packOrigin`).
- Second, with the world up: the first page played and the second never reached its Name box. The rig opened one cell
  (WORLD_CELLS=nalati-grasslands) and did not wait for the world. The first page dialled before the world listened, heard
  no word and took the grid (J300). The second heard a one-cell word (`hostsGrid`: cells > 1), took the one-shard flow, and
  that flow can't boot Nalati in this build (`boot: props declares .../meadow.phone.webp but public/assets has no such file`).
  `RIDE_RIG` opens the grid with Driftwood beside Nalati, as production hosts the grid, and is `isolated` (the world is up
  before a page opens, in its own fresh `<work>/rig`).
- Third: the rider's Name. The world reads `Matt#6730` (MP2.4's tagged Name) and the proof waited for `Matt` exactly.
  `typedName` strips the tag.
- The seat step now fails unless both pages' frames name a grid cell, the link is open and frames flow, so a page alone can
  no longer pass it.
- Proof: online-ride-proof on a local rig (engine f324b78c2 client, PGlite saves, Chromium 158 headless): PASS, both walked
  to within 0.8 and 1.7 m, Matt gets on, rides and gets off, Jake sees each. Guard: test/online-ride-rig.test.mjs.
- Not fixed here: a one-cell world's one-shard boot of Nalati (the unsized phone texture). Production hosts the grid.
