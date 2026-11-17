# Authored creature collision volumes

> Written by: Codex
> State: CC6b source, 2026-11-17.

ONE-FORMAT Q-CC18/20/41 replaces fixed head/body assumptions only for
explicit body layers. Skeleton defaults merge by part with authored
overrides, then compile against actual rest joints. Radius clamps after
all scale, to 0.3 metres. The segment reader moves the frozen rest rig
with the actor's root; it owns no clock, controller or random stream.

CreatureBodies creates query colliders from that read-only pose and
returns named parts and multipliers. Sleeping colliders keep their
cached pose. Existing dims/head/body/fore code retains its arithmetic,
cache, motor and lifetime. Rapier tests cover head, shield, tiny body,
root motion, sleep/wake, hide/death, exclusion and removal beside the
original 720-frame native direction/fore oracle.

Format admission is source cd8e484124, exact CI44146954551 green.
The first runtime check used a frozen candidate while npm processed
0.19.0. Registry checks and frozen install are required before commit;
the local candidate is never a committed dependency or a ship proof.

Registry 0.19.0 frozen install, full types/lint and 12 cases across
four real physics/Pine/Antler King files pass before this checkpoint.
The candidate dependency is absent from manifest and lock. Commit checks
passed in 9.7 seconds, beyond the eight-second wall cap. J381 permits
SKIP_BUDGET=1 for that clock only; all checks still run.
