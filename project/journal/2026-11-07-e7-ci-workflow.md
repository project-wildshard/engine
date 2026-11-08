# E7.2c green-main and tagged server bundles

Use the exact main SHA only after ci and ring-1 are green. Either
completion wakes staging; a version tag selects production and waits
for its exact main CI. Fork and PR workflow completions cannot receive
the publishing credentials. Each archive belongs to its GitHub tag's
Release; existing bytes cannot be overwritten.

Build IDs are full source SHAs. Staging tags are server-staging-SHA and
production uses the pushed version tag. Per-channel sockets fail closed;
an absent production setting never borrows staging. Shards default to
the first sitting's Driftwood and Nalati pins. Documented configuration
names E7_RELEASE_SIGNING_KEY, its matching public key, sockets and the
existing R2 writer. No secret, GitHub setting or infrastructure changed.

The local work stays above the held E7 port until public engine v0.1.1
exists. Both jobs then push in commit order with the normal whole-suite
pre-push, WS_FULL_SUITE=1 and SSH keepalives. Pack/page build alignment,
the real tunnel, CORS and the VPS proof remain outside this CI half.
