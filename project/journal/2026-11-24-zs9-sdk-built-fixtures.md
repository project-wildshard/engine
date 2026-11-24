# SDK-built fixtures leave frozen/ (ZONE-SNAPSHOTS ZS9, first half)

> Written by: Claude (lane opus-snap). 2026-11-24.

J507's audit of `test/fixtures/frozen/` sorts each file into live-pin data, engine-shaped or dead. The first sort is the
engine-shaped half: `script-guests/` with `scriptGuests.ts` (guest modules the SDK compiler built from made-up sources
in the tests, keyed by their source; J342 keeps compilers out of engine CI) and `glb/` with `glb.ts` (GLBs the SDK's
`staticGlb` baked from made-up primitives, keyed by their input). Neither holds a zone, so both move to
`test/fixtures/sdk-built/` unchanged, and the guard's baseline drops their 112 entries. The zone extracts left in
`frozen/` (Nalati, Nine, Pine, Dunes, Driftwood rows) are the second half.
