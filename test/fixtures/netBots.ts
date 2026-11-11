// TEST-SPEED TS5 (J255): net-bots was 20-33 s hosted.
// oxlint-disable-next-line import/no-nodejs-modules -- The product and Rapier are shipped bytes.
import { readFileSync, writeFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { diagnosticNow } from '../../src/shared/engine/core/clock';
import { NetClient } from '../../src/client/engine/net/client';
import { NET_BUTTONS } from '../../src/shared/engine/input/netButtons';
import { NetRoom } from '../../src/server/engine/net/room';
import { SimNetWorld } from '../../src/server/engine/net/simWorld';
import { loadRapier, type Rapier } from '../../src/shared/engine/physics/rapier';
import { directLoopback, type DirectLoopback } from '../../src/test/engine/netLoopback';
import { leadPlayer } from '../../src/shared/engine/sim/leadPlayer';
import { outputDescriptor } from '../../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../../src/server/host/headlessProduct';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../../src/server/host/headlessRuntime';
import { netTickCommands } from '../../src/shared/host/standalone/netInput';
import { tickCommands } from '../../src/shared/host/tickProtocol';
import { builtProduct } from './builtProduct';

// P1-E5.2a (MMO-REQUIREMENTS B4, M9): a full room. 32 players on a real shard, each a NetClient over its own DirectLoopback
// on the real codec, in one SimHost. Only the bots' fingers are fake. Tick p95 is the measured number; set
// WS_ROOM_REPORT=<file> to keep it. The ceiling is the sim's own rate: a room that cannot hold 60 Hz has already failed.
export const PLAYERS = 32, WARM = 300, TICKS = 1800, TICK_BUDGET_MS = 1000 / 60;
export let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

/** `world` as a cell's room opens it (MP1.2: `{ room: true, near }` runs the seats' held arms, as the box does). */
export async function resident(slug: string, world?: Parameters<typeof createTrustedHeadlessResident>[2]): Promise<TrustedHeadlessResident> {
  const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product }, undefined, world);
}
export interface Bot { readonly id: string; readonly client: NetClient; readonly link: DirectLoopback }
/** A wandering, jumping, dodging, occasionally swinging thumb, from a fixed sequence so a run repeats. */
export function input(index: number, tick: number, target: string | undefined): Omit<NetCommand, 'seq'> {
  const yaw = index * 0.9 + tick / (90 + index), keyY = tick % 240 < 200 ? 1 : 0, phase = (tick + index * 17) % 300;
  const buttons = (keyY === 1 ? NET_BUTTONS.sprint : 0) | (phase === 40 ? NET_BUTTONS.jump : 0) | (phase === 130 ? NET_BUTTONS.dodge : 0);
  return { viewTick: 0, steer: { keyX: 0, keyY, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons,
    ...(phase === 200 && target !== undefined ? { attack: { targetId: target, aim: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } } } } : {}) };
}
export const percentile = (sorted: readonly number[], at: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * at))] ?? Infinity;

export function run(live: TrustedHeadlessResident): { tierSkipsPerFrame: number; p50: number; p95: number; p99: number; max: number; creatures: number; downPerClient: number; rowsSeen: number; moved: number } {
  const { host } = live, world = new SimNetWorld(host), spawn = leadPlayer(host).position, bots: Bot[] = [];
  const room = new NetRoom({ world, step: inputs => {
    const [lead, ...others] = inputs, commands = new Map<string, NetCommand>();
    for (const other of others) if (other.command !== null) commands.set(other.player, other.command);
    live.step(tickCommands([{ source: 'bots', commands: netTickCommands(lead?.command ?? null, lead?.acts ?? []) }], 8), commands);
  } });
  for (let index = 0; index < PLAYERS; index++) {
    const angle = index / PLAYERS * Math.PI * 2, at = { x: spawn.x + Math.cos(angle) * 3, y: spawn.y, z: spawn.z + Math.sin(angle) * 3 };
    const player = index === 0 ? leadPlayer(host) : host.addPlayer(`bot:${String(index)}`, at), link = directLoopback(), client = new NetClient(link.client);
    room.join(link.server, world.playerOf(player.id)); client.hello(); link.pump();
    bots.push({ id: player.id, client, link });
  }
  room.open(); for (const bot of bots) bot.link.pump();
  const starts = bots.map(bot => host.players.get(bot.id)?.position.clone()), ticks: number[] = [], target = [...host.entities.keys()][0];
  let down = 0;
  for (let tick = 0; tick < WARM + TICKS; tick++) {
    bots.forEach((bot, index) => { bot.client.command(input(index, tick, target)); bot.client.flush(); bot.link.pump(); });
    const started = diagnosticNow(); room.tick(); const ms = diagnosticNow() - started;
    if (tick === WARM) down = bots.reduce((sum, bot) => sum + bot.link.client.stats.recvBytes, 0);
    for (const bot of bots) bot.link.pump();
    if (tick >= WARM) ticks.push(ms);
  }
  const sorted = ticks.slice().sort((a, b) => a - b), seconds = TICKS / 60;
  const moved = bots.filter((bot, index) => { const start = starts[index], now = host.players.get(bot.id)?.position; return start !== undefined && now !== undefined && now.distanceTo(start) > 1; }).length;
  bots.forEach(bot => {
    const { latest } = bot.client, player = host.players.get(bot.id);
    expect(bot.client.dropped).toBe(0);
    if (latest === null || player === undefined) throw new Error('No frame');
    expect(bot.client.owner(latest)['px']).toBe(player.position.x);
  });
  const last = bots.at(-1)?.client.latest;
  expect(room.admission.refused).toBe(0);
  // P1-E5.2c: what a client holds for a far creature is an old row, but a true one: it trails by what the body covers between sends.
  for (const bot of bots) {
    const frame = bot.client.latest, player = host.players.get(bot.id);
    if (frame === null || player === undefined) throw new Error('No frame');
    for (const entity of bot.client.entities.values()) {
      const sim = host.entities.get(entity.id), fields = bot.client.fields(frame, entity.handle);
      if (sim === undefined || fields === null) continue;
      expect(Math.hypot(Number(fields['x']) - sim.position.x, Number(fields['z']) - sim.position.z), `${bot.id} on ${entity.id}`).toBeLessThan(sim.position.distanceTo(player.position) > 59 ? 1.5 : 0.5);
    }
  }
  return { tierSkipsPerFrame: room.stats.tierSkips / room.stats.frames, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), max: sorted.at(-1) ?? Infinity, creatures: host.entities.size,
    downPerClient: (bots.reduce((sum, bot) => sum + bot.link.client.stats.recvBytes, 0) - down) / PLAYERS / seconds, rowsSeen: last === null || last === undefined ? 0 : last.rows.size, moved };
}

/** TEST-SPEED TS5: the 32-player tick proof, moved verbatim; net-bots.test.ts runs Sunscar, net-bots-driftwood.test.ts Driftwood. */
export function roomTickCases(slugs: readonly string[]): void {
test.each(slugs)('32 players on %s hold a 60 Hz tick', async slug => {
  const live = await resident(slug), result = run(live);
  live.dispose();
  const line = `room ${slug} ${PLAYERS} players ${result.creatures} creatures: tick p50 ${result.p50.toFixed(2)} ms, p95 ${result.p95.toFixed(2)} ms, p99 ${result.p99.toFixed(2)} ms, max ${result.max.toFixed(2)} ms, down ${(result.downPerClient / 1024).toFixed(1)} KB/s per client`;
  console.info(line);
  const report = process.env['WS_ROOM_REPORT'];
  if (report !== undefined) writeFileSync(report, `${JSON.stringify({ slug, players: PLAYERS, ...result })}\n`, { flag: 'a' });
  expect(result.moved).toBe(PLAYERS);
  expect(result.tierSkipsPerFrame, 'far entities use their tier').toBeGreaterThan(0);
  expect(result.rowsSeen).toBeGreaterThanOrEqual(PLAYERS - 1); // everyone else, within a client's view of the crowd
  expect(result.p95).toBeLessThan(TICK_BUDGET_MS);
}, 180_000);
}
