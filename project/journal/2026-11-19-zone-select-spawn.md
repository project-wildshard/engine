# Zone Select puts you at the zone's spawn

QA 11-19 rows 52 and 55 (Jake, 16:10 to 16:16 Cancún, staging v0.1.52).
He took Zone Select to Driftwood, walked out of its gate onto the road,
exited to the title and took Zone Select to Driftwood again. He stood on
the road outside Driftwood's walls, with Driftwood drawn as its far copy.
Back in the app, the page threw "Page coverage requires a measured
whole-page claim" every frame.

Row 52: the door seated a Zone Select goto at the cell's saved `at`.
When a player walks out of a cell, its save keeps the step onto the
road. That is about 251 m out on a 250 m half cell, inside the room's
64 m slack. So the cell took the seat there and handed it straight back
to the road. A fresh Zone Select pick now sends `&at=spawn` on its dials
until the page is first seated. The door then puts the seat at the
cell's spawn, stepped aside, and still loads its progress. A redial, a
recovery reload, a gate entry and ENTER THE MMO send no flag, so they
come back where the player stood.

Row 55: the page booted Driftwood as its home on a measured whole-page
reading. Standing on the road, the grid's first region was another
cell, so road-start recovery released the boot claim. Driftwood was
later claimed the ordinary way under the same `sim:` id. The next
composer allocation, when the app came back, still named that id as its
cover, and the allocator threw. The cover now holds only while the
allocator says that claim is measured. The allocator also charges an
uncovered page component instead of throwing in the render loop.

Proof: `test/dedicated-zone-select-spawn.test.ts` (real door, rooms and
road) and `page-residency-road-start.test.ts` both failed first.
`scripts/zone-select-return-proof.mjs` walks the journey on the phone
layout in Chromium and WebKit. On cf47558e it stood on the road 57 m
from the spawn.
