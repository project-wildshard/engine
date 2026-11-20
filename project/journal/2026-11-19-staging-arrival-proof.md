# J205 admits a staging chunk and named arrival

The v0.1.53 J451 proof refused Driftwood's real staging socket before
the first crossing. The page asked the staging door for the Driftwood
chunk and the named spawn. The harness accepted only a chunk by itself.

Allow a valid arrival name alongside one chunk. Preserve the staging
origin and root path checks, and refuse extra keys, duplicate keys
and a standalone arrival.
