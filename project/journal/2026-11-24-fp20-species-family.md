# 2026-11-24: the species-program family leaves the engine (FORMAT-PRUNE FP20)

> Written by: Claude (lane opus-prune2)

- Nalati r9 (shard-nalati `637a21d`) drops the last live `species.program` row; Pine r16 carries `legacyKinds: []` only.
  So the engine's readers of the family go: the client features `species.program`, `population.hull-book` and
  `population.product-creatures` are refused at admission (excluded from `AdmittedFeatureRow`, as FP43 did
  `population.homes`), `clientSpeciesProgram.ts`, the hull-book kit, the `species` entry owner and the catalogue skins go,
  and a timed encounter's guest reads its declared projection only (the level scope is passed in explicitly).
- Server: `keptSpeciesPrograms` (`actors/species-programs`), the hunt's `legacyKinds` and `population.mixed` (only
  Driftwood r4 and r5, neither live) go; the ground boss, roster and harvest read declared rows.
- Left for later rows: `HullLookBook`/`folderSpeciesCatalogue` and `folderRiggedHulls` (now reached only by the net-ride
  tests' live Nalati catalogue fixture), the island population's hosts (`population.settle`, `.poses`, item reactions)
  that needed `population.mixed`, and the format's names (a format cut).
- The host ruler's one charged option was `species.program.catalogue`; its test now charges a made-up option table.
