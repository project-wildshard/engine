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

The long soak waits for the release lane's all-slot tag gate to finish.
It will claim two slots through the repository's actual CPU admission,
then run the same immutable server and pack in the constrained Linux
container for at least thirty minutes. This is a VPS-like resource
envelope on Apple hardware, not an actual VPS or the separate E7.3e
eight-worker capacity bench. No VPS, deployment or signing secret is used.
