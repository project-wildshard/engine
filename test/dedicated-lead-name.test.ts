import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { NetRoom, type NetPlayer, type NetWorld } from '../src/server/engine/net/room';
import type { CombatEvent } from '../src/server/engine/net/combatWire';
import { PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import type { NetClass } from '../src/shared/engine/net/schema';
import { LEAD_SEAT } from '../src/server/host/standalone/cellWorld';
import { LEFT } from '../src/server/host/dedicated/socketPump';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { builtProduct } from './fixtures/builtProduct';

// A room's first seat stands in its lead body (`actor.player`), and the next player to take it is someone else. A body's
// Name travels once, in its spawn, so the lead's Name must go out again (a new spawn) when its holder changes: to a page
// already in the room, and to one that arrives after a room left empty took no ticks (rooms-proofs journal, 2026-11-11).
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
async function open(): Promise<DedicatedRoom> {
  clock = 0;
  live = await DedicatedRoom.boot({ slug: 'driftwood-isle', build: '', bootId: 'b1', input: await serverInput('driftwood-isle'), now: () => clock, post: () => undefined });
  return live;
}
afterEach(() => { live?.dispose(); live = undefined; });
function enter(room: DedicatedRoom, device: string, name: string): Phone {
  const link = directLoopback(), client = new NetClient(link.client);
  room.seat({ device, name, body: `p.${device}`, doc: null, seq: 0 }, link.server, () => { client.hello('', { player: device, name }); link.pump(); });
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
/** The Name each body of `id` reads as on this page: one body, one Name. */
const namesOf = (phone: Phone, id: string): string[] => [...phone.client.entities.values()].filter(info => info.id === id).map(info => String(info.initial['name']));

test('the lead leaves and the next player takes the lead body: a page already in the room reads the new Name', { timeout: 120_000 }, async () => {
  const room = await open(), a = enter(room, 'a', 'Ann#1111');
  run(room, [a], 10);
  const b = enter(room, 'b', 'Bo#2222');
  run(room, [a, b], 30);
  expect(namesOf(b, LEAD_SEAT)).toEqual(['Ann#1111']);
  // Ann quits and Cy takes her seat before the room's next frame.
  a.link.server.close(LEFT);
  const c = enter(room, 'c', 'Cy#3333');
  expect(room.bodyOf('c')?.id).toBe(LEAD_SEAT);
  run(room, [b, c], 30);
  expect(namesOf(b, LEAD_SEAT), 'the page already in the room').toEqual(['Cy#3333']);
  expect((b.client as unknown as { ids: ReadonlyMap<string, number> }).ids.get(LEAD_SEAT), 'and still finds the body by its id').toBe([...b.client.entities.values()].find(info => info.id === LEAD_SEAT)?.handle);
  expect(namesOf(c, 'p.b')).toEqual(['Bo#2222']);
  const d = enter(room, 'd', 'Di#4444');
  run(room, [b, c, d], 30);
  expect(namesOf(d, LEAD_SEAT), 'a fresh page').toEqual(['Cy#3333']);
});

test('a room left empty takes no ticks: the next lead still reads as themself to a fresh page', { timeout: 120_000 }, async () => {
  const room = await open(), a = enter(room, 'a', 'Ann#1111');
  run(room, [a], 30);
  a.link.server.close(LEFT);
  expect(room.taken).toBe(0);
  // Nobody is in the room, so its cell does not tick it (Q80) until someone arrives.
  const c = enter(room, 'c', 'Cy#3333');
  run(room, [c], 10);
  const d = enter(room, 'd', 'Di#4444');
  run(room, [c, d], 30);
  expect(room.bodyOf('c')?.id).toBe(LEAD_SEAT);
  expect(namesOf(d, LEAD_SEAT), 'a fresh page').toEqual(['Cy#3333']);
  expect(namesOf(c, 'p.d')).toEqual(['Di#4444']);
});

test('a hit the old lead took between frames reaches a page before the body goes, and the new one after', () => {
  // A bare room: two bodies whose rows read nothing but a Name, and one hit settled on an odd tick.
  let tick = 0, leadName = 'Ann#1111';
  const pending: CombatEvent[] = [];
  const cls = { ...PLAYER_CLASS, row: PLAYER_CLASS.row.map(column => ({ ...column, sample: () => 0 })), initial: PLAYER_CLASS.initial.map(column => ({ ...column, sample: () => 0 })),
    text: [{ name: 'name', read: (view: { name: string }) => view.name }] } as unknown as NetClass<never>;
  const body = (id: string): NetPlayer => ({ id, cls, sample: out => { out.fill(0); } });
  const lead = body(LEAD_SEAT), other = body('p.b');
  const world: NetWorld = { player: lead, tick: () => tick, cell: () => 0, combat: () => pending.splice(0),
    visit: visitor => { visitor.entity(LEAD_SEAT, cls, { name: leadName } as never); visitor.entity('p.b', cls, { name: 'Bo#2222' } as never); } };
  const room = new NetRoom({ world, step: () => { tick++; } });
  const enter = (player: NetPlayer): { link: DirectLoopback; client: NetClient } => {
    const link = directLoopback(), client = new NetClient(link.client);
    room.join(link.server, player); client.hello('', { player: player.id, name: player.id }); link.pump(); return { link, client };
  };
  const a = enter(lead), b = enter(other);
  room.open();
  for (let n = 0; n < 4; n++) { room.tick(); a.link.pump(); b.link.pump(); }
  const was = [...b.client.entities.values()].find(info => info.id === LEAD_SEAT)?.handle;
  expect(was).toBeDefined();
  const heard: { kind: string; handle: number; known: boolean }[] = [];
  b.client.onCombat(event => { if (event.kind === 'hit') heard.push({ kind: 'hit', handle: event.target, known: b.client.entities.has(event.target) }); });
  pending.push({ kind: 'hit', tick: 5, target: LEAD_SEAT, amount: 3, at: [0, 0, 0], head: false, killed: false, by: null, seq: 0 });
  room.tick(); // tick 5: settled, no frame yet
  a.link.server.close(); leadName = 'Cy#3333';
  const c = enter(lead);
  room.tick(); a.link.pump(); b.link.pump(); c.link.pump();
  expect(heard, 'the old body\'s hit, while the page still holds it').toEqual([{ kind: 'hit', handle: was, known: true }]);
  expect(namesOf({ device: 'b', ...b }, LEAD_SEAT)).toEqual(['Cy#3333']);
  expect(b.client.entities.has(was ?? 0), 'and then it goes').toBe(false);
});
