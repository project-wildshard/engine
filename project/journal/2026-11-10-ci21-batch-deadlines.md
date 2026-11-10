# CI21 dates follow the enablers

Jake chose NJ4(a), recorded as J237: after Thursday 12 November at 13:00
Cancún, inherited CI21 tests get a dated extension per batch. Every test still
ports. One missed batch makes engine red. This changes CI21 only; flaky-test
quarantine and its extension rules are untouched.

The old real loader returned zero exclusions for all 323 pending files at
2026-11-13T18:00Z. The new schedule binds those exact files once to all 48
batches in committed meta map 878b7a8. Five batches are already empty; seven
nonempty batches have no prerequisite and 36 await CI21.H enablers.

The implementation uses a fixed 48-hour window after the later of the old
cutoff and the last required enabler landing. Ready batches are due Saturday
14 November at 13:00 Cancún. Waiting batches have no fabricated date: the first
actual landing receipt activates their date. First assignments, windows and
landing receipts are frozen by Git history, so removing a file, changing a
batch name or re-adding a receipt cannot restart the clock. Completed members
remain in the assignment ledger; only the active inventory shrinks.

An enabler closes with the exact trailer `CI21-Enabler: CI21-H2 <source SHA>`
(substitute its ID), naming its already-published engine integration source.
For work built in another repo, that integration journal must name the published
prerequisite and prove its public consumer boundary; an external source change
alone is not completed engine integration. Fetch origin/main, commit the closure
trailer, run `node scripts/lift-pending-schedule.mjs`, then commit its derived
receipt and dates in the same queued chain. The helper reads the published
source's actual SHA and committer date, not the later receipt's date. That stable
source remains valid when the queue rebases the closure and policy commits.
No agent-entered external SHA/date can activate a clock. The loader finds
markers independently of the receipt and refuses a missing receipt, including
on an empty-tree commit. Source ancestry on origin/main and introducing-history
checks freeze the first source and receipt. Owners must use this closure
contract when delivering H1-H5; no wall-clock estimate counts.

`node scripts/lift-pending-batches-proof.mjs` exercises the actual loader and
copied CLI in real Git history: separate batch expiry, last-of-two enablers,
immutable first landing, assignment and window refusal, remove/re-add and
rename refusal, and all files ported. This is a Ring 2 manual proof: the complete
version takes 10-12 seconds under shared load because it includes two actual
Git publications, cloned negative histories and cache protocol checks. It does
not run in pre-commit or pre-push. The earlier loader-only controls took 4.6s.
`node scripts/lift-pending-history-proof.mjs` retains the original registration
and one-J200-extension controls. `node scripts/lift-pending-proof.mjs` checks
real Vitest discovery before a batch date and a named startup failure at expiry.
No game, file, shard or hook budget changes; registration is never execution
qualification. Exact-tree proof reuse expires at the old cutoff, then at the
next pending dated batch. When every pending batch genuinely waits there is no
time-only expiry (`deadline: null`); a fresh green proof can still be saved.
Every proof read/write validates actual history, so an omitted integration
receipt invalidates reuse even if the marker commit leaves the tree unchanged.

The one-shot J206 review found both the all-waiting cache-write refusal and
unverified external/omitted receipts. The follow-up proof reproduces the cache
boundary through the public API, verifies same-tree marker invalidation, rejects
external-only receipts, and commits actual remove/re-add and Git rename controls.
Batch dependencies remain the union in the assigned port-map batch: 68 members
without an individual prerequisite share their batch's harness dependency.
They are still explicitly owned; no file is retired or called qualified.

A committed removal of the entire schedule previously fell back to the old
policy. The loader now refuses that transition while any inherited files
remain. The real Git proof exercises both the refusal and cleanup after the
last pending file has been ported.
