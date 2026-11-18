# Keep baked ground-cover colours packed

> Written by: Codex
>
> **State:** measured 2026-11-18 for MEMORY-GATES MG11, J410.

The ground-cover draw keeps the authored ground RGB and cover RGBA
as normalized byte attributes. The cell cache holds placement, tint,
normal and side values. Fill reads the seven colour bytes directly
from their existing baked positions. The shader receives the same
normalized values. Both near and far streams budget uploads using
the actual byte width of each channel.

Five alternating cold WebKit pairs used engine runtime `08f3d688`
and frozen Driftwood r4, `c10405befd5a`, on phone Low. Settled process
samples followed two forced collections, idle and five reads. The
phone projections use the same EM11 model at `72e30a23`.

| Metric | Before, median MB | After, median MB |
| --- | ---: | ---: |
| Ground-cover CPU buffers [L] | 14.318 | 11.725 |
| Ground-cover WebGL buffers [L] | 14.792 | 12.021 |
| WebContent settled [K] | 844.22 | 834.52 |
| GPU process settled [K] | 594.30 | 605.96 |
| WebContent peak [K] | 990.46 | 965.64 |
| GPU process peak [K] | 805.26 | 761.45 |
| EM11 phone playing, central (upper) | 1,038 (1,156) | 1,033 (1,164) |
| EM11 phone loading, central (upper) | 1,229 (1,426) | 1,208 (1,388) |

The ground-cover totals include buffers with that name in the ledger
owner or asset. The exact capacity saving was 5.364 MB across CPU and
GPU. The process ranges overlap. Playing is still above its target and
loading continues to qualify. Nine fixed views at the spawn matched
the ground cover and draw and triangle counts. Water and clouds moved.

The mixed byte and float upload regression and the scene assembly
suite passed 11/11. Game lint and full typecheck passed. The combined
production tree measured 4,355,782 session raw bytes against 4,400,000.
