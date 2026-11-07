import type { SimHost } from '../../../src/server/engine/sim';
import type { HeadlessCommand } from '../../../src/shared/host/tickProtocol';
import { readNativeQuestSpots } from '@wildshard/engine/game/quest/nativeComposition';
import { DRIFTWOOD_SPOTS as nativeQuestSpots } from '../../../src/shards/driftwood-isle/generators/spots';
import policy from '../../../src/shards/driftwood-isle/data/nativeQuest.json' with { type: 'json' };
import * as v from 'valibot';
import { Vector3 } from 'three';
import { CableLayout } from '../../../src/shared/engine/sim/cableTraversal';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const { step: QUEST_STEP } = policy;

type Point = readonly [number, number];
const spots = readNativeQuestSpots(nativeQuestSpots);
/** Author a tape from real observations and bounded player/script inputs. No pose, HP, flag or fact writes. */
export async function playDriftwood(host: SimHost, tick: (commands: HeadlessCommand[]) => void | Promise<void>, mark: (name: string) => Promise<void>, journey: 'sealed-ring' | 'zipline' | 'zipline-from-lookout' = 'sealed-ring'): Promise<void> {
  const wait = async (count: number): Promise<void> => { for (let i = 0; i < count; i++) await tick([]); };
  const doubloons = (expected: number): void => {
    const pack = v.parse(v.object({ pack: v.object({ counts: v.record(v.string(), v.number()) }) }), host.adapters.get(QUEST_STEP)?.snapshot()).pack;
    if (pack.counts['doubloon'] !== expected) throw new Error(`Real chest pack diverged: expected ${String(expected)} doubloons`);
  };
  const go = async (x: number, z: number): Promise<void> => {
    let best = Infinity, stall = 0;
    for (let frame = 0; frame < 3600; frame++) {
      const p = leadPlayer(host).position, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      if (d < 0.25) return;
      if (d < best - 0.02) { best = d; stall = 0; } else stall++;
      const k = Math.min(1, d / 0.8) / Math.max(0.01, d);
      await tick([{ kind: 'player', moveX: dx * k, moveZ: dz * k, yaw: Math.atan2(-dx, -dz), ...(stall > 60 && stall % 30 === 0 ? { jump: true as const } : {}) }]);
    }
    throw new Error(`Driftwood tape stuck walking to ${String(x)},${String(z)} from ${JSON.stringify(leadPlayer(host).position.toArray())}`);
  };
  const walk = async (path: readonly Point[]): Promise<void> => { for (const [x, z] of path) await go(x, z); };
  const act = async (id: string, flag: string): Promise<void> => {
    await wait(60); const row = spots.rows.findIndex(r => r.id === id);
    if (row === -1) throw new Error(`No Driftwood prompt ${id}`);
    await tick([{ kind: 'script', actorId: 'driftwood.interact', value: 100 + row }]);
    if (!host.flags.has(flag)) throw new Error(`Driftwood prompt ${id} did not raise ${flag}: ${JSON.stringify({p:leadPlayer(host).position.toArray(),row:spots.rows[row],flags:host.flags.all})}`);
  };
  const fight = async (id: string, gap: number, interval: number): Promise<void> => {
    let captured = false;
    for (let frame = 0; frame < 6000; frame++) {
      const a = host.entities.get(id); if (a === undefined) throw new Error(`Missing live actor ${id}`);
      if (!a.alive) return;
      const p = leadPlayer(host).position, dx = a.position.x - p.x, dz = a.position.z - p.z, d = Math.hypot(dx, dz), k = d > gap ? 1 / Math.max(d, 0.01) : 0;
      await tick([{ kind: 'player', moveX: dx * k, moveZ: dz * k, yaw: Math.atan2(-dx, -dz), ...(frame % interval === 0 ? { attack: { targetId: id } } : {}) }]);
      if (a.kind === 'captain' && a.hp < 200 && !captured) { await mark('captain'); captured = true; }
    }
    throw new Error(`Driftwood tape did not defeat ${id}`);
  };
  if (journey !== 'zipline-from-lookout') {
    await walk([[0, -186.5], [-8, -172], [-17, -161], [-20, -150], [-30, -142], [-30, -130], [-30, -118], [-30, -106], [-30, -104], [-24, -80], [-22, -74], [-22, -71.5]]);
    await tick([{ kind: 'script', actorId: 'driftwood.interact', value: 0 }]);
    if (!host.flags.has('talked:castaway')) throw new Error('Wendell did not speak');
    await walk([[-22, -68.9], [-22, -67.6], [-22, -66.7], [-22, -65.2], [-22, -62.9]]); await act('castaway-chest', 'has:flint');
    doubloons(2);
    await walk([[-22, -67.6], [-22, -71.5], [-8, -50], [10.8, -27.8], [15.4, -8.6], [15.6, -7], [13.88, 11.88], [15.29, 13.29], [23.99, 21.99], [31.98, 29.98], [35.8, 33.8], [46, 46], [60, 60], [76, 76], [86.1, 82.45], [86.94, 83.68], [87.68, 84.76], [90.27, 88.55], [92.76, 92.18], [94.17, 94.25]]);
    await act('beacon', 'lit:beacon'); await go(93.65, 95.2); await act('shard-lookout', 'shard:lookout'); await mark('lookout');
  } else if (!host.flags.has('lit:beacon') || !host.flags.has('shard:lookout')) throw new Error('Missing earned lookout continuation');
  if (journey !== 'sealed-ring') {
    // Leave the lookout by foot, cross the native headland and approach the captured deck's single stair side.
    // The remaining waypoints are player steering targets; neither this route nor the prompt writes a pose or grant.
    const spec = spots.zipline, layout = new CableLayout({ top: new Vector3(spec.top.x, spec.top.y, spec.top.z),
      bottom: new Vector3(spec.bottom.x, spec.bottom.y, spec.bottom.z), sag: spec.sag }), deck = layout.deck;
    const c = Math.cos(deck.yaw), s = Math.sin(deck.yaw);
    await walk([[100, 90], [108, 82], [112, 74], [114, 66],
      [deck.x + (deck.hw + 0.8) * c, deck.z - (deck.hw + 0.8) * s],
      [deck.x + (deck.hw + 0.2) * c, deck.z - (deck.hw + 0.2) * s], [deck.x, deck.z]]);
    await wait(30);
    if (host.flags.has('used:zipline')) throw new Error('Zipline feat was granted before the real prompt');
    await mark('zipline-launch');
    await tick([{ kind: 'script', actorId: 'driftwood.interact', value: 2 }]);
    const ride = (): boolean => v.parse(v.object({ zipline: v.object({ riding: v.boolean() }) }), host.adapters.get(QUEST_STEP)?.snapshot()).zipline.riding;
    if (!ride()) throw new Error('Continuous lookout walk did not reach the live zipline prompt');
    for (let frame = 0; frame < 900; frame++) {
      await tick([]);
      if (frame === 96) { if (!ride()) throw new Error('Zipline ended before its mid-ride checkpoint'); await mark('zipline-mid'); }
      if (!ride()) {
        if (!host.flags.has('used:zipline')) throw new Error('Real zipline landing did not earn its feat');
        await mark('zipline-landed'); return;
      }
    }
    throw new Error('Real zipline ride exceeded its bounded continuation');
  }
  await walk([[92.76, 92.18], [90.27, 88.55], [87.68, 84.76], [86.1, 82.45], [76, 76], [60, 60], [46, 46], [35.8, 33.8], [23.99, 21.99], [15.29, 13.29], [13.88, 11.88], [15.6, -7], [62, 0], [80, -1.5], [100, -2], [124, 1.5], [144, 0], [147, 0.8], [149, 1.2], [150.5, 1.8], [152, 2.5]]);
  const sailor = [...host.entities.values()].find(a => a.kind === 'sailor'); if (sailor === undefined) throw new Error('Missing sailor');
  await fight(sailor.entityId, 1.4, 50);
  // The key follows the sailor's actual fall; water/wading can change where that fight ends.
  const key = v.parse(v.object({ key: v.object({ x: v.number(), z: v.number() }) }), host.adapters.get(QUEST_STEP)?.snapshot()).key;
  await go(key.x, key.z); await act('hold-key', 'key:hold');
  await go(155.2, -1.3); await act('hold-pump', 'lever:hold-pump');
  await go(154.7, -1.3); await act('hold-winch', 'winch:up'); await act('strongbox', 'shard:wreck');
  doubloons(5);
  await go(152.7, 3); await tick([{ kind: 'script', actorId: 'driftwood.interact', value: 1 }]); await mark('wreck');
  await walk([[152, 2.5], [150.5, 1.8], [149, 1.2], [147, 0.8]]);
  // Clear the actual plate approach in nearest-first order. Chasing the first roster crab through the wreck's solid hull is not a player route.
  const plateCrabs = [...host.entities].filter(([, a]) => a.kind === 'crab' && a.alive && Math.hypot(a.position.x - 144.9, a.position.z - 9.9) < 12);
  const threats = plateCrabs.length;
  for (let i = 0; i < threats; i++) {
    plateCrabs.sort(([, a], [, b]) => a.position.distanceToSquared(leadPlayer(host).position) - b.position.distanceToSquared(leadPlayer(host).position));
    const row = plateCrabs.shift(); if (row !== undefined) await fight(row[0], 1.2, 50);
  }
  const state = v.parse(v.object({ barrel: v.object({ handle: v.number() }) }), host.adapters.get(QUEST_STEP)?.snapshot());
  const body = host.physics.world.getRigidBody(state.barrel.handle), at = (): ReturnType<typeof body.translation> => body.translation();
  const home = { x: 147.5, z: 3.5 }, plate = { x: 144.9, z: 9.9 };
  await go(home.x + 0.9, home.z - 2.5);
  let stuck = 0;
  for (let move = 0; move < 16; move++) {
    const c = at(), dx = plate.x - c.x, dz = plate.z - c.z, d = Math.hypot(dx, dz);
    if (d < 0.35 || (d < 0.7 && host.flags.has('plate:tide-plate-b'))) break;
    const q = body.rotation(), ax = 2 * (q.x * q.y - q.w * q.z), ay = 1 - 2 * (q.x * q.x + q.z * q.z), az = 2 * (q.y * q.z + q.w * q.x), al = Math.hypot(ax, az);
    let ux = dx / d, uz = dz / d, far = d;
    if (Math.abs(ay) < 0.7 && al > 1e-6) {
      const hx = ax / al, hz = az / al, along = dx * hx + dz * hz, across = -dx * hz + dz * hx;
      if (Math.abs(along) >= Math.abs(across)) { const s = Math.sign(along); ux = hx * s; uz = hz * s; far = Math.abs(along); }
      else { const s = Math.sign(across); ux = -hz * s; uz = hx * s; far = Math.abs(across); }
    }
    const p = leadPlayer(host).position, side = (p.x - c.x) * -uz + (p.z - c.z) * ux >= 0 ? 1 : -1;
    if ((p.x - c.x) * ux + (p.z - c.z) * uz > -0.6) await walk([[c.x - uz * side * 1.4 + ux * 0.2, c.z + ux * side * 1.4 + uz * 0.2], [c.x - uz * side * 1.2 - ux * 1.2, c.z + ux * side * 1.2 - uz * 1.2]]);
    await go(c.x - ux * 1.3, c.z - uz * 1.3);
    let rest = 0, last = at();
    for (let frame = 0; frame < 900 && rest < 30; frame++) {
      const b = at(), feet = leadPlayer(host).position, gone = (b.x - c.x) * ux + (b.z - c.z) * uz;
      if (gone >= far - 0.05) break;
      const lat = (feet.x - b.x) * -uz + (feet.z - b.z) * ux, speed = far - gone > 1.2 ? 0.3 : 0.12;
      await tick([{ kind: 'player', moveX: ux * speed + uz * lat * 2, moveZ: uz * speed - ux * lat * 2, yaw: 0 }]);
      rest = Math.hypot(b.x - last.x, b.z - last.z) < 1e-3 && Math.hypot(feet.x - b.x, feet.z - b.z) < 1 ? rest + 1 : 0; last = b;
    }
    await wait(45); const moved = at(); stuck = Math.hypot(moved.x - c.x, moved.z - c.z) < 0.1 ? stuck + 1 : 0;
    if (stuck < 2) continue;
    for (let frame = 0; frame < 400; frame++) {
      const b = at(), feet = leadPlayer(host).position, dx2 = b.x - feet.x, dz2 = b.z - feet.z, d2 = Math.hypot(dx2, dz2);
      if (Math.hypot(b.x - home.x, b.z - home.z) < 0.5) break;
      await tick([{ kind: 'player', moveX: dx2 / d2, moveZ: dz2 / d2, yaw: 0 }]);
    }
    stuck = 0; await walk([[plate.x - 0.4, plate.z - 1.1], [home.x - 0.9, home.z + 2]]);
  }
  if (!host.flags.has('plate:tide-plate-b')) throw new Error('Barrel did not hold plate B'); await mark('barrel');
  const r = 1.9, k = r * Math.SQRT1_2, ring: Point[] = [[plate.x, plate.z + r], [plate.x + k, plate.z + k], [plate.x + r, plate.z], [plate.x + k, plate.z - k], [plate.x, plate.z - r], [plate.x - k, plate.z - k]];
  let from = 0, best = Infinity;
  ring.forEach(([x, z], i) => { const d = Math.hypot(x - leadPlayer(host).position.x, z - leadPlayer(host).position.z); if (d < best) { best = d; from = i; } });
  await walk([...ring.slice(from), [143.3, 9], [140, 9.05], [139.1, 9.9]]); await wait(10);
  if (!host.flags.has('open:sluice')) throw new Error('Two physical plates did not open the sluice');
  await walk([[140, 9.05], [143.3, 9], ...ring.slice(0, 4).reverse(), [146.8, 12.6], [142, 13.4], [142, 19.2], [142, 21.3]]); await act('shard-cave', 'shard:cave');
  await walk([[142, 19.2], [142, 13.4], [146.8, 12.6], [148, 5], [147, 0.8], [124, 1.5], [100, -2], [80, -1.5], [62, 0], [30, 0], [0, 0], [-30, 0], [-60, 0], [-72, 20], [-80, 45], [-88, 70], [-86.49, 92.26], [-88.26, 94.68], [-89.62, 96.54], [-91.51, 99.12], [-93.39, 101.7], [-93.87, 102.35], [-95.34, 104.37], [-96.82, 106.39], [-97.35, 107.11], [-98, 108.4]]);
  await act('altar', 'used:altar'); const captain = [...host.entities.values()].find(a => a.kind === 'captain'); if (captain === undefined) throw new Error('Altar did not wake the captain');
  await fight(captain.entityId, 1.3, 45);
  if (!host.flags.has('dead:captain')) throw new Error('Captain death was not filed');
  await go(spots.reward.x, spots.reward.z); await wait(450);
  if (!host.flags.has('quest:driftwood-done')) throw new Error('Reward did not complete the quest'); await mark('complete');
}
