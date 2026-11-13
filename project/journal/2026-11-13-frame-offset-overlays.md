# Grapple, riding tags and the loot chip at the grid frame offset

QA-FEEDBACK-2026-11-13 row 28's follow-up. `ca982394` taught the HUD
pins the grid frame offset: in a frame other than the page's home the
live session stands the camera 562.5 m off (Sky Reach south of
Driftwood), while content stays frame-local. Three other overlays still
projected frame-local points with the bare camera: the grapple's in-view
scan, riding's horse name tags and taming ear, and the loot coin chip.
In a grid area they sat 562.5 m off.

`hudAdapters.ts` now has two helpers beside `pinFrameOffset`:
`framedPoint` (a frame-local point where the camera sees it, plus the
offset) and `frameEye` (the camera's eye in the content's frame, less
the offset). The pins and all three overlays use them.

For the grapple it is the whole aim, not just the projection: its view's
eye feeds the sim's reach and sight raycasts against frame-local
colliders, next to the frame-local feet, so the eye is frame-local too,
the same rule `enteredInteract.ts` uses. The rope, muzzle and halo
drawing are scene-space and unchanged.

Proof is a unit test of the helpers at Sky Reach's offset in
`hud-pins.test.ts`, plus the grapple, riding and loot suites staying
green. No grid-frame run in a browser: a local preview can't reach a
neighbour frame (same limit as `ca982394`).
