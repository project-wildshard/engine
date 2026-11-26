# The local QA rig takes a free port block per run (opus-port130, meta QA 11-25 row 130)

- v0.1.96's train held at local QA with `EADDRINUSE 127.0.0.1:19479`: opus-rel86's row 123 control rig held the same
  fixed block, since `staging-qa-local.mjs` defaulted `WS_RIG_PORTS` to 19476. Any two lanes running the rig collided.
- Port 0 alone can't do it: the page build is stamped with the release URL before the rig opens, and a `pglite:` rig
  needs named ports. So `src/scripts/rig-ports.mjs` locks a block of four from a pool (19476 to 19571) under
  `~/.cache/wildshard/rig-ports/<base>.lock`, probes all four ports free, and frees the lock at close or process exit.
  A lock whose process is gone is taken over; a block an older cut's fixed rig holds is passed over.
- An explicit `WS_RIG_PORTS` is used as given. `importRigAt` loads a fresh `online-rig.mjs` per block, one at a time,
  since the module reads the port while it evaluates.
- seat-hold and enter-mmo-seat proofs drop their fixed blocks for the same pool.
- `src/test/rig-ports.test.mjs` opens two QA-shaped rigs (PGlite, named ports) at once and checks both serve.
