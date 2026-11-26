# Preview's zone table comes from staging's release

> Written by: Claude (opus-pvclient)

Fix preview PV2. Jake picked option (a): at deploy time preview takes staging's cook as its pack key, and the page is a static
client, so F5 never changes its zones. `src/scripts/page-release/zone-table.mjs build` reads staging's signed release and
placement file from releases.wildshard.io (R2 layout RL10), and writes one row per zone: slug, raw shard version (J524) and the
index key `shards/<slug>/<shardVersion>/cooks/<cookVersion>/<cookHash>/index.json`, spelled by codex-cookkeys'
`cookedPackPaths.ts`. `page-release.mjs preview --zone-table=<file>` bakes it as `zone-table.json` and inline in index.html
beside the catalogue, so an offline reload has it too.

The skew check compares cook versions only. A different hash under the same version passes: PV1's guard proves the bytes the
same. Today's hash-as-key would have refused 29% of the week's hourly deploys; a hand-bumped version refuses only a real change.

The check phase GETs every zone's index and HEADs every object its `objects` map names, with preview's Origin; one miss refuses
before the alias moves. The signed release and the placement file gain optional `cook` and `shardVersion` fields; a file from
before PV2 names none and the table refuses it by name, so preview keeps its last build rather than guessing.
