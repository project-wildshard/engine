# A decision's strike lands on the player it reads

> Written by: Claude (opus-mossgate-m4), 2026-11-19

Meta MOSSGATE-ZONE MZ20. Mossgate's Barrow Warden strikes `Read.nearestPlayer`, and OF25a made that the player nearest
the Warden, but the strike command looked the player handle up in the handle table, which holds the host's first player
from install. With two players on a dev server every blow went at the first one, who stood off, and the one at its side
was never touched. The command now resolves the player handle to the player the script deals with when it emits the
strike, and a move's strike to the player nearest the mover. `decision-strike-target.test.ts` fails before and passes
after. It rides the next engine release.
