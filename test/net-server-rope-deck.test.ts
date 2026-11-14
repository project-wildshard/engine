// oxlint-disable-next-line import/no-nodejs-modules -- The walk runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { runHeadlessJourney } from '../src/shared/host/headlessJourney';
import { snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import type { RigidBody } from '@dimforge/rapier3d-simd';
import type { SimHost } from '../src/server/engine/sim';
import { tagOf } from '../src/shared/engine/physics/surface';
import { builtFolder } from './fixtures/builtFolder';

// NET-LAG NL5 (Jake, 2026-11-12: "i fucking clipped through the rope bridge because of the lag lol"). The room's own resident
// (`createTrustedHeadlessResident`, what `cellWorld` runs) walks Driftwood's rope bridge. Before NL5 it built no rope chain:
// its player walked on air over the gully and fell to the gully floor (y -0.89 at the span's middle), and the page, which
// stands on its own planks, was corrected down through them. Test walks installed the chain from a fixture; the room did not.

const SLUG = 'driftwood-isle';
const BRIDGE = { start: { x: 15.6, z: -7, yaw: 3.09, y: 6.078 }, points: [{ x: 13.88, z: 11.88 }, { x: 15.29, z: 13.29 }, { x: 23.99, z: 21.99 }, { x: 31.98, z: 29.98 }, { x: 34.38, z: 32.38 }, { x: 35.8, z: 33.8 }], far: 12.289 };
/** The span's two ends, as `walk-routes.json`'s waypoints place them. */
const SPAN = { a: { x: 15.29, z: 13.29 }, b: { x: 34.38, z: 32.38 } };

/** The rope deck's planks in a host's world: dynamic bodies tagged with the bridge as their owner. */
const planks = (host: SimHost): number => {
  const seen = new Set<number>();
  host.physics.world.forEachCollider(collider => {
    const owner = tagOf(collider)?.owner, body = collider.parent();
    if (body?.isDynamic() === true && owner !== null && typeof owner === 'object' && 'id' in owner && owner.id === 'bridge') seen.add(body.handle);
  });
  return seen.size;
};

test('the room stands a walker on Driftwood\'s rope bridge, and a restore keeps one chain', async () => {
  const directory = builtFolder(SLUG), product = await loadHeadlessFolder(directory), shard = product.shardfile, descriptor = outputDescriptor(shard);
  if (descriptor === undefined) throw new Error(`Missing admitted ${SLUG} output`);
  const assets = new Map(descriptor.index.files.filter(file => serverReadsFile(file, shard.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'))
    .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), input = { shard, assets, rapier, product };
  const resident = await createTrustedHeadlessResident(input, undefined, { room: true });
  let lowest = Infinity, saved: ReturnType<typeof snapshotSimHostBytes>, bodies: number;
  try {
    bodies = planks(resident.host);
    expect(bodies).toBeGreaterThan(10);
    const report = runHeadlessJourney(resident.host, commands => { resident.step(commands); }, { ticks: 900, start: BRIDGE.start, points: BRIDGE.points, once: true }, sample => {
      const { x, y, z } = sample, along = ((x - SPAN.a.x) * (SPAN.b.x - SPAN.a.x) + (z - SPAN.a.z) * (SPAN.b.z - SPAN.a.z)) / ((SPAN.b.x - SPAN.a.x) ** 2 + (SPAN.b.z - SPAN.a.z) ** 2);
      if (along > 0.1 && along < 0.9) lowest = Math.min(lowest, y);
    });
    expect(report.stuck).toEqual([]);
    expect(report.complete).toBe(true);
    expect(report.final.position[1]).toBeCloseTo(BRIDGE.far, 0);
    expect(lowest).toBeGreaterThan(3); // the planks stay over 5 m; the gully floor is under 0
    saved = snapshotSimHostBytes(resident.host);
  } finally { resident.dispose(); }
  const restored = await createTrustedHeadlessResident(input, saved, { room: true });
  try {
    expect(planks(restored.host)).toBe(bodies);
    // the saved planks, lent back to the motor, carry a walker
    expect(runHeadlessJourney(restored.host, commands => { restored.step(commands); }, { ticks: 900, start: BRIDGE.start, points: BRIDGE.points, once: true }).complete).toBe(true);
  } finally { restored.dispose(); }
  // a room saved with no planks in its world (as before NL5; its adapter row is there, which `joined` makes optional) builds them
  const old = await createTrustedHeadlessResident(input, undefined, { room: true });
  try {
    const { world } = old.host.physics, chain = new Set<RigidBody>();
    world.forEachCollider(collider => { const body = collider.parent(), owner = tagOf(collider)?.owner; if (body?.isDynamic() === true && owner !== null && typeof owner === 'object' && 'id' in owner && owner.id === 'bridge') chain.add(body); });
    for (const body of chain) world.removeRigidBody(body);
    expect(planks(old.host)).toBe(0);
    saved = snapshotSimHostBytes(old.host);
  } finally { old.dispose(); }
  const upgraded = await createTrustedHeadlessResident(input, saved, { room: true });
  try {
    expect(planks(upgraded.host)).toBe(bodies);
    expect(runHeadlessJourney(upgraded.host, commands => { upgraded.step(commands); }, { ticks: 900, start: BRIDGE.start, points: BRIDGE.points, once: true }).complete).toBe(true);
  } finally { upgraded.dispose(); }
}, 60_000);
