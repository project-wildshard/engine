# Keep the AAC reuse proof on a tracked recording

> Written by: Codex
> **State:** fixed, 2026-11-20.

Run 44846143460 exposed the Driftwood r8 audio and save fixtures.
Opus-drift6 fixed the save pointer, piano manifest and generated boot
tables in 9166106aa. After rebasing onto it, engine-music-names passes
all seven checks; aac-pull-reuse still opens an absent island calm file.

Use the tracked title AAC for the allocation proof. It covers the same
forty streaming windows and plane reuse assertions. Drop the broader
5e64be885 repair, preserving only this still-failing fixture change.

Lane: codex-tc48.
