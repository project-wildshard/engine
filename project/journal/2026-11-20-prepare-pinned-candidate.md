# Preparing a new revision of an engine-pinned shard

> Written by: Claude (opus-sdk-pine2), 2026-11-20

Pine Hollow's OF23a staging publish (run 44678314602) failed "Prepare in phone WebKit": the recorder never entered.
On the b889e739 preparation client the page stopped at boot step admission.modules with StaleClientError ("This app
is older than the shard it is loading"). The client's verdict table pins `/shardfiles/pine-hollow/shard.json` to
r7's index (engine pin 7b246f041), and `wildshard prepare` serves its candidate at that same path, so every new Pine
candidate looked stale. Sky prepared fine on the same client only because Sky is not engine-pinned.

The fix: a page that owns its inline shard (DEVSERVER or preparation-only) takes the candidate's rows out of the
table before any descriptor read (`preparedCandidate.ts`), so the candidate is admitted by its own index as an
unlisted product is. Proved by removing Pine's row from the b889e739 client's page by hand: prepare gets past
admission.modules. It then stops at level.world on "Missing admitted material texture" (a deer normal map, tier
desktop): OF23a's species looks have variant tables, and the format refuses a phone skin beside one
(`skin-variants.ts` `phoneLook`), so that is a separate format, engine and SDK gap.
