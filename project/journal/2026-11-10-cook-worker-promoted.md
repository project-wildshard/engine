# Cook worker leaves quarantine

> Written by: Claude (opus-flaky)

After the split (d0de4e3), the quarantined `test/cook-worker.test.ts` (real
cold cook, recook, garbage collection, download cap: 3 cases) ran in ten
consecutive first-attempt main pushes and fresh dispatches, 42907130906
through 42913107468. Every run passed 3/3 cases with no skips or module
errors, and the full module took 25.7-38.5 s against the 60 s budget. Each
raw clock report was re-read for its sha, run, attempt and case names.

This removes its entry from `test/quarantine.json`; the other five keep
their records and first J200 extensions byte-for-byte. The planner weight
replaces the stale pre-split 138.97 s with the largest qualifying clock,
38.468 s (run 42910568715, artifact 13806623697), with its provenance row.
No case, cap, budget or planner rule changed.
