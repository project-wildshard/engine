# Native gait beneath an actual canonical skin

> Written by: Codex
> State: ONE-FORMAT CC8a2 source, 2026-11-17.

body.skeleton already owns the Kit choice. skinSpeciesLook now selects
the existing native quadruped pose and applies actual GLB clips in the
original post-pose hook. It does not introduce a second look skeleton,
controller, random source or clock. Other skins retain their custom path.

The raw clipless reference is the exact Kit biped/quadruped generation
recipe's quadruped asset from SDK21111050. Two additional fixtures use
that same source with a real idle body track and an optional walk track
on the front shoulder. The latter has a0.4-radian rotation and0.1-metre
position override; both come from the ordinary SDK skinnedGlb exporter.
The actual loader/factory/view bones deform weighted mesh vertices at
three speeds while actor snapshots remain exact.

Real transition and layer controls exposed two ordering bugs. Canonical
bind reset removes previous position tracks before gait. The SkinDriver
fresh-base path then retains this frame's native gait beneath pose layers
instead of restoring the previous cached layer base. Custom skin restores
are unchanged. The added layer is charged through the defining decoded
cost helper, with no budget bypass.

The final32-case/9-file set includes the actual GLBs, skinned vertices,
individual binding omissions, native transforms/continuation/stride,
retained physics/net pose, dotted names and older skin parts/layers.
Full types/lint pass. Exact logs, including both red controls, are in
tmp/codex-te2e/cc8a-*. Hosted proof is the final M2 gate. CC8b owns gait/IK
qualification,20-body cost on a quiet machine and Needs Opus judgement.
