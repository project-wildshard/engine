# The staging observer builds a pre-lean baseline (opus-obs120, QA 11-25 row 120)

- Every staging train from v0.1.94 on noted only "The staging observer could not arm or read its baseline". v0.1.95's
  `mmo-observer.json` said `refused`, `client-prepare`, after 7.2 s; the observer's log went with the run's scratch.
- The observer builds its native client from the source of the build staging serves. That was v0.1.93, from before the
  lean layout (f928fdae2), whose builder is `scripts/build-server.mjs`; prepare ran `src/scripts/build-server.mjs` in
  it, so node exited 1 with MODULE_NOT_FOUND. v0.1.94 had a second cause, its tools running from `src/` (1542b3612).
- `observerBuilder` takes either layout. A refused client command now carries its build log's tail, and staging-deploy's
  note names the observer's reason and keeps `mmo.log` in the proof, so the next refusal says why at once.
- Local staging-shaped run (the observer fixture's room bench, durable baseline, the real prepare): baseline-playing for
  v0.1.93 and v0.1.95 sources; the old code refuses v0.1.93 with client-prepare.
