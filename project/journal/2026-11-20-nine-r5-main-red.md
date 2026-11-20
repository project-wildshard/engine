# Nine r5 main red, fixed forward

- Engine main run 44698834129 went red on Nine Dragon rev 5's pin (eba94d538): six checks assumed Nine still had a
  client-plan runtime. Rev 5 is an ordinary upload (runtime null, no sim/runtime-plan), but its manifest still names the
  client-plan entry. Fixed forward, no test loosened (J422):
  - The page admits a client-plan manifest over a runtime-null product as data (`installManifestShardfile`); the stale
    entry threw "Client-plan entry requires its compiled runtime declaration" (nine-ring1). Nine's next revision should
    drop `bindings.entry`.
  - net-fuzz opens a declared product's room as `StandaloneGrid` does (`openCellWorld`), not as a native resident.
  - The folder session runs a declared product on the data host; walk proofs there now catch a fall as the lone page and
    room do (`FallFloor`, SS6), as the native adapter lends the page's bounds. Nine's 19 legs pass, net-well-fall too.
  - held-slot-entered keeps r3's runtime and starter Jian and Fei Zhua rows, frozen from that pin (r5's Jian is kit.melee).
  - The v0.1.1 Nine save is refused whole on r5 (its level changed), like Brasscap's and Dunes'.
- side-parity: the page half is re-recorded from main run 44705796865's measured r5 client (nine-ring1 booted it green). The
  r5 page holds every room solid plus copies: its client/plan world.assembly still builds the solids the prop rows now carry
  (owner@scene names and exact repeats). No room solid is missing from the page, so the lines are `known` under OF21; Nine
  rev 6 drops the assembly collision and the stale entry, and the lines go. (opus-of21-drift3)
- Driftwood's staging prepare timed out on v0.1.55 too: the page refused it at level.world ("Runtime-bound state supports
  host fields and retained-actor numeric fields"). The Drowned Captain is now a declared spawn a boss encounter names
  (OF22c2), with no runtime boss; format 0.55.2 admits his public decision fields, the page's `withoutRuntimeRows` did
  not. It reads format's rule now. Found by logging the prepare page's /api/errors post. (opus-of21-drift3)
