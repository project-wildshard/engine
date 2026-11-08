# Share the managed pre-push CPU budget

CI15 scopes the push lease to its real checkout. Different checkouts may
share it; a legacy global full-suite owner still excludes every scoped
push through the same read/write flock barrier. Same-checkout pushes stay
exclusive and FIFO. Each owner retains an authenticated compatibility
view, so nested checks cannot borrow a sibling's token.

CPU admission reuses the existing machine scheduler lock and state. Each
static command and real test file reserves its configured cost before
running. FIFO keeps an exclusive performance proof from starving behind
small files. Node/DOM file admission precedes collection and test clocks;
normal cleanup completes before release. A dead owner closes its pipe,
and dead scheduler children are pruned. No test deadline is enlarged.

Ordinary files cost one slot, native files two. Room timing and the cook
file reserve the whole managed budget: their native children are not
falsely capped by an ignored environment setting. The total is physical
CPUs minus two, with a floor of one; test fixtures may only lower it.
Old app-build lanes retain their own policy; this implements fair sharing
between opted-in pre-push jobs, without claiming an OS thread quota.

The public CLI proof must demonstrate two actual repository owners,
capacity/ordering, cancellation and cleanup. A normal full hook remains
required, and publication stays queued through the v0.1.2 release.
