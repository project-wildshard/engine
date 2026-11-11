# Packed CI: the unit estimates follow the measured units

> Written by: Claude (opus-testspeed-lane)

TEST-SPEED TS2. The packer balances five jobs on fixed seconds per unit,
set from the first spikes: products 230 s, e2e 20 s, plan-proofs 30 s,
boundaries 60 s. Over the last 12 packed runs products took 205-384 s
(347-358 s in the last three), e2e 19-79 s, plan-proofs 28-53 s,
boundaries 19-32 s. The job holding products came out longest: 582,
598 and 621 s against 317-545 s for the others.

The estimates are now the measured ones (products 360, e2e 45,
plan-proofs 45, boundaries 32, static 170). Replaying three runs'
actual unit seconds through the packer moves products' job to 450-473
s; the longest job of run 42974435994 goes from 594 to 503 s of unit
time. What is left is the shards' own spread (46-167 s for shards the
planner sizes alike), which the LS2 timings cache is now measuring.
