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
  /** Rows whose id took a fresh handle when their text changed; each retires at the next sweep. */
  private readonly replaced = new Set<number>();
  /** The last sweep's retired handles whose id took a fresh one: a client hears each go before its successor's spawn, as a
   *  client drops a body's id on its despawn. */
  readonly renewed: Set<number> = new Set<number>();
  /** A stable id's handle, or 0 if it has none yet. */
  readonly refs: NetRefs = id => this.byId.get(id)?.handle ?? 0;
  /** A handle's stable id. */
  readonly idOf = (handle: number): string | undefined => this.byHandle.get(handle)?.id;
  /** A handle's table row. */
  row(handle: number): NetEntityRow | undefined { return this.byHandle.get(handle); }
  /**
   * Mark an entity present this frame, assigning its handle and reading its initial fields the first time. A row whose text
   * (a player's Name) no longer reads the same takes a fresh handle, and the old one retires at the next sweep: a room's lead
   * body (`actor.player`) is the next player's once its holder leaves, and its Name travels only in a spawn. Reads the text,
   * never sends it: a client hears a Name again only when it changed.
   */
  touch<S>(id: string, cls: NetClass<S>, view: S, serial: number): NetEntityRow {
    const existing = this.byId.get(id);
    if (existing !== undefined) {
      if (sameText(existing, cls, view)) { existing.seen = serial; return existing; }
      this.byId.delete(id); this.replaced.add(existing.handle);
    }
    const slot = this.free.pop() ?? this.nextSlot++;
    if (slot >= SLOTS) throw new RangeError('Net handles exhausted');
    const handle = slot | ((this.generations[slot] ?? 0) << 12);
    const row: NetEntityRow = { handle, id, cls, initial: cls.initial.map(column => column.sample(view, this.refs)), text: cls.text.map(field => field.read(view)), seen: serial };
    this.byId.set(id, row); this.byHandle.set(handle, row);
    return row;
  }
  /** Retire every entity not touched this frame; returns their handles. Those whose id lives on under a fresh handle are `renewed` until the next sweep. */
  sweep(serial: number): number[] {
    const retired: number[] = [], { replaced, renewed } = this;
    renewed.clear();
    for (const row of this.byHandle.values()) {
      if (row.seen === serial) continue;
      const slot = row.handle & (SLOTS - 1);
      this.generations[slot] = ((this.generations[slot] ?? 0) + 1) % GENERATIONS;
      this.free.push(slot); this.byHandle.delete(row.handle);
      if (this.byId.get(row.id) === row) this.byId.delete(row.id);
      if (replaced.has(row.handle)) renewed.add(row.handle);
      retired.push(row.handle);
    }
    replaced.clear();
    return retired;
  }
}

/** Whether a row's text still reads as it did at its spawn. */
function sameText<S>(row: NetEntityRow, cls: NetClass<S>, view: S): boolean {
  const { text } = cls;
  for (let index = 0; index < text.length; index++) if ((text[index] as (typeof text)[number]).read(view) !== row.text[index]) return false;
  return true;
}
