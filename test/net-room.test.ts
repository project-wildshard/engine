// oxlint-disable-next-line import/no-nodejs-modules -- The room runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import type { Vector3 } from 'three';
import { beforeAll, expect, test } from 'vitest';
import { BitWriter } from '../src/shared/engine/net/bits';
import { NetClient } from '../src/client/engine/net/client';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { encodeCommands } from '../src/shared/engine/net/command';
import { encodeHello } from '../src/shared/engine/net/messages';
import { ANIMAL_CLASS, NET_SCHEMA_HASH } from '../src/shared/engine/net/netSchemas';
import { NetRoom, type NetVisitor, type NetWorld } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { ConditionedTransport, directLoopback } from '../src/test/engine/netLoopback';
import type { NetCommand } from '@wildshard/format/netCommand';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { netTickCommands } from '../src/shared/host/standalone/netInput';
import { tickCommands } from '../src/shared/host/tickProtocol';
import { builtProduct } from './fixtures/builtProduct';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

// P1-E5.2 (E5-REPLICATION §3.3, §9): a real room over the shipped Sunscar Dunes product, on the real codec. Only the carrier
// is a test double: the same room runs over a MessagePort in test/standalone-server.test.ts and in a Web Worker.

let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

async function sunscar(): Promise<TrustedHeadlessResident> {
  const directory = builtProduct('sunscar-dunes'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing Sunscar output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product });
}
function roomOver(resident: TrustedHeadlessResident): NetRoom {
  return new NetRoom({ world: new SimNetWorld(resident.host), step: inputs => {
    const own = inputs[0];
    resident.step(tickCommands([{ source: 'test', commands: netTickCommands(own?.command ?? null, own?.acts ?? []) }], 8));
  } });
}
const walk = (yaw: number): Omit<NetCommand, 'seq'> => ({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: NET_BUTTONS.sprint });

/** A creature's row, and not one of the cell's encounter rows, which have no position and reach every client. */
const isCreature = (client: NetClient, handle: number): boolean => client.entities.get(handle)?.cls.cls === 'animal';
const creatureCount = (client: NetClient): number => [...client.entities.keys()].filter(handle => isCreature(client, handle)).length;
/** A row past the near band is on its tier (§3.3): it may be the frame before, and only the frame before. */
const NEAR_BAND = 60;
type Positions = ReadonlyMap<string, Vector3>;
const positions = (resident: TrustedHeadlessResident): Positions => new Map([...resident.host.entities].map(([id, sim]) => [id, sim.position.clone()]));
const within = (fields: Readonly<Record<string, unknown>>, at: Vector3 | undefined, step: number): boolean => at !== undefined && (['x', 'y', 'z'] as const).every(axis => Math.abs(Number(fields[axis]) - at[axis]) <= step);
function checkRows(resident: TrustedHeadlessResident, client: NetClient, before: Positions): number {
  const frame = client.latest;
  if (frame === null) throw new Error('No frame');
  expect(frame.tick).toBe(resident.host.state.tick);
  const columns = new Map(ANIMAL_CLASS.row.map(column => [column.name, column]));
  let rows = 0;
  for (const [handle, row] of frame.rows) {
    if (!isCreature(client, handle)) continue;
    const info = client.entities.get(handle), sim = resident.host.entities.get(info?.id ?? ''), fields = client.fields(frame, handle);
    if (sim === undefined || fields === null) throw new Error(`Row ${String(handle)} names no creature`);
    expect(row).toHaveLength(ANIMAL_CLASS.row.length);
    const step = columns.get('x')?.step ?? 0, far = sim.position.distanceTo(leadPlayer(resident.host).position) > NEAR_BAND - 1;
    expect(within(fields, sim.position, step) || (far && within(fields, before.get(info?.id ?? ''), step)), `${info?.id ?? ''} at ${String(frame.tick)}`).toBe(true);
    if (!far) { expect(fields['state']).toBe(sim.state); expect(fields['alive']).toBe(sim.alive); expect(fields['hp']).toBe(Math.ceil(sim.hp)); }
    expect(info?.initial).toMatchObject({ kind: sim.kind, variant: sim.variant, rarity: sim.rarity });
    rows++;
  }
  return rows;
}

test('frames carry every creature within one quantisation step, and the owner block is exact', async () => {
  const resident = await sunscar(), room = roomOver(resident), link = directLoopback(), client = new NetClient(link.client);
  room.join(link.server);
  client.hello(); link.pump();
  expect(client.welcome).toBeNull(); // the sim stays paused until the client says ready (§6.3.1)
  room.open(); link.pump();
  expect(client.welcome).toMatchObject({ schemaHash: NET_SCHEMA_HASH, simHz: 60, frameHz: 30 });
  expect(client.latest?.baselineTick).toBe(0xffffffff);
  expect(creatureCount(client)).toBe(resident.host.entities.size);
  let frames = 0, seq = 0, before = positions(resident);
  client.onFrame(() => { frames++; });
  for (let tick = 0; tick < 600; tick++) {
    seq = client.command(walk(0.4)); client.flush(); link.pump();
    room.tick(); link.pump();
    if (resident.host.state.tick % 2 === 0) {
      expect(checkRows(resident, client, before)).toBe(resident.host.entities.size);
      before = positions(resident);
      const player = leadPlayer(resident.host), owner = client.latest === null ? null : client.owner(client.latest);
      for (const [field, axis] of [['px', 'x'], ['py', 'y'], ['pz', 'z']] as const) expect(owner?.[field]).toBe(player.position[axis]);
    }
  }
  expect(frames).toBe(300);
  expect(client.dropped).toBe(0);
  expect(client.latest?.baselineTick).toBeGreaterThan(0); // past the first frame everything is a delta
  expect(client.latest?.lastSeq).toBe(seq);
  expect(room.admission).toEqual({ refused: 0, duplicates: expect.any(Number) as number });
  resident.dispose();
});

test('commands over the wire drive today\'s host exactly as the same tick commands do directly', async () => {
  const direct = await sunscar(), wired = await sunscar(), room = roomOver(wired), link = directLoopback(), client = new NetClient(link.client);
  room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  for (let tick = 0; tick < 300; tick++) {
    const seq = client.command({ ...walk(1), buttons: tick === 60 ? NET_BUTTONS.jump | NET_BUTTONS.sprint : NET_BUTTONS.sprint });
    client.flush(); link.pump(); room.tick(); link.pump();
    // the yaw a command carries is quantised on the wire, so the direct run reads what the wire delivered
    const delivered = { seq, ...walk(Math.round(1 / (Math.PI * 2) * 0x10000) / 0x10000 * Math.PI * 2), buttons: tick === 60 ? NET_BUTTONS.jump | NET_BUTTONS.sprint : NET_BUTTONS.sprint };
    direct.step(netTickCommands(delivered, []));
  }
  expect(leadPlayer(wired.host).position.distanceTo(leadPlayer(direct.host).position)).toBe(0);
  expect(leadPlayer(wired.host).position.length()).toBeGreaterThan(1);
  direct.dispose(); wired.dispose();
});

test('a bad link heals: loss, jitter and reordering never corrupt a row', async () => {
  const resident = await sunscar(), room = roomOver(resident), link = directLoopback();
  let state = 12345;
  const random = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const conditions = { latencyMs: 75, jitterMs: 30, lossPct: 2, reorderPct: 1, random };
  const up = new ConditionedTransport(link.client, conditions), down = new ConditionedTransport(link.server, conditions), client = new NetClient(up);
  room.join(down); client.hello();
  // what the server held at every frame tick: each frame decoded over the bad link must match it, deltas included
  const truth = new Map<number, Map<string, Vector3>>(), step = ANIMAL_CLASS.row[0]?.step ?? 0;
  // the class's radius, measured as the room measures it, on quantised positions, so the set must match exactly
  const near = (at: Vector3, from: Vector3): boolean => { const cell = (value: number): number => -260 + Math.round((value + 260) / step) * step; return Math.hypot(cell(at.x) - cell(from.x), cell(at.y) - cell(from.y), cell(at.z) - cell(from.z)) <= 160; };
  const remember = (): void => {
    const { host } = resident;
    truth.set(host.state.tick, new Map([...host.entities].filter(([, sim]) => near(sim.position, leadPlayer(host).position)).map(([id, sim]) => [id, sim.position.clone()])));
  };
  let decoded = 0, deltas = 0;
  client.onFrame(frame => {
    const held = truth.get(frame.tick);
    if (held === undefined) throw new Error(`No server state for tick ${String(frame.tick)}`);
    decoded++; if (frame.baselineTick !== 0xffffffff) deltas++;
    const creatures = [...frame.rows.keys()].filter(handle => isCreature(client, handle));
    for (const handle of creatures) {
      const id = client.entities.get(handle)?.id ?? '', fields = client.fields(frame, handle), at = held.get(id);
      if (at === undefined || fields === null) throw new Error(`Row ${String(handle)} names nothing in range on the server`);
      // a near row is this tick's; a far one is on its tier, so it is some recent tick's, and never anything else
      const recent = [...truth].filter(([tick]) => tick <= frame.tick && tick > frame.tick - 64).map(([, rows]) => rows.get(id));
      expect(within(fields, at, step) || recent.some(row => within(fields, row, step)), `${id} at ${String(frame.tick)}`).toBe(true);
    }
    expect(creatures.length).toBe(held.size);
  });
  const settle = (ms: number): void => { up.advance(ms); down.advance(ms); link.pump(); };
  settle(200); remember(); room.open(); settle(200);
  for (let tick = 0; tick < 3600; tick++) {
    client.command(walk(tick / 300)); if (tick % 2 === 0) client.flush();
    room.tick(); remember(); settle(1000 / 60);
  }
  settle(400);
  expect(down.stats.lossPct).toBeGreaterThan(0.5);
  expect(decoded).toBeGreaterThan(1600); // of 1800 sent, minus the 2 % lost
  expect(deltas).toBeGreaterThan(decoded - 30); // loss healed against the last ack, without falling back to full frames
  expect(client.latest?.tick).toBeGreaterThan(3580);
  expect(client.closed).toBeNull();
  resident.dispose();
});

test('hello refuses a stale schema or build with `reload`, and garbage never reaches the tick', async () => {
  const resident = await sunscar(), room = new NetRoom({ world: new SimNetWorld(resident.host), build: 'build-a', step: () => { resident.step([]); } });
  const wrong = directLoopback(), stale = new NetClient(wrong.client), writer = new BitWriter();
  room.join(wrong.server);
  wrong.client.send('reliable', encodeHello(writer, { schemaHash: NET_SCHEMA_HASH ^ 1, build: 'build-a', player: 'device:1', name: 'Ann', ledger: 0 })); wrong.pump();
  expect(stale.closed).toBe('reload');
  const old = directLoopback(), oldClient = new NetClient(old.client);
  room.join(old.server); oldClient.hello('build-b'); old.pump();
  expect(oldClient.closed).toBe('reload');
  const garbled = directLoopback(), garbledClient = new NetClient(garbled.client);
  room.join(garbled.server); garbled.client.send('reliable', Uint8Array.of(1, 0, 0).buffer); garbled.pump();
  expect(garbledClient.closed, 'a hello this build cannot read is a stale tab too').toBe('reload');
  const good = directLoopback(), client = new NetClient(good.client);
  room.join(good.server); client.hello('build-a'); room.open(); good.pump();
  expect(client.welcome).not.toBeNull();
  good.client.send('unreliable', Uint8Array.of(99, 1, 2, 3).buffer);
  good.client.send('unreliable', Uint8Array.of(2, 1).buffer);
  good.client.send('reliable', encodeCommands(writer, { ackFrame: 0xfffffff0, commands: [] }, () => 0)); // an ack from the future is refused
  good.pump();
  expect(room.stats.refused).toBe(6); // three hellos, two bad messages, and that ack
  room.tick(); room.tick(); good.pump();
  expect(client.latest?.baselineTick).toBe(0xffffffff);
  resident.dispose();
});

test('relevance and handles: entities come and go with their spawn, and a retired slot returns under a new generation', async () => {
  const resident = await sunscar(), { host } = resident, inner = new SimNetWorld(host), hidden = new Set<string>();
  const ids = [...host.entities.keys()], last = ids[ids.length - 1] ?? '', other = ids[0] ?? '';
  hidden.add(last);
  const world: NetWorld = { tick: () => inner.tick(), cell: () => inner.cell(), player: inner.player,
    visit: (visitor: NetVisitor) => { inner.visit({ entity: (id, cls, view) => { if (!hidden.has(id)) visitor.entity(id, cls, view); } }); } };
  const room = new NetRoom({ world, step: () => { resident.step([]); } }), link = directLoopback(), client = new NetClient(link.client);
  room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  const run = (): void => { for (let round = 0; round < 3; round++) { client.flush(); link.pump(); room.tick(); room.tick(); link.pump(); } };
  const shown = (): string[] => [...client.latest?.rows.keys() ?? []].filter(handle => isCreature(client, handle)).map(handle => client.entities.get(handle)?.id ?? '').sort();
  const handleOf = (id: string): number | undefined => [...client.entities.values()].find(entity => entity.id === id)?.handle;
  expect(shown()).toEqual(ids.filter(id => id !== last).sort());

  // out of the class's 160 m: a `gone` row, while its identity stays for when it returns
  const inRange = (at: number): string[] => ids.filter(id => id !== last && (host.entities.get(id)?.position.distanceTo(leadPlayer(host).position) ?? Infinity) <= at);
  leadPlayer(host).position.set(240, 40, 240);
  run();
  expect(inRange(159).length).toBeLessThan(ids.length - 1);
  expect(shown()).toEqual(expect.arrayContaining(inRange(159)));
  expect(shown().every(id => inRange(161).includes(id))).toBe(true);
  expect(creatureCount(client)).toBe(ids.length - 1);
  leadPlayer(host).position.set(0, 40, 0);
  run();
  expect(shown()).toEqual(ids.filter(id => id !== last).sort());

  // retired: a despawn, and its slot comes back under a new generation, so a late row cannot reach the new owner
  const before = handleOf(other);
  hidden.add(other);
  run();
  expect(handleOf(other)).toBeUndefined();
  hidden.delete(last);
  run();
  const after = handleOf(last);
  expect(after).toBeDefined();
  expect((after ?? 0) & 0xfff).toBe((before ?? 0) & 0xfff);
  expect(after).not.toBe(before);
  expect(client.dropped).toBe(0);
  resident.dispose();
});

test('bandwidth for one client on a real shard stays inside the design budget', async () => {
  const resident = await sunscar(), room = roomOver(resident), link = directLoopback(), client = new NetClient(link.client);
  room.join(link.server); client.hello(); link.pump(); room.open(); link.pump();
  const warm = 600, ticks = 1800;
  for (let tick = 0; tick < warm; tick++) { client.command(walk(tick / 200)); if (tick % 2 === 0) client.flush(); link.pump(); room.tick(); link.pump(); }
  const down = link.client.stats.recvBytes, up = link.client.stats.sentBytes, { frames } = room.stats, frameBytes = room.stats.frameBytes;
  for (let tick = 0; tick < ticks; tick++) { client.command(walk(tick / 200)); if (tick % 2 === 0) client.flush(); link.pump(); room.tick(); link.pump(); }
  const seconds = ticks / 60, perFrame = (room.stats.frameBytes - frameBytes) / (room.stats.frames - frames);
  const downRate = (link.client.stats.recvBytes - down) / seconds, upRate = (link.client.stats.sentBytes - up) / seconds;
  expect(perFrame).toBeLessThan(1000); // the §7 worst case is 1.0 KB for 92 rows; this is one player and 13 creatures
  expect(downRate).toBeLessThan(30_000);
  expect(upRate).toBeLessThan(3_500);
  resident.dispose();
});
