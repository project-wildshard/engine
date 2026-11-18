# Release idle encounter HUD backing surfaces

> Written by: Codex
>
> **State:** measured 2026-11-18 for MEMORY-GATES MG11, J410.

WebKit's layer tree showed full-size composited backings for the
idle boss, elite and stealth overlays. Each backing reports 12.65 MB
at 402 × 874 and device scale 3. Idle overlay pieces now hide after
their opacity fades. Showing a piece makes it visible immediately,
so the authored fade-in and custom boss door duration still run.

Five cold alternating pairs per zone used the same engine runtime
`ada81564`, Nalati r2 `77b77fcc2174` and Driftwood r4 `c10405befd5a`.
WebKit [K] ran at Phone Low in Inspector minimal mode, with Network
and Console off. EM11 uses the `c3776b0d` refit.

| Zone | GPU IOSurface [K] MB | GPU settled / peak [K] MB | Playing EM11 MB, median (highest upper) | Loading EM11 MB, median (highest upper) |
| --- | ---: | ---: | ---: | ---: |
| Nalati base | 108.79 | 525 / 704 | 1,073 (1,205) | 1,482 (1,658) |
| Nalati trial | 56.44 | 472 / 648 | 1,046 (1,156) | 1,435 (1,582) |
| Driftwood base | 77.99 | 538 / 729 | 1,009 (1,157) | 1,220 (1,443) |
| Driftwood trial | 63.78 | 525 / 715 | 1,000 (1,141) | 1,248 (1,440) |

The settled GPU median fell 52.23 MB in Nalati and 13.06 MB in
Driftwood. Separate layer census runs accounted for four Nalati
backings and one Driftwood backing. Both zones still had one live
game WebGL context with a 402 × 874 buffer, the same program count,
and the same WebGL ledger totals. Driftwood's loading ranges overlap.
Its EM11 loading upper stays under 1,500 MB. Both playing uppers
and Nalati's loading upper remain above target.

All nine fixed Phone Low views matched in each zone. A WebKit
activity check verified that the boss bar and custom 720 ms fade,
elite bar and stealth vignette show, stay visible while fading, and
hide at zero opacity. Full typecheck and 29 focused tests passed.
The production session bundle was 4,359,300 raw bytes of 4,400,000.
The paired readings, layer owner captures and boards are in the
mini's plan-artifacts cache under
`memory-gates/j410-nalati-driftwood-gpu-2026-11-18/`.
