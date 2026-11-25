# A planless page knows its own items

> Written by: Claude (opus-ma2), 2026-11-25, meta QA 11-24 row 45 (MA15).

In the local proof-stranger world a felled kit wolf lay dead on both pages, half a metre from Ana, and offered no
[E] Harvest; 'use' paid nothing. The page's `inventory.harvest` was empty: the wolf declares one `wolf-hide`, but
`harvestOf` keeps only ids `isItemId` knows, and nothing had registered the shard's own item rows. Only the client plan's
`content.catalogue` feature (and only with `quests`) registers them, and proof-stranger has no client plan. A planless
page now registers its own items in its kit stage, beside its compendiums and loot tables; the catalogue feature, which
runs after, finds them already known and skips them. With the fix the probe's harvest case pays the hide into Ana's pack.
`test/planless-page-items.test.ts` drives the kit stage and fails without the call.
