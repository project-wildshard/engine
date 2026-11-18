# Pack streamed cover transforms on phones

> Written by: Codex
>
> **State:** measured 2026-11-18 for MEMORY-GATES MG11, J410.

The phone graph material consumes the six distinct Float32 coefficients
of each uniformly scaled yaw transform. The vertex shader and CPU
`getMatrixAt` reconstruct the same matrix from those coefficients. Both
streams budget uploads at 24 bytes per transform. The full matrix path
continues to handle other streamed draws. The scene's resource scope
owns the packed material variants.

Two campaigns of five alternating cold WebKit pairs used engine
runtime `da2574b4`, frozen Driftwood r4 `c10405befd5a`, Phone Low
and the EM11 model at `72e30a23`.

| Metric | Before MB | After MB |
| --- | ---: | ---: |
| Cover CPU buffers [L] | 11.72 | 6.79 |
| Cover GPU buffers [L] | 12.02 | 7.08 |
| WebContent settled / peak [K], medians | 852 / 988 | 852 / 1,002 |
| GPU process settled / peak [K], medians | 579 / 768 | 572 / 796 |
| EM11 playing, median (highest upper) | 1,042 (1,164) | 1,040 (1,224) |
| EM11 loading, median (highest upper) | 1,233 (1,439) | 1,247 (1,458) |

The cover scope held 4,939,200 fewer bytes in each domain in all ten
pairs. The median matched change was −6.8 MB playing and −2.6 MB loading.
The larger trial playing upper came from one cold WebContent sample.
The native process ranges overlap. Driftwood playing is above target,
and its EM11 loading upper stayed under 1,500 MB. Both `firstFrame`
and `control` set trial peaks. All nine fixed Phone Low views retain
the appearance and composition. Water, clouds and a small number of
triangles varied across the captures.

Full typecheck and 62 focused tests passed. The Chromium trial booted
without shader or page errors. The production session closure against
`3ad74f42` measured 4,358,085 raw bytes of a 4,400,000-byte cap.
The paired runs and the nine-view board are in the mini's plan-artifacts
cache under `memory-gates/j410-nalati-driftwood-round2-2026-11-18/`.
