# Nine's Ring 1 step digest follows its revision 2 (main red, buddy-engine)

- Main's tests (6), on d3cead51 and again on 5f230b07: `ring1: step
  RED`, `nine-dragon-stack ... a5df2019b0e17117 DIFFERS from
  9643c67b16a90de3`. The ci21 ENOENT fix in the same job passed; this is
  a separate gate.
- Cause: `e02a5a29` pinned Nine revision 2 (NB16's cellGround fix,
  NB8's phone cuts), and `aeac5b55` re-cut its slice, but no one
  re-recorded `test/pins/ring-digests.json`. The new chain differs from
  its first link at tick 60, which is what a new world looks like, not
  a late drift.
- This Mac steps Nine to the same `a5df2019b0e17117` CI's Linux runner
  printed. `ring-step.ts --only nine-dragon-stack --update` recorded
  darwin-arm64, and the same chain went into linux-x64, which had held
  the same value as Darwin before. Pine and Driftwood still step
  `same`.
- `test/pins/` by mode 1 needs `ALLOW_PIN_PUSH=1` (J375): main is red
  for every lane and opus-ss16q and the SB34 land wait on it.
