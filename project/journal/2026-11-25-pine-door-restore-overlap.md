# The Pine door test boots its restored worker during the walk

QA 11-25 row 59, opus-fr13. `test/pine-door-continuation.test.ts` failed once in opus-rel86's land of `9120e7807` (split
full, 31 local) and passed alone.

- Why: the test starts two native workers one after the other, the original and then, after the walk and the door, the
  restored one. Idle, each boot takes about 3 s of a 9 s test; alone at load 33 the test took 29 s of its 30 s limit.
- The fix: a native proof worker (`src/test/game/headlessWorker.ts`) takes its snapshot as a promise. It imports its
  modules and admits the product while the caller makes the checkpoint; only its payload waits. The door test starts
  the restored worker beside the original and hands it the opened door's checkpoint. No retry, the same 30 s limit.
- Proof: 20 runs, 10 at once beside a 31-worker run of the 47 zone sim test files, all green, the slowest 8.0 s.
