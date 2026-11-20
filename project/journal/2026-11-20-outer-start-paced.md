# Outer ring start, paced (DF8, mini-driftwood13g)

- The dock's ~2 s frame on the iPhone 13 was the grid session's fixed
  step starting the outer ring: ~80 outer-road block fetches started in
  one task (32 to 41 ms) and every far neighbour's declaration (11 ms).
- `debug.outerStartPaced` (on at phone Low): 4 outer blocks read at a
  time, one far declaration a fixed step. Pairs: reveal's longest update
  48-60 ms off, 38-39 ms on.
- `route-bench --frames` now switches the probe's frameCost on and prints
  each update over 50 ms with its split; the grid step names its parts.
