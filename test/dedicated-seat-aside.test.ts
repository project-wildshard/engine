import { afterEach, expect, test } from 'vitest';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { gridAssembly } from '../src/server/host/dedicated/gridCells';
import { GROUP } from '../src/shared/engine/physics/groups';
import { tagOf } from '../src/shared/engine/physics/surface';
import type { PlayerSim } from '../src/server/engine/sim/playerSim';
import { directLoopback } from '../src/test/engine/netLoopback';
import { serverInput } from './fixtures/dedicated/roomBench';

// NET-LAG NL13b5 (meta docs/plans/MULTI-REPO-SAGA/MMO-SAGA/NET-LAG-PLAN.md): the room stepped a fresh seat 1 m west of Nine's
// spawn, onto Lantern Square's west edge beside the Well's guard. Half the capsule hung over nothing, and the page, resting on the
// edge a few centimetres higher than the room, corrected every walking frame (32 a minute on staging v0.1.48). Every seat a fresh
// join steps aside to, in every shipped cell, stands its whole footprint on a floor with nothing solid inside it. The spawn is the
// shard's own choice (some drop the player a metre onto the ground); a step aside is the room's.
const SEATS = 5, LIFT = 0.5, DROP = 1.5, STEP = 0.5;
let live: DedicatedRoom | undefined;
afterEach(() => { live?.dispose(); live = undefined; });

/** Why this body's seat is not clear standing: a footprint point with no floor near its feet, an edge under it, or a solid in the capsule. */
function unclear(room: DedicatedRoom, body: PlayerSim): string | null {
  const { physics } = room.host, { R } = physics, { radius, height } = body.motor.opts, feet = body.position, own = body.motor.collider.handle;
  const world: InstanceType<typeof R.Collider>[] = [];
  physics.world.forEachCollider(collider => { if (collider.isEnabled() && !collider.isSensor() && collider.handle !== own && ((collider.collisionGroups() >>> 16) & GROUP.WORLD) !== 0) world.push(collider); });
  const ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }), floors: number[] = [];
  for (let step = -1; step < 8; step++) {
    const x = step < 0 ? feet.x : feet.x + Math.cos(step * Math.PI / 4) * radius, z = step < 0 ? feet.z : feet.z + Math.sin(step * Math.PI / 4) * radius;
    ray.origin = { x, y: feet.y + LIFT, z };
    const hits = world.map(collider => collider.castRay(ray, LIFT + DROP, true)).filter(t => t >= 0);
    if (hits.length === 0) return `no floor under ${x.toFixed(2)}, ${z.toFixed(2)}`;
    floors.push(feet.y + LIFT - Math.min(...hits));
  }
  if (Math.max(...floors) - Math.min(...floors) > STEP) return `an edge under the footprint: floors ${Math.min(...floors).toFixed(2)} to ${Math.max(...floors).toFixed(2)}`;
  const shape = new R.Capsule(Math.max(0.01, height / 2 - radius), radius), centre = { x: feet.x, y: feet.y + height / 2 + 0.03, z: feet.z };
  const inside = world.find(collider => collider.intersectsShape(shape, centre, { x: 0, y: 0, z: 0, w: 1 }));
  return inside === undefined ? null : `inside ${String(tagOf(inside)?.owner ?? inside.shape.type)}`;
}

test.each(gridAssembly(false).cells.map(row => [row.instance, row.slug] as const))('every fresh seat in %s stands clear on a floor', { timeout: 60_000 }, async (cell, slug) => {
  const room = await DedicatedRoom.boot({ slug, cell, build: '', bootId: 'aside', input: await serverInput(slug), now: () => 0, post: () => undefined });
  live = room;
  const misses: string[] = [];
  for (let seat = 0; seat < SEATS; seat++) {
    const device = `device:${String(seat)}`;
    room.seat({ device, name: device, body: `p.${String(seat)}`, doc: null, seq: 0 }, directLoopback().server, () => undefined);
    const body = room.bodyOf(device);
    if (body === undefined) { misses.push(`seat ${String(seat)}: refused`); continue; }
    if (body.position.x === room.spawn.x && body.position.z === room.spawn.z) continue;
    const why = unclear(room, body);
    if (why !== null) misses.push(`seat ${String(seat)} at ${body.position.x.toFixed(2)}, ${body.position.y.toFixed(2)}, ${body.position.z.toFixed(2)}: ${why}`);
  }
  expect(misses).toEqual([]);
});
