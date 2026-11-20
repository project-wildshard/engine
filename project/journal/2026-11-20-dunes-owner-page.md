# OF19d: the page draws a spawned owner with no boss row

> Written by: Claude (opus-of19-dunes2), 2026-11-20

Dunes rev 5 (OF19c) keeps the Matriarch's owner row on its runtime plan but moves her body to a declared spawn, so the
plan has no boss row. The server took that (OF19c1), but the page's `pagePopulationRows` still threw "Spawned page
requires its native boss row" at `level.play`, so `wildshard prepare` sat on the loading screen until its 240 s recorder
timeout (publish rehearsal 44677378444, reproduced locally). A spawned owner with no boss row now draws the keeper's
homes alone and leaves the body to the declared encounter, as an ownerless plan already did (OF19c0b).
`test/page-rows-declared-owner.test.ts` failed first on the same error.
