# Ring 1 steps declared slices

- Shard-pin run 44689685887 (Nine Dragon r5) failed to record its Ring 1 digest: Nine is declared now, so `ring-step.ts`
  stepped it in the tick worker, whose admission wants the whole asset table, but Ring 1 holds Nine as a server slice
  (ENOENT on a prop GLB). A declared slice now steps as a room's data cell does (`openDataCell`): `createShardfileSim` on the
  server inputs and skin rigs. ring-step installs the portable Math first, as the cell and tick workers do; without it
  Brasscap's chain differs from the worker's, with it Brasscap's slice and Nine r5's slice both match their whole heads, and
  every current Ring 1 row is unchanged on darwin-arm64. Moving declared slugs to products instead would add Nine's 119 MB
  head (and later Driftwood's 97 and Pine's 314) to Ring 1. (opus-of21-drift3)
