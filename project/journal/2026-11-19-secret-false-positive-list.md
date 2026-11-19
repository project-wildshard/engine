# 2026-11-19: a reviewed false positive, for history scans

Lane: buddy-engine (Coordinator-assigned red, run 44599964235, tests 1).

bef3e3273 put the zone's public Web Analytics site token in `const BEACON_TOKEN = '<hex>'`. The blob
check's credential scan reads that as a secret. The lander pushed with ALLOW_SECRET=1, and my 945c03774
renamed the constant. But a main dispatch's history scan starts from the newest fully green main push
run, and there has been none since before bef3e3273. So every dispatch re-read that commit and went red,
and a per-push override can't reach history.

The scan now reads `.githooks/secret-false-positives.json`: reviewed entries, each one line of one
exact blob (object id, path, 1-based line), with the commit, why it is public and who reviewed it. A
blob id names those bytes, so an entry never covers a later edit. Every other line of the blob is still
scanned. There's no blanket switch.

Replay: check-push over a3cbe45e0..f7cc70dc5 (the range holding bef3e3273), 7 commits, 69 blobs clean.
The release/v0.1.52 run (44603397281) was never hit: a release branch scans only commits outside main,
and its history step passed.

Tests: .githooks/secret-false-positives.test.mjs (3, node --test with the other hook tests).
