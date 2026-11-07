// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import type { RoomNews } from '../src/server/host/dedicated/cellProtocol';
import { builtProduct } from './fixtures/builtProduct';

let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

async function serverInput(slug: string): Promise<HeadlessRuntimeInput> {
  const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error(`Missing ${slug} output`);
  const server = descriptor.index.files.filter(file => serverReadsFile(file, product.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return { shard: product.shardfile, assets, rapier, product };
}

interface Phone { readonly device: string; readonly client: NetClient; readonly link: DirectLoopback }
let live: DedicatedRoom | undefined, clock = 0;
const news: RoomNews[] = [];
async function open(slug: string): Promise<DedicatedRoom> {
  clock = 0; news.length = 0;
  live = await DedicatedRoom.boot({ slug, build: '', bootId: 'b1', input: await serverInput(slug), now: () => clock, post: row => { news.push(row); } });
  return live;
}
afterEach(() => { live?.dispose(); live = undefined; });
function enter(room: DedicatedRoom, device: string): Phone {
  const link = directLoopback(), client = new NetClient(link.client);
  room.seat({ device, name: device, body: `p.${device}`, doc: null, seq: 0 }, link.server, () => { client.hello('', { player: device, name: device }); link.pump(); });
  link.pump();
  return { device, client, link };
}
function run(room: DedicatedRoom, phones: readonly Phone[], ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) {
    for (const { client, link } of phones) { client.command({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 }); client.flush(); link.pump(); }
    clock += 1000 / 60; room.tick();
    for (const { link } of phones) link.pump();
  }
}

test('two seats on Driftwood: the first takes the lead seat', { timeout: 120_000 }, async () => {
  const room = await open('driftwood-isle'), a = enter(room, 'a');
  run(room, [a], 30);
  const b = enter(room, 'b');
  run(room, [a, b], 30);
  expect(room.bodyOf('a')?.id).toBe('actor.player');
  expect(room.bodyOf('b')?.id).toBe('p.b');
  expect(a.client.latest).not.toBeNull();
  expect(b.client.latest).not.toBeNull();
  expect(room.taken).toBe(2);
});
