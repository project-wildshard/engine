# J201: the actual server beside Nalati's herd

The short headless proof uses the 16.67 ms simulation deadline. J201 asks
for a server-build soak with tick p95 at most 10 ms, beside a real herd.
It needs a separate reading, not a reinterpretation of the old proof.

`test/fixtures/dedicated/herdSoakEntry.ts` is a manual Ring 2 entry, outside
Vitest and all commit/push hooks. Compile it with the ordinary server
builder's `--entry herdSoak=test/fixtures/dedicated/herdSoakEntry.ts`.
The long run is necessary because a quick case cannot prove the requested
30-minute tick budget, or that the clients remain beside moving horses.

The entry starts the compiled main/cell worker against the complete
Nalati server pack. Its release is genuinely signed with an ephemeral
local key, epoch 1, and the save adapter is memory-only. Two real socket
clients walk from the normal spawn, using ordinary commands; there is no
teleport, reduced population, held controller, or changed herd program.
Each follows its nearest living horse, stopping at ten metres. A
one-second observation records both proximity and actual horse motion.
At least 80% of each client's samples must be within twenty metres.

The production worker supplies its ordinary ten-second p95/TPS/drop/RSS
readings. No synthetic tick timer or headless timing is substituted.
Every retained window must contain both players; the worst p95 must be
at most 10 ms and the backlog drop count must be zero. Another ten-second
interval covers the edge windows. No readings is a failure. The entry
drains its own server and clients on failure, and preserves a JSON result
and the exact server lines in the operator-provided scratch directory.

First Linux probe used production source `53c7779657c1756176787732dd76db51323f36e2`,
Node 24.21.0 bookworm-slim ARM64, restricted to CPU IDs 0,1, two CPUs and
2 GiB, with network disabled outside the container. Its image digest is
`sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20`.
The normal cook admitted all six server parts (9,228,067 bytes). Both
clients reached horses by walking. All 20 measured proximity samples
per client were within twenty metres (farthest 13.13/13.07 m); living
horses moved over one metre. The one complete worker window had p95
3.804375 ms, 59.9812 ticks/s, zero drops, and 435.44 MiB peak RSS.
This establishes the harness, not the thirty-minute result.

The strict short follow-up used full source
`214a484c489047bd8665687d46069d656c3123d1`: two complete windows, p95
3.509084 ms, 59.9875–59.9946 ticks/s, zero drops, 499.46 MiB RSS.
Both clients were near living moving horses in all 31 observations.

The subsequent long run used the actual global full-test lease and two
CPU slots, after port's tag-out, with the same immutable server and pack.
Its final result records 1810.62 seconds, 180 full worker windows, and
1808/1808 near observations per client. Farthest distances were
12.76/12.83 m; horses moved, both sockets remained connected, and neither
client dropped a frame. Worker p95 was 3.7414 ms mean and 5.4247 ms worst,
below J201's ten-millisecond threshold. Peak RSS was 525.82 MiB.

**The full soak is red:** it records 23 backlog-drop events, minimum
56.0254 ticks/s and maximum tick 123.5061 ms. Initial minute summaries
omitted cumulative drops, and this lane incorrectly reported zero from
current-window readings; those receipts are explicitly corrected. The
summary now prints cumulative drops and minimum rate. The zero-drop
assertion remains blocking, not removed to call the run green.

The outer wrapper returned timeout 124 at its default thirty-minute wall
limit. Inspection found the final result and server.drained file already
written at 20:39:50 UTC; the observation itself completed. Thus the early
receipt claiming no final result is superseded by the retained file.
Manual runs need a larger envelope for boot, approach, edge windows and
drain (`heavy-lane.py full-test --max 40 -- ...`). This changes no hook,
file or shard budget. The entry also bounds its own server drain at ten
seconds and fails rather than leaking a stopped proof's child.

The container recorded no CPU throttling, no memory-pressure or OOM
events. A late sixty-second worker Inspector profile (attached without a
debugger pause) records 52.326 seconds idle and 406.19 ms in GC. Its
longest contiguous sampled GC span was 17.53 ms; a separate 122.06 ms
sample gap does not identify a causal CPU hot spot. No production loop,
clock catch-up limit, herd, sample count or oracle is changed by guess.

`server-herd.yml` is a manual Ring 2 comparison on an isolated Linux
runner, with the exact same two-CPU/2-GiB image, full pack, 1800 seconds,
ten-millisecond p95 and zero-drop assertions. It builds server and pack
from the same committed SHA and retains failure artifacts. The job has a
45-minute envelope; it adds nothing to local hooks or automatic push CI.
The pinned OCI index explicitly contains Linux amd64 and arm64 variants.
Actionlint passes. A successful hosted result is not yet claimed.

This local Linux ARM64 envelope on Apple hardware is not an actual VPS
or the separate E7.3e eight-worker capacity bench. J201's p95 reading is
under budget, but the complete zero-drop soak and its hosted comparison
remain open. No VPS, deployment or signing secret is used.
