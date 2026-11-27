# Stamp the header a cooked attachment serves

Production nightly 46000160457 could not boot Nalati or Nine or
open them in Explorer. The cold attachment overwrote each local
shard header. Its cook stamps the shard version into that header,
so its verdict named a different hash at the same path. The
installer kept both hashes and the format reader refused.

The installer now replaces the stamp at each attached path and
retains the stamps for the other shards. The attachment regression
uses different initial and cooked hashes at the same pathname,
including when the pack lives under a loose upload prefix.
