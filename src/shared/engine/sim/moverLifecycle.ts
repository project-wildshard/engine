import * as v from 'valibot';
import { Euler, Quaternion } from 'three';
import { MoverLifecycleRowsSchema, type MoverLifecycleRows } from '@wildshard/format/moverLifecycle';
import type { MoverData } from '@wildshard/format/movers';

/** Platform drains these fixed-step edges into declared signals; these are not actor move.done events. */
export interface MoverEndEvent { readonly mover: string; readonly atEnd: boolean }
const event = v.strictObject({ mover: v.string(), atEnd: v.boolean() });
/** Checkpoints retain both edge latches and undelivered events. Restore emits nothing. */
export const MoverLifecycleStateSchema: v.GenericSchema<BoundedMoverStateInput, BoundedMoverState> = v.strictObject({ contract: v.string(),
  ends: v.pipe(v.array(event), v.maxLength(32)), pending: v.pipe(v.array(event), v.maxLength(64)) });
export type MoverLifecycleState = v.InferOutput<typeof MoverLifecycleStateSchema>;

/** Renderer-free endpoint observations with bounded delivery and an explicit logical continuation. */
export class MoverLifecycle {
  private readonly rows: MoverLifecycleRows;
  private readonly contract: string;
  private ends = new Map<string, boolean>();
  private pending: MoverEndEvent[] = [];
  constructor(input: unknown) {
    this.rows = v.parse(MoverLifecycleRowsSchema, input); this.contract = JSON.stringify(this.rows);
    for (const row of this.rows) if (row.atEnd !== undefined) this.ends.set(row.id, false);
  }
  /** A successful fixed-step publication observes the actual admitted host fields. */
  observe(id: string, fields: Readonly<Record<number, number>>): void {
    const row = this.rows.find(value => value.id === id); if (row === undefined) throw new Error('Unknown mover lifecycle');
    if (row.atEnd === undefined) return;
    const value = fields[row.atEnd.field]; if (value === undefined || !Number.isFinite(value)) throw new Error('Missing mover endpoint field');
    const atEnd = value === row.atEnd.equals;
    if (atEnd === this.ends.get(id)) return;
    if (this.pending.length === 64) throw new Error('Mover endpoint queue overflow; drain each fixed step');
    this.pending.push({ mover: id, atEnd }); this.ends.set(id, atEnd);
  }
  /** Initialization/load reconciles a published state without replaying an ordinary endpoint event. */
  seed(id: string, fields: Readonly<Record<number, number>>): void {
    const row = this.rows.find(value => value.id === id); if (row === undefined) throw new Error('Unknown mover lifecycle');
    if (row.atEnd === undefined) return;
    const value = fields[row.atEnd.field]; if (value === undefined || !Number.isFinite(value)) throw new Error('Missing mover endpoint field');
    this.ends.set(id, value === row.atEnd.equals);
  }
  /** The committed endpoint latch, including silent load/restore seeding. */
  atEnd(id: string): boolean {
    const value = this.ends.get(id); if (value === undefined) throw new Error('Mover has no declared endpoint'); return value;
  }
  drain(): readonly MoverEndEvent[] { const events = this.pending; this.pending = []; return events; }
  snapshot(): MoverLifecycleState { return { contract: this.contract, ends: [...this.ends].map(([mover, atEnd]) => ({ mover, atEnd })), pending: this.pending.map(row => ({ mover: row.mover, atEnd: row.atEnd })) }; }
  restore(input: unknown): void {
    const saved = v.parse(MoverLifecycleStateSchema, input), ids = new Set(this.ends.keys());
    if (saved.contract !== this.contract || saved.ends.length !== ids.size || new Set(saved.ends.map(row => row.mover)).size !== ids.size
      || [...saved.ends, ...saved.pending].some(row => !ids.has(row.mover))) throw new Error('Incompatible mover lifecycle continuation');
    this.ends = new Map(saved.ends.map(row => [row.mover, row.atEnd])); this.pending = saved.pending.map(row => ({ mover: row.mover, atEnd: row.atEnd }));
  }
}
/** Final admitted pose/state for a load-only one-shot track. No guest call, tick, player or quest effect occurs. */
export function moverEndState(row: MoverData[number]): { position: readonly [number, number, number]; fields: Readonly<Record<number, number>> } {
  const { track, driver } = row;
  if (row.restoreFrom === undefined || row.atEnd === undefined || track?.loop !== 'once'
    || !(driver?.kind === 'track' || driver?.kind === 'winch' && driver.mode === 'hinge')) throw new Error('Mover has no admitted endpoint');
  const position: readonly [number, number, number] = track.position?.at(-1) ?? [row.at.x, row.at.y, row.at.z];
  const q = track.quaternion?.at(-1), angles = driver.kind === 'winch' ? { ...row.euler, x: 0 }
    : q === undefined ? row.euler : new Euler().setFromQuaternion(new Quaternion(...q), 'YXZ');
  const fields = { 1: angles.x + 0, 2: angles.y + 0, 3: angles.z + 0, 4: Number(driver.kind === 'winch' || row.enabled), 5: 1, 6: 0 };
  if (fields[row.atEnd.field] !== row.atEnd.equals) throw new Error('Restored mover does not satisfy its declared endpoint');
  return { position: [position[0], position[1], position[2]], fields };
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedMoverStateInput = BoundedMoverState;
interface BoundedMoverStateFields {
    contract: string;
    ends: {
        mover: string;
        atEnd: boolean;
    }[];
    pending: {
        mover: string;
        atEnd: boolean;
    }[];
}
type BoundedMoverState = { [Key in keyof BoundedMoverStateFields]: BoundedMoverStateFields[Key] };
