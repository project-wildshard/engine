import type { NetClass, NetRefs } from '../../../shared/engine/net/schema';

// P1-E5.2 (E5-REPLICATION §3.4): stable ids stay strings; the wire uses 16-bit handles. A handle is a 12-bit slot and a
// 4-bit generation in one word, so a reused slot reads as a different handle and a late row can never hit its new owner.

const SLOTS = 0x1000, GENERATIONS = 0x10;
/** One live entity's wire identity and the fields that travel once. */
export interface NetEntityRow {
  readonly handle: number; readonly id: string; readonly cls: NetClass<never>;
  readonly initial: readonly number[]; readonly text: readonly string[];
  seen: number;
}

/** The room's table of live handles. */
export class NetHandles {
  private readonly byId = new Map<string, NetEntityRow>();
  private readonly byHandle = new Map<number, NetEntityRow>();
  private readonly generations = new Uint8Array(SLOTS);
  private readonly free: number[] = [];
  private nextSlot = 1; // handle 0 means "none" in a `ref` field
  /** A stable id's handle, or 0 if it has none yet. */
  readonly refs: NetRefs = id => this.byId.get(id)?.handle ?? 0;
  /** A handle's stable id. */
  readonly idOf = (handle: number): string | undefined => this.byHandle.get(handle)?.id;
  /** A handle's table row. */
  row(handle: number): NetEntityRow | undefined { return this.byHandle.get(handle); }
  /** Mark an entity present this frame, assigning its handle and reading its initial fields the first time. */
  touch<S>(id: string, cls: NetClass<S>, view: S, serial: number): NetEntityRow {
    const existing = this.byId.get(id);
    if (existing !== undefined) { existing.seen = serial; return existing; }
    const slot = this.free.pop() ?? this.nextSlot++;
    if (slot >= SLOTS) throw new RangeError('Net handles exhausted');
    const handle = slot | ((this.generations[slot] ?? 0) << 12);
    const row: NetEntityRow = { handle, id, cls, initial: cls.initial.map(column => column.sample(view, this.refs)), text: cls.text.map(field => field.read(view)), seen: serial };
    this.byId.set(id, row); this.byHandle.set(handle, row);
    return row;
  }
  /** Retire every entity not touched this frame; returns their handles. */
  sweep(serial: number): number[] {
    const retired: number[] = [];
    for (const row of this.byHandle.values()) {
      if (row.seen === serial) continue;
      const slot = row.handle & (SLOTS - 1);
      this.generations[slot] = ((this.generations[slot] ?? 0) + 1) % GENERATIONS;
      this.free.push(slot); this.byId.delete(row.id); this.byHandle.delete(row.handle);
      retired.push(row.handle);
    }
    return retired;
  }
}
