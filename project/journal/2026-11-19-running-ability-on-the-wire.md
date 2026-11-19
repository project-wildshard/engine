# 2026-11-19: a creature's running ability goes on its row (ONE-FORMAT CC11a2c)

> Written by: Claude (opus-of-m23)

A declared ability picks its own attack clip (the look's clip map `abilities`, or the ability's `clip`), but only the
server's `StrikeRunner` knew which ability ran, and a declared strike never sets the pose's attack scalar, so a page
drew no attack at all. Wire 1.4.0 adds `animal.ability` (the 1-based place in the species' `abilities`, 0 for none) and
`abilityT` (how far through). The server binds the species' strike ids with its ability playback, and a page resolves
the index through `abilityRows` and hands the body a running ability its skin driver already understands.

A row from an older room carries neither field, reads 0, and keeps the attack fallback. `net-running-ability.test.ts`
joins one page before a strike and one during it: both read the second declared ability and the same progress until
the strike ends, then 0. The wider row re-takes the room-bytes digests; wire-released moves to npm 1.3.0.
