# Phone geometry residency at control

> Written by: Codex
>
> **State:** verified 2026-11-18 on the Mac mini. ENGINE-MEMORY EM27.

Cold production-pin boots on Chromium Metal and native Playwright WebKit
with the minimal inspector returned the same byte counts. Pine used rev 5
(`2afc6270`), and Nalati used rev 2 (`77b77fcc`). The comparison builds use
engine `b33ab4bb` with and without the three changes below. Runs held the
shared measurement lock.

| Pin | Scene at control, before → after (B) | Labelled geometry outside scene [L], before → after (B) | Combined at control, before → after (B) |
|---|---:|---:|---:|
| Pine Hollow | 42,716,125 → 28,450,162 | 6,841,076 → 158,244 | 49,557,201 → 28,608,406 |
| Nalati | 17,056,130 → 17,056,130 | 10,534,008 → 0 | 27,590,138 → 17,056,130 |

The scene census reads the backing stores of Three's attributes, indices,
morph channels, instance matrices and instance colours. It uses the
`array` data descriptor so enumerating a retired attribute cannot read
it back from the GPU. Stores shared by several attributes count once.
The audit joins each scene buffer to its RAM ledger kind by identity.
The `geometry-cpu` entries in these runs all belonged to the ground merge
and none shared a buffer with the scene census. The ledger's entries
sum to its scalar total. Two collections after five seconds of play
leave both candidate totals at their control readings.

- The boot's draw checkpoints retire the fixed batch's uploaded vertex
  and index arrays. The shader stand-in already shares its geometry.
  Three's native batch planner receives the index byte width for its
  multi-draw offsets. A CPU raycast can still restore the real bytes.
  Pine measured 31,861,714 scene bytes with this change alone.
- Phone herd pages allocate after the bearing cull finds a rig that needs
  one. The existing paced path can open one page per frame and draws a
  rig directly while the page is unavailable. Pine's empty page held
  3,411,552 bytes at control. Halving the page size instead raised the
  scene total to 32,302,786 bytes in the trial.
- The phone ground merge writes transformed vertex channels into the
  output. Unmasked native index arrays supply the merge directly.
  Pine's remaining 158,244 ledger bytes are filtered triangle lists.

On both browsers, tapping Pine at (137, 472) opened **Forest tree**.
Tapping Nalati at (105, 472) opened **Outcrop slab**. Live world collider
queries at spawn hit Pine's stone grid and Nalati's ground. The candidate
returned upward normals and a hit distance of 3.020 m on both zones.
Three.js returned changing, finite skinned vertices on the visible Pine rigs
and on Nalati's camp people. The matched spawn captures show the same
terrain, foliage and buildings. Every measured cold boot had zero page
errors and zero `getBufferSubData` calls above 32 KB before interaction.

Engine and game typechecks passed. The focused suite passed 39 tests,
including 16- and 32-bit batch offsets, picking after GPU retirement,
demand for a visible herd page, and ground output ownership and bounds.
The full production-pin build on `1ec827b8` stayed within the session cap
at 4,367,347 raw bytes. The covering Chromium boots reproduced the table
and passed the same interactions. Raw identity rows, captures and harness sources
are in the mini's `plan-artifacts/engine-memory/em27-geometry-2026-11-18`.
