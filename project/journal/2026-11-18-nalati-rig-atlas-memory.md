# Retire decoded creature atlases after upload

> Written by: Codex
>
> **State:** measured 2026-11-18 for MEMORY-GATES MG11, J410.

On phone, the rigged hull loader retires the decoded bitmap backing an
embedded colour atlas after WebGL uploads it. Live hulls and card bakes
sample the same GPU texture. Baked coat adoption borrows the texture's
sampler settings and name. Separate maps and a colour source shared with
the normal map keep their original lifetime. The existing GPU-only
recovery path reloads the page after context loss.

Five alternating cold WebKit pairs used engine runtime `da2574b4` and
frozen Nalati r2, `77b77fcc2174`, on phone Low. The EM11 model was
`scripts/memory/phone-model.json` at `72e30a23`.

| Metric | Before, median MB | After, median MB |
| --- | ---: | ---: |
| Rig loader decoded bitmaps [L] | 9.44 | 0 |
| Rig loader GPU textures [L] | 14.68 | 14.68 |
| WebContent settled [K] | 953.76 | 918.90 |
| GPU process settled [K] | 613.62 | 592.30 |
| WebContent peak [K] | 1,291.96 | 1,217.35 |
| GPU process peak [K] | 806.86 | 774.16 |
| EM11 playing, central (highest upper) | 1,154 (1,268) | 1,113 (1,224) |
| EM11 loading, central (highest upper) | 1,555 (1,699) | 1,464 (1,607) |

The ledger confirms 9,437,184 bytes of decoded bitmap capacity retired in
all five pairs. The process readings include browser and allocator
effects. Audio was the measured loading peak. Both EM11 upper bounds
exceed their targets. All nine fixed spawn views retain the Phone Low
composition and matching draw and triangle counts. The board is in the
mini's plan-artifacts cache under
`memory-gates/j410-nalati-driftwood-round2-2026-11-18/`.

The lifetime and nearby renderer and hull suites passed 38 focused tests.
Game lint and full typecheck passed. The production session bundle was
4,357,421 raw bytes of a 4,400,000 cap.
