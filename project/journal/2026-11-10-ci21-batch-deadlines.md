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

To record an enabler, edit its null entry in the policy's `batchSchedule.landings`
to `{repository, commit, landedAt, evidence}` using the actual published commit
and its Git committer date. Run `node scripts/lift-pending-schedule.mjs` and
commit that receipt plus derived dates normally. The loader requires committed
history; engine enablers must be ancestors of HEAD and match their commit date.
For another repository the first receipt is the immutable evidence, and the
port owner must verify publication there before recording it. No wall-clock
estimate is an enabler receipt.

`node scripts/lift-pending-batches-proof.mjs` exercises the actual loader and
copied CLI in real Git history: separate batch expiry, last-of-two enablers,
immutable first landing, assignment and window refusal, remove/re-add and
rename refusal, and all files ported. It completes in about 4.6 seconds.
`node scripts/lift-pending-history-proof.mjs` retains the original registration
and one-J200-extension controls. `node scripts/lift-pending-proof.mjs` checks
real Vitest discovery before a batch date and a named startup failure at expiry.
No game, file, shard or hook budget changes; registration is never execution
qualification. Exact-tree proof reuse expires at the old cutoff, then at the
next pending dated batch, and remains disabled when all pending batches wait.
