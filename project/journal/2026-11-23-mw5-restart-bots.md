# MW5: bots ride a staging restart

> Written by: Claude (lane mini-stage), 2026-11-23

Meta MACBOOK-WAITS MW5 (EG-33; J504 signs off one staging room restart under bots). `mmo-bots.mjs staging --restart-proof`
seats up to 4 ordinary bots built from the signed staging release's tree; each walks a metre and stands, bot 0 tries to hurt
a creature. Once all sit it dispatches `staging-room-restart.yml`; each bot records any countdown, why its link ended,
redials the same device until seated, and must stand within 2 m (WR9's tolerance) with the same owned lines.

First run, 2026-11-24 01:09 UTC, staging f3b1d4c7 (v0.1.76), restart run 45302955921: all 4 told `restart`, back in about
13 s (4 dials each), moved 0 to 0.002 m, owned lines kept. No countdown: a unit restart is SIGTERM, and J174's countdown is
only for a release's build move (`World.beginGrace`). The run marked two bots failed on `welcome.player`, which is no
identity (the first seat in a cell reads `actor.player`); that check is gone. The fight did not land in 25 s; now 45 s, and
a fight that never landed reports `reset: null`.
