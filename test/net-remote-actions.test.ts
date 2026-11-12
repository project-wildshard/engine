// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { NetClient, type NetFields } from '../src/client/engine/net/client';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { builtProduct } from './fixtures/builtProduct';

// REMOTE-PLAYERS RP6: what another page needs to animate a player. Before RP6 a row for others carried only position,
// facing, board, swim, hp and held; a swing, its weight and a jump reached only the player who made them.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

interface Phone { readonly client: NetClient; readonly link: DirectLoopback }
let live: DedicatedRoom | undefined, clock = 0;
afterEach(() => { live?.dispose(); live = undefined; });

async function open(): Promise<DedicatedRoom> {
  const directory = builtProduct('driftwood-isle'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing driftwood-isle output');
  const server = descriptor.index.files.filter(file => serverReadsFile(file, product.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  clock = 0;
  live = await DedicatedRoom.boot({ slug: 'driftwood-isle', build: '', bootId: 'b1', input: { shard: product.shardfile, assets, rapier, product }, now: () => clock, post: () => undefined });
  return live;
}
function enter(room: DedicatedRoom, device: string): Phone {
  const link = directLoopback(), client = new NetClient(link.client);
  room.seat({ device, name: device, body: `p.${device}`, doc: null, seq: 0 }, link.server, () => { client.hello('', { player: device, name: device }); link.pump(); });
  link.pump();
  return { client, link };
}
const STILL: Omit<NetCommand, 'seq'> = { viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 };
const TAP = { ...STILL, attack: { aim: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } } } };
const HEAVY = { ...STILL, buttons: NET_BUTTONS.heavy };
const JUMP = { ...STILL, buttons: NET_BUTTONS.jump };

/** One server tick: A stands, B sends `b`; then B's row as A's newest frame has it. */
function tick(room: DedicatedRoom, a: Phone, b: Phone, command: Omit<NetCommand, 'seq'>): NetFields {
  a.client.command(STILL); a.client.flush(); a.link.pump();
  b.client.command(command); b.client.flush(); b.link.pump();
  clock += 1000 / 60; room.tick(); a.link.pump(); b.link.pump();
  const handle = [...a.client.entities.values()].find(info => info.cls.cls === PLAYER_CLASS.cls && info.id === 'p.b')?.handle;
  return handle === undefined ? {} : a.client.interpolator.fields(handle, Number.MAX_SAFE_INTEGER) ?? {};
}

test('the row for others carries a swing count, its weight and the airborne bit', () => {
  const names = PLAYER_CLASS.row.map(column => column.name);
  expect(names).toEqual(expect.arrayContaining(['swing', 'heavy', 'air']));
  expect(PLAYER_CLASS.row.length).toBeLessThanOrEqual(32);
});

test('page B taps, holds a heavy and jumps; page A reads each on B\'s row', { timeout: 120_000 }, async () => {
  const room = await open(), a = enter(room, 'a'), b = enter(room, 'b');
  for (let at = 0; at < 60; at++) tick(room, a, b, STILL);
  const rest = tick(room, a, b, STILL);
  expect(rest['air'], 'B stands').toBe(false);
  const before = rest['swing'];
  expect(typeof before).toBe('number');

  // a tap: the count moves by one and the swing is light
  let row = tick(room, a, b, TAP);
  for (let at = 0; at < 6; at++) row = tick(room, a, b, STILL);
  expect(row['swing']).toBe(((before as number) + 1) & 0xff);
  expect(row['heavy']).toBe(false);
  for (let at = 0; at < 90; at++) tick(room, a, b, STILL); // the swing ends and cools

  // a held heavy: charged, let go, it swings heavy and the count moves again
  for (let at = 0; at < 90; at++) tick(room, a, b, HEAVY);
  for (let at = 0; at < 6; at++) row = tick(room, a, b, STILL);
  expect(row['swing']).toBe(((before as number) + 2) & 0xff);
  expect(row['heavy']).toBe(true);
  for (let at = 0; at < 90; at++) row = tick(room, a, b, STILL);
  expect(row['air']).toBe(false);

  // a jump: airborne while up, down again after
  const flight: boolean[] = [];
  row = tick(room, a, b, JUMP); flight.push(row['air'] === true);
  for (let at = 0; at < 20; at++) { row = tick(room, a, b, STILL); flight.push(row['air'] === true); }
  expect(flight.some(Boolean), 'B is airborne during the jump').toBe(true);
  for (let at = 0; at < 90; at++) row = tick(room, a, b, STILL);
  expect(row['air'], 'B has landed').toBe(false);

  // a stun pins B where it stands, `grounded` false: not a jump
  const body = room.bodyOf('b'); if (body === undefined) throw new Error('No body for B');
  body.health.attributes['moveLocked'] = 1;
  for (let at = 0; at < 10; at++) { row = tick(room, a, b, STILL); expect(row['air'], 'a stunned B stands').toBe(false); }
  expect(body.fall.grounded, 'the stun clears the ground flag').toBe(false);
});
