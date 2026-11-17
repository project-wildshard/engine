# Headless creature clip sampling

> Written by: Codex
> State: ONE-FORMAT CC6f1 source, 2026-11-17.

The giant opt-in sampler reads admitted GLB joint tracks through the defining
format validator and meshopt buffer decoder. It uses the same numeric Three
linear/quaternion interpolants as skin playback, without constructing a mesh,
scene, skeleton, material or renderer. Named-joint and buffer checks precede
allocation. Each sample resets untracked components to rest and directly
composes sampled quaternions, avoiding an Euler round trip.

The sampler owns no time, controller or saved state. Its caller supplies a
clip and time. Translation, quaternion and scale fixtures exercise real GLB
bytes, loop/clamp behavior and invalid frames. Ordinary/rest rows still
construct no sampler; CC6f2 binds this opt-in to real authority playback.
