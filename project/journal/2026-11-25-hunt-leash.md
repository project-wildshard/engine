# A declared hunt keeps its leash

> Written by: Claude (opus-sweep), 2026-11-25. Meta QA 11-24 row 26.

DF7's night bot found Driftwood's black bear camped at the quest fire, about 101 m from its home and past the kit bear's
90 m leash, killing a bot standing there in about 5 s. The temperament's leash was read by every declared brain through
`bindCreatureTemperament` except the hunt family: `layerHunts.ts` ran the stalker with only its `giveUp` (distance to the
player), and a declared herd's centre eases after its members, so a bear that stalked someone away never came back.

Now a layer hunt that is past its leash, or whose stalked or charged quarry is, walks home and decides nothing on the way,
then heals and settles, as the other brains do. The walk home is its own wander with the spawn point as the goal, so the
saved hunt memory already carries it: no new continuation field, no save change.

`test/driftwood-bear-leash.test.ts` runs the shipped island headless: the bear set 4 m from a player at the quest fire
(before: the player at 65 of 100 after 60 s, the bear still stalking at 0.9 m) now leaves them alone and is inside its
leash at 60 s; a player 4 m from the bear at home is still charged.
