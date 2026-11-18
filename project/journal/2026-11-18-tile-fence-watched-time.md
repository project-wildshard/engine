# The tile fence counts only the time it watched

Hosted Nine's ring-1 load (run 44272554796) failed with `Tile fence
stalled: 34 tiles inside it made no progress for 20 s`. 4b61ceca made
that terminal message visible; before it, the same refusal waited out
the 235 s readiness deadline (c5a5c3bd).

The artifact's boot timeline has no page row at all from 63.6 s to
86.8 s. A worker made at 63.5 s sent its first message at 86.8 s, which
is the moment the page could read it. So the main thread was blocked
for about 23 s, most likely by a synchronous SwiftShader GL call on the
busy 4-core runner. The ledger diagnostic caught Nine stalling on hosted
Chromium earlier today too.

The fence's stall clock was plain wall time since the last finished
stage. Its first look after the block counted the whole block as "no
progress" and refused entry, although no tile could have moved while
the page was blocked.

The clock now adds only the time it could watch. Each gap between looks
counts at most two polls (500 ms). A real stall, where the loop wakes
every 250 ms and sees nothing finish, still rejects at the bound, and
the existing test for that still holds. The new test blocks the page
for 1.5 s against a 600 ms bound, then lets the tile land: the old
clock refused and the new one settles.

The 23 s block itself is still there. On a phone it would be a real
freeze, which the fence never could catch.
