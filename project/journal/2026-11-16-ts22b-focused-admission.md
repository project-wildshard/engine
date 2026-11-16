> Written by: Codex
> State: built, 2026-11-16.

Ordinary local focused Vitest files now acquire the same per-file CPU
admission as full gates. Hosted VM cohorts retain their existing policy.
A verified nested worker borrows its actual ancestor budget, watches for
loss and never requests a second grant. Insufficient inherited budgets
refuse; they cannot upgrade a parent. Teardown restores the previous
context. Brokers carry their canonical root, so private fixtures use
their own scheduler. Failed direct setup waits for its child to close.

The real focused counterexample waits behind an all-slots grant, resumes
and releases. Actual nested Vitest observes one ledger grant; a private
root stays separate, and a lost provider terminates borrowed work. Two
final integration controls pass (10.06 s), plus the prior nine focused
cases (10.72 s), lint and types. TS22c still owns app-build admission and
TS22d still owns original full-gate room measurement; no CPU-saving claim.
