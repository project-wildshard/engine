# Keep static scene positions packed on phones

> Written by: Codex
>
> **State:** measured on 2026-11-18. ENGINE-MEMORY EM28.

A bounded static scene part can carry its admitted GLB's normalized
Int16 positions from intake to upload. The mesh transform restores
the original grid scale and offset. Tile assignment reads the same
model-space values with Float32 rounding, without constructing a
Float32 position array. The home build cache stores the grid with
the packed positions.

CPU geometry consumers can still request an independent model-space
copy. Skinned and morphed geometry, segmented models, faced trees,
and materials that depend on the original object origin or model-space
positions keep the established path.

## Phone Low controls

Measurements used cold Chromium launches at a 402 × 874 phone
viewport with the same frozen products. Buffer charges came from
the live allocation ledger [L] at control. The Driftwood root-scene
position and index census used unique live backing stores [H].

| Zone and metric | Before, bytes | After, bytes |
|---|---:|---:|
| Driftwood Isle WebGL buffers [L] | 59,783,138 | 58,961,222 |
| Driftwood Isle live root-scene position and index stores [H] | 37,023,998 | 37,023,998 |
| Driftwood Isle whole-heap geometry backing stores [H] | 107,162,716 | 105,496,660 |
| Nine Dragon Stack WebGL buffers [L] | 124,331,906 | 124,331,906 |

Driftwood's shore boulder and small rock account for the full
821,916-byte WebGL reduction. Their draw path avoids creating
1,643,832 bytes of Float32 positions. The retired CPU position stores
were already absent from the baseline live-root census. Nine fixed
views at Driftwood's spawn matched with the same draw and triangle
counts. The captures differed in the animated sky and water. Both
final test boots reached control with zero page errors.

Nine's active owned scene inputs contain no normalized Int16 positions.
The current Paifang slabs use Float32 positions and account for
85.23 MB of WebGL buffers across two groups. ONE-FORMAT OF-EM28b3
and b4 cover slab grid intake and cook, with narrower indices and
channels in the adjacent rows. OF-EM28d covers the cooked-product
proof. Driftwood's whole-heap counts use the same backing-store
classifier as the original 122 MB census. The target is under 60 MB.
The live-root census above covers just positions and indices in
the active root scene.

Focused geometry, graph and scene tests passed 98/98. Full typecheck
passed. The production session closure measured 4,354,775 raw bytes
and 1,344,673 gzip bytes against caps of 4,400,000 and 1,361,500.
