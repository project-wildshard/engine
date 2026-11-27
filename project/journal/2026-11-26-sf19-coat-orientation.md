# SF17 follow-up: a creature coat stays unflipped

> Written by: Claude (opus-cookktx2), 2026-11-26

Nalati's look board (SF6f) showed every cooked coat upside down against
the hand-made one: the cook Y-flips standalone images, but a coat is its
rig's skin map, drawn with the rig map's glTF orientation (flipY false),
as the hand-made coat bake encoded it. flipsImage now leaves a
`.coat[.phone].<ext>` image unflipped; a test decodes the cooked KTX2
and checks its rows against the PNG.

Cook 1.9.0's record is hashed with engine's new format 0.82.2 pin
(codex-r2fmt's package.json and pnpm-lock.yaml commit), so it rides in
this push with it (573e9e48e): check:cook-record hashes the pin.
