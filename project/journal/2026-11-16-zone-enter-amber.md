# dedicated-zone-enter under its budget (main AMBER, buddy-engine)

- J295 AMBER: `test/dedicated-zone-enter.test.ts` (ZONE-ENTRY ZE9a-c)
  ran 103 s against its 60 s budget on main 04a3d3a5 (run
  43937600004).
- Where the time went, timed locally: per case, bench boot took 2 to
  3.5 s, and `toGate`'s walk took about 10 s. That walk is a sprint
  along the ~70 m of road from Driftwood's entryway into the next cell's
  buffer, and five of the six cases begin with it.
- The first case already walks the whole road and proves the gate on it:
  refused short of the buffer and into the home, then held at the gate.
  The other five test what happens after `enter` (arrive, ready,
  timeout, redial). So `toGate` keeps the real step off Driftwood onto
  the road, then places the walker on the road 4 m short of the cell's
  edge, and it runs into the buffer as before. No assertion changed.
- Locally at load 29: the five cases went from about 12 s to 3.5-8 s,
  and the file's test time from 79 s (load 4) to 40 s.
