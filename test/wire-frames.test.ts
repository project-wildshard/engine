// WIRE-STABILITY WR5: a frame sequence sent the wire v1 way and projected decodes to the DecodedFrame v0 gives: rows,
// deltas against a baseline, held rows, freshness, the owner block's f64 bits (J140) and the ride words.
import { encodeClassTables } from '@wildshard/wire/classTables';
import { WIRE_CLASSES } from '@wildshard/wire/classes';
import { classColumns } from '@wildshard/wire/columns';
import { encodeFrame as encodeWire } from '@wildshard/wire/frameRecord';
import { encodeRideLawTables } from '@wildshard/wire/rideTables';
import { RIDE_LAWS } from '@wildshard/wire/rides';
import { expect, test } from 'vitest';
import { BitWriter } from '../src/shared/engine/net/bits';
import { decodeFrame, encodeFrame, WorldFrame, type DecodedFrame, type FrameInput } from '../src/shared/engine/net/frame';
import { ANIMAL_CLASS, PLAYER_CLASS } from '../src/shared/engine/net/netSchemas';
import type { NetClass } from '../src/shared/engine/net/schema';
import { snapshotOf, WireFrameReader } from '../src/shared/engine/net/wireFrames';

const OWNER: NetClass<never> = PLAYER_CLASS, ANIMAL: NetClass<never> = ANIMAL_CLASS;
const TABLES = { classTables: encodeClassTables(WIRE_CLASSES), rideLawTables: encodeRideLawTables(RIDE_LAWS) };
const RIDE_WORDS = 38;

/** Three animals; `step` moves some of them, so a delta and a held row both appear. */
function world(tick: number, step: number): WorldFrame {
  const frame = new WorldFrame(); frame.reset(tick);
  for (const handle of [1, 2, 3]) {
    const at = frame.claim(handle, ANIMAL.row.length);
    for (let index = 0; index < ANIMAL.row.length; index++) frame.data[at + index] = (handle * 7 + index * 3 + (handle === 3 ? 0 : step)) % 2;
  }
  return frame;
}

function inputs(): FrameInput[] {
  const owner = new Float64Array(OWNER.owner.length).map((_, index) => (index % 5 === 0 ? 0.1 + index / 3 : index));
  const ride = new Float64Array(RIDE_WORDS).map((_, index) => index * 0.25 - 3);
  const base = { cell: 2, lastSeq: 9, ownerClass: OWNER, owner, visible: new Set([1, 2, 3]), classOf: () => ANIMAL };
  const first = world(10, 0), second = world(12, 1), third = world(14, 1);
  return [
    { ...base, frame: first, baseline: null },
    { ...base, frame: second, baseline: { frame: first, visible: new Set([1, 2, 3]) }, ride, rideWords: RIDE_WORDS },
    { ...base, frame: third, visible: new Set([1, 3]), baseline: { frame: second, visible: new Set([1, 2, 3]) }, due: handle => handle !== 3 },
  ] as FrameInput[];
}

test('a frame sequence projects to the frames v0 decodes, owner f64 bits and ride words included', () => {
  const v0Frames = new Map<number, DecodedFrame>(), writer = new BitWriter(4096);
  const reader = new WireFrameReader(TABLES, () => ANIMAL, OWNER);
  for (const input of inputs()) {
    const v0 = decodeFrame(new Uint8Array(encodeFrame(writer, input)), { ownerClass: OWNER, classOf: () => ANIMAL, baseline: tick => v0Frames.get(tick) ?? null });
    if (v0 === null) throw new Error('v0 frame did not decode');
    v0Frames.set(v0.tick, v0);
    const v1 = reader.read(encodeWire(snapshotOf(input)));
    expect(v1).toEqual(v0);
    expect(new Uint8Array(v1?.owner.buffer ?? new ArrayBuffer(0))).toEqual(new Uint8Array(v0.owner.buffer));
  }
});

test('a frame against a baseline the client never held cannot apply yet', () => {
  const [, second] = inputs();
  if (second === undefined) throw new Error('no second frame');
  expect(new WireFrameReader(TABLES, () => ANIMAL, OWNER).read(encodeWire(snapshotOf(second)))).toBeNull();
});

// The WR4 review, carried to WR5: a prediction correction through a skewed table keeps px..vz bit for bit (J140). The sender's
// player has an extra owner field before px, so every owner column sits one slot later on the wire than in this build.
test('a sender with an extra owner field before px projects px..vz bit for bit', () => {
  const player = WIRE_CLASSES.find(entry => entry.name === 'player');
  if (player === undefined) throw new Error('no player class');
  const skewed = { ...player, fields: [{ id: 200, name: 'extra', node: { kind: 'f32' as const }, send: 'owner' as const }, ...player.fields] };
  const classes = WIRE_CLASSES.map(entry => (entry === player ? skewed : entry));
  const local = classColumns(player).owner, sender = classColumns(skewed).owner;
  const exact = [123.45678901234567, -0.000123456789012345, 9_876.54321098765, 1.1, -2.2e-7, 3.3333333333333335];
  const value = (id: number, at: number): number => (id === 200 ? 7.25 : id >= 11 && id <= 16 ? exact[id - 11] ?? 0 : at % 2);
  const [first] = inputs();
  if (first === undefined) throw new Error('no frame');
  const columns = new Map(classes.map(entry => [entry.name, classColumns(entry)]));
  const input = { ...snapshotOf(first), ownerClass: classColumns(skewed), owner: Float64Array.from(sender.map((column, at) => value(column.id, at))),
    classOf: (handle: number) => (handle > 0 ? columns.get('animal') : undefined) };
  const reader = new WireFrameReader({ classTables: encodeClassTables(classes), rideLawTables: TABLES.rideLawTables }, () => ANIMAL, OWNER);
  const decoded = reader.read(encodeWire(input));
  if (decoded === null) throw new Error('frame did not decode');
  for (const id of [11, 12, 13, 14, 15, 16]) {
    const at = local.findIndex(column => column.id === id), want = new Float64Array([exact[id - 11] ?? 0]), got = new Float64Array([decoded.owner[at] ?? Number.NaN]);
    expect(new Uint8Array(got.buffer), `field ${String(id)}`).toEqual(new Uint8Array(want.buffer));
  }
});
