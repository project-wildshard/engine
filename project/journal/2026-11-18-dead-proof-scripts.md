# Dead proof scripts out (J422, meta FLOW-SIMPLE FS7, opus-flow)

The seven-day audit listed 24 proof scripts nothing runs: no package script, hook, workflow, test or other script names
them. Each was re-checked by name before it went (`git grep`, outside journal and docs). The seven older `cpu-*-proof`
scripts were replaced by `cpu-contract-proof.py` (FL5d); the push, cache and cohort proofs were one-off evidence for
gates J422 retires; `full-test-report.py` was read only by `full-test-log-proof.py`. 24 files, 1,781 lines. The proofs
stay in git history; their readings live in the meta plans that cite them.

Kept: `push-dependencies.mjs`, which the audit called orphaned, is read by `push-proof-cache.mjs` and two tests.
