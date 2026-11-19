# Creature gunfire and a serpent's death

> Written by: Claude (opus-brasscap-combat2). QA 11-19 rows 42 and 44.

Jake on his iPhone, Brasscap on staging: "They're clearly shooting at me, but there's no particle effects ... There's no
bullets. And enemies are not animated to be holding a gun and shooting a gun", and of the Dust Wyrm "It has zero
satisfying death animation".

What changed:

- `SkinDriver` marks `released` on the frame a windup runs out with the creature alive (the strike runner cancels the
  attack phase as its active window opens; a stagger cuts it short below 0.75 and fires nothing), and plays the skin's
  `attack.fire` clip from then: the kick, the step back, the rifle lowered. A skin without that clip keeps its old choice.
- `creatureGunfire` draws the round for a skin with a `muzzle` bone: `Gunfire.enemyRound` puts a flash and a puff of
  smoke on the muzzle and an enemy tracer that passes a hand's width off the eye and runs on past it. Nothing closer
  than 3 m (the rusher's knife). Both creature pages call it: `skinSpeciesLook` and the grid's `neighbourLife`, which is
  the one that draws Brasscap's creatures on staging.
- `SerpentDeath` plays over a dead serpent's trail: a whip that dies away in 1.6 s, a burst of sand and a jolt of the
  view (`Gunfire.quake`, felt within 45 m), then the head sinks 14 m over 2.6 s and the trail goes down behind it, dust
  rising along it, and the loot bursts out of the hole (`Gunfire.shower`). It holds the quest card back for the length of
  it (`holdQuestRewards`): a beat that has not started waits, one already showing is never cut.

The bandit's rifle, its muzzle and its clips, and the Wyrm's faster moves and glowing seams are shard content
(shard-brasscap `src/generators/bandit.ts`, `src/generators/wyrm.ts`, `src/behaviour/wyrm.as`).
