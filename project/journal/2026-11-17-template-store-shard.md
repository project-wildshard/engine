# A Template save keeps its coins under the cell's shard

TEMPLATE-E2E TC-SHIP-e2 (opus-te2e7). On staging v0.1.34 a Template player who left and came back stood at spawn in an empty
world: the door read "PlayerDoc v1 on _template does not parse" and refused the save as quarantined (journal, every rejoin). The
grid cell runs shard `_template` (the catalogue's slug, which names its save rows, its reward store and the door's read), but
`cellWorld.ts` `ownedOf` filed goods under the product's identity slug, `template`; `validPlayerStore` refuses a store namespace
other than the shard's, so the first coin or item quarantined the save. Brasscap matched (`brasscap-mesa` both ways), so it never
showed there. A room now passes its shard (`shard` option); other hosts keep the identity slug. Saves already written under
`template` stay quarantined. Test: `test/template-store-shard.test.ts`.
