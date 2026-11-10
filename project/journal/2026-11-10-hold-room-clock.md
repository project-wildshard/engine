# VITEST-BENCH VB5: the hold proofs skip their idle seconds

Jake, 2026-11-10: "use the raw intelligence to redesign and rewrite the
tests to not be so retarded long". Plan: meta `docs/plans/VITEST-BENCH-PLAN.md`,
row VB5. `dedicated-hold-expiry` was the longest file in the suite (41 s
alone) and `dedicated-hold` took 20 s; both spent almost all of it in
`setTimeout`, waiting out J114's 30 s hold on the wall clock.

The room reads its hold and checkpoint times from `options.now`. The cell
host now takes a proof's `roomNow` override, beside the existing `holdMs`
and `emptyMs` ones, and the hold bench gives the room a clock it can move
forward. Everything else stays real: the TCP proxy pulls a real cable, the
socket still dies after 3 s of real silence, the room still ticks at its
real rate, and the hold is the product's own `HOLD_MS` (asserted to be
30 s), not a shortened one.

The 40 s branch moves the room clock to 28 s after the pull, waits for two
hold checks and asserts the seat is still held, then lets real time run
until the seat is freed: between 29 and 31.5 s of room time, as before.
Mutants prove it still bites: dropping the silence credit (a 33 s hold)
fails the upper bound, and a 27 s hold fails the "still held at 28 s"
check. The 20 s branch moves the clock to 20 s and asserts the seat is
still held before the same return. Both files together now run in about
8 s instead of about 60 s, and their timeouts drop from 150 s to 60 s.
