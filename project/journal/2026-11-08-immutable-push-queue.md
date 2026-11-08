# Commit and hand off an immutable push

The local queue captures a fresh main clone before returning. It copies
objects independently, verifies the requested commit/tree and uses only
tracked normal hooks. Later lane edits cannot enter that snapshot. The
source checkout is never rebased, cleaned, stashed or altered by a worker.

An enqueue flock assigns FIFO tickets; a per-remote worker flock drains
them serially. The worker installs the locked dependencies and pins, then
pulls/rebases only when main is an ancestor of the captured tip. A changed
tip or source, failing preparation/hook, or divergent remote fails the job
with a durable receipt. A later job may fix forward. No force or hook skip.

Workers use SSH keepalives and the full authorized normal hook. The
check-only mode runs that same hook and reports checked, never pushed;
it is suitable for the release publication hold. Managed snapshots are
removed after status is recorded; immutable SHA/tree and timing remain.

Before publication the normal hook runs and the worker verifies that its
source stayed exact. Git push still invokes the normal hook; engine's
same-tree cache reuses that proved result while retaining the outgoing
history scan. Other repositories may repeat their own gate until they
adopt that cache. A publication whose outcome is uncertain is named as
such, never silently reported as a harmless pre-push failure.

The outside-hook proof pushes two actual commits to a local bare remote
in order, leaves subsequent dirty lane bytes out, and proves a third
commit's failing normal hook cannot advance main. It also requires every
managed snapshot to be removed. No production push is part of the proof.

An optional full --commit selects an ancestor of source main, so a lane
can hand off its committed boundary after another lane advances main.
Capture first fetches that exact commit into its own temporary bare main,
then makes an independent clone. The proof now creates all three commits
before enqueueing their distinct ancestors and still observes exact FIFO
publication and normal-hook refusal. It never rewinds the shared checkout.
