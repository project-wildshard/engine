# Keep only the static bake colour channels in use

> Written by: Codex
>
> **State:** measured 2026-11-18 for MEMORY-GATES MG11, J410.

Nalati's phone contact map records caster height in the red channel.
R16F retains the same half-float range, mip chain and sampling as
RGBA16F. Phones without the renderable single-channel float extension
keep RGBA16F. The shadow pass keeps the same depth attachment and uses
an R8 colour attachment.

Five alternating cold WebKit pairs used engine `7addc873`, frozen
Nalati r2 `77b77fcc2174` and phone Low. The Web Inspector Network and
Console domains were off (`minimal`). The EM11 model is `c3776b0d`.

| Metric | Before MB | After MB |
| --- | ---: | ---: |
| Contact texture [L] | 11.18 | 2.80 |
| All GPU ledger capacity [L] | 122.22 | 110.69 |
| WebContent settled / peak [K], medians | 800 / 1,093 | 799 / 1,099 |
| GPU process settled / peak [K], medians | 535 / 697 | 523 / 689 |
| EM11 playing, median (highest upper) | 1,072 (1,208) | 1,065 (1,193) |
| EM11 loading, median (highest upper) | 1,451 (1,639) | 1,451 (1,619) |

GPU ledger savings were 11,534,334 bytes in every pair. Loading
peaked during audio or finish. Both upper bounds remain open.
Nine fixed Phone Low views and draw counts matched. The paired
readings and board are in the mini's plan-artifacts cache under
`memory-gates/j410-nalati-driftwood-round3-2026-11-18/`.
