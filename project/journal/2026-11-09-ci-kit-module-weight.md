# Keep the new kit module inside the measured plan

Required pull before the reviewed gate-fix push brings published17b936e
onto the clean publication view. Its new declared-kit-items test has no
duration, so the full planner again fails its unchanged 60 s unknown
bound and 240 s headroom rule. Actual current discovery reproduces NoN.
ExactCI42718338436 plan129505689621 fails before the blocking matrix;
Ring142718338723 passes. The source belongs to Opus split-kit items,
not to the three gate fixes or a test assertion failure.

Actual Ring1 artifact13719890211, shard-2-ordinary.json at17b936e,
reports the complete passed module6072.365116ms, including5423.357833ms
collection and all setup/environment, not just591.539543ms cases/hooks.
Both rings use only the same pinned _template product and Rapier bytes
with the identical Node environment; no catalogue iteration is present.

Add only that entry and provenance to both timing registries. Keep every
active file, all other unknown60s weights, factor1.35/setup70s, 90% gain,
240s headroom, file60s/shard300s and native groups. This mandatory existing
main-red forward accompanies the reviewed safety batch, not optional
source. No actual quarantine/lift policy or deadline changes. Full normal
publication and exact hosted CI/Ring1 are still required.
