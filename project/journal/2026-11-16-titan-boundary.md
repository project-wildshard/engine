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
