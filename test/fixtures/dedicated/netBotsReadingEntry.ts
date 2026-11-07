// Portable Math before anything, as every server entry starts (E7.2).
import '@wildshard/engine/core/portableMathFirst';
import { readFileSync } from 'node:fs';
import type { NetCommand } from '@wildshard/format/netCommand';
import { NetClient } from '../../../src/client/engine/net/client';
import { NET_BUTTONS } from '../../../src/shared/engine/input/netButtons';
import { installAppIdentity } from '../../../src/shared/engine/app/identity';
import { loadRapier } from '../../../src/shared/engine/physics/rapier';
import { leadPlayer } from '../../../src/shared/engine/sim/leadPlayer';
import { NetRoom } from '../../../src/server/engine/net/room';
import { SimNetWorld } from '../../../src/server/engine/net/simWorld';
import { readPackProduct } from '../../../src/server/host/dedicated/packReader';
import { createTrustedHeadlessResident } from '../../../src/server/host/headlessRuntime';
import { netTickCommands } from '../../../src/shared/host/standalone/netInput';
import { tickCommands } from '../../../src/shared/host/tickProtocol';
import { directLoopback, type DirectLoopback } from '../../../src/test/engine/netLoopback';

// E7.3e's headroom reading: `net-bots`' 32-player room, its same thumb, on whatever core this runs on. A reading, not a gate.
const [origin = '', cache = '', slug = 'driftwood-isle', build = 'dev', wasm = ''] = process.argv.slice(2), PLAYERS = 32, WARM = 300, TICKS = 1800;
installAppIdentity({ name: '', wordmark: '', tagline: '', savePrefix: 'wildshard.room.', saveFormat: '', fileSlug: '', exposeProbe: () => undefined, harness: () => undefined });
const rapier = await loadRapier(readFileSync(wasm)), input = await readPackProduct(slug, build, rapier, { origin, cache }, { fetched: 0, fetchedBytes: 0, cached: 0, refused: 0 });
const live = await createTrustedHeadlessResident(input), { host } = live, world = new SimNetWorld(host), spawn = leadPlayer(host).position;
const room = new NetRoom({ world, step: inputs => {
  const [lead, ...others] = inputs, commands = new Map<string, NetCommand>();
  for (const other of others) if (other.command !== null) commands.set(other.player, other.command);
  live.step(tickCommands([{ source: 'bots', commands: netTickCommands(lead?.command ?? null, lead?.acts ?? []) }], 8), commands);
} });
const bots: { readonly client: NetClient; readonly link: DirectLoopback }[] = [];
for (let index = 0; index < PLAYERS; index++) {
  const angle = index / PLAYERS * Math.PI * 2, at = { x: spawn.x + Math.cos(angle) * 3, y: spawn.y, z: spawn.z + Math.sin(angle) * 3 };
  const player = index === 0 ? leadPlayer(host) : host.addPlayer(`bot:${String(index)}`, at), link = directLoopback(), client = new NetClient(link.client);
  room.join(link.server, world.playerOf(player.id)); client.hello(); link.pump();
  bots.push({ client, link });
}
room.open(); for (const bot of bots) bot.link.pump();
const target = [...host.entities.keys()][0], ticks: number[] = [];
const thumb = (index: number, tick: number): Omit<NetCommand, 'seq'> => {
  const yaw = index * 0.9 + tick / (90 + index), keyY = tick % 240 < 200 ? 1 : 0, phase = (tick + index * 17) % 300;
  const buttons = (keyY === 1 ? NET_BUTTONS.sprint : 0) | (phase === 40 ? NET_BUTTONS.jump : 0) | (phase === 130 ? NET_BUTTONS.dodge : 0);
  return { viewTick: 0, steer: { keyX: 0, keyY, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons, ...(phase === 200 && target !== undefined ? { attack: { targetId: target, aim: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } } } } : {}) };
};
for (let tick = 0; tick < WARM + TICKS; tick++) {
  bots.forEach((bot, index) => { bot.client.command(thumb(index, tick)); bot.client.flush(); bot.link.pump(); });
  const started = performance.now(); room.tick(); const ms = performance.now() - started;
  for (const bot of bots) bot.link.pump();
  if (tick >= WARM) ticks.push(ms);
}
const sorted = ticks.sort((a, b) => a - b), at = (share: number): number => Number((sorted[Math.floor(sorted.length * share)] ?? 0).toFixed(2));
console.info(JSON.stringify({ reading: 'net-bots', slug, players: PLAYERS, ticks: TICKS, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: Number((sorted.at(-1) ?? 0).toFixed(2)), platform: process.platform, arch: process.arch }));
process.exit(0);
