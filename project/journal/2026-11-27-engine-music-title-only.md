# 2026-11-27 Every pin plays its own island and pine; the guard lands first

Meta standalone shardfiles SF23. Driftwood (r14), Pine Hollow (r19), Mossgate (r27) and Mirror Salt (r9, pinned
here) carry the island and pine recordings they play as their own slot set, so no engine pin names an engine music
slot but the title.

Guard: `test/engine-music-pins.test.ts` reads every installed pinned product (or its Ring 1 slice) and fails when one
names an engine music slot other than the title. On Mirror Salt r8 it named `mirror-salt r8: pine, island`, the case
it exists for. The paired-AAC preparation test pairs the engine title (stereo) with a made-up mono fixture, the title
downmixed (`test/fixtures/aac-pair/title-mono.m4a`, 144 KB), so it no longer leans on the engine island pair.

Not yet: the removal of the four piano island and pine files. It needs shard-format 0.82.9 (`ENGINE_MUSIC_SLOTS`
empty, tagged), whose npm publish the format corpus refuses while the staging and production release files still pin
Pine r18 and Driftwood r13 and production still places Mossgate r26 and Mirror Salt r7. The removal patch is kept in
meta beside the plan (`docs/plans/support/standalone-shardfiles/sf23-engine-removal.patch`).
