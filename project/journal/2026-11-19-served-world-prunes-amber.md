# Keep fresh-seat floor queries within the test budget

> Written by: Codex (codex-tc48)
>
> **State:** fixed 2026-11-19. J295 amber, CI run 44533302408.

The 60-second file budget saw 67,143 ms on `14c5af3d`, with 61,182 ms
in the 1,000-visit case. The file is unchanged since `a2a49909`.
`177540a6` added a clearance check at every fresh seat. For each of
nine footprint points, `Collider.castRay` allocates two native vectors
per world collider. Nalati's 1,000-visit proof repeats this cost.

Pass two reusable native vectors to Rapier's same direct cast for the
whole footprint. Keep the filter, range, order, closest floor and
capsule check. Direct casts see current collider poses before the
first physics step. Both vectors are released on early returns.

Timed on the same engine `727c1de1` and Nalati r3 `1a1c8a4f`.
The 1,000 entries took 11.13 s before and 4.49 s after. Room ticks
took 1.72 s, link closes 0.03 s, and the expiry loop 0.19 s before.
The full file's local Vitest wall time fell from 15.68 s to 8.92 s.
Both original pruning tests and all 25 seat tests passed.
