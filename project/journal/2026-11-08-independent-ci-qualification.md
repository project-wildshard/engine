# Let real qualification dispatches execute

The coordinator asks for ten complete CI dispatches on main per fixed file.
They must be new runs, never reruns of a release commit.
The normal CI workflow now accepts workflow_dispatch.
All fifteen original files still run and report their actual failures.
The existing reporter now records complete module clocks in its artifacts.

The next bottleneck is the existing workflow concurrency group.
Every main push and dispatch shares ci-refs/heads/main.
GitHub permits one running and one pending workflow in that group.
Submitting another replaces the pending run, even without cancelling
the already running workflow.
Waiting avoids that cancellation but serializes every new source push
ahead of qualification and makes ten unchanged qualifications very slow.
Observed real runs 42506268393 and 42507055884 demonstrate that queue.
The driver has deliberately dispatched nothing while they occupy it.

Give each workflow_dispatch its own concurrency suffix using its run ID.
The workflow still runs on the exact main revision selected by GitHub.
Ordinary push and pull-request groups are byte-for-byte the same values.
Pull-request cancellation behavior is unchanged.
No job, matrix member, step, assertion or deadline is skipped or relaxed.
The complete incoming-history scan remains unchanged too.
No GitHub repository setting or runner setting changes.

The qualification driver will admit at most three complete dispatches.
This is three isolated hosted workflows, never three workers sharing
one test process or mutable physics world.
It records each run ID, attempt, source SHA and original case counts.
Only a fully green CI and that file's green <=60s module clock count.
Missing, skipped, failed or over-budget evidence resets that file.
Other quarantine failures remain visible and non-blocking as before.
No quarantine entry or extension changes with this scheduling patch.
