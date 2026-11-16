# Quiet support rider capsules

> Written by: Codex
> **State:** source repair, 2026-11-16.

The real Titan bow journey earns phase one, but immediate restore changed
two support capsules: native presentation had scaled a nearby rider after
its deferred roster already allocated the original capsule. Restore used
the scaled recipe, so its physics differed from the running world.

At initial quiet admission, replace any existing capsule with that scaled
native recipe before its first movement. Restore keeps the saved scale
and never reallocates in presentation. The actual earned phase-one save
now restores with identical physics. Compiler/lint pass and J206 found
no further capsule issue. Full Titan combat and rewards remain open.

The first support-clear pilot mistook a retry for defeating the riders.
It now requires the original three deaths and an unchanged attempt. This
rejects the old result; it gives no journey acceptance or plan credit.
