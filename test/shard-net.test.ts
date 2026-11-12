import { canoeRow } from './fixtures/engine-lift/canoe';
// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost } from '../src/server/engine/sim';
import { MoverScriptDriver } from '../src/server/game/plugin/mover';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { DeclaredScriptWorld } from '../src/shared/engine/script/state';
import { publishShardState } from '../src/shared/engine/sim/shardRows';
import { emptyShardfile } from '../src/shared/host/author';
import { directLoopback } from '../src/test/engine/netLoopback';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// P1-E3.10: a client reads shard state off the wire and sees what the server's sim did: a moving boat, a flag set by its
// arrival, a shared field, and nothing the shard kept for the host.
const row = structuredClone(canoeRow);

test('a client sees a mover, its flags and public shared state as the server holds them', async () => {
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) });
  try {
    const source = emptyShardfile({ slug: 'net-test', name: 'Net', author: 'Test', revision: 1, seed: 3 });
    const motion = new MoverScriptDriver([row], host).install(host, { content: source, assets: new Map(),
      rules: { fields: {}, archetypes: [], events: [], maxEntities: 32 } }, { id: 'net-test', drive: true });
    const field = { id: 1, type: 'f64' as const, default: 0, min: -10, max: 10 };
    const declared = new DeclaredScriptWorld({ fields: {}, archetypes: [], events: [], maxEntities: 4 }, [], {
      shared: [{ ...field, id: 1, name: 'tide', privacy: 'public', default: 1.5 }, { ...field, id: 2, name: 'secret', privacy: 'host' }], player: [] }, new Map());
    publishShardState(host, () => declared.publicShared());
    const world = new SimNetWorld(host), link = directLoopback(), client = new NetClient(link.client);
    const room = new NetRoom({ world, step: () => { host.step(); } });
    room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
    const wired = (): { readonly x: number; readonly z: number; readonly enabled: boolean } => {
      const frame = client.latest, entity = [...client.entities.values()].find(value => value.id === `script:${row.id}`);
      if (frame === null || entity === undefined) throw new Error('Missing script row');
      const { x, z, enabled } = client.fields(frame, entity.handle) ?? {};
      if (typeof x !== 'number' || typeof z !== 'number' || typeof enabled !== 'boolean') throw new Error('Bad script row');
      return { x, z, enabled };
    };
    motion.command(row.id, 1);
    for (let tick = 0; tick < 300; tick++) { room.tick(); link.pump(); }
    const midway = motion.pose(row.id).position, seen = wired();
    expect(Math.abs(seen.x - midway.x)).toBeLessThan(0.1); expect(Math.abs(seen.z - midway.z)).toBeLessThan(0.1);
    expect(seen.enabled).toBe(motion.pose(row.id).enabled);
    expect(client.phased.has('secret:islet')).toBe(false);
    for (let tick = 0; tick < 550 && motion.riding(row.id); tick++) { room.tick(); link.pump(); }
    room.tick(); room.tick(); link.pump();
    // SS13: an arrival is its rider's own find, so it reaches that player on their own flags, not as a world flag
    expect(client.phased.has('secret:islet')).toBe(true); expect(client.flags().has('secret:islet')).toBe(false);
    const frame = client.latest; if (frame === null) throw new Error('Missing frame');
    expect(client.stateField(frame, 'tide')).toBe(1.5);
    expect(client.stateField(frame, 'secret')).toBeUndefined();
    host.flags.clear('secret:islet'); room.tick(); room.tick(); link.pump();
    expect(client.phased.has('secret:islet')).toBe(false);
    expect(client.dropped).toBe(0);
  } finally { host.dispose(); }
});
