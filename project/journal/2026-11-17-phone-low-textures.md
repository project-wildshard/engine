# 2026-11-17 — Pine Hollow's phone Low textures (EM29)

> Written by: Codex (lane codex-nalati)

Phone Low caps surface and weapon textures at 512 pixels. Pine's sky keeps
the original gain-map decode and samples the already-linear HDR pixels at
512 × 256. Its horizon uses a separate 1200-pixel limit, and the keyed
environment takes the existing smaller HDR tier. The colour-graded output
and the sun-ray targets are 8-bit. The scene input remains half-float
because drawing the sky into an 8-bit scene target clipped its gradient.

Far creature cards use 64-pixel tiles on phone Low. Disabled directional
and spot shadows use an empty 1-pixel map once control opens. A live
Low → High → Low switch restored the shadow map 1 → 1024 → 1 on Pine with
no WebGL errors.

On the same Pine Hollow product pin, phone Low WebGL texture bytes [L]
fell from 125,611,048 to 64,807,840 in three alternating cold pairs.
The nine fixed spawn cameras used the same midday and clear weather
settings. FP Back recovered the blue gradient and visible sea horizon.
The smaller panorama softens some distant detail. Targeted lint, the
layered typecheck and 27 relevant tests passed.

EM29 builds on EM26 (`8128f4f6`) and the existing ASTC 6×6 phone cook.
EM26 routed Nine's phone textures through the available KTX2 set and
reduced its ledger from 94.5 to 58.9 MB.
