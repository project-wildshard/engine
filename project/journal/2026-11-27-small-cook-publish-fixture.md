# Keep the publish test on a one-tile shard

The notification and listing-reuse test cooked the active Dunes upload
twice. The old upload took 10.647 seconds on this Mac. The images-only
pin hit the 60-second deadline both locally and in CI `46026793773`.
The test's contract is independent of the zone's texture inventory.

QA57 uses the existing made-up one-tile shard and caps its input at
128 KiB. Authenticated HTTP notify and both actual child publications
still run. The case passed in 4.487 seconds and the six provenance
tests passed alongside it.
