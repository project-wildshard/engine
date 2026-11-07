import type { Scope } from '../app/scope';
import { withOwner } from '../app/ownership';
import type { Phase } from '../../../client/engine/app/systems';
import type { AskInput, AskMap, AskOutput, EventMap } from '../../../client/engine/events/maps';

interface Listener { order: number; active: boolean; scope: Scope; run: (value: unknown) => unknown }
interface QueuedEvent { name: keyof EventMap; payload: unknown }
interface EventsState<T> { version: number; queue: { name: keyof EventMap; payload: T }[]; frameCount: number; frameBound: boolean }
export interface ListenerOptions { order?: number }
export const EVENT_FLUSH_LIMIT = 1000;

export class Events {
  private listeners = new Map<keyof EventMap, Listener[]>();
  private answerers = new Map<keyof AskMap, Listener[]>();
  private queue: QueuedEvent[] = [];
  private flushing = false;
  private frameCount = 0;
  private frameBound = false;
  /** All phase drains share one frame budget; isolated callers retain the standalone drain contract. */
  beginFrame(): void { this.frameCount = 0; this.frameBound = true; }
  /** The host codec replaces live actor references with stable ids in queued payloads. */
  snapshot<T>(encode: (payload: unknown) => T): EventsState<T> {
    if (this.flushing) throw new Error('Cannot snapshot while events are dispatching');
    return { version: 1, queue: this.queue.map((event) => ({ name: event.name, payload: encode(event.payload) })), frameCount: this.frameCount, frameBound: this.frameBound };
  }
  restore<T>(state: EventsState<T>, decode: (payload: T) => unknown): void {
    if (this.flushing || state.version !== 1 || !Number.isSafeInteger(state.frameCount) || state.frameCount < 0
      || state.frameCount > EVENT_FLUSH_LIMIT || typeof state.frameBound !== 'boolean') throw new RangeError('Invalid events snapshot');
    const queue = state.queue.map((event) => ({ name: event.name, payload: decode(event.payload) }));
    this.queue = queue; this.frameCount = state.frameCount; this.frameBound = state.frameBound;
  }
  /** Independent live counts; exclude a level subtree to measure retained engine registrations before unload. */
  census(exclude?: Scope): { listeners: number; answerers: number } {
    const count = (lists: Iterable<Listener[]>): number => {
      let total = 0;
      for (const list of lists) for (const listener of list) if (exclude === undefined || !listener.scope.belongsTo(exclude)) total++;
      return total;
    };
    return { listeners: count(this.listeners.values()), answerers: count(this.answerers.values()) };
  }

  emit<K extends keyof EventMap>(name: K, payload: EventMap[K]): void {
    this.queue.push({ name, payload });
  }
  private subscribe<K>(map: Map<K, Listener[]>, name: K, run: Listener['run'], scope: Scope, opts?: ListenerOptions): void {
    if (scope.disposed) return;
    const listener: Listener = { order: opts?.order ?? 0, active: true, scope, run: (value) => withOwner(scope, () => run(value)) };
    const list = map.get(name) ?? [];
    list.push(listener);
    list.sort((a, b) => a.order - b.order);
    map.set(name, list);
    scope.onDispose(() => {
      listener.active = false;
      const at = list.indexOf(listener);
      if (at !== -1) list.splice(at, 1);
      if (list.length === 0) map.delete(name);
    });
  }
  on<K extends keyof EventMap>(name: K, fn: (payload: EventMap[K]) => void, scope: Scope, opts?: ListenerOptions): void {
    this.subscribe(this.listeners, name, (value) => fn(value as EventMap[K]), scope, opts);
  }
  answer<K extends keyof AskMap>(name: K, fn: (value: AskInput<K>) => AskOutput<K>, scope: Scope, opts?: ListenerOptions): void {
    this.subscribe(this.answerers, name, (value) => fn(value as AskInput<K>), scope, opts);
  }
  ask<K extends keyof AskMap>(name: K, value: AskInput<K>): AskOutput<K> {
    const registered = this.answerers.get(name);
    if (registered === undefined && name !== 'player.crouch') return value as AskOutput<K>;
    // One captured listener is already a complete snapshot, even if its callback changes the registry.
    const single = registered?.length === 1 ? registered[0] : undefined;
    if (single !== undefined) return (single.active ? single.run(value) : value) as AskOutput<K>;
    let result: unknown = value;
    const answerers = [...(registered ?? [])];
    for (const listener of answerers) {
      if (listener.active) result = listener.run(result);
    }
    if (name === 'player.crouch' && answerers.length === 0) result = { allowed: false, latched: false };
    return result as AskOutput<K>;
  }
  private dispatch(event: QueuedEvent): void {
    const listeners = [...(this.listeners.get(event.name) ?? [])];
    for (const listener of listeners) {
      if (listener.active) listener.run(event.payload);
    }
  }
  /** The loop calls this at each phase boundary. Recursive emits join the current drain. */
  flush(phase: Phase): void {
    if (this.flushing) return;
    this.flushing = true;
    try {
      let count = this.frameBound ? this.frameCount : 0;
      while (this.queue.length > 0) {
        if (count === EVENT_FLUSH_LIMIT) {
          this.queue.length = 0;
          try {
            this.dispatch({ name: 'fault', payload: {
              source: 'events', phase, limit: EVENT_FLUSH_LIMIT,
              message: `Event flush exceeded ${String(EVENT_FLUSH_LIMIT)} events`,
            } satisfies EventMap['fault'] });
          } finally { this.queue.length = 0; }
          break;
        }
        const event = this.queue.shift();
        if (event) { count++; this.frameCount = count; this.dispatch(event); }
      }
    } finally { this.flushing = false; }
  }
}
