# Bind the defining quadruped joints

> Written by: Codex
> State: ONE-FORMAT CC8a1 source, 2026-11-17.

The existing QuadrupedRigPose now has an explicit canonical Kit opt-in.
All defining joints remain mandatory, while cosmetic ears and belly can
be absent. The ordinary native constructor remains strict and keeps its
existing scalar gait and breath continuation exactly.

Admitted Kit binds are unrotated and unit scale. The opt-in stores local
rest positions once and restores those locals before the native gait;
this prevents a previous authored position track leaking into idle.
Only that Kit path resets local rotation/scale. No controller, random
source, scheduler or additional clock is introduced.

Five direct binder/native controls cover every defining omission and
exact decorated transforms/breath after300frames. Actual loaded GLB,
skinned-vertex, track and pose-layer ordering controls belong to CC8a2.
The current combined native/view set and explicit types/lint logs are
under tmp/codex-te2e/cc8a-*. Engine hosted qualification remains the M2
batch gate. The20-body timing and graphical judgement are CC8b.
