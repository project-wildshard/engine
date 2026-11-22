# Build-max C3: a land STOP names what failed

buddy-engine, 2026-11-21, for the Coordinator.

Today's land STOP receipts with no reason ("STOP main push of X
refused: " and nothing after) all came from repo-kit's land. That
covers shard-format's format-prune and compat-w2 stops and sharddev's
of-close ones, seven SHAs checked. Kit's `pushMain` runs the pre-push
with stderr inherited, so it shows live but is never kept. It then
builds the cause from git's stdout, which is empty when the hook
refuses. That half belongs to kit, so it is noted for kit rather than
changed here.

Engine's land already kept the hook's output (`gitTee`) and named the
RED check. Its half: a cause that names only the check ("vitest (split
full: 23 local) RED in 162.8 s") still sends the lane back to scroll
the gate. `failingDetail` now adds the first thing that failed inside
the check, with how many more: a NEW red test from the known-red list,
a TypeScript error, or a lint rule with its file and line. An empty
pick reads "no output" instead of nothing.
