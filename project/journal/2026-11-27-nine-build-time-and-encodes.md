# Nine's CI build gets time and the full-ledger encodes

Meta QA 11-26 row 31 (red, coordinator). `nine-ring1-build` had an 8 minute
limit, and its "Build full pinned Nine" step took 7 to 8 minutes, so five of
the last ten main runs were cancelled at the limit. Almost all of that step
was encoding 63 spawn parts cold (322 s), because the job restored no encode
cache.

The job limit is now 15 minutes. Before it builds, Nine restores CI's
content-addressed full ledger (the FS30 `full-ledger-key` action: the linux
key, its prefix, then `nightly-encodes-`). After a failed or timed-out build,
it saves a partial cache under a per-run key, as `memory-client-build` has done
since row 31. Each build step has its own limit inside its job (Nine 12 of 15
minutes, memory 26 of 30). A job-level timeout cancels the whole job, and the
partial save with it.

Guard: `test/land.test.ts` pins the two job limits, the step limits, and Nine's
restore and partial save, in order.
