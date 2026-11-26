# Exit after a zone crossing went back into the zone (QA 11-25 row 90)

> Written by: Claude (opus-chunk3)

v0.1.93's staging tour held: after Pine Hollow to Mossgate, Exit to the main menu never showed the menu. Five of seven
menu-and-back legs failed. I reproduced it on staging (the cut, b2c9e9f38) with the tour's own leg 0. The exit reached
`/`, and that bare title booted Mossgate in the same document. A boot from `/` with no zone shows the menu without
crossing a zone, so the crossing was the trigger. The crossing is an in-page travel, and it writes its tap in two
copies: the tab's and the device backup (`titleArrival.once`). The session spends the tab copy, but `deviceBackup` only
touched the backup on a page a tap navigated. The tour's page, like a bookmark or a reload, was not one, so the backup
stayed: fresh, unclaimed, and of the same origin. CHUNK-PARAM CP1 lets a bare `/` adopt a tap, so the title the Exit
loaded seconds later took the backup and entered Mossgate. Now a document can always read and spend a backup it wrote
or took, and the player's Exit drops the tap it carries. Another tab's backup stays. Two navigation-arrival tests fail
without the fix.
