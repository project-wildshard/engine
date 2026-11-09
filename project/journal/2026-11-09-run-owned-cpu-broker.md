# One CPU broker per checked Vitest run

The full fallback on published 4f31a1d retains 1,179 files and 5,978 cases,
including the one pre-existing skip. Its normal hook passes in 217.8 seconds.
Ordinary work ends at 174.55 seconds, followed by the exclusive cook and room
performance proofs at 30.96 and 8.77 seconds. Three minutes remains a target,
not an excuse to remove those proofs or relax their clocks.

Every isolated Vitest fork currently starts its own Python CPU-admission child.
The local alternating forty-pair actual grant/release probe measures median
33.94 ms per fresh child versus 1.37 ms via a run-owned socket broker. This is
an admission-path measurement, not an attributed whole-hook saving. The separate
ancestry check remains unchanged and measures about 21 ms median in a loaded
probe; no authentication or isolation is removed to eliminate that cost.

The broker and original command owners call the same extracted FIFO policy.
They share the same scheduler root, capacity, queue, tickets and five-minute
admission deadline. Each file still obtains a fresh grant. A private ephemeral
localhost connection owns that grant, so normal teardown and killed isolated
forks release it through EOF. No fixed port or live-world object is shared.
The run owns the broker's control pipe; closing it drains all clients. Broker
loss fails the active runner and disconnects clients rather than falling back
to unadmitted execution. Fresh isolated forks, ten-worker push limit, native
weights, performance exclusivity and original case/file/shard budgets remain.

The outside-hook proof exercises actual broker/command capacity sharing, FIFO
exclusion, malformed requests, a killed client, broker loss and recovery with
no remaining grants. The original CPU-admission CLI still proves checkout and
legacy-global exclusion plus fail-fast descendant cleanup. Existing worker,
cache and Chromium keychain cases pass unchanged under the authenticated broker.
All Chromium launchers in the next capture include the committed keychain fix.

The shared checkout's layered compiler sees unrelated in-flight browser-proof
diagnostics. Only a clean committed capture and its normal hook can establish
the complete source verdict; neither those errors nor this component probe are
silently reported as a full green result. Cook remains exclusive until its
producer owner supplies the separately proved CPU-grant boundary.
