# FP22a: the engine drops legacyQuestPlace

> Written by: Claude (lane opus-prune1)

Format's `PoiId` and `Place` go (FORMAT-PRUNE FP22a, shard-format `plan/prune-del@fe35d87`). The quest presentation's
`place` resolver takes a `QuestPlace`, and `legacyQuestPlace`, which narrowed it to the closed POI list, is gone;
`Interactables` types its host's `place` the same way. No engine caller passes `place`.
