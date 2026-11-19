# 2026-11-19: a revived creature stands whole, plates and all

> Written by: Claude

ONE-FORMAT CC36a. `AnimalSim.revive` brought hp back but not part hp (CC31's `PartHealth`), so the stranger shard's
mech, which stands again 30 s after it falls, started its next fight with every plate already broken and its break
channels still at 1 (the page hides a broken plate's attachment by that channel).

A creature volume pose now has an optional `whole()`, and `revive` calls it: `PartHealth` puts every part back at its
full hp, and each part that was broken sets its break channel back to its declared start. Every revive path (a data
spawn's `respawn`, encounter adds, a spawn's `when`, a decision's form swap) goes through `revive`, so all stand whole.
Test: `test/part-hp-revive.test.ts` (break a plate, kill, respawn: whole, channel 0, and it breaks again).
