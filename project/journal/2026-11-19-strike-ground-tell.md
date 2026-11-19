# The running strike's ground tell (ONE-FORMAT CC11b3)

- opus-of-m23b, from opus-of-m23's part-built handoff: a page draws a creature's running ability's ground tell from its
  animal row (wire 1.4 `ability`, `abilityT`) and the species' declared ability. `abilityRows` now carries the ability's
  `tell`, its timing as the server's runner counts it (the ability's windup and duration over its strike's, the
  strike's recover) and the reach and width its strike shape draws. `abilityTell` turns progress into a phase; the
  elite page's `drawTell` moved to `shardfile/abilityTell.ts` and is shared; `AbilityTells` pools one `GroundTell` per
  tell drawn at once, per scene, and the worker's `showRows` draws through it.
- Proof (`test/net-ability-tell.test.ts`): two pages on one room. A slam marked `tell: 'ring'` (0.8 s wind-up) runs 84
  ticks; both pages show one ring on 46 ticks, agree tick for tick, and never outside the server's 47 wind-up ticks. An
  unmarked bite runs as long and neither page draws anything. Without the `tell` mark the slam test fails.
