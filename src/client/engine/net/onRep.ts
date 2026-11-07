// P1-E5.3-F4 (E5-REPLICATION §3.3, §6.1): what a row or an event means to a view, at the moment the view shows it. Events wait
// for the interpolated clock, so a death lands on the pose it belongs to; a `hit` that confirms this client's own swing plays
// at once, because the predicted swing already ran. `onRep('animal.state', fn)` is the registry `shared/` never names.
import type { NetCombatEvent } from '../../../shared/engine/net/messages';
import type { NetColumn, NetValue } from '../../../shared/engine/net/schema';
import type { Interpolator } from './interpolator';

/** A field changed on screen: the entity's handle, the new value and the one before. */
export type RepListener = (handle: number, value: NetValue, was: NetValue) => void;
/** The events that wait for the clock, oldest first. A long stall flushes everything already past. */
export const MAX_HELD_EVENTS = 256;

/** The view's side of the wire, stepped once per render frame. */
export class NetDelivery {
  private readonly interpolator: Interpolator;
  private readonly classNameOf: (handle: number) => string | undefined;
  private readonly fights = new Set<(event: NetCombatEvent) => void>();
  private readonly watchers = new Map<string, Map<string, Set<RepListener>>>();
  private readonly shown = new Map<number, Map<string, NetValue>>();
  private held: NetCombatEvent[] = [];
  private scratch = new Float64Array(32);
  constructor(interpolator: Interpolator, classNameOf: (handle: number) => string | undefined) { this.interpolator = interpolator; this.classNameOf = classNameOf; }

  /** Every combat event, when the screen reaches it; returns the unsubscribe. */
  onEvent(listener: (event: NetCombatEvent) => void): () => void { this.fights.add(listener); return () => { this.fights.delete(listener); }; }
  /** Call when `field` ('animal.state') changes on an entity's interpolated row; returns the unsubscribe. A first sight is no change. */
  onRep(field: string, listener: RepListener): () => void {
    const [cls = '', name = ''] = field.split('.');
    const fields = this.watchers.get(cls) ?? new Map<string, Set<RepListener>>(), listeners = fields.get(name) ?? new Set<RepListener>();
    listeners.add(listener); fields.set(name, listeners); this.watchers.set(cls, fields);
    return () => { listeners.delete(listener); };
  }
  /** One event off the wire, as `NetClient.onCombat` gives it. */
  receive(event: NetCombatEvent): void {
    if (event.kind === 'hit' && event.confirmFor !== 0) { this.play(event); return; }
    let at = this.held.length;
    while (at > 0 && (this.held[at - 1]?.tick ?? 0) > event.tick) at--;
    this.held.splice(at, 0, event);
    if (this.held.length > MAX_HELD_EVENTS) this.play(this.held.shift() ?? event);
  }
  /** A render frame drawn at `renderTick`: changed fields first, then the events it has reached, so a death meets its pose. */
  update(renderTick: number): void {
    if (this.watchers.size > 0) this.replicate(renderTick);
    let due = 0;
    while (due < this.held.length && (this.held[due]?.tick ?? 0) <= renderTick) due++;
    if (due === 0) return;
    const ready = this.held.slice(0, due);
    this.held = this.held.slice(due);
    for (const event of ready) this.play(event);
  }
  /** The client changed cells: what was waiting belonged to the one it left. */
  clear(): void { this.held = []; this.shown.clear(); }

  private play(event: NetCombatEvent): void { for (const listener of this.fights) listener(event); }
  private replicate(renderTick: number): void {
    const { interpolator, shown } = this;
    for (const handle of interpolator.handles()) {
      const fields = this.watchers.get(this.classNameOf(handle) ?? ''), columns = interpolator.columns(handle);
      if (fields === undefined || columns === null) continue;
      if (this.scratch.length < columns.length) this.scratch = new Float64Array(columns.length);
      if (!interpolator.sample(handle, renderTick, this.scratch)) continue;
      const known = shown.get(handle) ?? new Map<string, NetValue>();
      shown.set(handle, known);
      columns.forEach((column, index) => { this.compare(handle, column, this.scratch[index] ?? 0, known, fields); });
    }
    for (const handle of shown.keys()) if (interpolator.columns(handle) === null) shown.delete(handle);
  }
  private compare(handle: number, column: NetColumn<never>, raw: number, known: Map<string, NetValue>, fields: ReadonlyMap<string, ReadonlySet<RepListener>>): void {
    const listeners = fields.get(column.name);
    if (listeners === undefined) return;
    const value = column.kind === 'f32q' || column.kind === 'f32' || column.kind === 'angle' ? raw : column.value(raw), was = known.get(column.name);
    known.set(column.name, value);
    if (was !== undefined && was !== value) for (const listener of listeners) listener(handle, value, was);
  }
}
