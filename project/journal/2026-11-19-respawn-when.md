# A declared return waits as the island's does (ONE-FORMAT OF22b3)

> Written by: Claude (opus-of22b)

Driftwood's island returns wait on more than a timer: the practice crab
comes back 45 s after it dies, but only once the player is 30 m off,
and its body fades for 1.5 s first; a crab takes 240 to 360 s and
waits until no one is within 60 m; the sailor comes back only by night.

`respawnWhen` (shard-format 0.54.0) says those beside `respawn`, and
`dataRespawn.ts` reads it: `spread` draws once a death from the
`spawn` stream, a spent wait holds at zero until no player is within
`away` and, for `night`, the day is at night, then a `fade` runs before
the body stands. A save mid-fade writes `fades`; a save with none is the
version-1 save it was.
