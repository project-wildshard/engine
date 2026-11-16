# Titan boundary correction

> Written by: Codex
> State: implemented, 2026-11-16.

The earned Titan tick 13682 exposed a post-motor boundary clamp that
changed only X/Z. Its 2.56 m correction entered rising terrain while
keeping the old height, burying the capsule and blocking every later
move. The ordinary walk's motor result was sound.

Both encounter callers now lend their current player motor to the
shared boundary answer. Its correction runs through native collision,
so slopes lift it and solid walls block it. Unchanged answers do not
run an extra move. Disabled mounted capsules keep their existing law.

The exact earned input now stays above terrain; the resulting whole
save restores immediately and for five identical command/effect
batches. A native slope/wall regression and two related continuation
files pass all 11 cases. Focused game lint passes. Shared-tree typecheck
was blocked only by another lane's unfinished main-watch Io change;
the clean-copy push gate validates the committed tree.

The full clean push gate found two stale tests from af0adf3f and an
old boundary identity control that assumed exact X/Z assignment. The
control now asserts the requested motor delta and exact side-effect
order; the native slope/wall test owns collision results. The statue
restore helper now prepares chapters before restore, as openWorld does.
The armed-room digest now includes the King's new native contact pose
and complete view continuation; its unarmed wire/body oracle is intact.

FIXFWD publication for main run 43969009665: the clean recovery gate
passes the Nalati controls (176 of 177 files, 815 cases), but fails
mmo-release-observer's unrelated "Missing durable loss control".
J381 SKIP_CHECK=1 publishes the prepared fix after this normal gate;
record the escape and the failure in the receipt. The forward fixer
owns that observer red. No Nalati assertion or budget is weakened.
