# Keep verified play-time bytes when the cache is full

Opus found that boot's quota fallback ended at control. A real fetch-layer
boundary reproduces it: finish the packed download, release boot members,
empty disposable cache bytes, then refuse Cache.put with native quota.
The old reader returns HTTP 404 despite having verified the requested
member's SHA-256. The new reader serves those bytes from a separate page
memory cache; repeat reads and worker-held requests do not revisit disk
or refetch the part. Non-quota publication failures retain their prior
failure path.

Related review findings: retain downloaded loose bytes until control
instead of downloading them twice after quota; prune held-index hints to
the current manifest's hashes; describe the optional portable metadata
port accurately. Native part opens, matches and writes join the existing
owned Cache operation tracking. Neither save epoch nor backend changes.

The old post-control case failed 404 versus 200 in 415 ms. The focused
cache boundaries pass in under three seconds. Full hooks and actual
browser validation remain publication prerequisites. The leave-drain is
still bounded by the existing four-second navigation deadline, and cannot
guarantee completion on browser Back/close or arbitrary pagehide.
