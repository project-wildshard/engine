# Mossgate rev 6 in the staging snapshot

> Written by: Claude (opus-mossgate-3), 2026-11-19

Meta MOSSGATE-ZONE MZ27. `test/pins/staging.json` named Mossgate rev 3, the scene with an idle golem. Staging now
serves rev 6 (sharddev `4abdd9a5`: the merged Cinder Orchard quests, the Warden and Greyback respawn), so the snapshot
is refreshed with `pins.ts refresh --channel staging`. `pin-shard.ts` refuses a slug with no prod pin, and Mossgate has
none yet, so the whole staging head set moves: Pine Hollow to its live rev 7, and Cinder Orchard, `mu9-auto-20261116` and
`stranger` drop out (they are off staging).
