# A page one revision behind its room loads once

> Written by: Claude (opus-finish2)

v0.1.75's staging QA held P0 on K4 and K6 (codex-ms, 20:13 UTC). The page baked Pine r12 and Signal Dunes r6. The signed rooms
already ran r13 and r7, published after the cut. The deep link never reached play: nine reloads in 90 s, the last at "Home
region 59%, attempt 9".

Reproduced headless WebKit at the phone layout. This tree was built as `9b74e58cc` (`WS_BUILD_ID`) and served as staging
against rooms/141, so the page reads that build's cook indexes. The loop had two causes.

- **The one-reload guard never held.** `heardRooms` records the reload it gave in the tab's session hints through the save
  environment. The online door's bundle has no save store (OF4, as `worldRestart.ts` says), so every write was dropped and
  every boot reloaded again. The hints now fall back to the tab's own `sessionStorage`. A tab that keeps nothing at all stays
  behind and never reloads for the rooms.
- **The followed upload never downloaded.** r13's manifests list 1,809 content-named blobs that r12 already had. Its
  `loose/<hash>/` folder holds only the new ones, so `placedLoose` sent the rest to 404s ("The world didn't download"). A
  content-named blob (`blobs/<kind>/<sha256>.<ext>`) that the cook index does not list is now the build's own copy of the
  same bytes. A file named by its path is always the upload's.

After the fix: one reload, then Pine r13 reaches control (about 53 s, desktop tier, cold) and Dunes r7 in about 18 s.
`watchLeg` (the staging smoke) now keeps each failed request with its document number, and why each document left.
