// oxlint-disable-next-line import/no-nodejs-modules -- The room runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { WIRE_CLASSES as HEAD_CLASSES } from '@wildshard/wire/classes';
import { classColumns as headColumns, type ClassColumns } from '@wildshard/wire/columns';
import type * as ClassTables from '@wildshard/wire/classTables';
import type * as Classes from '@wildshard/wire/classes';
import type * as Columns from '@wildshard/wire/columns';
import type * as EventStream from '@wildshard/wire/eventStream';
import type * as FrameRecord from '@wildshard/wire/frameRecord';
import type * as Framing from '@wildshard/wire/framing';
import type * as Game from '@wildshard/wire/game';
import type { WireEvent } from '@wildshard/wire/game';
import type { WireClass } from '@wildshard/wire/grammar';
import type * as Handshake from '@wildshard/wire/handshake';
import type * as Major from '@wildshard/wire/major';
import type * as Projection from '@wildshard/wire/projection';
import type * as RideTables from '@wildshard/wire/rideTables';
import type * as Rides from '@wildshard/wire/rides';
import type * as Snapshot from '@wildshard/wire/snapshot';
import type { RawFrame, RowSource, SnapshotInput } from '@wildshard/wire/snapshot';
import type * as SpawnColumns from '@wildshard/wire/spawnColumns';
import { beforeAll, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import type { NetCombatEvent } from '../src/shared/engine/net/messages';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { netTickCommands } from '../src/shared/host/standalone/netInput';
import { tickCommands } from '../src/shared/host/tickProtocol';
import { builtProduct } from './fixtures/builtProduct';

// WIRE-STABILITY WR6, engine's half of the cross-version harness (plan section 7). `@wildshard/wire-released` is the wire
// at the last release (shardfile 669d1fc, WR4's last codec commit, until `wire-v1.0.0` exists) installed beside the wire
// this engine binds. Both ways, with this engine's real code on the HEAD side: a client on the released wire plays a real
// room over the shipped Sunscar Dunes product, and this engine's NetClient plays a room on the released wire whose tables
// are a minor ahead (an animal field it lacks, first, and a class it lacks). Shardfile's `test/cross.test.ts` holds the
// codec-only half and the WR3/WR4 revert negatives.

/**
 * One module of the released wire, typed as this engine's, which is what the harness proves. Loaded by a specifier
 * TypeScript doesn't resolve: both copies are `@wildshard/wire@0.0.0`, and TypeScript would type one as the other.
 */
const RELEASED = '@wildshard/wire-released';
const released = async <Module>(path: string): Promise<Module> => (await import(/* @vite-ignore */ `${RELEASED}/${path}`)) as Module;
const { encodeClassTables, decodeClassTables } = await released<typeof ClassTables>('classTables');
const { WIRE_CLASSES } = await released<typeof Classes>('classes');
const { classColumns } = await released<typeof Columns>('columns');
const { eventsDecoder, encodeEvents, eventTables } = await released<typeof EventStream>('eventStream');
const { decodeFrameMessage, encodeFrame, TAG_FRAME } = await released<typeof FrameRecord>('frameRecord');
const { recordBytes, writeRecord } = await released<typeof Framing>('framing');
const { clientTables, encodeBody, localCodecs, readMessage, TAG_CMDS, TAG_EVENTS } = await released<typeof Game>('game');
const { decodeWelcome, encodeHello, encodeWelcome, tableHash } = await released<typeof Handshake>('handshake');
const { WIRE_MINOR } = await released<typeof Major>('major');
const { projectClasses, projectRow } = await released<typeof Projection>('projection');
const { decodeRideLawTables, encodeRideLawTables } = await released<typeof RideTables>('rideTables');
const { RIDE_LAWS } = await released<typeof Rides>('rides');
const { NO_BASELINE } = await released<typeof Snapshot>('snapshot');
const { spawnColumns } = await released<typeof SpawnColumns>('spawnColumns');

const TAG_WELCOME = 4;
const FRAMES = 30, LOST_ACK = 10, WHOLE = 20;
type Span = Parameters<typeof decodeWelcome>[0];
const spans = (bytes: Uint8Array): (Span & { readonly tag: number })[] => readMessage(bytes).records.map(record => ({ bytes, start: record.start, end: record.end, tag: record.tag }));
const columnsOf = (classes: readonly WireClass[]): Map<number, ClassColumns> => new Map(classes.map(entry => [entry.id, classColumns(entry)]));

let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

async function sunscar(): Promise<TrustedHeadlessResident> {
  const directory = builtProduct('sunscar-dunes'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing Sunscar output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product });
}

test('a client on the released wire plays a HEAD room: hello, welcome, spawns and 30 frames with a lost ack, its cmds driving the room', async () => {
  expect(classColumns, 'the released wire is its own copy, not the bound one').not.toBe(headColumns);
  const resident = await sunscar(), link = directLoopback(), inbox: Uint8Array[] = [];
  const seen: number[] = [];
  const room = new NetRoom({ world: new SimNetWorld(resident.host), step: inputs => {
    const own = inputs[0];
    if (own?.command !== undefined && own.command !== null) seen.push(own.command.yaw);
    resident.step(tickCommands([{ source: 'test', commands: netTickCommands(own?.command ?? null, own?.acts ?? []) }], 8));
  } });
  const seat = room.join(link.server);
  link.client.onMessage((_channel, bytes) => { inbox.push(new Uint8Array(bytes)); });
  link.client.send('reliable', encodeHello({ minor: WIRE_MINOR, build: 'released', player: 'device:released', name: 'Ann', ledger: 0, capabilities: [], ...clientTables() }).slice().buffer);
  link.pump(); room.open(); link.pump();

  const welcomeSpan = inbox.flatMap(spans).find(span => span.tag === TAG_WELCOME);
  if (welcomeSpan === undefined) throw new Error('the room sent no welcome to a released hello');
  const welcome = decodeWelcome(welcomeSpan), { tables } = welcome;
  if (tables === undefined) throw new Error('a first welcome carries its tables');
  const senderClasses = decodeClassTables(tables.classTables), sender = columnsOf(senderClasses);
  const projected = projectClasses(senderClasses, WIRE_CLASSES), laws = decodeRideLawTables(tables.rideLawTables);
  const readEvents = eventsDecoder(tables.eventTables, spawnColumns(id => sender.get(id)));
  const owner = sender.get(1);
  if (owner === undefined) throw new Error('the room sent no player class');

  const classOfHandle = new Map<number, number>(), held = new Map<number, RawFrame>(), local = localCodecs();
  const problems: string[] = [];
  let acked: number = NO_BASELINE, spawned = 0, frames = 0, rows = 0, seq = 0;
  // The welcome's message also carries the room's first spawns: every record after the welcome counts.
  const consume = (): void => {
      for (const span of inbox.flatMap(spans)) {
        if (span.tag === TAG_EVENTS) {
          const read = readEvents(span);
          for (const event of read.events) if (event.event === 'spawn') { classOfHandle.set(Number(event.fields['handle']), Number(event.fields['cls'])); spawned++; }
        } else if (span.tag === TAG_FRAME) {
          const raw = decodeFrameMessage(span.bytes, { ownerClass: owner, classOf: handle => sender.get(classOfHandle.get(handle) ?? -1), rideLaw: id => { const law = laws.find(entry => entry.id === id); return law === undefined ? undefined : { id, words: law.fields.length }; }, baseline: tick => held.get(tick) });
          if (raw === undefined) { problems.push(`frame ${String(frames + 1)} could not apply`); continue; }
          held.set(raw.tick, raw); frames++;
          for (const [handle, row] of raw.rows) {
            const slots = projected.get(classOfHandle.get(handle) ?? -1)?.row;
            if (slots !== undefined && projectRow(slots, row).length !== slots.length) problems.push(`row ${String(handle)} projected short`);
            rows++;
          }
          if (frames !== LOST_ACK) acked = raw.tick;
        }
      }
    inbox.length = 0;
  };
  consume();
  while (frames < FRAMES && seq < FRAMES * 4) {
    seq++;
    const cmds = encodeBody(local.commands, TAG_CMDS, { ackFrame: acked, commands: [{ seq, viewTick: acked === NO_BASELINE ? 0 : acked, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: seq / 10, pitch: 0, buttons: NET_BUTTONS.sprint }] });
    link.client.send('unreliable', cmds.slice().buffer); link.pump();
    room.tick(); link.pump();
    consume();
  }
  expect(problems).toEqual([]);
  expect(welcome.handle).toBeGreaterThan(0);
  expect(spawned, 'the released client read the room spawns').toBeGreaterThan(0);
  expect(frames, 'thirty frames the released client applied').toBe(FRAMES);
  expect(rows, 'the frames carried creature rows').toBeGreaterThan(FRAMES);
  expect(room.lastSeq(seat), 'the released cmds reached the room').toBe(seq);
  expect(seen.length).toBeGreaterThan(0);
}, 60_000);

// The released room's tables, a minor ahead of this engine: the animal has `mood` first, so every sender column sits a slot
// later, and a kite class this engine lacks. Rows hold raw words, as the shardfile half does.
const ANIMAL = 2, KITE = 9, PLAYER = 1;
const ROOM_CLASSES: readonly WireClass[] = [...WIRE_CLASSES.map(entry => (entry.id === ANIMAL ? { ...entry, fields: [{ id: 99, name: 'mood', node: { kind: 'uint' as const, bits: 3 }, send: 'all' as const }, ...entry.fields] } : entry)),
  { id: KITE, name: 'kite', fields: [{ id: 1, name: 'x', node: { kind: 'uint' as const, bits: 8 } }] }];
const ROOM = columnsOf(ROOM_CLASSES);
const EXACT = new Map([[11, 123.45678901234567], [12, -0.000123456789], [13, 9876.54321098765], [14, 1.1], [15, -2.2e-7], [16, 3.3333333333333335]]);
const [MOUNT_LAW] = RIDE_LAWS, RIDE = MOUNT_LAW === undefined ? undefined : { id: MOUNT_LAW.id, words: MOUNT_LAW.fields.length };
const animalWords = ROOM.get(ANIMAL)?.row.length ?? 0;
function rowSource(tick: number): RowSource {
  const data = [...Array.from({ length: animalWords }, (_, at) => (at === 0 ? tick % 8 : (tick + at) % 2)), tick % 256];
  return { tick, data, offset: handle => [0, animalWords].at(handle - 1) };
}
function snapshot(tick: number, acked: number | undefined): SnapshotInput {
  const player = ROOM.get(PLAYER);
  if (player === undefined || RIDE === undefined) throw new Error('no player class or ride law');
  return {
    frame: rowSource(tick), cell: 0, lastSeq: tick, ownerClass: player,
    owner: Float64Array.from(player.owner.map((column, at) => EXACT.get(column.id) ?? at % 2)),
    ride: tick % 5 === 0 ? { law: RIDE.id, words: Float64Array.from({ length: RIDE.words }, (_, at) => at / 4) } : undefined,
    visible: new Set([1, 2]),
    baseline: acked === undefined || tick === WHOLE ? undefined : { frame: rowSource(acked), visible: new Set([1, 2]) },
    classOf: handle => ROOM.get(handle === 1 ? ANIMAL : KITE),
  };
}
/** The events message with a record no version knows after the known ones. */
function withUnknown(bytes: Uint8Array): Uint8Array {
  const [record] = readMessage(bytes).records;
  if (record === undefined) throw new Error('no events record');
  const body = [...bytes.subarray(record.start, record.end)];
  writeRecord(body, 99, Uint8Array.of(1, 2, 3));
  return recordBytes(TAG_EVENTS, Uint8Array.from(body));
}

test('a HEAD client plays a room on the released wire a minor ahead: welcome, spawns, an unknown record, 30 skewed frames', () => {
  const link = directLoopback(), client = new NetClient(link.client);
  client.hello(); link.pump();
  const tables = { classTables: encodeClassTables(ROOM_CLASSES), eventTables: eventTables(), rideLawTables: encodeRideLawTables(RIDE_LAWS) };
  const welcome = encodeWelcome({ minor: WIRE_MINOR + 1, build: 'released-room', handle: 1, player: 'device:1', tick: 1, cell: 0, simHz: 60, frameHz: 30, capabilities: [], requiredCapabilities: [],
    tableHash: tableHash([tables.classTables, tables.eventTables, tables.rideLawTables]), tables });
  link.server.send('reliable', welcome.slice().buffer); link.pump();
  expect(client.closed).toBeNull();
  expect(client.welcome?.handle).toBe(1);

  const combat: NetCombatEvent[] = [], chat: string[] = [];
  client.onCombat(event => { combat.push(event); }); client.onChat(line => { chat.push(line.text); });
  const spawn = (handle: number, cls: number): WireEvent => ({ event: 'spawn', fields: { handle, cls, id: `thing:${String(cls)}`, initial: (ROOM.get(cls)?.initial ?? []).map(() => 1), text: (ROOM.get(cls)?.text ?? []).map(() => 'boar') } });
  const events: WireEvent[] = [spawn(1, ANIMAL), spawn(2, KITE),
    { event: 'hit', fields: { tick: 1, target: 1, amount: 12, at: { x: 1, y: 2, z: 3 }, head: false, killed: false, blow: false, confirmFor: 0 } },
    { event: 'chat', fields: { tick: 1, line: 1, channel: 'room', from: 2, name: 'Ann', text: 'hi' } }];
  link.server.send('reliable', withUnknown(encodeEvents(1, events, spawnColumns(id => ROOM.get(id)))).slice().buffer); link.pump();
  expect([...client.entities.keys()], 'the animal is known, the kite left out').toEqual([1]);
  expect(client.entities.get(1)?.initial).toMatchObject({ kind: 'boar' });
  expect(combat.map(event => event.kind)).toEqual(['hit']);
  expect(chat).toEqual(['hi']);

  const ownerColumns = headColumns(HEAD_CLASSES.find(entry => entry.id === PLAYER) ?? HEAD_CLASSES[0] ?? { id: 0, name: '', fields: [] }).owner;
  const problems: string[] = [];
  let acked: number | undefined;
  for (let tick = 2; tick <= FRAMES + 1; tick++) {
    link.server.send('unreliable', encodeFrame(snapshot(tick, acked)).slice().buffer); link.pump();
    const frame = client.latest;
    if (frame?.tick !== tick) { problems.push(`frame ${String(tick)} did not apply`); continue; }
    const want = Array.from({ length: animalWords - 1 }, (_, at) => (tick + at + 1) % 2);
    if (JSON.stringify([...frame.rows.get(1) ?? []]) !== JSON.stringify(want)) problems.push(`frame ${String(tick)}: animal row ${JSON.stringify([...frame.rows.get(1) ?? []])}`);
    if (frame.rows.has(2)) problems.push(`frame ${String(tick)}: the kite projected`);
    for (const [id, value] of EXACT) if (frame.owner[ownerColumns.findIndex(column => column.id === id)] !== value) problems.push(`frame ${String(tick)}: owner field ${String(id)} lost bits`);
    if (tick % 5 === 0 && frame.ride?.length !== RIDE?.words) problems.push(`frame ${String(tick)}: ride words ${String(frame.ride?.length)}`);
    if (tick !== LOST_ACK) acked = tick;
  }
  expect(problems).toEqual([]);
  expect(client.closed).toBeNull();
});
