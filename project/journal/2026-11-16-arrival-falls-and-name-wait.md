# Arrival "falls" and the Name wait (mini-arrival)

> Written by: Claude (mini-arrival, Mac mini)

- QA 11-16 mini row 69 (new-shard-e2e F42): Honeyknoll's "FELL TOO FAR" arrivals were not falls. A local DedicatedRoom on the
  sdk 0.3.5 build seats 12 arrivals at the spawn with no drop below 4.8 m; with 0.0.1's boars beside the spawn (the room kept
  0.0.1's rules, F48) idle players die to boar bites, and a data shard's creature strike carried no death cause, so the card read
  the cause-less default, "Fell too far". `5a2a375c` gives sim.ts strikes and layer hunts their killer.
- QA 11-16 mini row 85: the boot watchdog counted the Name prompt (asked inside the "server" step) as a hang. Headless WebKit on
  staging: answering at 65 s trips "stopped loading at step server (no progress for 60 s)"; answering at once joins in 14 to
  23 s. The prompt now marks itself `data-boot-wait="player"`, which `progressOfCard` reads as the recovery page's wait.
