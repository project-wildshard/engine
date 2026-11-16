> Written by: Codex
> State: J206 correction built, 2026-11-16.

The one branch review found a real FIFO deadlock: check:saves removes the
full-test flags while its command wrapper already holds one CPU slot.
Without verified parent context the local worker could queue behind an
exclusive request that cannot fit until that same wrapper releases.

Every admitted run now exports its actual ledger grant context. Nested
run commands spend only a verified inherited budget and stop on loss.
Nested Vitest configuration uses one worker so parallel files cannot each
spend the whole parent budget. Insufficient inherited budgets refuse.
The actual check:saves-shaped control queues exclusive work ahead of its
inner real Vitest worker; the inner worker completes with one active grant
and one pending exclusive request, which then resumes. Five actors drain.
The two proof groups keep each case's existing deadline with more headroom.
Original direct/broker regression proofs remain green. The same J206
review session confirms NO remaining MUST. Twenty changed cases pass,
then eight final worker/ancestor/group controls pass. Strict loss refusal
and the bounded 300 s acquisition remain explicit TS22 follow-ups.

Also narrowed telemetry relocation to probe runs and named a stale
recording lock's path in its refusal. The motion 60 s budget stays intact.

The normal related gate then exercised every suite and found 430 shared
setup failures: fixtures could restore an environment snapshot containing
the previous file's released own grant. Teardown also used a fixture's
global process stub. Use the real process, drain only this worker's held
grants, and unwrap only contexts that this worker actually published.
Unknown inherited evidence still refuses. A real three-file reused-worker
control fails on the old setup (one pass/two refusals), passes on the fix,
and refuses two forged contexts without logging them. All ledger grants
drain. The entire 681-file shared inventory now completes (680 pass, one
skip; 3,009 passed cases), plus four focused/ancestor controls. No deadline
or assertion changes. The broader normal land must still run again.

The same J206 reviewer confirms NO remaining MUST for the shared fix.
Split the ordinary and forged subprocess controls into separate cases so
each keeps its existing 20 s outer limit. File-start reconciliation does
not repair a mid-file environment restore; unknown contexts intentionally
refuse later shared files. A failed-collection then exclusive-file control
remains follow-up coverage for the defensive pre-file drain.
