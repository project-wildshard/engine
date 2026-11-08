# The lease directory is not a test runtime

A real clean tiny repository runs its actual gate under two independently
acquired full-test leases. The first writes a successful tree receipt;
the second incorrectly misses because WS_HEAVY_ROOT contains a fresh
per-lease token. The reproducer is red before changing the fingerprint.

Exclude that ephemeral compatibility-view path, like the already excluded
lease token. Keep the real scheduler root, test environment, runtime,
profile, git tree and scope. Dirty/partial/failed/CI rules do not change.
The same real two-lease command must now hit, and existing negative scope
and changed-tree cases must still refuse reuse. No old proof is invented.
