# Pine Hollow loads in half the time (SB32b)

Meta STAGING-BUGBASH SB32 measured Pine Hollow reaching play in 22 to
30 s on staging against Driftwood's 10 to 11 s. A local preview showed
the main thread idle for most of it: every compressed texture upload
waited for a painted frame before and after it, one at a time, about
180 of them on Pine. The shaders step awaited its uploads one by one
too, so it took 2.4 s for 63 programs, and LS8's slow-GPU reading
(shader step time per program) called this Mac's Metal GPU a software
one: a narrowed first frame, a covered canvas and paced frames in play.

Under the loader nothing is on show, so uploads now share a painted
frame until a 32 ms slice is spent; in play nothing changes. The
shaders step hands its uploads to the queue together, and the slow-GPU
reading leaves the uploads out. Local preview, headless Chromium, tap
to play: Pine 16.4 -> 7.8 s, Driftwood unchanged.
