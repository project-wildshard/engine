// TEST-SPEED TS5 (J255): net-socket-room was 22-31 s hosted.
// oxlint-disable-next-line import/no-nodejs-modules -- The product and Rapier are shipped bytes.
import { readFileSync } from 'node:fs';
import { beforeAll } from 'vitest';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { NetClient } from '../../src/client/engine/net/client';
import { NET_BUTTONS } from '../../src/shared/engine/input/netButtons';
import type { Transport } from '../../src/shared/engine/net/transport';
import type { LedgerFiling } from '../../src/server/engine/net/ledgerBook';
import { NetRoom } from '../../src/server/engine/net/room';
import { SimNetWorld } from '../../src/server/engine/net/simWorld';
import { loadRapier, type Rapier } from '../../src/shared/engine/physics/rapier';
import { leadPlayer } from '../../src/shared/engine/sim/leadPlayer';
import { outputDescriptor } from '../../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../../src/server/host/headlessProduct';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../../src/server/host/headlessRuntime';
import { ledgerFilings } from '../../src/server/host/standalone/ledgerFilings';
import { netTickCommands } from '../../src/shared/host/standalone/netInput';
import { tickCommands } from '../../src/shared/host/tickProtocol';
import { builtProduct } from './builtProduct';

// E7.1a: `net-bots`' room on real localhost sockets. Both ends are the shipped ones, and Node 24's global `WebSocket` stands in
// for the browser's. Set WS_SOCKET_REPORT=<file> to keep the run's numbers.
export const PLAYERS = 32, TICKS = 900, TARGETS = 4;
export let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

export async function resident(slug: string): Promise<TrustedHeadlessResident> {
  const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product });
}
/** Ticks the bots stand and fight before they wander. */
export const FIGHT = 600;
/** net-bots' thumb, standing to swing at a creature until the fight is over, so blows land and loot falls. */
export function input(index: number, tick: number, target: string | undefined): Omit<NetCommand, 'seq'> {
  const yaw = index * 0.9 + tick / (90 + index), keyY = tick >= FIGHT && tick % 240 < 200 ? 1 : 0, phase = (tick + index * 17) % 300;
  const buttons = (keyY === 1 ? NET_BUTTONS.sprint : 0) | (phase === 40 ? NET_BUTTONS.jump : 0) | (phase === 130 ? NET_BUTTONS.dodge : 0);
  return { viewTick: 0, steer: { keyX: 0, keyY, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons,
    ...(tick < FIGHT && (tick + index) % 20 === 0 && target !== undefined ? { attack: { targetId: target, aim: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } } } } : {}) };
}

/** A line per thing a client heard, and where each body ended up: everything a game makes of a session. */
export interface Session { readonly facts: readonly (readonly string[])[]; readonly ledger: readonly (readonly string[])[]; readonly ends: readonly (readonly (number | undefined)[])[]; readonly dropped: number; readonly refused: number }

/** One room, one transport pair per bot, stepped in lockstep with `pump`: the same inputs at the same ticks, however bytes travel. */
export async function session(live: TrustedHeadlessResident, pairs: readonly { readonly client: Transport; readonly server: Transport }[], pump: () => Promise<void>): Promise<Session> {
  const { host } = live, first = leadPlayer(host).id, planted: LedgerFiling[] = [];
  const world = new SimNetWorld(host, 0, () => [...planted.splice(0), ...ledgerFilings(host, first, live.effects, null)]);
  const room = new NetRoom({ world, step: inputs => {
    const [lead, ...others] = inputs, commands = new Map<string, NetCommand>();
    for (const other of others) if (other.command !== null) commands.set(other.player, other.command);
    live.step(tickCommands([{ source: 'bots', commands: netTickCommands(lead?.command ?? null, lead?.acts ?? []) }], 8), commands);
  } });
  const creatures = [...host.entities].slice(0, TARGETS);
  for (const [, creature] of creatures) creature.harnessHold = true;
  const bots = pairs.map((pair, index) => {
    const [id, creature] = creatures[index % creatures.length] ?? [], angle = index / PLAYERS * Math.PI * 8;
    if (id === undefined || creature === undefined) throw new Error('No creature');
    const at = { x: creature.position.x + Math.cos(angle) * 1.5, y: creature.position.y, z: creature.position.z + Math.sin(angle) * 1.5 };
    return { id: index === 0 ? first : host.addPlayer(`bot:${String(index)}`, at).id, target: id, client: new NetClient(pair.client, () => 0), facts: [] as string[], ledger: [] as string[], server: pair.server };
  });
  for (const bot of bots) {
    room.join(bot.server, world.playerOf(bot.id)); bot.client.hello();
    bot.client.onCombat(event => { bot.facts.push(JSON.stringify(event)); });
    bot.client.onView(event => { bot.facts.push(JSON.stringify(event)); });
    bot.client.onLedger(event => { bot.ledger.push(JSON.stringify(event)); });
  }
  await pump(); room.open(); await pump();
  for (let tick = 0; tick < TICKS; tick++) {
    if (tick % 120 === 60) for (const bot of bots) planted.push({ player: bot.id, id: `planted.${String(tick)}`, tick, grant: 'coins', name: 'coins', amount: 1 + tick, pending: false });
    bots.forEach((bot, index) => { bot.client.command(input(index, tick, bot.target)); bot.client.flush(); });
    await pump(); room.tick(); await pump();
  }
  const ends = bots.map(bot => { const frame = bot.client.latest; if (frame === null) throw new Error('No frame'); const owner = bot.client.owner(frame), body = host.players.get(bot.id); return [frame.tick, Number(owner['px']), Number(owner['py']), Number(owner['pz']), body?.position.x, frame.lastSeq, frame.rows.size]; });
  for (const bot of bots) { bot.facts.push(JSON.stringify([...bot.client.owned]), JSON.stringify([...bot.client.quests]), JSON.stringify([...bot.client.entities.keys()])); }
  const out: Session = { facts: bots.map(bot => bot.facts), ledger: bots.map(bot => bot.ledger), ends, dropped: bots.reduce((sum, bot) => sum + bot.client.dropped, 0), refused: room.admission.refused + room.stats.refused };
  room.dispose();
  return out;
}
