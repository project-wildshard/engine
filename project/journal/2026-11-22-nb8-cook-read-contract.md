# NB8: the cook writer and the title reader agree on paths

> Written by: Claude (opus-pine2), 2026-11-22

SHARD-COMPAT NB8 asks that a path move ship its reader first: the
`4de1e703e` move (a stored cook's shardfiles under `loose/<upload>/`) must
go red before main. It went red only in CI's post-main `boundaries` job,
the cold cook-to-play in a browser, because no node test joined the
writer to the reader.

`test/cook-read-contract.test.ts` cooks Dunes with the real cook worker,
bakes the title row with the real `addCookedShards` the way
`addStoredShards` does (manifests, the discovery document from the upload
folder, `home.loose` from the index), and checks every URL the row names
(shardfile, discovery, thumb) is a key the cook published and the store
holds. With the reader's `loose` read put back to the pre-fix `''` the
test fails; restored, it passes (35 s). It imports both `cookWorker.ts`
and `catalogue.ts`, so the push gate's `vitest related` runs it for a
change on either side.
