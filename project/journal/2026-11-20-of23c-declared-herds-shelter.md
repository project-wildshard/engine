# OF23c: declared herds shelter, keep together and save

> Written by: Claude (opus-pine5), 2026-11-20

Pine's herds became declared spawns (shard-pine-hollow `39d7083`), and its
population journey went red: rain picked no shelter, because the shelter
host read only the roster's herds and Pine's roster now stands none.

What changed:

- `shardfile/declaredHerds.ts`: declared hunt bodies that share a spawn
  `group` are one herd, its centre where they stand. A group a script
  borrows (an elite program's main, the night's thralls) is never a herd.
- The shelter shelters the roster's herds, then the declared ones, and
  hands each declared herd its goal.
- A layer hunt's wander walks to that goal with no navmesh, and keeps to
  its herd's centre as a roster herd does (`HuntPorts.herdOf`). Without it
  Pine's herds drifted apart over a session.
- A declared herd's centre is saved (`creatures.herds`, a joined adapter,
  so an older save still restores).
- A spawn script's lent bodies stay absent on restore: the population
  journey's suffix showed restored night thralls ticking.

Tests that failed first: `native-shelter-declared-herds` (52 shelters, not
53) and the night case of `native-elite-declared-main` (the restored
digest differed). Driftwood's `driftwood.herd.*` groups also keep to their
centres now, so its checkpoint baselines move when it next pins.
