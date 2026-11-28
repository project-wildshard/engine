# 2026-11-28: Pine's ground draws on the phone again

- Meta QA 11-28 row 82. On staging (v0.1.101, 9273ba690), a phone-size (402x874) entry into Pine through the grid showed
  a huge beige V around the camera with no ground. It showed in headless Chromium (Metal) and WebKit. Desktop size
  (1440x900) and Nalati were fine.
- The V was Pine's own far proxy (`far-proxy` under `grid-cell:pine-hollow`, the decimated shell of the zone seen from
  the road). Hiding that one mesh in the live page removed the wedge. Its 16-region mask was all zeros: Pine's ground is
  its own L1 / L0 ring tiles (D189), and on the phone none were resident (`l1: 0, l0: 0`; desktop `16, 16`). With no tiles
  there was nothing to mask the proxy and no ground, so the shell enclosed the camera.
- Why: the entered cell's tile views were admitted only through the neighbours' optional path (`render`/`approach`):
  speculative reads that use spare headroom and never evict. The phone envelope is 1.0 GB. The page was already past it
  at 1.18 GB playing, with Pine's 504 MB measured home, 262 MB engine base and 134 MB page. `allocator.wouldFit` was
  false even for 1 byte, so every try was deferred. The boot mark said `app:spawn-ground: none` after 2 ms; desktop's
  said `ready` after 916 ms. Calling the session's required admission (`complete(cell, true)`) by hand in the live phone
  page evicted enough room: 31 Pine tiles uploaded and the view showed path, grass and trees.
- Fix: the spawn hold falls back to a required admission when the optional one defers (`admitEnteredGround`). In play,
  the fixed step asks once per entry for the cell the player stands in, if its ground is its tiles
  (`EnteredGroundAdmission`). Required work may evict claims for the ground under the player, as an entry does.
- Guard: `spawnGround.test.ts` builds a full phone budget with the real `GridViewAdmissions` and `ResidencyAllocator`.
  The optional-only hold ends `none` with the proxy unmasked. With the fallback it ends `ready` with all 16 regions
  masked. A second test covers the in-play ask: once per entry, and asked again after leaving.
- Not settled: the admission code is the same in v0.1.100 and v0.1.101, so the trigger is the phone budget being full
  at entry. Which byte change in v0.1.101 filled it was not traced.
