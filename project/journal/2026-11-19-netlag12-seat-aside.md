# NL13b5: a fresh seat stands clear (opus-netlag12)

> Written by: Claude

Nine's third seat stepped 1 m west of the spawn onto Lantern Square's west edge, beside the Well's guard: half the capsule over
nothing, and the page corrected every walking frame on staging (32 a minute). The room now takes the first step aside that stands
clear (`clearStand` in `physics/query.ts`: floor under the centre and rim, no edge, nothing solid inside), else the spawn.
`test/dedicated-seat-aside.test.ts` seats five in every shipped cell; it failed first on Nine (-1 m, +0.5 m) and Frostline (three
asides inside the slope).
