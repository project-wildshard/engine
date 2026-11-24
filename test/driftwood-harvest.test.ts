// oxlint-disable-next-line import/no-nodejs-modules -- The harvest runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createNativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { nativeInventories } from '../src/shared/game/inventoryLaw';
import { builtFolder } from '../src/test/game/builtFolder';

// QA-FEEDBACK-2026-11-24 row 35 (Jake, ~14:50 Cancún: "i can no longer harvest corpses of enemies for items in driftwood"). The
// shipped island, headless: the practice crab killed beside the player offers its harvest, and the claim puts its items in the
// pack. (The page half: src/client/game/session/harvest-bodies.test.ts, the prompt reads the entered grid cell's corpses.)
const SLUG = 'driftwood-isle', PRACTICE = 'creature:21', PLAYER = 'actor.player';

test('Driftwood: a crab killed beside the player is harvested for its items', async () => {
  const directory = builtFolder(SLUG), product = await loadHeadlessFolder(directory), shard = product.shardfile;
  const descriptor = outputDescriptor(shard); if (descriptor === undefined) throw new Error('Missing admitted output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const live = await createNativeHeadlessResident({ shard, assets, rapier, product });
  try {
    const host = live.host, routes = actRoutes(host);
    const crab = host.entities.get(PRACTICE), player = host.players.get(PLAYER);
    if (crab === undefined || player === undefined) throw new Error('Missing the practice crab or the player');
    expect(crab.kind).toBe('crab');
    player.position.set(crab.position.x + 1, crab.position.y, crab.position.z); player.motor.resetAt(player.position);
    const dealt = host.combat.hit({ source: 'env', sourceTags: ['dmg.legacy', 'cover.checked'], target: crab.combatActor(), amount: crab.maxHp * 10,
      point: crab.position.clone(), dir: new Vector3(0, 0, 1) });
    expect(dealt?.killed).toBe(true);
    live.step([]);
    const claim = routes.claims.get(`harvest.${crab.entityId}`);
    expect(claim, 'the dead crab offers its harvest').toBeDefined();
    claim?.(PLAYER); live.step([]);
    expect(nativeInventories(host)['pack']).toEqual({ 'crab-meat': 1, 'crab-claw': 1 });
    expect(routes.claims.has(`harvest.${crab.entityId}`), 'harvested once').toBe(false);
  } finally { live.dispose?.(); }
});
