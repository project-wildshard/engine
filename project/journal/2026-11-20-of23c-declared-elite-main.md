# OF23c: an elite program's main is a declared body (opus-pine4)

- Pine's elites are v1 fight programs over the native roster's lair
  bodies. To move them onto OF28 ranks, each can now stand as a
  `creatures.spawns` row in its program's spawn group
  (`pine.elite.<id>`): `population.elites` lends that declared body to
  the fight's `SpawnScript.native`.
- The lent body is the script's boot body; the roster's own lair body of
  the same kind and variant never is. Retiring it makes it absent (as a
  `when` row's body); spawning its kind and variant stands it again at
  the site, whole, on its own id and rank. The roster never spawns or
  retires it.
- A layer hunt stands aside for a scripted (adopted) body, so the
  species' hunt brain and the fight program never both drive it.
- test/native-elite-declared-main.test.ts failed first (the respawn took
  the roster's lair body); now Old Ironhide declared on rank elite is
  adopted, ranked (hp x4), fights, saves and restores exactly, falls, and
  stands again on the same id.
