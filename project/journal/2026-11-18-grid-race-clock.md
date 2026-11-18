# The race clock in a grid data cell

> Written by: Claude (opus-ss10n, SHARD-SOURCE SS-MS1b), 2026-11-18

On staging v0.1.40 Mirror Salt's arch line ran on the cell's server: the
gate flags rose in order and the finish filed `mirror.race`. The page
showed no clock. A one-shard page installs the race clock in its
shardfile client (`raceClock.ts`); a grid data cell installed only its
kit and talks, so no `.ws-quest-race` chip and no race system existed.

`grid/dataCellRaces.ts` installs the clock while the feet stand in a copy
that declares races, beside its talks, reading the cell server's owned
lines and tick only while the wire is that cell's.
`data-cell-races.test.ts` covers the run, the crossing and the finish.
