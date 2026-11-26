# Scoped R2 credentials on the cook host

PV25 uses a bucket-scoped S3 key pair. The VPS can receive its two exact
credential rows over stdin and atomically store them in the root-only cook
environment. Credential staging leaves the running cook and its bucket
selection alone. Rooms use the signed versioned pack path after their
channel's operator enables it.

The rebuild proof exercises old packs, a local store, and the new scoped
bucket. Its previous source-text assertion still expected the old name for
the worker's directory variable, which failed the hosted run of f53b8de01a.

PV2's signed release pins each canonical shard version. Rooms can open that
address directly. A placement also carries the raw hash, so a room compares
it against the cooked index when reading that placement.
