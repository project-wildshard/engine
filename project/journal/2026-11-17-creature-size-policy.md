# Class stride, perception and cell weight

> Written by: Codex
> State: ONE-FORMAT CC46c source, 2026-11-17.

The defining format0.22.0 table is resolved once into the existing species
spec. AnimalSim applies class stride when its existing brain requests
forward/strafe motion. Saved desired/current speeds already represent
world speed, so restoring never multiplies them again. Free model scale
changes geometry only, independent of stride, aggro and cell weight.

Existing pursuit, skirmisher, guardian, grazer, diver and hunt detectors
apply class aggro to acquisition radii. Authored senses use the same
factor while retaining the original cone, sight test, awareness meter,
hearing rate and actual target. Ability contact, leash, controller,
clock and RNG ownership are unchanged. Native/medium defaults are1.
AnimalSim.cellWeight is the single resolved class weight for later CC47.

The existing level fingerprint already includes resolved species specs.
A change of class cannot restore an old controller even if free scale
cancels its geometry. An initial control exposed an unnecessary default
spec entry; medium now omits identity policy entirely, preserving native
fingerprints, adapter rosters and exact save bytes without a new adapter.
Actual default-host controls exercise large-wolf acquisition/movement at
free1/1.2, native hunt meters, five weights, exact restore, policy drift
and native identity. The matrix and types/lint logs are in
`tmp/codex-te2e/cc46c-*`; exact final qualification is recorded in meta.
