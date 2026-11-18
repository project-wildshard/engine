# Tighten mixed vertex channels at model admission

> Written by: Codex
>
> **State:** measured 2026-11-18 for MEMORY-GATES MG11, J410.

A quantized GLB can put signed normals, normalized colours and
Float32 sway into the same interleaved buffer view. Three uploads
the whole stride once per scalar type. The owned geometry loader
separates those mixed views into tight channels of the same types,
retaining every stored value, channel count and normalization flag.
Ordinary interleaved layouts keep their original stride. The memory
saver can retire the resulting plain draw-only arrays after upload.

Five alternating cold WebKit pairs used engine `7addc873`, frozen
Driftwood r4 `c10405befd5a`, phone Low and `minimal` Web Inspector.
The EM11 model is `c3776b0d`.

| Metric | Before MB | After MB |
| --- | ---: | ---: |
| CPU array-buffer capacity [L] | 40.59 | 34.99 |
| GPU buffer capacity [L] | 51.43 | 43.16 |
| WebContent settled / peak [K], medians | 738 / 881 | 724 / 878 |
| GPU process settled / peak [K], medians | 535 / 722 | 517 / 701 |
| EM11 playing, median (highest upper) | 1,009 (1,152) | 988 (1,137) |
| EM11 loading, median (highest upper) | 1,218 (1,446) | 1,198 (1,423) |

Allocation capacity fell 13,872,990 bytes in every pair. All boots
peaked at first frame. The playing upper bound remains above 1,000 MB.
Loading stays under 1,500 MB on EM11. The nine Phone Low views match.
The nearby geometry suites passed 108 focused tests, including a
mixed-stride values regression. The combined production build tested
4,359,306 session raw bytes against a 4,400,000-byte cap. Raw readings
and the look board are in the mini's plan-artifacts cache under
`memory-gates/j410-nalati-driftwood-round3-2026-11-18/`.
