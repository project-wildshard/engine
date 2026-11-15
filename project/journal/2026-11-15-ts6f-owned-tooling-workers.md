# Reuse workers for owned tooling inputs

The cook-signature, asset-limit, frame-floor inventory, engine-side,
standalone-side and control-chunk suites own their keys, graph inputs
and temporary files. They neither change shared registries nor demand
a fresh module import. Source-side checks only read the actual tree.

All fifteen cases pass isolated together and in exact forward/reverse
shared orders. Warm isolation costs 9.516 CPU-s; shared orders cost
8.094 and 7.903 CPU-s. The initial cold isolated sample is 10.543 CPU-s.
These are local batch observations, not full-gate savings.

Keep filesystem fixtures' existing cleanup and every assertion intact.
Also correct the remaining packed-boundaries comment to match TS15's
now-blocking workflow and unit classification.
