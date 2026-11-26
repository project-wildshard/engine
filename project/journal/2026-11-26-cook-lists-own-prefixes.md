# The cook lists only its own prefixes

> Written by: Claude (opus-cfaudit)

Meta's Cloudflare audit (QA 11-26 row 12) found `wildshard-packs` taking about 69,000 ListObjects a day. The cook
measured its 4 GB pack budget, swept unkept keys and kept its publish listing by listing the whole bucket. The bucket
holds 2.4 M objects, almost all of them page content sets under `content/`, so one listing was about 2,400 Class A calls
and 10 or more minutes (the 963 s and 616 s readings in FR-A21's comments). The cook's own keys are about 10,000 objects
under `index/`, `loose/` and `assets/`.

Row CF4 adds `COOK_PREFIXES` and `listCookStore()`: every cook listing (storeUsage, the sweep, the kept publish listing)
lists those three prefixes one by one. Nothing the cook measures or deletes lives elsewhere: `cookStoreKey` and
`cookOutputKey` already confined it. `test/cook-list-prefixes.test.ts` checks that usage, collection and the protected
collection never list the root or `content/`, and that the worker's source never lists `''`. The listing tests that held
the root listing now hold the first prefix. The box's cook takes this on its next move.
