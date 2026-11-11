// WIRE-STABILITY WR5 (5.4): frames on wire v1. The server says its FrameInput as a snapshot input in its own layout;
// the client reads the raw frame in the sender's layout, keeps that raw frame as the next baseline, and projects it into
// its own layout. The predictor and the interpolator read only the projection (a DecodedFrame, as before).
import { decodeClassTables } from '@wildshard/wire/classTables';
import { WIRE_CLASSES } from '@wildshard/wire/classes';
import { classColumns, type ClassColumns } from '@wildshard/wire/columns';
import { decodeFrameMessage } from '@wildshard/wire/frameRecord';
import { projectClasses, projectRides, projectRow, type ClassProjection, type RideProjection } from '@wildshard/wire/projection';
import { decodeRideLawTables } from '@wildshard/wire/rideTables';
import { MOUNT, RIDE_LAWS } from '@wildshard/wire/rides';
import type { RawFrame, RideLaw, RowSource, SnapshotInput } from '@wildshard/wire/snapshot';
import type { DecodedFrame, FrameInput } from './frame';
import type { NetClass } from './schema';

/** This build's columns of every class, by name, compiled once. */
const LOCAL: ReadonlyMap<string, ClassColumns> = new Map(WIRE_CLASSES.map(entry => [entry.name, classColumns(entry)]));
/** This build's class ids, by name. */
const IDS: ReadonlyMap<string, number> = new Map(WIRE_CLASSES.map(entry => [entry.name, entry.id]));

/** This build's columns for a game class. */
export function columnsOf(cls: NetClass<never>): ClassColumns {
  const columns = LOCAL.get(cls.cls);
  if (columns === undefined) throw new RangeError(`No wire class ${cls.cls}`);
  return columns;
}

/** A game frame input as the wire's snapshot input, in this build's layout. */
export function snapshotOf(input: FrameInput): SnapshotInput {
  const words = input.rideWords ?? 0, { baseline } = input;
  return {
    frame: input.frame, cell: input.cell, lastSeq: input.lastSeq, ownerClass: columnsOf(input.ownerClass), owner: input.owner,
    ride: words > 0 && input.ride !== undefined ? { law: MOUNT.id, words: input.ride.slice(0, words) } : undefined,
    visible: input.visible,
    baseline: baseline === null ? undefined : {
      frame: baseline.frame, visible: baseline.visible,
      ...(baseline.rowFrom === undefined ? {} : { rowFrom: (handle: number): RowSource | undefined => baseline.rowFrom?.(handle) ?? undefined }),
    },
    ...(input.due === undefined ? {} : { due: input.due }),
    classOf: handle => { const cls = input.classOf(handle); return cls === undefined ? undefined : columnsOf(cls); },
  };
}

/** The server's table blocks a welcome carries (5.3). */
export interface FrameTables { readonly classTables: Uint8Array; readonly rideLawTables: Uint8Array }
/** How many raw frames the client keeps as baselines. */
const RAW_RING = 64;

/** Reads one server's frames into this build's layout; the raw frames it keeps are that server's own. */
export class WireFrameReader {
  private readonly sender: ReadonlyMap<number, ClassColumns>;
  private readonly projected: ReadonlyMap<number, ClassProjection>;
  private readonly rides: ReadonlyMap<number, RideProjection>;
  private readonly laws: ReadonlyMap<number, RideLaw>;
  private readonly raw = new Map<number, RawFrame>();
  private readonly classOf: (handle: number) => NetClass<never> | undefined;
  private readonly owner: NetClass<never>;

  /** `classOf` names a handle's class from its spawn; the welcome's tables name the sender's layout. */
  constructor(tables: FrameTables, classOf: (handle: number) => NetClass<never> | undefined, owner: NetClass<never>) {
    this.classOf = classOf; this.owner = owner;
    const classes = decodeClassTables(tables.classTables), laws = decodeRideLawTables(tables.rideLawTables);
    this.sender = new Map(classes.map(entry => [entry.id, classColumns(entry)]));
    this.projected = projectClasses(classes, WIRE_CLASSES);
    this.rides = projectRides(laws, RIDE_LAWS);
    this.laws = new Map(laws.map(law => [law.id, { id: law.id, words: law.fields.length }]));
  }

  /** The sender's columns of a class, by its id: what its spawns are written in. */
  senderColumns(id: number): ClassColumns | undefined { return this.sender.get(id); }

  /** A spawn's initial words, sent in the sender's layout, in this build's. */
  initial(cls: NetClass<never>, words: readonly number[]): number[] {
    const slots = this.projected.get(IDS.get(cls.cls) ?? 0);
    return slots === undefined ? [...words] : [...projectRow(slots.initial, words)];
  }

  private senderOf(cls: NetClass<never> | undefined): ClassColumns | undefined {
    const id = cls === undefined ? undefined : IDS.get(cls.cls);
    return id === undefined ? undefined : this.sender.get(id);
  }

  /** One frame message, projected; null when it is malformed or cannot apply yet. */
  read(bytes: Uint8Array): DecodedFrame | null {
    const ownerClass = this.senderOf(this.owner);
    if (ownerClass === undefined) return null;
    let raw: RawFrame | undefined;
    try {
      raw = decodeFrameMessage(bytes, { ownerClass, classOf: handle => this.senderOf(this.classOf(handle)), rideLaw: id => this.laws.get(id), baseline: tick => this.raw.get(tick) });
    } catch (error) { if (error instanceof Error && error.name === 'WireDecodeError') return null; throw error; }
    if (raw === undefined) return null;
    this.raw.set(raw.tick, raw);
    if (this.raw.size > RAW_RING) for (const tick of this.raw.keys()) { this.raw.delete(tick); if (this.raw.size <= RAW_RING) break; }
    return this.project(raw);
  }

  private project(raw: RawFrame): DecodedFrame {
    const ownerId = IDS.get(this.owner.cls) ?? 0, owner = this.projected.get(ownerId);
    const rows = new Map<number, Uint32Array>();
    for (const [handle, row] of raw.rows) {
      const cls = this.classOf(handle), slots = cls === undefined ? undefined : this.projected.get(IDS.get(cls.cls) ?? 0);
      if (slots !== undefined) rows.set(handle, Uint32Array.from(projectRow(slots.row, row)));
    }
    const ride = raw.ride === undefined ? undefined : this.rides.get(raw.ride.law);
    return {
      tick: raw.tick, baselineTick: raw.baselineTick, cell: raw.cell, lastSeq: raw.lastSeq,
      owner: owner === undefined ? new Float64Array(0) : projectRow(owner.owner, raw.owner), rows,
      // A rider is seated only on a law it can read whole (5.4); otherwise it stands, and the raw block stays raw.
      ride: raw.ride !== undefined && ride?.seated === true ? projectRow(ride.words, raw.ride.words) : null,
      fresh: raw.fresh,
    };
  }
}
