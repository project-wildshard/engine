# Plain perch continuation and original native control

> Written by: Codex
> State: OF26c3 built locally, 2026-11-17; hosted qualification follows M2 land.

Eleven real Rapier cases use the default data loader. Throw, drop, landing,
ground bite, return, climb and perched saves restore the entire native
snapshot and replay 150 identical player commands exactly, including RNG,
controller, body handles, actual health and projectile state. Restore draws
no RNG and spawns no native body. The original source JSON stays unchanged.
Hit audits retain once-per-attack stamps while permitting subsequent real
attacks; the health delta equals actual dispatched damage. Three real troop
death cases prove explicit group/catalogue scope and no alternate site.

An independent injected control uses the original native species context,
steering, strike observation and the installer's single PerchHunterBrain.
Both controls retain the same host body scheduler; the first draft's native
fixture accidentally enabled body bands, which removed/recreated motors.
The corrected control keeps the existing scheduler with bands:null and
asserts its identity. Both actual actors and player health match on every
one of 360 identical-input ticks; final RNG is identical too.

The comparison exposed two production differences before correction:
the default body lazily created its AI stream, and its hit point selected
the target instead of the original attacking body. Bind the declared attack
stream at setup without drawing, and retain the original native hit origin
and zero direction. The actual action owner's contact/reach tests still
admit the hit, with declared strike tags and real actor provenance. The
fixture explicitly declares the original native feel.blow/cover.checked
tags, so knockback is compared rather than silently omitted.

The existing native context now accepts the actual AnimalSim and only its
used hunt members. No view-only hidden/sampleTerrain member, roster spawn,
structural assertion, test stub or extra controller is needed. Native roster
callers retain the same runtime behavior. Local matrix, full types and game
lint pass; the exact red/green logs remain in tmp/codex-te2e. This source
proof does not claim hosted qualification before the later batch land.
