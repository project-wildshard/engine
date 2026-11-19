# 2026-11-19: the completion card keeps you in the world

Lane: buddy-engine (Coordinator, QA-FEEDBACK 11-19 row 25, J454).

Jake, Cinder Orchard on staging: "the completion card should not have exit the title ... it bumps you out of
the MMO ... Just get rid of the exit the title button on the completion card." The zone completion card
(ShardComplete) offered KEEP EXPLORING, TITLE SCREEN and, when a shard named a next one, NEXT SHARD. The
Coordinator's row says keep only KEEP EXPLORING. NEXT SHARD leaves the world the same way, so it goes too:
its button, the handlers, the card data's `next` and the projection's `next` argument. The shard format
had no copy or option naming either button, so this is engine-only. Every zone draws the same card.
complete-card-buttons.test.ts failed first (keep, title).
