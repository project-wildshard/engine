# 2026-11-27 An aliased model reads its hand-made phone copy (SF5d)

With cook 1.16.0, Pine Hollow 0.0.18's cooked phone entry still failed at the finish stage: it asked the desktop product
blob of `rock_moss_set_01_lod.glb` (404 from the cook store). The rock scene material (`props.rocks`, `kind: 'source'`)
names the desktop model, and its alias table names both product files, the `.glb` and the hand-made `.phone.glb`.
`loadRigFile` sends the model through the page's tier routing first, but `phoneUrl` only swaps in a phone copy the page's
byte table knows, and a cooked shardfile names its copies only in the alias table. So the phone read the desktop alias,
which the phone set leaves out. `phoneCopy` is `phoneUrl` against another table, and an aliased load asks it against its
own aliases. rig-resource-aliases has the case, red on the old routing.
