// oxlint-disable-next-line import/no-nodejs-modules -- The admitted portal runs on real player motors and physics.
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { createSimHost,type SimHost } from '../src/server/engine/sim';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { tagCollider } from '../src/shared/engine/physics/surface';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { installHostPortalRide } from '../src/shared/game/shardfile/portalRide';
import portals from './fixtures/engine-lift/portals.json';
import { builtProduct } from './fixtures/engine-lift/product';
import { SIM_LEVEL } from './fixtures/sim-level/level';

test('a bot enters the admitted portal alone and resumes its fade on a fresh real host', async () => {
  const source = (await loadHeadlessProduct(builtProduct('nine-dragon-stack'))).shardfile;
  const portal = source.entryways.find(row => row.portal !== undefined)?.portal;
  const road = portal?.road;
  if (road === undefined) throw new Error('Missing admitted portal');
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const level = { ...SIM_LEVEL, entities: [], quests: [] }, host = createSimHost(level, { rapier });
  let resumed: SimHost | undefined;
  const bind = (owner: SimHost) => installHostPortalRide(owner, portals.director, source, portals, () => undefined);
  try {
    if (portal === undefined) throw new Error('Missing portal link');
    for (const node of [portal.road, portal.destination]) {
      const floor = host.physics.world.createCollider(host.physics.R.ColliderDesc.cuboid(2, .2, 2).setTranslation(node.at[0], node.at[1] - .2, node.at[2]));
      tagCollider(floor, 'wood', node.floor);
    }
    const ride = bind(host), lead = [...host.players.values()][0];
    if (lead === undefined) throw new Error('Missing lead');
    lead.resetPose({ x: 0, y: 125, z: 7 }, 0);
    host.step();
    const bot = host.addPlayer('bot:1', { x: road.at[0], y: road.at[1], z: road.at[2] });
    host.step();
    expect(ride.busy()).toBe(false);
    const adapter = host.adapters.get(portals.director);
    if (adapter === undefined) throw new Error('Missing real portal continuation');
    const saved = adapter.snapshot();
    expect(JSON.parse(String(saved))).toMatchObject({ others: { 'bot:1': { held: { x: road.at[0], z: road.at[2] } } } });
    resumed = restoreSimHost(level, { rapier }, snapshotSimHost(host), fresh => { bind(fresh); });
    expect(resumed.adapters.get(portals.director)?.snapshot()).toBe(saved);
    for (let tick = 0; tick < 120; tick++) { host.step(); resumed.step(); }
    expect(resumed.players.get('bot:1')?.position.toArray()).toEqual(bot.position.toArray());
    expect(Math.hypot(bot.position.x - road.at[0], bot.position.z - road.at[2])).toBeGreaterThan(1);
    expect(lead.position.x).toBeCloseTo(0);
  } finally { resumed?.dispose(); host.dispose(); }
});
