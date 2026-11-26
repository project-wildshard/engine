# The transport client's startup is off the protocol clock; load harnesses go through cpu-load (opus-sim134, meta QA 11-25 rows 134 and 136)

- `test/sim-transport.test.ts` refused two push gates at load 31 to 113 and passed alone. The cause is the first exec of
  the binary the test has just compiled: macOS checks a new binary's code signature on its first run, and a machine
  busy compiling and running fresh binaries queues that check. Measured here: 0.16 s idle, about 1.5 s with nine
  compile-and-run loops (load 40). Pure busy-loop load (load 280) left it at 0.17 s, which is why burners never
  reproduced it. `subprocess.run(..., timeout=2)` covered that startup as well as the client's protocol work.
- `run_transport_client` in `test_sim_lane.py` waits for the client's own `started` record (it prints it before its
  one-second TCP deadline starts) and bounds only what follows. A new case proves it deterministically: a client that
  starts after 0.6 s passes a 0.3 s bound, and one that stalls after starting still times out.
- Row 136 (J505 for the burner storm that took the MacBook's load to 285): `src/scripts/cpu-load.mjs` is the one way to
  load the machine on purpose. It holds `cpu-load.lock` (one harness at a time), caps burners at nproc/2 and 60 s in
  code, refuses when load15 is already over nproc, gives each burner its own end time, and stops them when the command
  it wraps ends. `--kind exec` makes the compile-and-run load that reproduces row 134. Shards don't need it, so the kit
  doesn't carry it.
