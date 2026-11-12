# Template rev 3: Mossgate's own hero on the title card

Jake, 17:14 Cancún (meta QA-FEEDBACK 2026-11-12 row 29): "you have to
update the hero images for the templates." Template rev 2 (`169ae525`)
carried the grey placeholder SVG.

sharddev `6d6cf02` gives `_template` its captured hero (thumb 640x360,
portrait 804x1626, landscape 1600x900). Template revision 3
(`4b5bcb9c`, v0.2.2) is that build, prepared on a preparation-only
preview of `827ffbdb` (renderer `86cb061f`, fence 181). Only the card
changed, so Ring 1's template digests and the refused v0.1.1 save
stand; the save fixture now names rev 3 as the pin it is refused by.

Proof on a worktree of `827ffbdb` with this pin: `ring1.sh cook-step`
and `build-boot` green, pins and saves tests green with all 28 pins.
A local `build:game`, in headless Chromium at 402x874 (Developer on):
Shard select's Template card shows the rev 3 thumbnail, the hero is
rev 3's 804x1626 portrait, ENTER WORLD plays in 2.7 s, the player
walks 8.5 m to the hut, 0 page or console errors. The tar is on the
`pins` release. API: preview is rev 3; staging and production stay
on rev 2 until v0.1.14 flips them.
