# Keep the memory ledger's phone encodes between builds

Engine run 44890926808 exhausted the 30-minute job limit. The pinned
build took 1,614 seconds and emitted no new Brotli parts. Its successful
3.25 GB upload took 140 seconds. Nearby successful uploads took 17 to
35 seconds. Main-watch recorded the cancelled run as superseded.

The ledger restored only the Brotli child directory. Retain the sibling
phone ASTC cache with it and seed from the latest full nightly encodes
when needed. The app still checks and archives its current exact pins.
Prune unused textures as the other build does. Bound the upload at four
minutes, above the slow observed success, within the existing job limit.
