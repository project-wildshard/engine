# Pine Hollow's rain roof scan

> Written by: Codex
> **State:** built 2026-11-17 (MEMORY-GATES MG9).

Pine's 256 × 256 rain cover sampled 16 deck rows every boot. The
allocation profile attributed 153 MB of sampled allocation churn to
portable sine and cosine and the floor loop. Cache each footprint's
rotation and skip out-of-range tiles before checking its exact shape.
The original deck edge and cave polygon arithmetic still decides cover.

A Pine-product replay of the bounds check matched all 65,536 original
cover tests. The local Node scan took 53 ms before and 14 ms with
bounds alone. The test preserves rotated decks, inclusive edges and a
concave cave polygon. MG9 measures the renderer peak separately.
