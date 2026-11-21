# Phone Low seeds held through the boot loss (mini-phone-pairs)

- route-bench's iPhone 13 boots seeded at Low kept coming up at DPR 2. At control the device save had
  the game's own keys but none of the seeds (graphics, firstPlayDone, devMode, debug.*): 7 of 7 boots
  on a restarted tunnel origin, 1 of 4 on the one before. Same loss as codex-tc48's DF5 finding; the
  cause is still open (`saves/legacy.ts` resetLegacy is one suspect).
- route-bench now installs a Page bootstrap that puts back any missing seed on each device/global read
  or write (memoized by raw string, so the 2 s mode re-read allocates nothing), counts restores in
  `__wsLowGuard`, prints the saved keys in the raster witness and refuses a non-Low boot before the
  route plays. Meta evidence: `project/evidence/driftwood-fps/df10-df9-phone-pairs-2026-11-21.md`.
