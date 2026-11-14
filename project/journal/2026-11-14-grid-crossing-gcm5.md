# Grid crossing, opus-gcm5 (2026-11-14 night Cancún)

- GC6 (QA 11-14 row 6, Jake on staging v0.1.18: a 37 s card crossing into Nalati at 2992x1434@2). Measured on a local build of
  main at his viewport (`grid-crossing-tour.mjs --in=50 --viewport=2992x1434@2`, 18 fps headless, a loaded box): the walk's
  first crossing held 0 to 17.5 s at Nalati's wall. Three causes, in order of size:
  - Inside Driftwood the page held 3 to 5 neighbours' radial products, each pinned while held (playing 1199 of 1200 MB), so
    the demand read of the cell ahead was deferred for the whole approach and its world was built only on the road. A refused
    demand read now lets the other speculative products go, farthest first, radial reads wait while it is missing, and its
    deferral is kept apart from the radial read's (which had blocked it until the allocator's revision moved).
  - The world's inputs read back in lockstep batches of four: Nalati's ~860 files took 20 of its world's 30 s, each read a
    cache round trip waiting on drawn frames. A sliding window of 16 (12 for an approach).
  - Live builds get a quarter of the fastest vsync a frame: 2 ms on a 120 Hz screen, about 6 % of the wall clock at 30 fps.
    A world the traveller heads into, or the road (where its entry prepares), now builds with an urgent 8 ms slice after each
    drawn frame, and its entry warm-up issues 2 programs a frame.
- The tour takes `--in=<m>` (start further in, to measure the pre-warm) and `--viewport=<w>x<h>@<dpr>`, and keeps a trace of
  samples per crossing (with the page's warm refusal, deferred reads, playing MB and envelope) and the page's warnings.
