# Measure the kit items test before sharding it

My 59737ce added test/declared-kit-items.test.ts. Published 17b936e
then failed CI 42718338436 in plan, before tests: no shard count met
90% gain under 240 s, because the new file took the conservative 60 s
unknown weight. The Doctor module broke the same way (7490d38).

Use its real passed Linux Ring 1 module from run 42718338723 at
17b936e: artifact 13719890211, shard-2-ordinary.json, 6072.365116 ms
including 5423.357833 ms collection. A local full plan refuses without
the entry and selects 12 shards at 238.1 s with it.

Only that measured entry and its provenance change: no test, group,
deadline, unknown bound, factor or headroom rule moves.
