# A bear at the quest fire ended the night's cells (DF15)

The 11-23 DF7 night on cd8143559 lost 15 cells to "position jumped during the route". Each was the bench player
respawning at the south gate: the night's dev world had run for hours, and Driftwood's black bear (home (-122,-100),
leash 90) had come to stand at the quest fire, mauling every player within ~5 s of the village dwell. Runs 1 and 2
on the fresh world were clean.

The route now names a death (html `data-ws-state` 'dead' plus the death card's cause). `table.mjs --stop-on-death`
ends on such a cell with exit 4; `nightly-mini.mjs` keeps one port for the night, restarts the world and resumes the
table. A SIGTERM stops the world and the table first, so a killed night no longer orphans its dev world.
