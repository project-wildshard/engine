# DL23: the boot's shaders step links what the first frame draws

> Written by: Claude

J198: "warm shaders before control"; DOWNLOAD's DL23 bar fails any loading frame over 250 ms. Re-measured on
`b17d8b7` (the iPhone Simulator, the sweep's flow and pairs), the cold runs' long frames had moved out of the Shaders
step into the First frame step: Nalati 762 ms (9 frames over 250), Driftwood 858-866 ms, Nine 1326 ms, Far Reach 348 ms,
Sunscar 439 ms, with the card held 1.1-1.6 s inside that step (DL21).

The shaders step compiled only what the spawn view and its warm turns show (`drawnFrom`). `Game.firstFrame` then
warms every drawable on the camera's layers through parked draws, out of view and hidden alternates included (one per
pipeline, G743). Each program the census missed linked synchronously inside a parked draw. A link probe in desktop
WebKit (iPhone device, select flow) counted them by the card's step: Nalati 25 programs in First frame, Pine 34.

The boot census now takes `firstFrameDrawables`, the same inventory `warmParkedDraws` builds, through
`Game.firstFrameCensus()`. Families and road variants stay out (`drawnOnly`); grid entries and the world frame's
re-census are unchanged. Same probe after: First frame 0 links on both, Shaders 93 (Nalati) and 104 (Pine, was 70), total
programs unchanged (201, 219), none after control. (Nalati's early scene-only pass splits its links between the Sky
and Shaders steps by timing, so its before-count there varies run to run.)

J206 review (Codex) had one MUST-FIX on a first cut that took every camera-layer drawable: two hidden instanced
twins differing only in instance colour compile two programs, while the parked warm draws one. The census now is the
warm's own inventory, and a test proves the census and the warm's draws are the same set, one hidden twin included.

The second J206 review (Codex) found no MUST-FIX; its SHOULD, wiring coverage through `precompileLevel`, is a test that
the census reaches scene discovery as its include, drawnFrom stays the default, and an arrival set still wins.

## The link bound counts from the last link

The first Simulator sweep of the census showed what moving 86-107 programs into one batch costs on a loaded Mac
(load 30-60): the GPU process links about 4 a second, so the batch passed `LINK_WAIT_MS` (10 s from its issue) while
still landing links, and the resolve phase then forced the rest synchronously in one frame: Driftwood 5,163 ms at 47 / 86
linked, Pine 3,260 ms at 80 / 104. The other cold runs passed outright (Nalati 18.5 s, Far Reach 17.6 s, Sunscar 8.9 s,
Driftwood packs 17.0 s, Nine packs 15.0 s; before, every cold run failed on first-frame frames of 348-1540 ms).

The boot batch's bound now counts from the last link that landed (`boundedLinkWait`'s `since`), so a batch still
making progress keeps waiting with its count moving on the card; a link that never reports (O14) still ends the wait
`LINK_WAIT_MS` after the last one landed. The constant is unchanged.
