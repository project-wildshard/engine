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
