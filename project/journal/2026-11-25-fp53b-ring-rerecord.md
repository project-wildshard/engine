# FP53b's ring re-record

FP53b (`bd2db0ad9`) turned main red on Ring 1's step: Sunscar Dunes and Far Reach digests moved. The retired keeper's step
had registered a continuation (`far.flock`, `sunscar.homes`) that every snapshot carried, and the digest hashes the whole
snapshot. Stepping the pre-FP53b commit with only those two adapters dropped gives snapshots byte-identical to main at
all four links in both zones, so the keeper did nothing a player sees, and the two chains are re-recorded. My FP53b check
looked for recorded hashes in the zone repos and missed `test/pins/ring-digests.json`. The guard follows: the push gate steps Ring 1 when
sim-state code changes, not only when a pin or digest moves.
