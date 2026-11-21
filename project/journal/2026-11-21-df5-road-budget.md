# Give the phone's road return time to finish

> Written by: Codex
> **State:** measured harness correction, 2026-11-21.

DF5 diagnostic29 on frozen engine `39542d31d` reached the return gate
at about 35 seconds. The 40-second route ended during `afterPlay`,
with 29 of 38 textures uploaded. The crossing finished after 6,614 ms:
world construction took 2,068 ms and `afterPlay` took 3,736 ms. The
gate admitted the player about two seconds after the old deadline.
The page kept drawing, with no navigation, visibility or page errors.

Jake asked this lane to find whether the road failure was a harness
path, a gate, loading or a timeout too short for the phone. Use a fixed
60-second road leg on both phone and Mac. Keep every frame, waypoint
and the ten-second road dwell. All old 40-second captures remain
incomplete; DF5 needs three fresh matched pairs with the new workload.

The regression replay reproduces the old failure at 40 seconds,
completes the observed admission at 60 seconds and still refuses an
admission that never finishes. Fresh phone qualification remains open. Related checks and the normal
push gate are recorded in the commit and lane receipts.
