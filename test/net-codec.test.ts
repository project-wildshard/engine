import { expect, test } from 'vitest';
import { BitReader, BitWriter, NetDecodeError } from '../src/shared/engine/net/bits';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { decodeCommands, encodeCommands } from '../src/shared/engine/net/command';
import { decodeFrame, encodeFrame, WorldFrame, type DecodedFrame, type FrameInput } from '../src/shared/engine/net/frame';
import { decodeAct, decodeEvents, decodeHello, decodeWelcome, encodeAct, encodeEvents, encodeHello, encodeWelcome, type InitialBits, type NetEvent } from '../src/shared/engine/net/messages';
import { NET_SCHEMA_HASH } from '../src/shared/engine/net/netSchemas';
import { compileSchema, netSchema, netSchemaHash, schemaDescription, type NetClass } from '../src/shared/engine/net/schema';

// P1-E5.2 (E5-REPLICATION §9): the codec's properties, with a seeded stream so a failure reproduces.

/** mulberry32: a small seeded stream, independent of the game's RNG services. */
function stream(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

interface Sample { x: number; yaw: number; flinch: number; hp: number; alive: boolean; state: string; target: string | null; speed: number; name: string; exact: number }
const SAMPLE = netSchema<Sample>({ cls: 'sample', fields: {
  x: { kind: 'f32q', min: -260, max: 260, bits: 16, read: s => s.x },
  yaw: { kind: 'angle', bits: 10, read: s => s.yaw },
  flinch: { kind: 'f32q', min: 0, max: 1, bits: 6, read: s => s.flinch },
  hp: { kind: 'u16', read: s => s.hp },
  alive: { kind: 'bool', read: s => s.alive },
  state: { kind: 'enum', values: ['idle', 'walk', 'run'], read: s => s.state },
  target: { kind: 'ref', read: s => s.target },
  exact: { kind: 'f32', predicted: true, read: s => s.exact },
  speed: { kind: 'f32', send: 'owner', read: s => s.speed },
  name: { kind: 'text', send: 'initial', read: s => s.name },
} });
const CLASS: NetClass<Sample> = compileSchema(SAMPLE, 0);
const erased: NetClass<never> = CLASS;
const refs = (id: string): number => id.length;
const draw = (random: () => number): Sample => ({ x: random() * 520 - 260, yaw: random() * Math.PI * 8 - Math.PI * 4, flinch: random(), hp: Math.floor(random() * 0x10000),
  alive: random() < 0.5, state: ['idle', 'walk', 'run'][Math.floor(random() * 3)] ?? 'idle', target: random() < 0.5 ? null : 'abc', speed: random() * 10, name: 'n', exact: random() * 100 });

function fill(frame: WorldFrame, rows: ReadonlyMap<number, Sample>): void {
  for (const [handle, sample] of rows) {
    const at = frame.claim(handle, CLASS.row.length);
    CLASS.row.forEach((column, index) => { frame.data[at + index] = column.sample(sample, refs); });
  }
}
function input(frame: WorldFrame, baseline: FrameInput['baseline'], visible = new Set(frame.handles())): FrameInput {
  return { frame, cell: 3, lastSeq: 77, ownerClass: erased, owner: Float64Array.from(CLASS.owner, () => 9), visible, baseline, classOf: () => erased };
}
const table = (held: DecodedFrame | null): Parameters<typeof decodeFrame>[1] => ({ ownerClass: erased, classOf: () => erased, baseline: tick => held?.tick === tick ? held : null });
const rowsOf = (frame: DecodedFrame | null): Record<string, number[]> => Object.fromEntries([...(frame?.rows ?? [])].map(([handle, row]) => [handle, [...row]]));

test('bits round-trip at every width and refuse reading past the end', () => {
  const random = stream(1), writer = new BitWriter(4), fields = Array.from({ length: 4096 }, () => {
    const bits = 1 + Math.floor(random() * 32);
    return { bits, value: Math.floor(random() * 2 ** bits) };
  });
  for (const { value, bits } of fields) writer.write(value, bits);
  const reader = new BitReader(new Uint8Array(writer.finish()));
  for (const { value, bits } of fields) expect(reader.read(bits)).toBe(value);
  reader.end();
  expect(() => reader.read(32)).toThrow(NetDecodeError);
  writer.writeText('Ωmega'); expect(new BitReader(new Uint8Array(writer.finish())).readText()).toBe('Ωmega');
});

test('a writer that has finished leaves no bits behind in its next message', () => {
  const writer = new BitWriter(8);
  writer.write(0xffffffff, 32); writer.finish();
  writer.write(0, 8);
  expect([...new Uint8Array(writer.finish())]).toEqual([0]);
});

test('every field decodes within one quantisation step', () => {
  const random = stream(2);
  for (let round = 0; round < 2000; round++) {
    const sample = draw(random);
    for (const column of CLASS.row) {
      const quantised = column.sample(sample, refs), value = column.value(quantised);
      expect(quantised).toBeLessThan(2 ** column.bits);
      if (column.name === 'yaw' && typeof value === 'number') {
        const turn = Math.PI * 2, gap = Math.abs(((value - sample.yaw) % turn + turn) % turn);
        expect(Math.min(gap, turn - gap)).toBeLessThanOrEqual(column.step / 2 + 1e-9);
      } else if (typeof value === 'number' && column.kind === 'f32q') expect(Math.abs(value - (column.name === 'x' ? sample.x : sample.flinch))).toBeLessThanOrEqual(column.step / 2 + 1e-9);
    }
    expect(CLASS.row.find(column => column.name === 'state')?.value(CLASS.row.find(column => column.name === 'state')?.sample(sample, refs) ?? 0)).toBe(sample.state);
  }
});

test('a delta against any baseline decodes to exactly what a full frame would', () => {
  const random = stream(3), writer = new BitWriter();
  const rows = new Map(Array.from({ length: 24 }, (_, index) => [index + 1, draw(random)]));
  const first = new WorldFrame(); first.reset(100); fill(first, rows);
  const baseline = decodeFrame(new Uint8Array(encodeFrame(writer, input(first, null))), table(null));
  expect(baseline?.baselineTick).toBe(0xffffffff);
  for (let round = 0; round < 200; round++) {
    const moved = new Map(rows);
    for (const handle of rows.keys()) if (random() < 0.3) moved.set(handle, { ...rows.get(handle) ?? draw(random), x: random() * 200 });
    const next = new WorldFrame(); next.reset(102 + round); fill(next, moved);
    const held = new Set(first.handles());
    const delta = decodeFrame(new Uint8Array(encodeFrame(writer, input(next, { frame: first, visible: held }))), table(baseline));
    const full = decodeFrame(new Uint8Array(encodeFrame(writer, input(next, null))), table(null));
    expect(delta).not.toBeNull();
    expect(rowsOf(delta)).toEqual(rowsOf(full));
    expect(delta?.owner).toEqual(full?.owner);
  }
});

test('J140: a double crosses an owner block bit for bit, and only an owner block', () => {
  const held = compileSchema(netSchema<Sample>({ cls: 'exact', fields: { x: { kind: 'f64', predicted: true, read: s => s.x }, hp: { kind: 'u16', read: s => s.hp } } }), 0);
  const x = 123.456_789_012_345_67 + Number.EPSILON * 16, writer = new BitWriter(), erasedHeld: NetClass<never> = held;
  const frame = new WorldFrame(); frame.reset(1);
  const decoded = decodeFrame(new Uint8Array(encodeFrame(writer, { frame, cell: 0, lastSeq: 0, ownerClass: erasedHeld, owner: Float64Array.of(x, 7), visible: new Set(), baseline: null, classOf: () => undefined })), { ownerClass: erasedHeld, classOf: () => undefined, baseline: () => null });
  expect(decoded?.owner[0]).toBe(x);
  expect(decoded?.owner[1]).toBe(7);
  expect(held.owner[0]?.value(x)).toBe(x);
  expect(() => compileSchema(netSchema<Sample>({ cls: 'bad', fields: { x: { kind: 'f64', read: s => s.x } } }), 0)).toThrow(RangeError);
});

test('an unchanged world costs no rows, and a frame carries its header and owner block', () => {
  const writer = new BitWriter(), frame = new WorldFrame(), random = stream(4);
  frame.reset(10); fill(frame, new Map(Array.from({ length: 60 }, (_, index) => [index + 1, draw(random)])));
  const full = encodeFrame(writer, input(frame, null)), still = encodeFrame(writer, input(frame, { frame, visible: new Set(frame.handles()) }));
  expect(still.byteLength).toBeLessThan(full.byteLength / 10);
  const held = decodeFrame(new Uint8Array(full), table(null));
  const decoded = decodeFrame(new Uint8Array(still), table(held));
  expect(decoded).toMatchObject({ tick: 10, cell: 3, lastSeq: 77 });
  expect(rowsOf(decoded)).toEqual(rowsOf(held));
  expect(decoded?.fresh.size).toBe(60); // nothing changed and every row was due: all true samples
});

test('P1-E5.3-F1: a frame tells a sent row, a still row and a held row apart, on 64 rows in 8 bytes', () => {
  const writer = new BitWriter(), random = stream(6), rows = new Map(Array.from({ length: 64 }, (_, index) => [index + 1, draw(random)]));
  const first = new WorldFrame(); first.reset(10); fill(first, rows);
  const held = decodeFrame(new Uint8Array(encodeFrame(writer, input(first, null))), table(null));
  const moved = new Map(rows).set(1, { ...draw(random), x: 3 });
  const next = new WorldFrame(); next.reset(12); fill(next, moved);
  const heldBack = (handle: number): boolean => handle % 2 === 1; // odd handles are not due, even ones are
  const base = { frame: first, visible: new Set(first.handles()) };
  const frame = { ...input(next, base), due: (handle: number) => !heldBack(handle) };
  const decoded = decodeFrame(new Uint8Array(encodeFrame(writer, frame)), table(held));
  expect(decoded?.fresh).toEqual(new Set([...rows.keys()].filter(handle => !heldBack(handle))));
  expect(rowsOf(decoded)).toEqual(rowsOf(held)); // handle 1 moved, but it was not due: the client keeps its copy
  const bare = encodeFrame(writer, { ...input(next, base, new Set()), baseline: { frame: first, visible: new Set() } });
  expect(encodeFrame(writer, frame).byteLength - bare.byteLength).toBe(8);
});

test('a class with no row fields is its spawn alone: it costs no fresh bit, and the frames after it still decode', () => {
  const writer = new BitWriter(), random = stream(7), bare: NetClass<never> = { ...erased, row: [] };
  const classOf = (handle: number): NetClass<never> => handle === 2 ? bare : erased;
  const first = new WorldFrame(); first.reset(1); fill(first, new Map([[1, draw(random)], [2, draw(random)]]));
  const full = { ...input(first, null), classOf }, tables = { ...table(null), classOf };
  const held = decodeFrame(new Uint8Array(encodeFrame(writer, full)), tables);
  expect([...held?.rows.keys() ?? []]).toEqual([1]);
  const next = { ...input(first, { frame: first, visible: new Set(first.handles()) }), classOf };
  const decoded = decodeFrame(new Uint8Array(encodeFrame(writer, next)), { ...table(held), classOf });
  expect(decoded?.fresh).toEqual(new Set([1]));
});

test('a row that leaves relevance goes, and one that enters arrives whole', () => {
  const writer = new BitWriter(), random = stream(5), a = draw(random), b = draw(random);
  const first = new WorldFrame(); first.reset(1); fill(first, new Map([[1, a], [2, b]]));
  const held = decodeFrame(new Uint8Array(encodeFrame(writer, input(first, null, new Set([1])))), table(null));
  expect([...held?.rows.keys() ?? []]).toEqual([1]);
  const next = new WorldFrame(); next.reset(3); fill(next, new Map([[1, a], [2, b]]));
  const swapped = decodeFrame(new Uint8Array(encodeFrame(writer, input(next, { frame: first, visible: new Set([1]) }, new Set([2])))), table(held));
  expect([...swapped?.rows.keys() ?? []]).toEqual([2]);
});

test('a frame that cannot apply yet is dropped, not guessed at', () => {
  const writer = new BitWriter(), frame = new WorldFrame(), random = stream(6);
  frame.reset(4); fill(frame, new Map([[1, draw(random)]]));
  const bytes = new Uint8Array(encodeFrame(writer, input(frame, null)));
  expect(decodeFrame(bytes, { ...table(null), classOf: () => undefined })).toBeNull(); // the spawn has not arrived
  const delta = new Uint8Array(encodeFrame(writer, input(frame, { frame, visible: new Set([1]) })));
  expect(decodeFrame(delta, table(null))).toBeNull(); // the baseline is not held
});

test('the schema hash moves with names, bounds, kinds and order, and tables the wire cannot carry are refused', () => {
  const hash = netSchemaHash([schemaDescription(SAMPLE)]);
  const change = (fields: typeof SAMPLE.fields): number => netSchemaHash([schemaDescription({ ...SAMPLE, fields })]);
  const { x, yaw, ...rest } = SAMPLE.fields;
  if (x === undefined || yaw === undefined) throw new Error('Missing sample fields');
  expect(change({ ...SAMPLE.fields, x: { kind: 'f32q', min: -260, max: 261, bits: 16, read: s => s.x } })).not.toBe(hash);
  expect(change({ ...SAMPLE.fields, x: { kind: 'f32q', min: -260, max: 260, bits: 15, read: s => s.x } })).not.toBe(hash);
  expect(change({ yaw, x, ...rest })).not.toBe(hash);
  expect(change({ ...rest, y: x, yaw })).not.toBe(hash);
  expect(NET_SCHEMA_HASH).toBeGreaterThan(0);
  expect(() => compileSchema(netSchema<Sample>({ cls: 'bad', fields: { name: { kind: 'text', read: s => s.name } } }), 0)).toThrow(/initial-only/u);
  expect(() => compileSchema(netSchema<Sample>({ cls: 'bad', fields: { x: { kind: 'f32', predicted: true, send: 'others', read: s => s.x } } }), 0)).toThrow(/owner/u);
  expect(() => compileSchema(netSchema<Sample>({ cls: 'bad', fields: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`f${String(index)}`, { kind: 'bool' as const, read: () => true }])) }), 0)).toThrow(/row fields/u);
  const undeclared = CLASS.row.find(column => column.name === 'state');
  expect(() => undeclared?.sample({ ...draw(stream(7)), state: 'flying' }, refs)).toThrow(/Undeclared/u);
});

test('fuzzed bytes never throw past any decoder boundary', () => {
  const random = stream(8), writer = new BitWriter(), bits: InitialBits = cls => cls === 0 ? { bits: [8, 32], text: 2 } : undefined, ids = (handle: number): string | undefined => handle === 1 ? 'one' : undefined;
  const frame = new WorldFrame(); frame.reset(8); fill(frame, new Map([[1, draw(random)], [2, draw(random)]]));
  const steer = { keyX: 0, keyY: 1, stickX: 0, stickY: 0 };
  const seeds = [
    encodeFrame(writer, input(frame, null)),
    encodeCommands(writer, { ackFrame: 2, commands: [{ seq: 1, viewTick: 2, steer, yaw: 1, pitch: 0, buttons: NET_BUTTONS.jump, attack: { targetId: 'one', aim: { origin: { x: 1, y: 2, z: 3 }, direction: { x: 0, y: 0, z: 1 } } }, launcher: { slot: 1, ads: 0.5, fire: true } }] }, () => 1),
    encodeHello(writer, { schemaHash: 1, build: 'b', player: 'device:1', name: 'Ann', ledger: 3 }), encodeWelcome(writer, { handle: 1, player: 'actor.player', tick: 2, cell: 3, schemaHash: 4, simHz: 60, frameHz: 30 }),
    encodeEvents(writer, 4, [{ kind: 'spawn', handle: 1, cls: 0, id: 'one', initial: [1, 2], text: ['a', 'b'] }, { kind: 'despawn', handle: 1 }], bits),
    encodeAct(writer, { kind: 'interact', seq: 1, id: 'door' }),
  ].map(buffer => new Uint8Array(buffer));
  const decodeAll = (bytes: Uint8Array): void => {
    decodeFrame(bytes, table(null)); decodeCommands(bytes, ids); decodeHello(bytes); decodeWelcome(bytes); decodeEvents(bytes, bits); decodeAct(bytes);
  };
  for (const seed of seeds) decodeAll(seed);
  for (let round = 0; round < 20000; round++) {
    const seed = seeds[round % seeds.length] ?? new Uint8Array(0), bytes = round % 3 === 0 ? seed.slice(0, Math.floor(random() * seed.length)) : seed.slice();
    if (round % 3 === 1) for (let flips = 1 + Math.floor(random() * 4); flips > 0; flips--) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
    expect(() => { decodeAll(round % 3 === 2 ? Uint8Array.from({ length: Math.floor(random() * 64) }, () => Math.floor(random() * 256)) : bytes); }).not.toThrow();
  }
});

test('hit and died cross the wire: amounts exact, vectors within a step, and a truncated event refuses', () => {
  const hit: NetEvent = { kind: 'hit', tick: 901, target: 0x1203, amount: 37.5, at: [12.5, -3.25, 200], head: true, killed: false, confirmFor: 4242 };
  const died: NetEvent = { kind: 'died', tick: 902, id: 0x1203, by: 7, dir: [0, -1, 0.5], impulse: 37.5 };
  const bytes = encodeEvents(new BitWriter(), 902, [hit, died], () => undefined), decoded = decodeEvents(new Uint8Array(bytes), () => undefined);
  if (decoded === null) throw new Error('Events did not decode');
  const [first, second] = decoded.events;
  if (first?.kind !== 'hit' || second?.kind !== 'died') throw new Error('Events changed kind');
  expect({ ...first, at: 0 }).toEqual({ ...hit, at: 0 });
  first.at.forEach((axis, index) => { expect(Math.abs(axis - (hit.at[index] ?? 0))).toBeLessThan(0.008); });
  expect({ ...second, dir: 0 }).toEqual({ ...died, dir: 0 });
  second.dir.forEach((axis, index) => { expect(Math.abs(axis - (died.dir[index] ?? 0))).toBeLessThan(0.008); });
  expect(decodeEvents(new Uint8Array(bytes).slice(0, 20), () => undefined)).toBeNull();
});

test('a fight\'s view call keeps its name, its order and its numbers', () => {
  const writer = new BitWriter(), views = [{ kind: 'view', tick: 9, name: 'hazard.ring', args: [1, 2.5, -3, 4] }, { kind: 'view', tick: 9, name: 'strike.arc.off', args: [] }] as const;
  const decoded = decodeEvents(new Uint8Array(encodeEvents(writer, 9, views, () => undefined)), () => undefined);
  expect(decoded?.events).toEqual(views);
});

test('trophy identity and blow attribution survive the actual event codec', () => {
  for (const blow of [true, false]) {
    const hit: NetEvent = { kind: 'hit', tick: 17, target: 9, amount: 12, at: [0, 0, 0], head: false, killed: false, confirmFor: 0, ...(blow ? { blow: true } : {}) };
    const rewards: NetEvent[] = [{ kind: 'reward', tick: 17, coins: 7, body: 9, item: 'boar-tusk' }, { kind: 'reward', tick: 17, coins: 2, body: 9 }];
    const decoded = decodeEvents(new Uint8Array(encodeEvents(new BitWriter(), 17, [hit, ...rewards], () => undefined)), () => undefined);
    expect(decoded?.events.map(event => event.kind === 'hit' ? { ...event, at: hit.at } : event)).toEqual([hit, ...rewards]);
  }
});
