# OF19d: the page draws a spawned owner with no boss row

> Written by: Claude (opus-of19-dunes2), 2026-11-20

Dunes rev 5 (OF19c) keeps the Matriarch's owner row on its runtime plan but moves her body to a declared spawn, so the
plan has no boss row. The server took that (OF19c1), but the page's `pagePopulationRows` still threw "Spawned page
requires its native boss row" at `level.play`, so `wildshard prepare` sat on the loading screen until its 240 s recorder
timeout (publish rehearsal 44677378444, reproduced locally). A spawned owner with no boss row now draws the keeper's
homes alone and leaves the body to the declared encounter, as an ownerless plan already did (OF19c0b).
`test/page-rows-declared-owner.test.ts` failed first on the same error.

**Second wall, same boot.** With the boss row fixed, a preparation client built from `a5de2fff5` stopped at the next
`level.play` throw: "Quest summon requires its actual encounter". The quest page sent a declared encounter's summon to
the wire only when the plan's owner row did not name it; Dunes rev 5's owner row names the Matriarch and the page binds
no fight for her. `questSummonOwner` now says who answers a summon: the page's fight for a keeper boss it binds, else the
server's declared encounter. With both fixes `wildshard prepare` passes on rev 5 locally (51 programs).

**A death in her fight went to the shard spawn (opus-of19-dunes3).** On a local two-player rev 5 walk the page fought
the Matriarch inside her arena, but every fall put the player at the shard's spawn, 150 m from the basin, not the south
rim the encounter declares. A declared encounter (`PhaseEncounter`) placed the fallen on `actor.died` but never answered
`death.checkpoint`, so the room's J107 respawn moved them first. It now answers it while engaged in a room, as a boss
row does; `test/encounter-room-respawn.test.ts` failed first (the bot stood at the spawn, 5.7 m off).

## Main red after the r5 pin (opus-of19-dunes3)

The r5 pin (`04855fb7de`) turned main red in nine tests across nine files. Rev 5's Matriarch is a declared boss spawn that waits out of the world, unreplicated and down, until the signal fire summons her, and the keeper stands no boss. The fixes:

- net-room counts the standing creatures, and standalone-server expects 14 probe rows.
- The census expects her down at birth.
- The released v0.1.1 save is refused on r5's level.
- runtime-declared-encounters binds to r5's own encounter id, and its refusal case freezes r4's keeper boss row.
- The keeper-era tests (runtime-declared-creatures, matriarch-borrowed-body) run on the frozen r3 keeper with r4's Matriarch decision row and module (`test/fixtures/frozen/dunes-r4-matriarch-decision.*`).

The crank guard's tap from the 88.1 stand met a well skitterer in the lash's lane on r5's tick, so the page cracks again, up to four times.
