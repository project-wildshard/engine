// Portable Math before anything, as every server entry starts (E7.2).
import '@wildshard/engine/core/portableMathFirst';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NetClient } from '../../../src/client/engine/net/client';
import { NET_BUTTONS } from '../../../src/shared/engine/input/netButtons';
import { loadRapier } from '../../../src/shared/engine/physics/rapier';
import { portableMathInstalled } from '../../../src/shared/engine/core/portableMath';
import { installAppIdentity } from '../../../src/shared/engine/app/identity';
import { serializeSimSnapshot, snapshotSimHostBytes } from '../../../src/shared/engine/sim/snapshot';
import { DedicatedRoom } from '../../../src/server/host/dedicated/dedicatedRoom';
import { readPackFolder } from '../../../src/server/host/dedicated/packReader';
import { directLoopback, type DirectLoopback } from '../../../src/test/engine/netLoopback';

// E7.2a: a fixed tape through the real room: two seats on a fixed thumb, in lockstep with no clock. Every second of it goes in a hash,
// and at the end the whole world's snapshot does too. The bundle runs on Darwin and on Linux, and the two lines must be the same.
const [origin = '', cache = '', slug = 'driftwood-isle', build = 'tape', ticksArg = '3600', wasm = ''] = process.argv.slice(2), TICKS = Number(ticksArg);
installAppIdentity({ name: '', wordmark: '', tagline: '', savePrefix: 'wildshard.room.', saveFormat: '', fileSlug: '', exposeProbe: () => undefined, harness: () => undefined });
const rapier = await loadRapier(readFileSync(wasm)), reads = { fetched: 0, fetchedBytes: 0, cached: 0, refused: 0 }, input = await readPackFolder(slug, build, rapier, { origin, cache }, reads);
let now = 0;
const room = await DedicatedRoom.boot({ slug, build, bootId: 'tape', input, now: () => now, post: () => undefined });
interface Phone { readonly client: NetClient; readonly link: DirectLoopback; readonly index: number }
function enter(device: string, index: number): Phone {
  const link = directLoopback(), client = new NetClient(link.client);
  room.seat({ device, name: device, body: `p.${device}`, doc: null, seq: 0 }, link.server, () => { client.hello(build, { player: device, name: device }); link.pump(); });
  link.pump();
  return { client, link, index };
}
const phones = [enter('a', 0), enter('b', 1)], stood = [...room.host.players.values()].map(player => player.position.clone()), digest = createHash('sha256'), started = performance.now();
const thumb = (index: number, tick: number): Parameters<NetClient['command']>[0] => {
  const yaw = index * 2.1 + tick / 170, phase = (tick + index * 31) % 240;
  return { viewTick: 0, steer: { keyX: 0, keyY: phase < 200 ? 1 : 0, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: phase === 60 ? NET_BUTTONS.jump : phase === 120 ? NET_BUTTONS.dodge : phase === 180 ? NET_BUTTONS.sprint : 0 };
};
const say = (tick: number): void => {
  const rows: (string | number)[] = [tick];
  for (const player of room.host.players.values()) rows.push(player.id, player.position.x, player.position.y, player.position.z, player.yaw, player.health.attributes.health);
  for (const [id, sim] of room.host.entities) rows.push(id, sim.position.x, sim.position.y, sim.position.z, sim.hp);
  digest.update(JSON.stringify(rows));
};
for (let tick = 0; tick < TICKS; tick++) {
  for (const { client, link, index } of phones) { client.command(thumb(index, tick)); client.flush(); link.pump(); }
  now += 1000 / 60; room.tick();
  for (const { link } of phones) link.pump();
  if (tick % 60 === 0) say(tick);
}
const snapshot = createHash('sha256').update(serializeSimSnapshot(snapshotSimHostBytes(room.host))).digest('hex');
const moved = [...room.host.players.values()].map((player, index) => Number(player.position.distanceTo(stood[index] ?? player.position).toFixed(2)));
if (moved.some(metres => metres === 0)) throw new Error(`A seat never moved: ${String(moved)}`);
console.log(JSON.stringify({ slug, ticks: TICKS, moved, sim: digest.digest('hex'), snapshot, entities: room.host.entities.size, portableMath: portableMathInstalled(), sin1: Math.sin(1), node: process.version, platform: process.platform, arch: process.arch, msPerTick: Number(((performance.now() - started) / TICKS).toFixed(3)), reads }));
process.exit(0);
