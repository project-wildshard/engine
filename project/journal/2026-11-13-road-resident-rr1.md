# 2026-11-13: no cell boots on a player's arrival (ROAD-RESIDENT RR1)

Jake (J320) wants the MMO server to hold the whole grid and its roads in memory, never loading a zone the first time a
player goes there. The server already opened every cell at boot, but J107's start-over (a world everyone left starts
fresh) ran on the next arrival, and `emptySince` was set at boot, so on a server up for more than five minutes the first
visit to any cell booted it again (staging's `cell.booted driftwood-isle ms 892` on an arrival).

Now a cell that someone used and left starts over on its own timer, `EMPTY_MS` after it emptied, one at a time per
worker; an arrival only waits for a start-over already running. A cell nobody entered keeps its boot world. A timer that
fires early by `diagnosticNow` looks again (the first rig run left 5 of 25 cells unrestarted without it); `cross` settles
both cells before reading their rooms; a failed start-over keeps the old world. `EMPTY_MS` is now an env override like
`HOLD_MS`. Local 25-cell `main.mjs`: 25 first visits, 0 cell boots, 25 of 25 start-overs with nobody there.
The start-over still stalls the worker's clock while it boots; that hitch is SERVER-CELLS-PLAN's.
