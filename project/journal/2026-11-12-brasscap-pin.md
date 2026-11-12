# Brasscap rev 2 pin (opus-brasscap)

- Meta HOW-WE-BUILD ENG-3, TEMPLATE-E2E TE-PIN1 (engine half). Engine
  pins `blender-template` revision 2 (`c74e27f2…`, 5,105,664 bytes,
  v0.4.3, "Brasscap Mesa", uploaded by opus-slot in the J279 slot). It
  was still on revision 1, "Blender Template", which the API no longer
  serves as live. `pins.ts refresh` moved only this row; the other 27
  live heads already matched. The mirror release holds the tarball.
- `@wildshard/format` moves `0916c10` → `8fcfa77` (LF2-7 metal and
  palette, the eye and gullet glow). Only `corpus/brasscap-mesa` and
  Brasscap's tools changed between them; no format code, so Ring 1's
  digests (its `blender-template` comes from `corpus/handwritten`) stay
  as they are. Not shardfile `origin/main`: that now carries SS2 and SS7,
  SERVER-PARITY's format bump, which waits on SS5 and needs engine's
  `DecisionScript.side` change. The lockfile moves the format row only;
  the wire row stays as it was.
- The released v0.1.1 Blender Template save is refused whole on rev 2:
  same level id, different level fingerprint. Rev 2 is a different level
  (the canyon, not the hub), so its client state can't migrate either.
  `carryRefusedSave` keeps its fallback, the flags; wallet and ledger
  sit outside the snapshot. The fixture says `refused` plus
  `carry: "flags"`, and the test proves exactly that (J174). The save
  holds no flags at tick 30, so nothing is lost.
- The six old hub legs in `scripts/physics-route.json` walked into
  canyon walls. Replaced by three Brasscap legs from shardfile
  `canyon.ts` `ROUTES`: porch into camp 1, the ledge branch, the side
  canyon into camp 3. Each stops at its camp's edge (the tent stands on
  the route's end) and none crosses the gate, which is shut until the
  camps fall. Each passes twice in a row.
- Brasscap stays a Developer shard on Shard select, off the grid, as
  the API catalogue places it (`hidden`); the row asks for no grid move.

## Rev 3 (opus-eng3b, ENG-3b)

- Rev 2's pin was backed out (505f32ec): Ring 1's cook walks a real
  capsule 50 m in from every edge midpoint at road height, and rev 2's
  canyon floor stepped up 1 m 34 m in on all four edges. The format's
  own entry check covers only the first 15 m, so prepare and the API
  validator passed it. Shardfile 285a9a2 flattens the four entry
  corridors and moves one mesa; rev 3 (5400ea84, v0.4.4) carries it and
  opus-hero's card art. The pin files are a5d17381's, on rev 3, plus
  that pin's three review SHOULDs.
