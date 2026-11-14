// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import type { NetCommand } from '@wildshard/wire/netCommand';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { NetClient, type NetFields } from '../src/client/engine/net/client';
import { kitSlots } from '../src/client/engine/net/heldOnOthers';
import { PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { builtFolder } from './fixtures/builtFolder';

// opus-slotsync (J293, REMOTE-PLAYERS RP5's gap): on a native kit with no slot map (Driftwood's swords, Nalati's bow, sabre and
// spear) a page had no slot to send for the item it switched to, and Driftwood's server had no route for one, so another player
// saw the starting item for good. The page now numbers its kit in kit order (`kitSlots`), the server's own slot order.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

interface Phone { readonly client: NetClient; readonly link: DirectLoopback }
let live: DedicatedRoom | undefined, clock = 0;
afterEach(() => { live?.dispose(); live = undefined; });

async function open(slug: string): Promise<DedicatedRoom> {
  const directory = builtFolder(slug), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error(`Missing ${slug} output`);
  const server = descriptor.index.files.filter(file => serverReadsFile(file, product.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  clock = 0;
  live = await DedicatedRoom.boot({ slug, build: '', bootId: 'b1', input: { shard: product.shardfile, assets, rapier, product }, now: () => clock, post: () => undefined });
  return live;
}
function enter(room: DedicatedRoom, device: string): Phone {
  const link = directLoopback(), client = new NetClient(link.client);
  room.seat({ device, name: device, body: `p.${device}`, doc: null, seq: 0 }, link.server, () => { client.hello('', { player: device, name: device }); link.pump(); });
  link.pump();
  return { client, link };
}
const STILL: Omit<NetCommand, 'seq'> = { viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 };

/** One server tick: both stand, B asks for `slot` (or interacts with `slot`, by name) if given; then B's row as A's newest frame has it. */
function tick(room: DedicatedRoom, a: Phone, b: Phone, slot?: number | string): NetFields {
  a.client.command(STILL); a.client.flush(); a.link.pump();
  if (typeof slot === 'number') b.client.act({ kind: 'equip', seq: 0, slot });
  else if (slot !== undefined) b.client.act({ kind: 'interact', seq: 0, id: slot });
  b.client.command(STILL); b.client.flush(); b.link.pump();
  clock += 1000 / 60; room.tick(); a.link.pump(); b.link.pump();
  const handle = [...a.client.entities.values()].find(info => info.cls.cls === PLAYER_CLASS.cls && info.id === 'p.b')?.handle;
  return handle === undefined ? {} : a.client.interpolator.fields(handle, Number.MAX_SAFE_INTEGER) ?? {};
}
/** B asks for `row` by its kit-order slot, then a second for it to land. */
function swap(room: DedicatedRoom, a: Phone, b: Phone, kit: readonly string[], row: string): NetFields {
  const slot = kitSlots(new Map(), kit).get(row);
  if (slot === undefined) throw new Error(`No slot for ${row}`);
  let seen = tick(room, a, b, slot);
  for (let at = 0; at < 60; at++) seen = tick(room, a, b);
  return seen;
}

/** Counts every input the room refuses from here on (it reads and clears its tally each tick). */
function refusals(room: DedicatedRoom): () => number {
  const routes = actRoutes(room.host);
  let tally = routes.refused, counted = 0;
  Object.defineProperty(routes, 'refused', { configurable: true, get: () => tally, set: (value: number) => { if (value > tally) counted += value - tally; tally = value; } });
  return () => counted;
}

/** Each native kit as its page lists it: the rows in kit order, the one B switches to, and how B comes to own it (Driftwood's
 *  iron sword is the wreck's: the quest gives it; Nalati's three arms are every player's from the start). */
const KITS: readonly { readonly slug: string; readonly kit: readonly string[]; readonly to: string; readonly earn?: string }[] = [
  { slug: 'driftwood-isle', kit: ['weapon.driftwood-isle.wood', 'weapon.driftwood-isle.iron'], to: 'weapon.driftwood-isle.iron', earn: 'iron-sword' },
  { slug: 'nalati-grasslands', kit: ['weapon.bow', 'weapon.sabre', 'weapon.spear'], to: 'weapon.sabre' },
];

for (const { slug, kit, to, earn } of KITS) test(`${slug}: B switches item and A sees it on B's row, and back`, { timeout: 120_000 }, async () => {
  const room = await open(slug), a = enter(room, 'a'), b = enter(room, 'b');
  let row: NetFields = {};
  for (let at = 0; at < 60; at++) row = tick(room, a, b);
  expect(row['held'], 'B starts on the kit\'s first item').toBe(0);
  if (earn !== undefined) {
    // an item B doesn't own yet stays where it is, whatever B's page asks for
    row = swap(room, a, b, kit, to);
    expect(row['held'], `B doesn't own ${to} yet`).toBe(0);
    // the wreck's rack: its sailor down, B beside it, B's own interact (Driftwood's `acquisition`, built `quests` rows)
    for (const body of room.host.entities.values()) if (body.kind === 'sailor') room.host.combat.hit({ source: 'env', sourceTags: [], target: body.combatActor(), amount: 1e6, point: body.position.clone(), dir: new Vector3(0, 0, 1) });
    const self = room.bodyOf('b'); if (self === undefined) throw new Error('No body for B');
    self.resetPose({ x: 153.2, y: 2.3, z: 3.4 }, 0);
    for (let at = 0; at < 10; at++) tick(room, a, b);
    tick(room, a, b, earn);
    for (let at = 0; at < 10; at++) row = tick(room, a, b);
    expect(row['held'], `the quest hands B ${to}`).toBe(kit.indexOf(to));
    row = swap(room, a, b, kit, kit[0] ?? '');
    expect(row['held']).toBe(0);
  }
  const counted = refusals(room);
  row = swap(room, a, b, kit, to);
  expect(row['held'], `A sees B holding ${to}`).toBe(kit.indexOf(to));
  expect(room.bodyOf('b')?.held).toBe(kit.indexOf(to));
  row = swap(room, a, b, kit, kit[0] ?? '');
  expect(row['held'], 'and back to the first').toBe(0);
  expect(counted(), 'no equip was refused').toBe(0);
});

test('driftwood: a slot past the kit is refused, and B keeps what it holds', { timeout: 120_000 }, async () => {
  const room = await open('driftwood-isle'), a = enter(room, 'a'), b = enter(room, 'b');
  for (let at = 0; at < 60; at++) tick(room, a, b);
  const counted = refusals(room);
  let row = tick(room, a, b, 7);
  for (let at = 0; at < 30; at++) row = tick(room, a, b);
  expect(row['held']).toBe(0);
  expect(counted(), 'the room counts it').toBeGreaterThan(0);
});
