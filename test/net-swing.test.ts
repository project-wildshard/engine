// oxlint-disable-next-line import/no-nodejs-modules -- The room runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/format/netCommand';
import { NetClient } from '../src/client/engine/net/client';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { shotRandom, shotSpread } from '../src/shared/engine/combat/shotSpread';
import { SweptMeleeCore } from '../src/shared/engine/combat/sweptMeleeCore';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { directLoopback } from '../src/test/engine/netLoopback';
import { readNativeRangedItem } from '../src/server/game/plugin/nativeItems';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { STARTER_MELEE_PROFILE } from '../src/shared/game/weapons/starterCombat';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { netTickCommands } from '../src/shared/host/standalone/netInput';
import { tickCommands } from '../src/shared/host/tickProtocol';
import { builtProduct } from './fixtures/builtProduct';

// P1-E5.3-E1, E4 (J47): what the client predicts of an attack against what the server ran, in a real room on a real shard.
const DT = 1 / 60;

async function shard(slug: string): Promise<TrustedHeadlessResident> {
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error(`Missing ${slug} output`);
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product });
}
const hold = (live: TrustedHeadlessResident): void => { for (const actor of live.host.entities.values()) actor.harnessHold = true; };
const FREE = { aim: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } } };

/** A three-swing chain, played by the server and by a client's own clock from one command stream. */
async function chain(hits: boolean): Promise<{ apart: number; server: number; client: number; hitsHeard: number }> {
  const live = await shard('driftwood-isle'), { host } = live, player = leadPlayer(host), link = directLoopback(), client = new NetClient(link.client);
  const crab = [...host.entities.values()].filter(row => row.kind === 'crab' && row.alive).sort((a, b) => a.position.distanceTo(player.position) - b.position.distanceTo(player.position))[0];
  if (crab === undefined) throw new Error('No crab');
  hold(live);
  const { x, y, z } = crab.position, feetY = host.groundHeightAt(x, z + 1.4), pitch = Math.atan2(y + crab.dims.bodyY * crab.scale - (feetY + 1.68), 1.4);
  player.resetPose({ x, y: feetY, z: z + 1.4 }, 0);
  const room = new NetRoom({ world: new SimNetWorld(host), step: inputs => {
    const own = inputs[0]; hold(live); crab.hp = crab.maxHp;
    if (!hits) crab.position.y = y - 40;
    live.step(tickCommands([{ source: 'test', commands: netTickCommands(own?.command ?? null, own?.acts ?? []) }], 8));
  } });
  room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  // the client's own clock, on the same moves and the same law
  let queued = false, serverEnd = -1, clientEnd = -1, hitsHeard = 0, last = -1;
  const { moves, swingScale } = STARTER_MELEE_PROFILE;
  const clock = new SweptMeleeCore(moves, STARTER_MELEE_PROFILE, { queue: () => { queued = true; }, consume: () => { const was = queued; queued = false; return was; } }, { start: () => undefined, charge: () => undefined });
  const phases = new Map<number, number>();
  let phaseApart = 0;
  client.onCombat(event => { if (event.kind === 'hit' && event.confirmFor !== 0) hitsHeard++; });
  client.onFrame(frame => {
    const phase = client.owner(frame)['swingPhase'], mine = phases.get(frame.lastSeq);
    if (typeof phase === 'number' && !Number.isNaN(phase) && mine !== undefined) phaseApart = Math.max(phaseApart, Math.abs(phase - mine));
  });
  for (let at = 0; at < 150; at++) {
    const press = at === 0 || at === 16 || at === 34;
    const command: Omit<NetCommand, 'seq'> = { viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch, buttons: 0, ...(press ? { attack: FREE } : {}) };
    const seq = client.command(command);
    if (press) clock.tryFire();
    const { move } = clock.step(DT, at * DT, swingScale, false);
    if (move !== null) { phases.set(seq, clock.swingTime); last = at; } else phases.delete(seq);
    if (move === null && clientEnd === -1 && last !== -1 && at > 40) clientEnd = at;
    client.flush(); link.pump(); room.tick(); link.pump();
    if (player.swing.t === null && serverEnd === -1 && at > 40) serverEnd = at;
  }
  room.dispose(); client.dispose(); live.dispose();
  return { apart: phaseApart, server: serverEnd, client: clientEnd, hitsHeard };
}

test('over a chain, with hits and without, the client\'s clock and the server\'s stay a tick apart', async () => {
  const struck = await chain(true), swung = await chain(false);
  process.stdout.write(`swing clocks ${JSON.stringify({ struck, swung })}\n`);
  expect(struck.hitsHeard).toBeGreaterThan(1); expect(swung.hitsHeard).toBe(0);
  expect(Math.abs(struck.server - struck.client)).toBeLessThanOrEqual(1);
  expect(Math.abs(swung.server - swung.client)).toBeLessThanOrEqual(1);
  expect(swung.apart).toBeLessThanOrEqual(DT + 1e-6);
  expect(struck.apart).toBeLessThanOrEqual(DT + 1e-6);
  // a hit-stop is visual (Game.hitStop): neither clock serves one
  expect(struck.server).toBe(swung.server);
}, 120_000);

/** Where a shot on `seq` goes on a fresh Pine, once the world's own stream has been drawn from `burn` times. */
async function shot(seq: number, burn: number): Promise<{ velocity: Vector3; muzzle: Vector3; pos: Vector3 }> {
  const live = await shard('pine-hollow'), { host } = live, player = leadPlayer(host), yaw = player.yaw, stand = { kind: 'player' as const, moveX: 0, moveZ: 0, yaw };
  for (let at = 0; at < burn; at++) host.rng.stream('gameplay').next();
  hold(live); live.step([stand]);
  const pitch = 0.2, command: NetCommand = { seq, viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw, pitch, buttons: 0, launcher: { slot: 0, ads: 0, fire: true } };
  hold(live); live.step(tickCommands([{ source: 'test', commands: netTickCommands(command, []) }], 8));
  expect(readNativeRangedItem(host, 0).kind).toBe('bolt');
  const triple = v.tuple([v.number(), v.number(), v.number()]), { bolts } = v.parse(v.object({ bolts: v.array(v.object({ active: v.boolean(), vel: triple, pos: triple })) }), host.adapters.get('pine.crossbow')?.snapshot());
  const bolt = bolts.find(row => row.active); if (bolt === undefined) throw new Error('No bolt');
  const out = { velocity: new Vector3(...bolt.vel), pos: new Vector3(...bolt.pos), muzzle: player.position.clone() };
  live.dispose();
  return out;
}

test('a shot spreads from its seq, so the client flies the server\'s shot whatever the world has drawn', async () => {
  const first = await shot(4242, 0), later = await shot(4242, 17), other = await shot(4243, 0);
  expect(later.velocity.distanceTo(first.velocity)).toBeLessThan(1e-9);
  expect(other.velocity.distanceTo(first.velocity)).toBeGreaterThan(1e-3);
  // the client's half of the law: the same four draws off the same seq
  const random = shotRandom(4242), mine = new Vector3(0, 0, -1), side = new Vector3(), copy = shotRandom(4242), twin = new Vector3(0, 0, -1);
  shotSpread(mine, 0.02, random, { radius: 'linear', axisScale: 2 }, side); shotSpread(twin, 0.02, copy, { radius: 'linear', axisScale: 2 }, side);
  expect(mine).toEqual(twin);
  expect(new Set(Array.from({ length: 2000 }, (_, seq) => Math.round(shotRandom(seq + 1)() * 50))).size).toBe(51);
}, 120_000);
