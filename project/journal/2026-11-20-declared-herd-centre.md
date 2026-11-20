# Declared herds get their centre (opus-pine8, 2026-11-20)

- Pine's OF23c warden journey died at the den: the declared black bears wandered 30 m out onto
  the trail and charged the walker, where r8's roster bears stay within 10 m of home.
- Cause: a declared body keeps AnimalSim's `herd = 0`, and a layer hunt rolls no herds, so
  `HuntBrain.herdFor` read `herds[0]`, got nothing and never asked the `herdOf` port. Declared
  herds had no straggler pull, no herd alert and no centre easing.
- Fix: `herdFor` falls back to the port when the roster has no such herd.
  `test/hunt-declared-herd.test.ts` fails before it.
- Same lane: `test/ci/native-loadout.proof.mjs` (Pine r8 main red) aimed the King's head from a
  fixed post; it now stands before his chest and aims the chest lock point (`40655ea23`).

## OF23d option B: a native fight takes over its boss's encounter row

- The coordinator picked option B for the declared Antler King: Pine adds a `boss` encounter row on
  his declared spawn (so his public `king.*` decision fields have a retained actor under the
  existing format and engine rule), and the native `boss.ground` fight runs it.
- Engine: the ground boss claims its boss body (`claimDeclaredFight`), and the declared creature
  host stands no PhaseEncounter (nor its adds) for a `boss` row on a claimed body.
- `native-ground-boss-declared` now ships the row: `withoutRuntimeRows` admits the fields with no
  runtime boss, and no `encounter.<id>` adapter stands (fails without the takeover).

## J109 for declared herds

- 08c3bdc13 skipped the shipped-room refill test: Pine r8's herds are declared, and a room's
  fallen declared herd body never came back (J109: authors change nothing).
- The declared herd save now runs a `CreatureRefill`: in a room (two players or a served world)
  a fallen herd body is owed, and the same body returns at its herd's centre after the wait, never
  in front of a player. A body with its own `respawn` timer keeps it.
- What is owed rides the `creatures.herds` save as `{ centres, refill }`; a save with nothing owed
  (every solo save) keeps the plain centres array, so solo bytes and digests do not move. The
  refill's clock starts over when it drains, so such a save restores the same game.
- The Pine room test is back on, rewritten for the declared body (fails without the refill).
