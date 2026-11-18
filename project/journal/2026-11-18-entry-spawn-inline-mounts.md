# entry-spawn mock adopts inline mounts

Lane mini-mg8 (J249 fix forward). 0af7ccd8 (mini-pinemem5, SA43) made `entry.ts` call
`assetTables.adoptInlineMounts` for an inline author shard; `entry-spawn.test.ts`'s
mock lacked it, so main ci 44334549232 went red in tests (8). The mock now returns 0.
