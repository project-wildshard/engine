# Author proofs count a data shard's pay (meta MU6)

The mini's NE6 tape could talk and choose on 0.1.30 but never assert inventory: `proveAuthoredGrid` reported only native
packs, which only native assembly quests, harvests and bosses register. A scene or data shard has none, so its
`requiredItems` always failed. The proof now pays the tape as a data cell does: quest coins through its coin port and
each kill's roll through `installCellLoot` (moved from cellWorld into `game/loot/personal.ts`, so both share one), plus
the ledger's item rewards, under a `player` pack. The restored run's pay must equal the uninterrupted baseline's, as its
facts must. `test/author-proof-goods.test.ts`.
