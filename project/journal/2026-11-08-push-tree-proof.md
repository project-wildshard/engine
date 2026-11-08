# Reuse only the tree that passed

J193 permits a green pre-push result to cover an identical git tree. The
receipt lives in the local git directory, never version control. It names
the real successful run, commit, runtime/environment fingerprint, scope
and elapsed seconds. No receipt is imported or synthesized for older runs.

The hook captures clean status before checking and verifies it again
after success. Dirty or new untracked source disables both reuse and
recording. CI never uses the local cache. Every push still performs its
outgoing history/secret scan and holds the existing full-test lease.

Full covers any selection; related covers only contained related paths;
docs cannot cover full. Failed or interrupted work never writes a receipt.
A real tiny repository proves same-tree reuse across two commits, changed
tree and runtime misses, dirty refusal, scope limits and corrupt receipt
refusal. This CLI proof stays outside hook discovery under J186.

Publication is queued through port's v0.1.2 release window. A first actual
engine hook receipt and hit are still required before claiming CI19 done.
