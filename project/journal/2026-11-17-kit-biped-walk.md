# Walk on a clipless Kit biped

> Written by: Codex
> State: verified locally, 2026-11-17.

SkinDriver binds a fallback only when the declared biped has every
defining joint. Both Animal views and entered cells use their existing
gait phase. The driver starts from the authored rest transforms and
plays the selected clip or swings the legs and arms. Explicit clip
collision continues to publish the authoritative joint frame through
the existing port.

The real clipless humanoid failed before the change because both thighs
stayed neutral. It now alternates and returns to bind on idle, with
actor continuation exact. The entered-cell path walks the same GLB.
The derived `kit-biped-walk.glb` adds a constant 0.42 rad rotation of
`thigh.L` to `kit-humanoid.glb`, with the geometry and inverse binds
retained. Its SHA-256 is
`3b981bc19d81a35406304cb553e8681e4d32b81297817721e8ef9380b4c93d4d`.
The clip overrides the procedural thighs and resets on idle. The
seven-file suite passed 64 cases, with types and game lint.
