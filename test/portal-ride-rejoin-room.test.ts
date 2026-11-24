// oxlint-disable-next-line import/no-nodejs-modules -- The room runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { builtFolder } from '../src/test/game/builtFolder';
import portals from './fixtures/engine-lift/portals.json';

const SLUG = 'nine-dragon-stack';
let rapier: Rapier, live: DedicatedRoom | undefined, clock = 0;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });
afterEach(() => { live?.dispose(); live = undefined; });

async function open() {
  const directory = builtFolder(SLUG), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error(`Missing ${SLUG} output`);
  const files = serverInputFiles(descriptor.index.files, product.shardfile);
  const assets = new Map(files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  clock = 0;
  live = await DedicatedRoom.boot({ slug: SLUG, build: '', bootId: 'b1', input: { shard: product.shardfile, assets, rapier, product }, now: () => clock, post: () => undefined });
  const portal = product.shardfile.entryways.find(row => row.portal !== undefined)?.portal;
  if (portal === undefined) throw new Error('Missing admitted portal');
  const adapter = live.host.adapters.get(portals.director);
  if (adapter === undefined) throw new Error('The room runs no portal ride');
  return { room: live, portal, ride: () => JSON.parse(String(adapter.snapshot())) as { held: unknown; ride: unknown } };
}
interface Phone { readonly client: NetClient; readonly link: DirectLoopback }
function enter(room: DedicatedRoom, device = 'a'): Phone {
  const link = directLoopback(), client = new NetClient(link.client);
  room.seat({ device, name: device, body: `p.${device}`, doc: null, seq: 0 }, link.server, () => { client.hello('', { player: device, name: device }); link.pump(); });
  link.pump();
  return { client, link };
}
function run(room: DedicatedRoom, phone: Phone, ticks: number, until: () => boolean = () => false): void {
  for (let tick = 0; tick < ticks && !until(); tick++) {
    phone.client.command({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 }); phone.client.flush(); phone.link.pump();
    clock += 1000 / 60; room.tick(); phone.link.pump();
  }
}

test('QA-11-24 row 2: a reload that kept its seat rides the portal anew, as its fresh page does (no snap)', async () => {
  const { room, portal, ride } = await open(), first = enter(room), fresh = ride();
  const [[, lead] = []] = room.host.players;
  if (lead === undefined) throw new Error('Missing lead');
  lead.resetPose({ x: portal.road.at[0], y: portal.road.at[1], z: portal.road.at[2] }, 0);
  run(room, first, 240, () => JSON.stringify(ride().ride) !== JSON.stringify(fresh.ride) && ride().held === null);
  expect(ride().ride).not.toEqual(fresh.ride); // the seat entered by the portal's road
  first.link.server.close('closed'); // the page reloads: the seat is held
  run(room, first, 2);
  enter(room); // the reloaded page takes its kept seat
  expect(ride()).toEqual(fresh);
});

test('QA-11-24 row 2: a blip mid-ride starts the ride afresh; a player still on the portal rides again, never left held', async () => {
  const { room, portal, ride } = await open(), first = enter(room), fresh = ride();
  const [[, lead] = []] = room.host.players;
  if (lead === undefined) throw new Error('Missing lead');
  lead.resetPose({ x: portal.road.at[0], y: portal.road.at[1], z: portal.road.at[2] }, 0);
  run(room, first, 240, () => ride().held !== null);
  expect(ride().held).not.toBeNull(); // mid-fade: the feet are held
  first.link.server.close('closed'); // the link blips; the page redials
  const again = enter(room);
  expect(ride()).toEqual(fresh);
  run(room, again, 240, () => ride().held !== null);
  expect(ride().held).not.toBeNull(); // still on the road's pad: the fresh ride takes them again
  run(room, again, 240, () => ride().held === null);
  expect(ride().held).toBeNull(); // and lands them
});
