// P1-E5.2 (E5-REPLICATION §3.3): the world frame and its per-client delta, Quake 3 / Source style. The server builds one
// quantised frame per snapshot tick, keeps the last 32, and encodes each client's frame against the last one that
// client acked. State needs no reliable channel: a lost frame heals at the next acked one.
import { BitReader, bitsToFloat, floatToBits, NetDecodeError, type BitWriter } from './bits';
import type { NetClass } from './schema';
import { MSG_FRAME } from './messages';

/** The baseline tick of a full frame. */
export const NO_BASELINE = 0xffffffff;
/** World frames the server keeps: about a second at 30 Hz. An ack older than this gets a full frame. */
export const FRAME_RING = 32;

/** One snapshot tick's quantised rows, flat, reused from the ring so a frame allocates nothing once warm. */
export class WorldFrame {
  tick = -1;
  data: Uint32Array = new Uint32Array(1024);
  private used = 0;
  private readonly offsets = new Map<number, number>();
  /** Empty this slot for a new tick. */
  reset(tick: number): void { this.tick = tick; this.used = 0; this.offsets.clear(); }
  /** Reserve one handle's row; the caller fills `length` values from the returned offset. */
  claim(handle: number, length: number): number {
    const at = this.used;
    this.used += length;
    if (this.used > this.data.length) { const next = new Uint32Array(Math.max(this.data.length * 2, this.used)); next.set(this.data); this.data = next; }
    this.offsets.set(handle, at);
    return at;
  }
  /** Where a handle's row starts, or undefined if it was not in this frame. */
  offset(handle: number): number | undefined { return this.offsets.get(handle); }
  /** Every handle in this frame. */
  handles(): Iterable<number> { return this.offsets.keys(); }
}

/** The last FRAME_RING world frames. */
export class WorldFrameRing {
  private readonly slots: WorldFrame[] = Array.from({ length: FRAME_RING }, () => new WorldFrame());
  private next = 0;
  /** The oldest slot, emptied for `tick`. */
  claim(tick: number): WorldFrame {
    const slot = this.slots[this.next];
    if (slot === undefined) throw new Error('Empty frame ring');
    this.next = (this.next + 1) % FRAME_RING;
    slot.reset(tick);
    return slot;
  }
  /** The frame of `tick` if it is still held. */
  at(tick: number): WorldFrame | null { return this.slots.find(slot => slot.tick === tick) ?? null; }
}

/** What one client's frame is built from. */
export interface FrameInput {
  readonly frame: WorldFrame; readonly cell: number; readonly lastSeq: number;
  readonly ownerClass: NetClass<never>; readonly owner: Float64Array;
  /** The first `rideWords` of this are the ride under the owner (P1-E5.3-D3): flat words only its law reads. Absent or 0: on foot, and it costs one bit. */
  readonly ride?: Float64Array; readonly rideWords?: number;
  /** The handles this client should see now, and the same set as of its baseline. */
  readonly visible: ReadonlySet<number>;
  /** `rowFrom` is the world frame a baseline row's values came from: its tier may have left it older than the baseline. */
  readonly baseline: { readonly frame: WorldFrame; readonly visible: ReadonlySet<number>; readonly rowFrom?: (handle: number) => WorldFrame | null } | null;
  /** Whether a row the baseline holds is sent this frame; left out, the client keeps it (§3.3). Absent, all are. */
  readonly due?: (handle: number) => boolean;
  readonly classOf: (handle: number) => NetClass<never> | undefined;
}

const fullMask = (fields: number): number => fields >= 32 ? 0xffffffff : 2 ** fields - 1;
const ascending = (a: number, b: number): number => a - b;

function rowMask(frame: WorldFrame, at: number, base: WorldFrame | null, baseAt: number | undefined, fields: number): number {
  if (base === null || baseAt === undefined) return fullMask(fields);
  let mask = 0;
  for (let index = 0; index < fields; index++) if (frame.data[at + index] !== base.data[baseAt + index]) mask += 2 ** index;
  return mask;
}

/** Write one client's frame: header, owner block, then only the rows that changed since its baseline. */
export function encodeFrame(writer: BitWriter, input: FrameInput): ArrayBuffer {
  const { frame, baseline, visible, classOf, due } = input, seen = baseline?.visible;
  /** The frame a handle's row is a delta against, or null for a whole row. */
  const baseOf = (handle: number): WorldFrame | null => baseline === null || seen?.has(handle) !== true ? null : baseline.rowFrom === undefined ? baseline.frame : baseline.rowFrom(handle);
  writer.write(MSG_FRAME, 8); writer.write(frame.tick, 32); writer.write(baseline?.frame.tick ?? NO_BASELINE, 32);
  writer.write(input.cell, 16); writer.write(input.lastSeq, 16);
  input.ownerClass.owner.forEach((column, index) => { if (column.kind === 'f64') writer.writeDouble(input.owner[index] ?? 0); else writer.write(input.owner[index] ?? 0, column.bits); });
  const rideWords = input.rideWords ?? 0;
  writer.writeBool(rideWords > 0);
  if (rideWords > 0) { writer.write(rideWords, 8); for (let index = 0; index < rideWords; index++) writer.write(floatToBits(input.ride?.[index] ?? 0), 32); }
  const changed: number[] = [], left: number[] = [];
  for (const handle of visible) {
    const cls = classOf(handle), at = frame.offset(handle);
    if (cls === undefined || at === undefined || cls.row.length === 0) continue; // a class with no row is only its spawn
    const base = baseOf(handle);
    if (base !== null && due?.(handle) === false) { left.push(handle); continue; }
    if (rowMask(frame, at, base, base?.offset(handle), cls.row.length) !== 0) changed.push(handle);
    else left.push(handle);
  }
  const gone: number[] = [];
  if (seen !== undefined) for (const handle of seen) if (!visible.has(handle)) gone.push(handle);
  writer.write(changed.length + gone.length, 16);
  for (const handle of gone) { writer.write(handle, 16); writer.writeBool(true); }
  for (const handle of changed) {
    const cls = classOf(handle), at = frame.offset(handle);
    if (cls === undefined || at === undefined) continue;
    const base = baseOf(handle), mask = rowMask(frame, at, base, base?.offset(handle), cls.row.length);
    writer.write(handle, 16); writer.writeBool(false); writer.write(mask, cls.row.length);
    cls.row.forEach((column, index) => { if (Math.floor(mask / 2 ** index) % 2 === 1) writer.write(frame.data[at + index] ?? 0, column.bits); });
  }
  // P1-E5.3-F1: a row left out is one of two things. Due and unchanged is a true sample of something standing still; not due is a stale copy.
  left.sort(ascending);
  for (const handle of left) writer.writeBool(due?.(handle) !== false);
  return writer.finish();
}

/** One decoded frame: the owner block and every visible row, whole, quantised. */
export interface DecodedFrame {
  readonly tick: number; readonly baselineTick: number; readonly cell: number; readonly lastSeq: number;
  readonly owner: Float64Array; readonly rows: Map<number, Uint32Array>;
  /** The ride under this client's player, or null on foot. */
  readonly ride: Float64Array | null;
  /** The rows that are a true sample of this tick, sent or standing still. Any other row is a held copy of an older one. */
  readonly fresh: ReadonlySet<number>;
}
/** What decoding needs from the receiver. */
export interface FrameTable {
  readonly ownerClass: NetClass<never>;
  readonly classOf: (handle: number) => NetClass<never> | undefined;
  readonly baseline: (tick: number) => DecodedFrame | null;
}

function readFrame(reader: BitReader, table: FrameTable): DecodedFrame | null {
  if (reader.read(8) !== MSG_FRAME) throw new NetDecodeError('Not a frame');
  const tick = reader.read(32), baselineTick = reader.read(32), cell = reader.read(16), lastSeq = reader.read(16);
  const owner = new Float64Array(table.ownerClass.owner.length);
  table.ownerClass.owner.forEach((column, index) => { owner[index] = column.kind === 'f64' ? reader.readDouble() : reader.read(column.bits); });
  const ride = reader.readBool() ? new Float64Array(reader.read(8)) : null;
  if (ride !== null) for (let index = 0; index < ride.length; index++) ride[index] = bitsToFloat(reader.read(32));
  const base = baselineTick === NO_BASELINE ? null : table.baseline(baselineTick);
  if (baselineTick !== NO_BASELINE && base === null) return null; // not held any more: wait for the full frame that follows
  const rows = new Map(base?.rows), fresh = new Set<number>(), count = reader.read(16);
  for (let index = 0; index < count; index++) {
    const handle = reader.read(16);
    if (reader.readBool()) { rows.delete(handle); continue; }
    const cls = table.classOf(handle);
    if (cls === undefined) return null; // its spawn has not arrived: the next delta against the last ack carries this row again
    const fields = cls.row.length, mask = reader.read(fields), previous = rows.get(handle);
    if (previous === undefined && mask !== fullMask(fields)) throw new NetDecodeError('Delta row without a baseline');
    const row = previous === undefined ? new Uint32Array(fields) : previous.slice();
    cls.row.forEach((column, at) => { if (Math.floor(mask / 2 ** at) % 2 === 1) row[at] = reader.read(column.bits); });
    rows.set(handle, row); fresh.add(handle);
  }
  for (const handle of [...rows.keys()].sort(ascending)) if (!fresh.has(handle) && reader.readBool()) fresh.add(handle);
  reader.end();
  return { tick, baselineTick, cell, lastSeq, owner, ride, rows, fresh };
}

/** Decode a frame. Malformed bytes or a frame that cannot apply yet give null; nothing throws past this boundary. */
export function decodeFrame(bytes: Uint8Array, table: FrameTable): DecodedFrame | null {
  try { return readFrame(new BitReader(bytes), table); }
  catch (error) { if (error instanceof NetDecodeError) return null; throw error; }
}
