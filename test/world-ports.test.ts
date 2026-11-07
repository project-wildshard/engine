import { canoeRow } from './fixtures/engine-lift/canoe';
// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { beforeAll,expect,test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { netNeighbourRegion } from '../src/client/game/grid/neighbourRows';
import { NetMovers } from '../src/client/game/plugin/moverViews';
import { netCreatureCount } from '../src/client/game/population/netCounts';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost,type SimHost } from '../src/server/engine/sim';
import { MoverScriptDriver,type MoverView } from '../src/server/game/plugin/mover';
import type { MoverPose } from '../src/shared/engine/physics/mover';
import { loadRapier,type Rapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { directLoopback } from '../src/test/engine/netLoopback';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// E6 WORLD: each world view's port, fed off the wire instead of the page's sim, shows what the server's sim holds.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

/** A real room over the direct loopback. */
function wired(host: SimHost): { client: NetClient; run: (ticks: number) => void } {
  const link = directLoopback(), client = new NetClient(link.client), room = new NetRoom({ world: new SimNetWorld(host), step: () => { host.step(); } });
  room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  return { client, run: ticks => { for (let tick = 0; tick < ticks; tick++) { room.tick(); link.pump(); } } };
}

test('a neighbour creature reads the same off its row as off the sim', () => {
  const host = createSimHost(SIM_LEVEL, { rapier });
  try {
    const { client, run } = wired(host), { position } = [...host.players.values()][0] ?? { position: null }, [id, sim] = [...host.entities][0] ?? [];
    if (id === undefined || sim === undefined || position === null) throw new Error('No creature on the level');
    sim.harnessHold = true; sim.position.set(position.x + 10, position.y, position.z);
    run(40);
    const shown = netNeighbourRegion(client, () => client.latest?.tick ?? 0).host.entities.get(id);
    expect(shown?.alive).toBe(sim.alive); expect(shown?.state).toBe(sim.state); expect(shown?.scale).toBeCloseTo(sim.scale);
    expect(shown?.position.x).toBeCloseTo(sim.position.x, 1); expect(shown?.position.z).toBeCloseTo(sim.position.z, 1);
    expect(netNeighbourRegion(client, () => 0).host.entities.get('nobody')).toBeUndefined();
  } finally { host.dispose(); }
});

test('a population count off the rows is the server\'s, and a death leaves it', () => {
  const host = createSimHost(SIM_LEVEL, { rapier });
  try {
    const { client, run } = wired(host), lead = [...host.players.values()][0], bodies = [...host.entities.values()], kind = bodies[0]?.kind;
    if (lead === undefined || kind === undefined) throw new Error('No creature on the level');
    for (const sim of bodies) { sim.harnessHold = true; sim.position.set(lead.position.x + 5, lead.position.y, lead.position.z); }
    run(30);
    const alive = (): number => bodies.filter(sim => sim.kind === kind && sim.alive).length, before = alive();
    expect(netCreatureCount(client, kind)).toBe(before);
    const first = bodies[0]; if (first === undefined) throw new Error('No creature on the level');
    first.alive = false; run(10);
    expect(netCreatureCount(client, kind)).toBe(before - 1);
  } finally { host.dispose(); }
});

test('a deck under a predicted body stands where each command meets it, and a far one at render time', () => {
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier });
  try {
    const row = structuredClone(canoeRow), source = emptyShardfile({ slug: 'net-test', name: 'Net', author: 'Test', revision: 1, seed: 3 });
    const motion = new MoverScriptDriver([row], host).install(host, { content: source, assets: new Map(), rules: { fields: {}, archetypes: [], events: [], maxEntities: 32 } }, { id: 'net-test', drive: true, restoreFlags: new Set(host.flags.all) });
    const { client, run } = wired(host);
    motion.command(row.id, 1); run(120);
    const posed: MoverPose[] = [], placed: (readonly [MoverPose, MoverPose])[] = [], view: MoverView = { pose: pose => { posed.push(pose); }, place: (at, next) => { placed.push([at, next]); } };
    const { x, z } = motion.pose(row.id).position, tick = host.state.tick, renderTick = tick - 6, near = new NetMovers(client, new Map([[row.id, view]]), { x, z });
    near.frame(renderTick);
    expect(posed).toEqual([]); // it waits for a step
    near.at(tick + 3, false);
    expect(posed).toHaveLength(1);
    near.at(tick + 3, true);
    expect(posed).toHaveLength(1); // a replay moves no view
    const [[at, next] = []] = placed;
    expect(Math.hypot((next?.position.x ?? 0) - (at?.position.x ?? 0), (next?.position.z ?? 0) - (at?.position.z ?? 0)), 'one tick apart').toBeGreaterThan(0);
    expect(next?.position.x).toBe(posed[0]?.position.x); // the step after a replay carries from the pose the live step would have left
    new NetMovers(client, new Map([[row.id, view]]), { x: x + 100, z }).frame(renderTick);
    expect(posed).toHaveLength(2); // far away: posed at once, at render time
  } finally { host.dispose(); }
});

test('a mover view posed off its row stands where the server has the mover', () => {
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier });
  try {
    const row = structuredClone(canoeRow), source = emptyShardfile({ slug: 'net-test', name: 'Net', author: 'Test', revision: 1, seed: 3 });
    const motion = new MoverScriptDriver([row], host).install(host, { content: source, assets: new Map(), rules: { fields: {}, archetypes: [], events: [], maxEntities: 32 } }, { id: 'net-test', drive: true });
    const { client, run } = wired(host), drawn = { x: Number.NaN, z: Number.NaN, enabled: false };
    const view: MoverView = { pose: pose => { Object.assign(drawn, { x: pose.position.x, z: pose.position.z, enabled: pose.enabled }); } };
    motion.command(row.id, 1); run(300);
    new NetMovers(client, new Map([[row.id, view]]), { x: 0, z: 0 }).frame(Number.MAX_SAFE_INTEGER);
    const actual = motion.pose(row.id);
    expect(drawn.x).toBeCloseTo(actual.position.x, 0); expect(drawn.z).toBeCloseTo(actual.position.z, 0); expect(drawn.enabled).toBe(actual.enabled);
  } finally { host.dispose(); }
});
