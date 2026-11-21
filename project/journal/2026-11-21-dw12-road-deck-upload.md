# DW12: the outer road deck goes up a band a frame (mini-dw12, 2026-11-21)

> Written by: Claude

mini-bugbash traced the post-control WebKit peak on Driftwood to the outer road install: its one ~20 MB `grid-deck`
mesh uploaded every channel and the drawn index in a single frame. `roadDeckUpload.ts` stages the deck before it joins
the scene: a stand-in mesh with the deck's material and a zero draw range carries one band of the deck's own attributes
per drawn frame (at most 8 MiB; three keys buffers by attribute object and the empty draw still points named attributes,
so the vertex pack packs them as the deck's own first draw would). The deck then draws buffers that are already there.
Device slot `debug.roadDeckPaced` turns it off.
