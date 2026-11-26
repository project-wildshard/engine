# QA 11-25 row 122: Nine's boot geometry read caught copies waiting to go

> Written by: Claude (opus-geo122), 2026-11-26.

Row 102 recorded `nine/boot/retained-geometry` at 14.15 MB from budgets run
45783353162, whose four boots read 12.06 to 15.38 MB. Only the one-cell
page's deck (0.90 MB) had content behind the rise over the old 8.03 MB, so
the line went back to 8.93 MB first (c6818e75b), and the rest was hunted.

There was no extra content. Every hosted read adds up to the same total:
retained plus released at boot is 57.905 MB in all four (14.15 + 43.75,
15.38 + 42.52, 12.06 + 45.84). What moves is how much the boot's own
`releaseDrawnGeometry` calls caught. Everything drawn after them keeps its
CPU copy until play's settle lets it go after 240 renders, and hosted
SwiftShader had drawn 9 to 11 frames at control. Row 115's settle (3 s
unchanged) passed in its first window there, because nothing changes
between frames that slow; it read the copies still in the queue.

Local SwiftShader, today's main (c6818e75b plus this change), one-cell
Nine, by owner once settled (6.06 MB, 310 buffers):

- Nine's instanced props (the town groups, lanterns, crowd, plants): 4.6 MB
- Nine's sets not drawn from the spawn view (booth, pavilion, parasol): 1.0 MB
- Nine's dynamic groups: 0.16 MB
- the grid: deck cull index 0.14 MB (0.90 MB until its tile backing swaps
  it, some seconds after control), seam curtain and boulevard 0.01 MB
- the held weapon and hands: 0.04 MB
- identical bytes in two buffers: 0.02 MB (mahjong tables' matrices)

No duplicate and no held copy: the deck index is the tile backing's own
(a named grid system); the rest is Nine's content. The build before row 109
(538781c16) reads the same: 6.82 MB at control, 51.08 MB released, 6.06 MB
once the deck's tile backing swaps, so the home admission cut changed no
geometry.

What still moves from boot to boot on a settled read: the deck's tile
backing (0.76 MB) and Nine's hidden dragon hooks (1.03 MB), whose copies go
only when the boot's warm draws happened to draw them.

The fix is in the read, not the page. The probe gains `releaseDrawn` (the
boot's own release, what play does after 240 renders), and nine-load lets
every drawn, unchanged copy go before each settle read and before the
budget read (`releaseDrawnThenRead`). The read is then what play keeps,
whatever the frame rate. `nine/boot/retained-geometry` gets its own caps
entry with a 1.5 MB floor (no hard cap; J444), instead of the 5 MB memory
floor that hid a 3 MB regrowth, and the line is recorded at the settled
read: three local SwiftShader nine-loads of the one-cell page read 6.82 MB
each (heap 208.4, 208.9, 228.4 MB), soft line 8.32 MB. `test/boot-memory-ratchet.test.ts` pins the release-first read and
the floor: 3 MB grown back over the line is a regression.
