# Signal Dunes: authored physics (G350-SD, was DS1.5 Node-canonical)

`generators/physics.ts` defines the source-owned physics declaration from the camp placement, tower, ridge and scout
recipes, species scale ranges and seeded creature stream, plus authored arena, dressing, species and spot rows.
The SDK product and this witness consume that declaration directly. G919 retired the frozen declaration-byte
snapshot test; the standalone writer job is retired too. Native gameplay and continuation checks remain.

Run the existing gameplay/replay/Ledger witness:

```sh
node --experimental-transform-types --import ./scripts/sim-node-loader.mjs test/proof/sunscar-dunes/run.mjs all
```

At the original authored-physics boundary, the official 12,503-tick gameplay journey retained the canonical hash `95a6050c27629ed4eb94e79af6a502495f3e5aa7b4c9fd56fb03c8cfdaef54ae`, both earned facts and 25 coins. The 1,793-tick mid-fight restore suffix and shipping-worker continuation agree exactly, with durable reload and duplicate-stable Ledger outcomes. Those historical receipts predate later scheduler changes. The current witness reads the admitted product and verifies every asset byte/hash, then independently checks gameplay, restore, shipping-worker continuation and durable Ledger outcomes. No compatibility receipt is re-pinned by the writer retirement.

Fresh native page comparison confirms every gameplay field is exact. The actual map rebake preserves every image byte. Official `physics-baseline.mjs --no-build --mode=walk --shard=sunscar-dunes`: **7 legs, 0 stuck, no page errors**.


SF81 DIR5 Matriarch stages are authored for page and native hosts, with the same DirectorBossBrain as Sky. Deliberately updated canonical boot/final/replay hashes for the encounter version2 wrapper and complete stage cursor; the real native tape, fire and quest effects, body contacts, retries, victory and Ledger outcomes remain exact. Existing marked-body checkpoint spawn/retirement and storm presentation stay native. This lands the boss-stage slice; the brazier-signal director is separate.


SF81 DIR5 signal fire: the accepted real fire edge enters signalStages.json through the same local SignalDirector on the page and native host. Quiet loaded-light admission and full cursor restore never summon or file effects. Deliberately re-recorded canonical continuation hashes for the additional sunscar.signal-fire adapter; all checked prior native fields, complete command tape, real bowl/fire/quest/victory effects, contacts, retries and Ledger outcomes match the predecessor. Actual physics payload and official map pixels are unchanged; no snapshot payload is committed.
