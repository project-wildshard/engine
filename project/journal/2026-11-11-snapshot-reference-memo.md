# A world's checkpoint re-encodes only what changed

> Written by: Claude (opus-testspeed-lane)

TEST-SPEED TS4a (J255/J256). A headless world checkpoints its native
world over and over. Between two Nalati walk checkpoints, a few stretches
of the 22 MB of Rapier bytes change: up to ~150 KB near the start and a
little at the end, and the stretch between them often moves by a few
hundred bytes. The reference encoder (`encodePhysicsReferences`, an LZ
pass with a 1 M-slot dictionary) still read all 22 MB every time, ~200 ms
on the Mac.

`snapshotReferenceMemo.ts` keeps each world's previous bytes, references
and matches. It finds the changed windows and the delta of each copied
stretch, re-encodes only through the windows, and reuses the previous
references elsewhere, after proving each reused decision is unchanged.
The proof is in the file's header comment. In short, the dictionary is a
function of the bytes alone. Outside the windows, only a hash that a
window had can find a different candidate, and only at its first
recurrence; those lookups and any match whose source reaches a window
are redone. A reused match keeps its length, and its distance is
patched by the stretches' delta difference. Anything else falls back to
the full encoder. The output is byte-identical:
`test/snapshot-reference-memo.test.ts` fuzzes chains of overwrites,
insertions, deletions and copies at the start, the end and in between
against the full encoder, and the 13 real walk checkpoints of
physics-nalati matched too. The world's packer (`ScopedPhysicsPacker`)
uses it; the stateless writers and basis encodings are unchanged.

Numbers (Mac):
- References of a Nalati walk checkpoint: ~215 → 76-140 ms (the
  first, after creation, falls back to the full encoder).
- A Nalati world saving every 120 ticks while walking (the worker's
  commit): 226-308 → 118-141 ms a save after the first three.
- vitest-bench, alone, two rounds: physics-nalati 18.2 / 18.9 → 16.3 /
  18.0 CPU-s; awareness 28.9 / 29.0 → 26.4 / 29.0; discovery-cave
  25.5 / 26.7 → 25.6 / 29.0 (noise: a review ran during round 2).
  The deflate of the shifted 64 KB blocks still runs every save, so the
  test files move less than the encoder does.

Review (J206): the returned encoding aliased the memo's storage, so a
caller writing to it could change a later result; the memo now keeps its
own compact copy (tested).
