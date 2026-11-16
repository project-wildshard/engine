# Restore the previous Titan heart pose

> Written by: Codex
> State: implemented, 2026-11-16.

The fresh ordinary-input Titan reward test exposed a first-suffix yaw
difference during its mounted intro. Immediate whole saves matched;
only player yaw differed after the first bow input. Both worlds read
the same input, then the intro eased the camera toward different hearts.

The server cloud body's transforms are derived from its saved pose and
clock. A restored body kept constructor transforms until its first draw,
but the intro reads the previous frame's heart before that draw. Rebuild
these derived matrices in the quiet restored-host callback. This runs no
guest step and emits no gameplay or ledger effects.

The exact earned failing input now matches its uninterrupted whole save.
A native world regression covers the heart before the first restored
frame, immediate whole state and five commands/effects. The shard's full
fresh reward test remains the ordinary-input acceptance.


An intro that has not drawn yet retains its constructor geometry; only
visible bodies rebuild their derived pose. Both the zero-frame and
five-frame native boundaries are covered. A fresh full reward run also
found the Titan's manual persistence write left BossBrain.rewardTaken
false after paying the orb. The last claimant now uses takeReward(),
the existing authoritative record path, without granting again.

J381 main-red deadlock: SKIP_CHECK=1 after focused cases and typecheck;
the coordinator authorized bypassing unrelated baseline gate failures.
