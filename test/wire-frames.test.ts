// WIRE-STABILITY WR5: a frame sequence sent the wire v1 way and projected decodes to the DecodedFrame v0 gives: rows,
// deltas against a baseline, held rows, freshness, the owner block's f64 bits (J140) and the ride words.
import { encodeClassTables } from '@wildshard/wire/classTables';
import { WIRE_CLASSES } from '@wildshard/wire/classes';
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
