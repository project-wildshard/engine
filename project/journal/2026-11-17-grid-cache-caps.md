# Bound cache residency across grid crossings

> Written by: Codex
>
> **State:** measured on 2026-11-17. ENGINE-MEMORY EM32.

The byte limits and owners are in
`src/shared/engine/core/memoryBudget.ts`. The page evicts the least
recently used optional values by their charged bytes. Resident products,
colliders, and renderer objects keep their existing live leases. Product
transfers and verified disk copies keep their existing owners.

| Cache | Owner | Limit |
|---|---|---:|
| Verified section data | grid/section-cache | 2 MiB |
| Parsed grid indexes | grid/index-cache | 12 MiB |
| Parsed edge profiles | grid/edge-cache | 4 MiB |
| Verified quota fallback | boot/spawn-quota-cache | 32 MiB |
| Parsed spawn pack indexes | boot/spawn-index-cache | 8 MiB |
| Decoded baked images | engine/baked-image-cache | 48 MiB |
| Baked common bytes | engine/baked-common-cache | 8 MiB |
| Durable grid continuation | grid/continuations | 32 MiB + 16 KiB |
| Optional scene backing for revisits | platform | 16 MiB |

The index limits charge estimated heap bytes from the verified wire
sizes. The revisit pool debits unique backing stores and evicts idle
entries. A reader can finish using an oversized verified member
without adding it to the cache. The continuation store keeps its
existing transactional refusal.

Chromium heap snapshots [H] traced retired Driftwood buffers through the
full map's cancellation handle, a closed scope's tile driver and
completion card, and an island book held by its product. Those references
now retire with their owners. The island book remains shared while an
entered world or Explorer borrower holds it. Same-document entry also
releases the retired session's score and stops counting its drawing
buffer when the renderer is replaced.

## Crossing evidence

Fresh Chromium at 402 × 874, touch controls, phone tier and Low graphics.
The grid e2e walked or boosted across the real Driftwood Isle–Sunscar
Dunes border. It took the baseline after the first crossing and alternated
directions for ten further legs, with an 11-second hold and two Chromium GCs
before each ledger read. The browser's headless blank-frame guard
sometimes required its Keep Playing button. A sentinel confirmed the
same document throughout. Driftwood was pin `c10405befd5a` and Sunscar
was `f4a1d611cccc`.

| Build | First crossing [L] MB | After ten further crossings [L] MB | Change |
|---|---:|---:|---:|
| Map cleanup | 369.403 | 438.215 | +18.63% |
| Map, audio and renderer cleanup | 322.150 | 349.351 | +8.44% |
| Earlier full caps and tile cleanup | 330.951 | 350.286 | +5.84% |
| Final cache and scope cleanup | 323.085 | 337.463 | +4.45% |
| Final cleanup rechecked on engine 6b432a2a | 321.127 | 334.288 | +4.10% |

| Crossing | Cell | Ledger bytes | Allocator phone playing MB |
|---:|---|---:|---:|
| 1 | sunscar-dunes | 321,126,911 | 797.92 |
| 2 | driftwood-isle | 312,993,946 | 998.73 |
| 3 | sunscar-dunes | 333,863,617 | 797.92 |
| 4 | driftwood-isle | 314,691,222 | 998.73 |
| 5 | sunscar-dunes | 334,602,185 | 797.92 |
| 6 | driftwood-isle | 314,689,874 | 998.73 |
| 7 | sunscar-dunes | 389,854,817 | 797.92 |
| 8 | driftwood-isle | 312,579,228 | 998.73 |
| 9 | sunscar-dunes | 333,376,985 | 797.92 |
| 10 | driftwood-isle | 312,463,820 | 998.73 |
| 11 | sunscar-dunes | 334,288,093 | 797.92 |

The two final runs reached control on all 11 crossings in one
document with no page errors. The page and worker ledger [L]
measures allocations and capacity. The allocator reading is its
estimate for play on a phone.
