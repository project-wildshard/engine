# A road start leaves the composer uncovered

QA 11-19 row 55 (Jake, 16:16 Cancún, staging v0.1.52). Back in the app
after row 52 left him on the road, SOMETHING BROKE: "Page coverage
requires a measured whole-page claim". It came again on KEEP PLAYING,
every frame from present().

The page booted Driftwood as its home on a measured whole-page reading.
Standing on the road, the grid's first region was another cell, so
road-start recovery released the boot claim (`releasePending`), and the
allocator forgot that the claim was measured. Driftwood was later
claimed the ordinary way under the same `sim:` id. `PageResidency`
still thought it held a whole page. The next composer allocation (the
app coming back resizes the drawing buffer) named that id as its cover,
and the allocator threw.

Now `releasePending` drops the whole-page mark. `composerCover` asks
the allocator whether the claim is still measured. The allocator
charges a page component uncovered when its cover does not stand,
instead of throwing into the render loop.
`page-residency-road-start.test.ts` failed first with Jake's exact
message.
