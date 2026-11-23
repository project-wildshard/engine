# A rooms revision reload stays in the zone (QA 11-23-b rows 18, 20)

> Written by: Claude (opus-finish)

Jake, 11-23 on staging: Signal Dunes r6 went live at 16:28 UTC, and ENTER
THE MMO's Signal Dunes card dropped him to the main menu again and again.
The room revised Dunes at 16:27:47 (`cell.revised` in the journal). The
door's world word then named r6 for Dunes while the page baked r5, so
NB2's `heardRooms()` reloaded the page once onto the rooms' bytes, with a
bare `location.reload()`. Nothing marked that reload, so `lastEnd` read it
as the player's own, and entry's QA 11-12 row 35 rule put the page on a
quiet title. opus-noexit found the same seam from the title side (row 22).

The reload now leaves through the shell's seat-elsewhere path: a marked
end, the tab's arrival and `?chunk=<zone>`. The next boot follows the
rooms' bytes (`placedCells.ts`) and enters the same zone. The callback is
a required argument, so no other caller can leave unmarked.

Staging's current build bakes Dunes at its live hash, so the drop does not
reproduce there now. The J451 zone-entry smoke's menu-and-back step
checks it on every release.

## A neighbour's file stays the build's own

While proving the smoke, every fresh WebKit boot of staging's Driftwood
stopped at "Download paused · the connection dropped" (16:50 UTC, the
placement file at serial 90 and 91). Copy diagnostics named
`/shardfiles/brasscap-mesa/discovery.json`: Driftwood's grid manifest
lists Brasscap's discovery at the bytes the build baked, but the rooms had
moved Brasscap to an upload, so SA48's `placedLoose` sent the read to that
upload's folder. The folder had no such file yet (a 27 kB 404 page, over
the 6 kB cap), so the size check failed the whole Driftwood download. A
new upload with other discovery bytes would fail the same way. A manifest
now reads only its own slug's loose files from the upload; a neighbour's
stay the build's copy, which is what the manifest lists.

## The smoke goes to the main menu and back

Jake, ~11:36 Cancún: fold the check into the J451 zone-entry smoke, not a
new test. After the first seeded crossing into each zone but Driftwood
(seven of the sixteen), the staging smoke now pauses, exits to the main
menu, taps ENTER THE MMO, and must be back in that zone through one
loading screen, never by way of Driftwood, then walks the return crossing.
The arrival keeps `rejoinMs` and `returnMs`; the release gate
(`smokeGap`) holds a verdict that lacks either for any of the seven, and
each failure names its step (pause, exit, main menu, ENTER THE MMO, the
loading screen, play, the return crossing). Nalati is already one of the
eight featured zones, with two crossings in every draw.

## A neighbour's file stays the build's own

While proving the smoke, every fresh WebKit boot of staging's Driftwood
stopped at "Download paused · the connection dropped" (16:50 UTC, the
placement file at serial 90 and 91). Copy diagnostics named
`/shardfiles/brasscap-mesa/discovery.json`: Driftwood's grid manifest
lists Brasscap's discovery at the bytes the build baked, but the rooms had
moved Brasscap to an upload, so SA48's `placedLoose` sent the read to that
upload's folder. The folder had no such file yet (a 27 kB 404 page, over
the 6 kB cap), so the size check failed the whole Driftwood download. A
new upload with other discovery bytes would fail the same way. A manifest
now reads only its own slug's loose files from the upload; a neighbour's
stay the build's copy, which is what the manifest lists.
