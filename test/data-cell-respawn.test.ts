// oxlint-disable-next-line import/no-nodejs-modules -- The real cell runs the shipped Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { emptyShardfile } from '../src/shared/host/author';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { SaveStore } from '../src/shared/engine/saves/store';
import { dataCellPlaces, openCellWorld } from '../src/server/host/standalone/cellWorld';

// TEMPLATE-E2E TC-E3 (J361, Jake 2026-11-15: "death respawns you at the last camp"): a grid data cell installed its room
// respawn with no places, so a fall always went back to the shard's spawn. Its places are now the product's published
// places, else the shard's own map POIs, and a fallen player comes back at the last one they stood in.
const rapier = loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
const CAMP = { id: 'camp-2', name: 'The ledge camp', x: 12, z: -30, r: 6 };
function shard() {
  const source = emptyShardfile({ slug: 'camp-cell', name: 'Camp cell', author: 'Test', seed: 7, revision: 1 });
  // only the map's POIs are read here; the rest of the manifest is the page's
  return Object.assign(source, { manifest: { pois: [{ id: 'depot', name: 'Depot', x: 0, z: 0 }, CAMP] } as never });
}

test('a data cell\'s places are its map POIs when the product publishes none', async () => {
  expect(await dataCellPlaces({ shard: shard() })).toEqual([
    { id: 'depot', label: 'Depot', x: 0, z: 0, r: 8 }, { id: 'camp-2', label: 'The ledge camp', x: 12, z: -30, r: 6 }]);
  expect(await dataCellPlaces({ shard: emptyShardfile({ slug: 'bare', name: 'Bare', author: 'Test', seed: 1, revision: 1 }) })).toEqual([]);
});

test('a player who reached camp 2 and falls comes back at camp 2, not the spawn', async () => {
  const cell = await openCellWorld({ instance: 'camp-cell' }, { shard: shard(), assets: new Map(), sections: new Map(), rapier: await rapier } as never,
    undefined, { saves: new SaveStore({ local: null, session: null }), lone: true, pageless: true });
  try {
    const { host } = cell, lead = [...host.players.values()][0];
    if (lead === undefined) throw new Error('No lead seat');
    lead.resetPose({ x: CAMP.x, y: lead.position.y, z: CAMP.z }, 0);
    for (let tick = 0; tick < 60; tick++) cell.step([]);
    expect(host.respawn.stand(lead.id)?.id).toBe('camp-2');
    lead.resetPose({ x: 40, y: lead.position.y, z: -60 }, 0);
    cell.step([]);
    host.combat.hit({ source: 'env', sourceTags: [], target: lead.health, amount: 1000, point: lead.position.clone(), dir: new Vector3(0, 0, 1) });
    cell.step([]);
    expect(host.respawn.falls(lead.id)).toBe(1);
    expect(Math.hypot(lead.position.x - CAMP.x, lead.position.z - CAMP.z)).toBeLessThan(CAMP.r);
  } finally { cell.dispose(); }
});

test('a map POI with respawn: false is no respawn place (a death in the Wyrm pit does not come back in the pit)', async () => {
  const source = shard();
  Object.assign(source, { manifest: { pois: [{ id: 'depot', name: 'Depot', x: 0, z: 0 }, { id: 'pit', name: 'Wyrm pit', x: 30, z: 30, r: 10, respawn: false }, CAMP] } as never });
  expect((await dataCellPlaces({ shard: source })).map(place => place.id)).toEqual(['depot', 'camp-2']);
});
