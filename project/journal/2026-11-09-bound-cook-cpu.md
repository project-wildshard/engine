# Carry the admitted CPU grant into the real cook

State: local forward fix, 2026-11-09.
Owner: codex-pinefix2; FL10 and the HS producer handoff.

The shared CI scheduler can admit four slots for a cook.
That admission did not bound the production producer.
runJob deliberately passed a sanitized child environment.
It dropped WS_CPU_SLOTS together with all other parent variables.
The q11 encoder then selected availableParallelism minus two lanes.
Its encode API could also start more workers than its lanes advertised.

Reproduction used a fresh pinned clone, not the shared local aliases.
The actual permission-limited child received a four-slot parent grant.
Eight concurrent real encodes produced eight actual Worker reports.
The child reported no CPU grant, although all bytes decoded correctly.
This is a resource contract failure, not a fabricated slow test.
An earlier canonical probe stopped at J196's known external-link fence.
That result was discarded as CPU evidence; no permission was relaxed.

runJob now takes the smaller scheduler grant and trusted host limit.
It forwards only that numeric value as COOK_CPU_SLOTS.
The rest of its credential-free environment remains an allowlist.
Invalid or non-positive grants refuse before any child starts.
The shardfile never supplies this trusted host value.
The encoder reserves one slot for its coordinating thread.
A grant of four allows three concurrent encoder Workers.
The pool queues additional callers instead of creating extra Workers.
An absent grant keeps the existing machine-wide default.

Three quick outer-edge cases use actual child processes and q11 Workers.
They cover the four-slot grant, a stricter two-slot host and no grant.
All eight returned bodies must match native q11 bytes exactly.
They also retain bounded decompression and original SHA-256 checks.
The original 23 cook-worker cases pass with WS_CPU_SLOTS=4.
That loaded pinned run took 53.74 seconds, with no failed or skipped case.
Cold/warm publication, hostile data and OS boundaries remain intact.
No case deadline, asset, compression quality or gameplay proof changed.

This does not claim a reliable whole-file speed improvement.
Hosted ten-run qualification and quarantine removal remain open.
Mock owns the scheduler and its actual admitted-grant injection.
Cook stays exclusive until this producer commit and proof are handed over.
Normal hooks and immutable publication remain required.
