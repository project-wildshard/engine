// oxlint-disable-next-line import/no-nodejs-modules -- The blow runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createNativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { layerHuntFight } from '../src/server/game/shardfile/layerHunts';
import { builtFolder } from '../src/test/game/builtFolder';

// QA 11-25 row 86 (c): on the grid Driftwood's bear charged a player beside it with no wind-up (so no warning and no dodge
// hint) and its contact carried no `feel.blow` (so no grunt, shove or fight music). Its declared hunt ran with an empty
// fight; it now runs the shard's authored one (telegraphed, two attackers).
const SLUG = 'driftwood-isle', BEAR = 'creature:12', PLAYER = 'actor.player';

async function island() {
  const directory = builtFolder(SLUG), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard); if (descriptor === undefined) throw new Error('Missing admitted output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  return createNativeHeadlessResident({ shard, assets, rapier, product });
}

test("a shard's authored fight reaches its declared hunts", () => {
  expect(layerHuntFight(undefined)).toEqual({});
  expect(layerHuntFight({ telegraphed: true, attackers: 2 })).toEqual({ telegraphed: true, attackers: 2 });
  expect(layerHuntFight({ telegraphed: true, attackers: 'unbounded' })).toEqual({ telegraphed: true, attackers: Infinity });
});

test("Driftwood: the bear winds up on the wire before its blow, and the blow is felt", async () => {
  const live = await island();
  try {
    const host = live.host, bear = host.entities.get(BEAR), player = host.players.get(PLAYER);
    if (bear === undefined || player === undefined) throw new Error('Missing the black bear or the player');
    expect(bear.kind).toBe('bear');
    const tags: (readonly string[])[] = [];
    host.events.on('damage.dealt', ({ req, dealt }) => { if (req.target === player.health && dealt > 0) tags.push(req.sourceTags); }, host.scope);
    player.position.set(bear.position.x + 4, host.groundHeightAt(bear.position.x + 4, bear.position.z), bear.position.z); player.motor.resetAt(player.position);
    const start = host.clock.now;
    let wound = false;
    while (host.clock.now - start < 30 && tags.length === 0) {
      live.step([{ kind: 'player', moveX: 0, moveZ: 0, yaw: 0 }]);
      if (tags.length === 0 && bear.attackPhase >= 0) wound = true; // a strike's clock running: the row's `winding`
    }
    expect(tags.length, 'the bear struck the player beside it').toBeGreaterThan(0);
    expect(wound, 'its wind-up was on the wire before the blow').toBe(true);
    expect(tags[0], 'the blow is felt (grunt, shove, fight music)').toContain('feel.blow');
  } finally { live.dispose?.(); }
}, 120_000);
