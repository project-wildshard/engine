# Sky Reach: authored physics (G350-FR, was DS1.5 Node-canonical)

`generators/physics.ts` constructs the physics values directly from authoring inputs (G320): the
island, lip, prop and bridge recipes, the species scale ranges with the creature manager's seed stream (level seed 6417,
flyers then goats), and `data/physicsRows.json` for what no recipe computes yet (the knoll hulls, islet rails and posts,
docks, keeper stand, crown ruin, winch house, roost nest, practice arena, each species simulation spec and the registry
order of every piece). It runs under the authoring loader; no world, model, registry or runtime code runs. The retired
DS1.5 bake built the world in Node; its last output matched this product in every field, byte for byte.

GR5 F16 retires the redundant `sky-physics` scheduler publication. `skyPhysics()`
supplies production output; `skyPhysicsActors()` supplies the same original actor
stream to fixtures. The source oracle in `test/sky-prepared-model-boot.test.ts`
pins the complete 277,965-byte predecessor hash and compares every field with the
published runtime-plan section. The ignored predecessor remains held, with no
active reader. Under G769 the retirement lands on touched types/lint; the
historical measurements below are retained, not newly executed proofs.

The official 21,134-tick gameplay journey, gale-wall restore/worker suffix and durable ledger pass with the original canonical hashes, both earned facts and 35 coins. All cached checkpoint payload hashes stay byte-identical; their input-only refresh remains the pusher's. `compatibility.json` is from that real run. Twenty focused native contracts, strict and touched typed lint pass.

Fresh native page comparison confirms these exact last-bit differences. The actual map rebake preserves every image byte. Official `physics-baseline.mjs --no-build --mode=walk --shard=far-reach`: **10 legs, 0 stuck, no page errors**.


SF81 DIR5 Roc stages are authored for page and native hosts, with the shared DirectorBossBrain over the original held body/fight ports. Deliberately re-recorded step, gale and storm hash manifests: decoded command tape and every canonical native field are identical except the encounter wrapper version1->2 and its complete authored stage cursor. The full native spawn-to-Roc tape, gameplay/contacts, retries, quest/encounter facts and Ledger outcomes remain exact; physical payloads and map pixels are unchanged. No gzip payload committed.

G345 flock keeper: `runtime/flock.ts` runs on the shared `installHomeKeeper` (options `late`, `think.bands`, `killY`, `place`, `adopt`, the policy's `stream`). Deliberately re-recorded step, gale and storm checkpoints: every tick's player, bodies, effects and every other adapter are identical on a clean export of HEAD vs HEAD + the port; only the `far.flock` continuation wrapper changes (the keeper's `tokens: []`, `wait: 0`, `boss: null` for Sky's derived `goats` flag). Signal's keeper witness is byte-exact.
