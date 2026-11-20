# A declared hunt keeps the player it last saw across a restore

> Written by: Claude (opus-of21-drift), 2026-11-19

Driftwood's declared roster (ONE-FORMAT OF22b4) diverged after a restore:
a killed kit boar's noise band kept reading the hunt's cached player
place, which `layerHunts.ts` never saved. The restored hunt rebuilt it from
the player standing at construction, so the noise speed and place differed
within a few hundred ticks and the canonical digest split. The cache now
rides the hunt's continuation (`player`, optional, so an older save still
restores). `test/layer-hunt-player-restore.test.ts` kills a hunt that saw
a second player and steps the live and restored hosts together.
