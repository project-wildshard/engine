# A red rerun still holds the tag

The source and pin checks were necessary but not sufficient for J167.
An old green artifact can belong to the same commit as a later red run.
Presenting that old artifact must not permit a new tag.
The latest completed nightly is the release decision.

The optional promotion helper now reads that run from public Actions.
It uses existing gh authentication, not a new secret or app.
The downloaded report must name that exact hosted run ID.
Its conclusion must be success and its commit must match HEAD.
Cancelled and red runs refuse promotion.
Missing history refuses promotion as well.

Offline validation runs before the public history read.
A known red or incomplete artifact never reaches a network or tag write.
The schedule itself retains read-only permissions.
It still does not cut tags or deploy production.
Promotion remains the tag owner under J184.

The explicit proof adds the later-red-on-same-SHA case.
It also checks cancellation, another commit and a local report.
Ten checks now run outside hooks in about three seconds.
No new test is added to Vitest discovery or push gates.
The existing normal full push hook remains required for publication.

The local stack remains held behind codex-port publication.
Its held grid fix is 47e26de at this boundary.
That is not claimed to be on origin main yet.
The nightly source is committed in the fresh ring-2 clone.
The clone is isolated from every active renderer lane.
No source, pin or generated file in another clone was edited.

Once the remote barrier is satisfied, rebase the whole local stack.
Run WS_FULL_SUITE=1 with the normal pre-push and SSH keepalives.
Only then publish the nightly to the default branch.
