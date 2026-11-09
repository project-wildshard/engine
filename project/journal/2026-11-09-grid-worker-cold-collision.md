# Stop the worker proof baking unused client pages

FL18 is the next independent quarantine row. The 749 CI artifact gives the
road/reload case 39.337 seconds of the 69.660-second grid module. All six
assertions pass, but the complete module exceeds its unchanged 60-second cap.

The cold fixture asks the full seams CLI for worker collision. That CLI also
builds other grid modes and all compiled client page packs. The native worker
only reads the existing plain-grid strips.json and shapes.bin files.

Add an explicit --collision-only CLI mode and use it in that fixture. It runs
the same plain-grid assembly, edge readers, geometry and collision writer.
Its one false/false/false mode omits later modes and client-page encoding.
The default invocation still executes every original mode and client writer.
No Three.js implementation, geometry, layout, collision or world input changes.

The first prepared baseline passes the six original grid cases in 34.56 s.
The unchanged road/reload case takes 13.607 s locally. The first candidate
passes all six in 31.25 s, with that same case taking 10.153 s. These are local
paired observations on a shared Mac, not a guaranteed Linux saving.
A final six-case run passes in 31.56 s while overlapping a separately
admitted four-slot full-bake control; the road/reload case is 10.176 s.

The manual CLI proof is red on the original code: the worker-only request
still creates client page packs. The final candidate passes in 6.842 s.
Its cold collision mode takes 1,807.878 ms versus 4,949.551 ms for the full bake.
Both produce identical 22,238-byte strips.json and 4,577,040-byte shapes.bin.
Their SHA-256 values are b3d9e0f9f38ed59757b3b295e21828ea20a203592af00642cdeb53a0f5fbf192
and 58f0e702895f8124e0c40b889f9ca71d3b91a7f3b7334b1bb6e325d8eb46f8a8.

A separate complete-output comparison keeps all 21 normal default-bake files
byte-identical, 65,169,741 bytes in total, against the pre-change full bake.
All 28 captured product header identities remain unchanged. Each measured
process holds a real four-slot CPU grant; no unbacked CPU environment claim.

The manual proof is outside Vitest's test-file glob. It is Ring 2 because the
complete cold client-bake control can exceed ten seconds on the hosted runner.
It is not registered in a commit or push hook. The original six grid cases,
server clock, 16 ms command cadence, stable-wall criterion, routes, reloads,
native worlds, ownership checks and deadlines remain unchanged.

An earlier preparation attempt lacked the physics WASM in the isolated view;
all six failed before play. That attempt is excluded from timing evidence.
The existing unchanged WASM was copied into the view before the real baseline.
Typed lint uses the repository's pinned native-helper resolver and passes.
Strict root test-solution typecheck also passes with one Go worker.

J206 one-shot read-only review of 84701d9 returns five OK lines, no must-fix
or should-fix. The selected Claude quota report was 100 percent, so the
authorized Codex fallback reviewed it. Review file: engine-FL18-2245.md in
the session-keep reviews directory. The reviewer ran no tests or browser.

Local commit and review only through the v0.1.4 window. Hosted qualification
still needs ten real green file executions; no quarantine or deadline edit.
The separate 06:00 UTC J200 decision wake remains armed. Progress stays open.
