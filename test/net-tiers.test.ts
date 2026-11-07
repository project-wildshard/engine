// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { framesBetween, rowDue } from '../src/server/engine/net/tiers';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { ConditionedTransport, directLoopback } from '../src/test/engine/netLoopback';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// P1-E5.2c (E5-REPLICATION §3.3): a far row costs less, and leaving it out never leaves a client holding a wrong row.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

const NEAR = 20, MID = 100, FAR = 200;
/** A host with a body in each band of the lead, moved only by the test. */
function stage(): { host: SimHost; near: string; mid: string; far: string } {
  const host = createSimHost(SIM_LEVEL, { rapier }), { position } = leadPlayer(host), bodies = [...host.entities];
  const place = (index: number, offset: number): string => {
    const [id, sim] = bodies[index] ?? [];
    if (id === undefined || sim === undefined) throw new Error('Too few creatures');
    sim.harnessHold = true; sim.position.set(position.x + offset, position.y, position.z);
    return id;
  };
  const bot = (id: string, offset: number): string => host.addPlayer(id, { x: position.x + offset, y: position.y, z: position.z }).id;
  return { host, near: place(0, NEAR), mid: bot('bot:mid', MID), far: bot('bot:far', FAR) };
}
const nudge = (host: SimHost, ids: readonly string[], tick: number): void => {
  for (const id of ids) { const body = host.entities.get(id) ?? host.players.get(id); if (body !== undefined) body.position.z = Math.sin(tick / 9) * 3; }
};
const handleOf = (client: NetClient, id: string): number => [...client.entities.values()].find(entity => entity.id === id)?.handle ?? 0;

test('rates fall with distance: 30 Hz, 15 Hz, then 10 Hz', () => {
  expect([framesBetween(NEAR ** 2), framesBetween(MID ** 2), framesBetween(FAR ** 2)]).toEqual([1, 2, 3]);
  expect([0, 1, 2, 3, 4, 5].filter(frame => rowDue(frame, 7, 3))).toEqual([2, 5]);
});

test('over a clean link each band updates at its rate', () => {
  const { host, near, mid, far } = stage(), link = directLoopback(), client = new NetClient(link.client);
  const room = new NetRoom({ world: new SimNetWorld(host), step: () => { host.step(); } });
  room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  const ids = [near, mid, far], changes = new Map(ids.map(id => [id, 0])), last = new Map<string, number>();
  for (let tick = 0; tick < 180; tick++) {
    nudge(host, ids, tick); client.flush(); link.pump(); room.tick(); link.pump();
    const frame = client.latest;
    if (frame === null || tick < 60 || tick % 2 === 1) continue;
    for (const id of ids) {
      const z = client.fields(frame, handleOf(client, id))?.['z'];
      if (typeof z !== 'number') throw new Error(`No row for ${id}`);
      if (last.get(id) !== z) changes.set(id, (changes.get(id) ?? 0) + 1);
      last.set(id, z);
    }
  }
  expect(client.dropped).toBe(0);
  expect(room.stats.tierSkips).toBeGreaterThan(0);
  expect(changes.get(near)).toBeGreaterThan(55); // 60 frames at 30 Hz
  expect(changes.get(mid)).toBeGreaterThan(25); expect(changes.get(mid)).toBeLessThanOrEqual(31);
  expect(changes.get(far)).toBeGreaterThan(16); expect(changes.get(far)).toBeLessThanOrEqual(21);
  room.dispose(); host.dispose();
});

test('a lost frame never leaves a tier row wrong: every delta starts from what the client really holds', () => {
  const { host, near, mid, far } = stage(), link = directLoopback(), client = new NetClient(link.client);
  let seed = 7;
  const random = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const bad = new ConditionedTransport(link.server, { latencyMs: 0, jitterMs: 0, lossPct: 25, reorderPct: 0, random });
  const room = new NetRoom({ world: new SimNetWorld(host), step: () => { host.step(); } });
  room.join(bad); client.hello(); link.pump(); room.open(); bad.advance(1); link.pump();
  const ids = [near, mid, far], history = new Map<number, Map<string, number>>();
  for (let tick = 0; tick < 600; tick++) {
    nudge(host, ids, tick); client.flush(); link.pump(); room.tick();
    history.set(host.state.tick, new Map(ids.map(id => [id, (host.entities.get(id) ?? host.players.get(id))?.position.z ?? 0])));
    bad.advance(1); link.pump();
    const frame = client.latest;
    if (frame === null || frame.tick < 2) continue;
    for (const id of ids) {
      const z = client.fields(frame, handleOf(client, id))?.['z'];
      if (typeof z !== 'number') throw new Error(`No row for ${id}`);
      const held = [...history.entries()].filter(([at]) => at <= frame.tick && at > frame.tick - 64).some(([, row]) => Math.abs((row.get(id) ?? Infinity) - z) < 0.01);
      expect(held, `${id} at ${String(frame.tick)}`).toBe(true);
    }
  }
  expect(room.stats.tierSkips).toBeGreaterThan(0);
  room.dispose(); host.dispose();
});

test('a change on a frame that skipped the row still arrives, though it never changes again', () => {
  const { host, mid, far } = stage(), link = directLoopback(), client = new NetClient(link.client);
  const room = new NetRoom({ world: new SimNetWorld(host), step: () => { host.step(); } });
  room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  const run = (ticks: number): void => { for (let tick = 0; tick < ticks; tick++) { client.flush(); link.pump(); room.tick(); link.pump(); } };
  run(20);
  for (let step = 0; step < 12; step++) { // one change at every phase of the tiers' cycles, then a hold
    for (const id of [mid, far]) { const player = host.players.get(id); if (player !== undefined) player.position.z = step; }
    run(1 + step % 2); run(16);
    const frame = client.latest;
    if (frame === null) throw new Error('No frame');
    for (const id of [mid, far]) expect(client.fields(frame, handleOf(client, id))?.['z']).toBeCloseTo(step, 1);
  }
  room.dispose(); host.dispose();
});

test('P1-E5.3-F1: a far row between its samples is held, and a still row is fresh on every frame it was due', () => {
  const { host, near, mid, far } = stage(), link = directLoopback(), client = new NetClient(link.client);
  const room = new NetRoom({ world: new SimNetWorld(host), step: () => { host.step(); } });
  room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  const ids = [near, mid, far], fresh = new Map(ids.map(id => [id, 0])), held = new Map(ids.map(id => [id, 0]));
  let frames = 0;
  for (let tick = 0; tick < 240; tick++) {
    if (tick < 60) nudge(host, [far], tick); // far moves, then stands; near never moves
    client.flush(); link.pump(); room.tick(); link.pump();
    const frame = client.latest;
    if (frame === null || frame.tick % 2 !== 0 || tick < 12) continue;
    frames++;
    for (const id of ids) {
      expect(frame.rows.has(handleOf(client, id))).toBe(true);
      const count = frame.fresh.has(handleOf(client, id)) ? fresh : held;
      count.set(id, (count.get(id) ?? 0) + 1);
    }
  }
  expect(client.dropped).toBe(0);
  expect(fresh.get(near)).toBe(frames); // standing still inside the first tier: a true sample every frame
  expect(held.get(mid)).toBeGreaterThan(frames * 0.4); expect(held.get(mid)).toBeLessThan(frames * 0.6); // 15 Hz
  expect(held.get(far)).toBeGreaterThan(frames * 0.6); expect(held.get(far)).toBeLessThan(frames * 0.72); // 10 Hz, moving or not
  room.dispose(); host.dispose();
});
