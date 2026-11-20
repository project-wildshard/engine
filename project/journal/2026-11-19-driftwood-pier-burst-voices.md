# Driftwood's pier burst was the voice prewarm, not the GPU (DW3, mini-driftwood13d)

The pier leg's first-turn burst on the iPhone 13 (about five frames of 60 to 100 ms, two to five seconds into the walk)
read as "gpu~" on the frame meter, so the lane took a Metal System Trace of it (`xctrace`, all processes). The GPU
process never worked longer than 9.4 ms on a pass in the whole 25 s, and the Metal compiler ran 8 times for 4 ms. In the
burst the page simply sent no WebGL work for 60 to 164 ms at a time.

The bench's new `--voices` log named it: the first footstep on the pier arms the declared bank's prewarm, and its slices
render creature vocals and wind-ups on the main thread, one channel of one variant each: vocal-sailor 66 to 96 ms,
windup-sailor 105 to 171 ms, vocal-monkey about 42, the ui families 20 to 50. About 1.1 s of renders in 2 s. The prewarm
pace (`debug.audioWarmPaceMs`) could not help: it spaces the slices, but each slice is one long render.

The census on the phone (`--census`) also showed no shadow-pass draws in a 760k-triangle boot; the boots that read
about 1.2 M triangles and about 111 draws still need a census taken inside one.

`debug.audioWarmWorker` renders the prewarm in a module worker (`voiceRender.worker.ts`). The families and the render
moved to `voiceFamilies.ts` so the worker imports no DOM; a declared family carries its render as data (`work`: an
impact material or a PCM program). One job is in flight at a time; a failed or late (5 s) reply turns the worker off for
the page and renders that job and the rest on the main thread. A play that finds its family unrendered still renders on
the spot, as before. Off by default until the cooled phone pairs decide.
