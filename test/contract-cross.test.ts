// oxlint-disable-next-line import/no-nodejs-modules -- The released wire's bytes are its identity.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The room runs the shipped product bytes and physics module.
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Walk the released package.
import { join, relative, resolve } from 'node:path';
import { WIRE_CLASSES as HEAD_CLASSES } from '@wildshard/wire/classes';
import { decodeClassTables as headDecodeClassTables } from '@wildshard/wire/classTables';
import { classColumns as headColumns, type ClassColumns } from '@wildshard/wire/columns';
import { decodeFrameMessage as headDecodeFrame } from '@wildshard/wire/frameRecord';
import { actCodec as headActCodec, clientTables as headClientTables, commandsCodec as headCommandsCodec, decodeBody as headDecodeBody } from '@wildshard/wire/game';
import { WIRE_MINOR as HEAD_MINOR } from '@wildshard/wire/major';
import { decodeRideLawTables as headDecodeLaws } from '@wildshard/wire/rideTables';
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
import { quantiseCommand } from '../src/shared/engine/net/command';
import type { NetCombatEvent } from '../src/shared/engine/net/messages';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { directLoopback } from '../src/test/engine/netLoopback';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { netTickCommands } from '../src/shared/host/standalone/netInput';
import { tickCommands } from '../src/shared/host/tickProtocol';
import { builtFolder } from './fixtures/builtFolder';

// WIRE-STABILITY WR6, engine's half of the cross-version harness (plan section 7). `@wildshard/wire-released` is the wire
// at the last release (shardfile 669d1fc, WR4's last codec commit, until `wire-v1.0.0` exists) installed beside the wire
// this engine binds. Both ways, with this engine's real code on the HEAD side: a client on the released wire plays a real
// room over the shipped Sunscar Dunes product (its frames read word for word as the bound wire reads them, its cmds and a
// chat act driving the room), and this engine's NetClient plays a room on the released wire, once at the release's own
// tables and once a minor ahead (an animal field it lacks, first, and a class it lacks), its hello, cmds and act read by
// the released codecs as the bound ones read them. Shardfile's `test/cross.test.ts` holds the codec-only half: reward,
// mount and travel records, a class the old client lacks, and the WR3/WR4 revert negatives.

/**
 * One module of the released wire, typed as this engine's, which is what the harness proves. Loaded by a specifier
 * TypeScript doesn't resolve: both copies are `@wildshard/wire@0.0.0`, and TypeScript would type one as the other.
 */
const RELEASED = '@wildshard/wire-released';
// packageDigest of shardfile 669d1fc's packages/wire (package.json "@wildshard/wire-released"): recompute when the pin moves.
const RELEASED_DIGEST = 'b9f717b2bc9ec808541135b4c2a6cdfb5ec86f5b94af3ea350d1a0e8d342f46c';
const released = async <Module>(path: string): Promise<Module> => (await import(/* @vite-ignore */ `${RELEASED}/${path}`)) as Module;
const { encodeClassTables, decodeClassTables } = await released<typeof ClassTables>('classTables');
const { WIRE_CLASSES } = await released<typeof Classes>('classes');
const { classColumns } = await released<typeof Columns>('columns');
const { eventsDecoder, encodeEvents, eventTables } = await released<typeof EventStream>('eventStream');
const { decodeFrameMessage, encodeFrame, TAG_FRAME } = await released<typeof FrameRecord>('frameRecord');
const { recordBytes, writeRecord } = await released<typeof Framing>('framing');
const { actCodec, clientTables, commandsCodec, decodeBody, encodeBody, localCodecs, readMessage, TAG_ACT, TAG_CMDS, TAG_EVENTS } = await released<typeof Game>('game');
const { decodeFirstMessage, decodeWelcome, encodeHello, encodeWelcome, tableHash } = await released<typeof Handshake>('handshake');
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
// A released copy that is the bound one (the same pin, or a resolver that dedupes them) would make every test here green.
beforeAll(() => {
  expect(classColumns, 'the released wire is its own copy, not the bound one').not.toBe(headColumns);
  // The bytes the alias reaches, not where they sit: a classic slot's folder named the commit, a global-store slot's
  // (GVS G9) is a content hash, and a link to another commit's slot passes any path check. Bump with RELEASED's pin.
  const root = realpathSync(resolve('node_modules', RELEASED));
  expect(packageDigest(root), 'the released wire is shardfile 669d1fc, byte for byte').toBe(RELEASED_DIGEST);
});

/** sha256 over a package's files (path and bytes, sorted), its own node_modules left out. */
function packageDigest(root: string): string {
  const hash = createHash('sha256');
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name === 'node_modules') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else hash.update(`${relative(root, path)}\0`).update(readFileSync(path)).update('\0');
    }
  };
  walk(root);
  return hash.digest('hex');
}

async function sunscar(): Promise<TrustedHeadlessResident> {
  const directory = builtFolder('sunscar-dunes'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing Sunscar output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product });
}

/** A raw frame as plain words, to compare two decoders word for word. */
const plain = (raw: RawFrame | undefined): string => JSON.stringify(raw === undefined ? null : { tick: raw.tick, base: raw.baselineTick, seq: raw.lastSeq, owner: [...raw.owner], rows: [...raw.rows].map(([handle, row]) => [handle, [...row]]), ride: raw.ride === undefined ? null : [raw.ride.law, ...raw.ride.words] });
const STEER = { keyX: 0, keyY: 1, stickX: 0, stickY: 0 };

test('a client on the released wire plays a HEAD room: hello, welcome, spawns, 30 frames with a lost ack read as the bound wire reads them, its cmds and a chat act driving the room', async () => {
  const resident = await sunscar(), link = directLoopback(), inbox: Uint8Array[] = [];
  const seen: { readonly yaw: number; readonly buttons: number }[] = [];
  const room = new NetRoom({ world: new SimNetWorld(resident.host), step: inputs => {
    const own = inputs[0];
    if (own?.command !== undefined && own.command !== null) seen.push({ yaw: own.command.yaw, buttons: own.command.buttons });
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
  // The bound wire reads the same bytes beside it: the released client must see exactly what this engine's own would.
  const headSender = new Map(headDecodeClassTables(tables.classTables).map(entry => [entry.id, headColumns(entry)]));
  const headLaws = headDecodeLaws(tables.rideLawTables), headOwner = headSender.get(1);
  if (owner === undefined || headOwner === undefined) throw new Error('the room sent no player class');

  const classOfHandle = new Map<number, number>(), held = new Map<number, RawFrame>(), headHeld = new Map<number, RawFrame>(), local = localCodecs();
  const problems: string[] = [];
  let acked: number = NO_BASELINE, spawned = 0, frames = 0, rows = 0, seq = 0, chats = 0;
  // The welcome's message also carries the room's first spawns: every record after the welcome counts.
  const consume = (): void => {
    for (const span of inbox.flatMap(spans)) {
      if (span.tag === TAG_EVENTS) {
        for (const event of readEvents(span).events) {
          if (event.event === 'spawn') { classOfHandle.set(Number(event.fields['handle']), Number(event.fields['cls'])); spawned++; }
          if (event.event === 'chat' && event.fields['text'] === 'hello') chats++;
        }
      } else if (span.tag === TAG_FRAME) {
        const classOf = (handle: number): number => classOfHandle.get(handle) ?? -1;
        const raw = decodeFrameMessage(span.bytes, { ownerClass: owner, classOf: handle => sender.get(classOf(handle)), rideLaw: id => { const law = laws.find(entry => entry.id === id); return law === undefined ? undefined : { id, words: law.fields.length }; }, baseline: tick => held.get(tick) });
        const bound = headDecodeFrame(span.bytes, { ownerClass: headOwner, classOf: handle => headSender.get(classOf(handle)), rideLaw: id => { const law = headLaws.find(entry => entry.id === id); return law === undefined ? undefined : { id, words: law.fields.length }; }, baseline: tick => headHeld.get(tick) });
        if (raw === undefined) { problems.push(`frame ${String(frames + 1)} could not apply`); continue; }
        if (plain(raw) !== plain(bound)) problems.push(`frame ${String(raw.tick)}: the released client read ${plain(raw)}, the bound wire ${plain(bound)}`);
        held.set(raw.tick, raw); if (bound !== undefined) headHeld.set(bound.tick, bound); frames++;
        for (const [handle, row] of raw.rows) {
          const slots = projected.get(classOf(handle))?.row;
          if (slots !== undefined && projectRow(slots, row).length !== slots.length) problems.push(`row ${String(handle)} projected short`);
          rows++;
        }
        if (frames !== LOST_ACK) acked = raw.tick;
      }
    }
    inbox.length = 0;
  };
  consume();
  const sent: number[] = [];
  while (frames < FRAMES && seq < FRAMES * 4) {
    seq++;
    const yaw = seq / 10;
    sent.push(quantiseCommand({ steer: STEER, yaw, pitch: 0 }).yaw);
    const cmds = encodeBody(local.commands, TAG_CMDS, { ackFrame: acked, commands: [{ seq, viewTick: acked === NO_BASELINE ? 0 : acked, steer: STEER, yaw, pitch: 0, buttons: NET_BUTTONS.sprint }] });
    link.client.send('unreliable', cmds.slice().buffer);
    if (seq === 3) link.client.send('reliable', encodeBody(local.act, TAG_ACT, { seq, act: { arm: 'chat', fields: { channel: 'room', text: 'hello' } } }).slice().buffer);
    link.pump(); room.tick(); link.pump();
    consume();
  }
  expect(problems).toEqual([]);
  expect(welcome.handle).toBeGreaterThan(0);
  expect(spawned, 'the released client read the room spawns').toBeGreaterThan(0);
  expect(frames, 'thirty frames the released client applied').toBe(FRAMES);
  expect(rows, 'the frames carried creature rows').toBeGreaterThan(FRAMES);
  expect(chats, 'the released chat act came back as the room line').toBe(1);
  expect(room.lastSeq(seat), 'the released cmds reached the room').toBe(seq);
  // Each command the room stepped is one the released client sent, as the quantiser leaves it, in the order sent.
  expect(seen.length).toBeGreaterThanOrEqual(FRAMES);
  expect(seen.every(input => sent.includes(input.yaw) && input.buttons === NET_BUTTONS.sprint), JSON.stringify(seen)).toBe(true);
  expect(seen.map(input => input.yaw)).toEqual([...seen.map(input => input.yaw)].sort((left, right) => left - right));
  link.client.close('bye'); link.pump();
  expect(room.lastSeq(seat), 'a closed client frees its seat').toBe(0);
}, 60_000);

const ANIMAL = 2, KITE = 9, PLAYER = 1;
/** The release's own tables, and a room a minor ahead of them: the animal has `mood` first, so every sender column sits a
 * slot later, and a kite class this engine lacks. Rows hold raw words, as the shardfile half does. */
const AHEAD: readonly WireClass[] = [...WIRE_CLASSES.map(entry => (entry.id === ANIMAL ? { ...entry, fields: [{ id: 99, name: 'mood', node: { kind: 'uint' as const, bits: 3 }, send: 'all' as const }, ...entry.fields] } : entry)),
  { id: KITE, name: 'kite', fields: [{ id: 1, name: 'x', node: { kind: 'uint' as const, bits: 8 } }] }];
const ROOMS = [
  { name: 'at the release', classes: WIRE_CLASSES, minor: WIRE_MINOR, skew: 0 },
  { name: 'a minor ahead, skewed', classes: AHEAD, minor: WIRE_MINOR + 1, skew: 1 },
] as const;
const EXACT = new Map([[11, 123.45678901234567], [12, -0.000123456789], [13, 9876.54321098765], [14, 1.1], [15, -2.2e-7], [16, 3.3333333333333335]]);
const [MOUNT_LAW] = RIDE_LAWS, RIDE = MOUNT_LAW === undefined ? undefined : { id: MOUNT_LAW.id, words: MOUNT_LAW.fields.length };
/** The events message with a record no version knows after the known ones. */
function withUnknown(bytes: Uint8Array): Uint8Array {
  const [record] = readMessage(bytes).records;
  if (record === undefined) throw new Error('no events record');
  const body = [...bytes.subarray(record.start, record.end)];
  writeRecord(body, 99, Uint8Array.of(1, 2, 3));
  return recordBytes(TAG_EVENTS, Uint8Array.from(body));
}

test.each(ROOMS)('a HEAD client plays a room on the released wire $name: welcome, spawns, an unknown record, 30 frames, its hello, cmds and act read by the released codecs, a clean close', ({ classes, minor, skew }) => {
  const columns = columnsOf(classes), animalWords = columns.get(ANIMAL)?.row.length ?? 0, player = columns.get(PLAYER);
  if (player === undefined || RIDE === undefined) throw new Error('no player class or ride law');
  const visible = new Set(skew === 1 ? [1, 2] : [1]);
  const rowSource = (tick: number): RowSource => ({ tick, data: [...Array.from({ length: animalWords }, (_, at) => (at < skew ? tick % 8 : (tick + at) % 2)), tick % 256], offset: handle => [0, animalWords].at(handle - 1) });
  const snapshot = (tick: number, acked: number | undefined): SnapshotInput => ({
    frame: rowSource(tick), cell: 0, lastSeq: 0, ownerClass: player, // no command seen yet: the cmds below are all unacked
    owner: Float64Array.from(player.owner.map((column, at) => EXACT.get(column.id) ?? at % 2)),
    ride: tick % 5 === 0 ? { law: RIDE.id, words: Float64Array.from({ length: RIDE.words }, (_, at) => at / 4) } : undefined,
    visible, baseline: acked === undefined || tick === WHOLE ? undefined : { frame: rowSource(acked), visible },
    classOf: handle => columns.get(handle === 1 ? ANIMAL : KITE),
  });

  const link = directLoopback(), client = new NetClient(link.client), up: Uint8Array[] = [];
  link.server.onMessage((_channel, bytes) => { up.push(new Uint8Array(bytes)); });
  client.hello(); link.pump();
  const [helloBytes] = up;
  const first = helloBytes === undefined ? undefined : decodeFirstMessage(helloBytes);
  if (first?.kind !== 'hello') throw new Error('the released room could not read the HEAD hello');
  expect(first.hello.minor).toBe(HEAD_MINOR);
  up.length = 0;

  const tables = { classTables: encodeClassTables(classes), eventTables: eventTables(), rideLawTables: encodeRideLawTables(RIDE_LAWS) };
  const welcome = encodeWelcome({ minor, build: 'released-room', handle: 1, player: 'device:1', tick: 1, cell: 0, simHz: 60, frameHz: 30, capabilities: [], requiredCapabilities: [],
    tableHash: tableHash([tables.classTables, tables.eventTables, tables.rideLawTables]), tables });
  link.server.send('reliable', welcome.slice().buffer); link.pump();
  expect(client.closed).toBeNull();
  expect(client.welcome?.handle).toBe(1);

  const combat: NetCombatEvent[] = [], chat: string[] = [];
  client.onCombat(event => { combat.push(event); }); client.onChat(line => { chat.push(line.text); });
  const spawn = (handle: number, cls: number): WireEvent => ({ event: 'spawn', fields: { handle, cls, id: `thing:${String(cls)}`, initial: (columns.get(cls)?.initial ?? []).map(() => 1), text: (columns.get(cls)?.text ?? []).map(() => 'boar') } });
  const events: WireEvent[] = [spawn(1, ANIMAL), ...(skew === 1 ? [spawn(2, KITE)] : []),
    { event: 'hit', fields: { tick: 1, target: 1, amount: 12, at: { x: 1, y: 2, z: 3 }, head: false, killed: false, blow: false, confirmFor: 0 } },
    { event: 'chat', fields: { tick: 1, line: 1, channel: 'room', from: 2, name: 'Ann', text: 'hi' } }];
  link.server.send('reliable', withUnknown(encodeEvents(1, events, spawnColumns(id => columns.get(id)))).slice().buffer); link.pump();
  expect([...client.entities.keys()], 'the animal is known, any kite left out').toEqual([1]);
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
    const want = Array.from({ length: animalWords - skew }, (_, at) => (tick + at + skew) % 2);
    if (JSON.stringify([...frame.rows.get(1) ?? []]) !== JSON.stringify(want)) problems.push(`frame ${String(tick)}: animal row ${JSON.stringify([...frame.rows.get(1) ?? []])}`);
    if (frame.rows.has(2)) problems.push(`frame ${String(tick)}: the kite projected`);
    for (const [id, value] of EXACT) if (frame.owner[ownerColumns.findIndex(column => column.id === id)] !== value) problems.push(`frame ${String(tick)}: owner field ${String(id)} lost bits`);
    if (tick % 5 === 0 && frame.ride?.length !== RIDE.words) problems.push(`frame ${String(tick)}: ride words ${String(frame.ride?.length)}`);
    if (tick !== LOST_ACK) acked = tick;
  }
  expect(problems).toEqual([]);

  // Up the wire: this engine's cmds and a chat act, read by the released room's codecs from the HEAD hello's own tables,
  // word for word as the bound wire reads them.
  client.command({ steer: STEER, yaw: 1, pitch: 0.25, buttons: NET_BUTTONS.sprint });
  client.command({ steer: STEER, yaw: 2, pitch: 0, buttons: 0 });
  client.act({ kind: 'chat', seq: 2, channel: 'room', text: 'hey' });
  client.flush(); link.pump();
  const local = headClientTables();
  const read = up.flatMap(spans).map(span => {
    if (span.tag === TAG_CMDS) return { tag: 'cmds', released: decodeBody(commandsCodec(first.hello.commandTable), span), bound: headDecodeBody(headCommandsCodec(local.commandTable), span) };
    if (span.tag === TAG_ACT) return { tag: 'act', released: decodeBody(actCodec(first.hello.actTable), span), bound: headDecodeBody(headActCodec(local.actTable), span) };
    return { tag: String(span.tag), released: null, bound: null };
  });
  for (const entry of read) expect(JSON.stringify(entry.released), entry.tag).toBe(JSON.stringify(entry.bound));
  const cmds = read.find(entry => entry.tag === 'cmds')?.released, act = read.find(entry => entry.tag === 'act')?.released;
  expect(cmds?.['ackFrame']).toBe(FRAMES + 1);
  // The wire's yaw is on [0, 2π) and its pitch steps agree with the quantiser to the last few bits (292e07ac).
  const wanted = [{ seq: 1, ...quantiseCommand({ steer: STEER, yaw: 1, pitch: 0.25 }), buttons: NET_BUTTONS.sprint }, { seq: 2, ...quantiseCommand({ steer: STEER, yaw: 2, pitch: 0 }), buttons: 0 }];
  const got = (cmds?.['commands'] ?? []) as readonly Readonly<Record<string, unknown>>[];
  expect(got.map(command => [command['seq'], command['buttons']])).toEqual(wanted.map(command => [command.seq, command.buttons]));
  got.forEach((command, at) => { expect(command['yaw']).toBeCloseTo(wanted[at]?.yaw ?? Number.NaN, 12); expect(command['pitch']).toBeCloseTo(wanted[at]?.pitch ?? Number.NaN, 12); });
  expect(JSON.stringify(act)).toContain('"text":"hey"');

  link.server.close('bye');
  expect(client.closed).toBe('bye');
});
