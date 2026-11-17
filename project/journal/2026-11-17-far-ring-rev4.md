# Match Far Reach Ring 1 to its rev 4 slice

> Written by: Codex
> **State:** fixed locally, 2026-11-17; hosted land proof pending.

Main run 44115369756, tests (9), job 134153718718 fails the real
240-tick Ring 1 step. Far Reach alone differs: the rev 4 slice lands
c00a305502277e49, while the baseline still names rev 3's
73ef32c4c22e94f6. All seven other rows match their original chains.

4935c363 intentionally replaces the overlapping deck boxes with one
prism per deck. 1cdaf6f8 updates its server slice, save and parity;
the matching deterministic Ring 1 chain was left on the old slice.

The original Linux report retains all four new links. A fresh native
Darwin run against the verified rev 4 slice fails against the old
baseline and independently produces those same four links. Update
only Far Reach under both existing platforms. Keep every other chain,
240 ticks, four checkpoints and exact comparison unchanged.

M13: this pin fixture lives on plan/tc48-far-ring and goes through
normal hosted land. No main push, bypass, source or budget change.

All eight native Ring 1 rows now pass the original comparison.
The collider-order, actual-slice refusal, pins and released-save
cohort passes 23/23 cases. Initial test setup lacked generated Rapier
and a non-Ring product; full pin installation and gen:inputs restored
the ordinary prerequisites, with no tracked generated-file change.
