# 2026-11-12: the interpolation delay settles after a stall

- NET-LAG NL2 (meta plan): other players were drawn 140 to 270 ms behind
  against a 90 to 110 ms target. A page stall (boot, a long task) holds the
  socket's frames and hands them over as one burst, oldest first. The oldest
  is more than 250 ms late, so `NetClock` snapped back to it, and the rest of
  the burst only nudged the clock at 1 %: it then ran up to 250 ms behind,
  every frame read as jitter, and the delay climbed and fell at 1 % for tens
  of seconds. Past ~233 ms the render tick fell off the 8-frame buffer.
- Now the rest of a burst carries the clock to its newest frame, the delay
  falls at 3 % (rows run 3 % fast while it settles), it stops at 200 ms, and
  the buffer keeps 10 frames. `Interpolator.held` / `starved` (the page's
  `interpHeld` / `interpStarved`) count render frames the buffer missed.
- Red first, `test/net-delay-settles.test.ts`: 1 s boot stall and a 325 ms
  burst, then 10 s clean, was delay 154 ms and 690 held frames; now 69 ms, 0.
