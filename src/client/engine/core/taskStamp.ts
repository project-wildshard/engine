/**
 * meta DRIFTWOOD-FPS DF8 / IPHONE13-DRIFTWOOD DW3 (mini-driftwood13m, 2026-11-20): name the work that runs outside the game's
 * frame. On the iPhone 13 a third of the dock's frames over 50 ms had no update, render, link, upload or collection in them
 * ("other"), and WebKit's Timeline answers every record with a zero timestamp on iOS 18.6.2. With `debug.taskStamp` on, the
 * page stamps every callback the browser hands it (timers, animation frames, microtasks, event listeners and `on*`
 * handlers, worker and socket messages, the DOM observers, promise reactions) that runs `TASK_STAMP_MIN_MS` or more, and a
 * 10 ms probe timer records how late it fired, and a WeakRef sentinel it renews says when a collection ran: a late probe with no stamp is main-thread work nothing here wraps (a
 * collection, style and layout, an `await` continuation); an on-time probe in a long frame is a frame the main thread did
 * not hold up. The bench reads `window.__wsTaskStamp` (src/scripts/memory/iphone/census.mjs). Off by default, debug only: the
 * wrappers are installed once at page start, in the first page script (client/app/identity.ts).
 */
import { jsonSlot } from '../saves/slots';
import { diagnosticNow } from '@wildshard/engine/core/clock';

export const TASK_STAMP_SLOT = 'debug.taskStamp';
/** callbacks this long or longer are kept */
export const TASK_STAMP_MIN_MS = 2;
/** the probe's period; a probe this much later than asked is kept */
export const PROBE_EVERY_MS = 10;
export const PROBE_LATE_MS = 12;
const RING = 32_768;

/** The stamps: a ring of [page ms, ms, label] and of late probes [page ms they were due, ms late]. */
export class TaskStampLog {
  // plain arrays, filled as stamps arrive (debug only; a page with the slot off never makes one)
  private readonly t: number[] = [];
  private readonly ms: number[] = [];
  private readonly label: string[] = [];
  private n = 0;
  private readonly lateT: number[] = [];
  private readonly lateMs: number[] = [];
  private ln = 0;
  // collections seen by the probe's sentinel: [the probe before, the probe that found it gone]
  private readonly gcFrom: number[] = [];
  private readonly gcTo: number[] = [];
  private gn = 0;
  record(t: number, ms: number, label: string): void { const i = this.n % RING; this.t[i] = t; this.ms[i] = ms; this.label[i] = label; this.n++; }
  late(due: number, ms: number): void { const i = this.ln % RING; this.lateT[i] = due; this.lateMs[i] = ms; this.ln++; }
  /** a collection ran between two probes (the earlier probe's sentinel was gone at the later one) */
  collected(from: number, to: number): void { const i = this.gn % RING; this.gcFrom[i] = from; this.gcTo[i] = to; this.gn++; }
  /** the probe gaps with a collection in them that overlap [from, to): [gap start, gap end] */
  collections(from: number, to: number): [number, number][] {
    const out: [number, number][] = [];
    for (let k = Math.max(0, this.gn - RING); k < this.gn; k++) {
      const i = k % RING, a = this.gcFrom[i] ?? 0, b = this.gcTo[i] ?? 0;
      if (a < to && b > from) out.push([Math.round(a), Math.round(b)]);
    }
    return out;
  }
  /** the stamps that overlap [from, to): [start, ms, label] */
  read(from: number, to: number): [number, number, string][] {
    const out: [number, number, string][] = [];
    for (let k = Math.max(0, this.n - RING); k < this.n; k++) {
      const i = k % RING, t = this.t[i] ?? 0, ms = this.ms[i] ?? 0;
      if (t < to && t + ms > from) out.push([Math.round(t), Math.round(ms * 10) / 10, this.label[i] ?? '?']);
    }
    return out;
  }
  /** the late probes due in [from, to): [due, ms late] */
  lates(from: number, to: number): [number, number][] {
    const out: [number, number][] = [];
    for (let k = Math.max(0, this.ln - RING); k < this.ln; k++) {
      const i = k % RING, t = this.lateT[i] ?? 0;
      if (t >= from && t < to) out.push([Math.round(t), Math.round(this.lateMs[i] ?? 0)]);
    }
    return out;
  }
  get count(): number { return this.n; }
}

type AnyFn = (this: unknown, ...args: unknown[]) => unknown;
const names = new WeakMap<object, string>();
/** a callback's name, read once: its function name, else the start of its source */
function nameOf(fn: object): string {
  let name = names.get(fn);
  if (name === undefined) {
    const own = typeof fn === 'function' ? fn.name : '';
    name = own !== '' ? own : (typeof fn === 'function' ? Function.prototype.toString.call(fn) : fn.constructor.name).slice(0, 60).replaceAll(/\s+/gu, ' ');
    names.set(fn, name);
  }
  return name;
}

/** Install the wrappers on `scope` (the page's window) and answer the log. Pure apart from `scope`. */
export function installTaskStamp(scope: typeof globalThis, now: () => number = diagnosticNow, promises = false): TaskStampLog {
  const log = new TaskStampLog();
  const timed = (kind: string, fn: AnyFn, label?: (self: unknown, args: unknown[]) => string): AnyFn => function stamped(this: unknown, ...args: unknown[]): unknown {
    const t = now();
    try { return fn.apply(this, args); } finally {
      const ms = now() - t;
      if (ms >= TASK_STAMP_MIN_MS) log.record(t, ms, label === undefined ? `${kind}:${nameOf(fn)}` : label(this, args));
    }
  };
  const g = scope as unknown as Record<string, unknown>;
  // timers, frames, microtasks
  const ownTimeout = g['setTimeout'] as (fn: AnyFn, ms?: number, ...rest: unknown[]) => number;
  for (const name of ['setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask', 'requestIdleCallback'] as const) {
    const own = g[name];
    if (typeof own !== 'function') continue;
    const kind = name === 'requestAnimationFrame' ? 'raf' : name === 'queueMicrotask' ? 'micro' : name === 'requestIdleCallback' ? 'idle' : name === 'setTimeout' ? 'timeout' : 'interval';
    g[name] = function stampedSchedule(this: unknown, fn: unknown, ...rest: unknown[]): unknown {
      return (own as AnyFn).call(scope, typeof fn === 'function' ? timed(kind, fn as AnyFn) : fn, ...rest);
    };
  }
  // event listeners (worker, socket and port messages, input, media, storage requests): one wrapper per listener
  const proto = (scope as unknown as { EventTarget?: { prototype: EventTarget } }).EventTarget?.prototype;
  if (proto !== undefined) {
    const wrapped = new WeakMap<object, AnyFn>();
    const listenerOf = (listener: unknown): AnyFn | null => {
      if (listener === null || (typeof listener !== 'function' && typeof listener !== 'object')) return null;
      let w = wrapped.get(listener);
      if (w === undefined) {
        const call: AnyFn = typeof listener === 'function' ? (listener as AnyFn) : function handleEvent(this: unknown, ...args: unknown[]) { return (listener as { handleEvent: AnyFn }).handleEvent(...args); };
        w = timed('event', call, (self, args) => `${self === null || self === undefined ? '?' : self.constructor.name}.${String((args[0] as Event | undefined)?.type)}:${nameOf(listener)}`);
        wrapped.set(listener, w);
      }
      return w;
    };
    const add = Reflect.get(proto, 'addEventListener') as AnyFn, remove = Reflect.get(proto, 'removeEventListener') as AnyFn;
    proto.addEventListener = function addEventListener(this: EventTarget, type: string, listener: unknown, options?: unknown): void {
      add.call(this, type, listenerOf(listener) ?? listener, options);
    };
    proto.removeEventListener = function removeEventListener(this: EventTarget, type: string, listener: unknown, options?: unknown): void {
      const w = listener !== null && (typeof listener === 'function' || typeof listener === 'object') ? wrapped.get(listener) : undefined;
      remove.call(this, type, w ?? listener, options);
    };
    // `on*` handler properties on the classes that deliver work (a worker's or a socket's onmessage, a request's onsuccess)
    const handlers = ['onmessage', 'onload', 'onloadend', 'onsuccess', 'onerror', 'oncomplete', 'onopen', 'onclose', 'onended', 'onreadystatechange', 'onupgradeneeded'];
    for (const cls of ['Worker', 'MessagePort', 'WebSocket', 'BroadcastChannel', 'XMLHttpRequest', 'IDBRequest', 'IDBOpenDBRequest', 'IDBTransaction', 'FileReader', 'AudioScheduledSourceNode', 'HTMLImageElement', 'HTMLMediaElement']) {
      const target = (g[cls] as { prototype?: object } | undefined)?.prototype;
      if (target === undefined) continue;
      for (const prop of handlers) {
        const d = Object.getOwnPropertyDescriptor(target, prop);
        if (d?.set === undefined || d.get === undefined || d.configurable !== true) continue;
        const set = Reflect.get(d, 'set') as AnyFn, get = Reflect.get(d, 'get') as AnyFn, originals = new WeakMap<object, unknown>();
        Object.defineProperty(target, prop, { configurable: true, enumerable: d.enumerable ?? false,
          get(this: object) { return originals.has(this) ? originals.get(this) : get.call(this); },
          set(this: object, fn: unknown) {
            originals.set(this, fn);
            set.call(this, typeof fn === 'function' ? timed('on', fn as AnyFn, (self) => `${(self as object).constructor.name}.${prop}:${nameOf(fn)}`) : fn);
          } });
      }
    }
  }
  // DOM and performance observers
  for (const cls of ['MutationObserver', 'ResizeObserver', 'IntersectionObserver', 'PerformanceObserver']) {
    const Own = g[cls] as (new (notify: AnyFn, ...rest: unknown[]) => object) | undefined;
    if (typeof Own !== 'function') continue;
    g[cls] = class extends Own { constructor(notify: AnyFn, ...rest: unknown[]) { super(typeof notify === 'function' ? timed(cls, notify) : notify, ...rest); } };
  }
  // promise reactions (`.then`, and `.catch` / `.finally`, which call it); an `await` continuation is not one of these
  const promise = (g['Promise'] as { prototype: { then: AnyFn } } | undefined)?.prototype;
  if (promises && promise !== undefined) {
    const ownThen = promise.then;
    const stampedThen = function stampedThen(this: unknown, onFulfilled?: unknown, onRejected?: unknown): unknown {
      return ownThen.call(this, typeof onFulfilled === 'function' ? timed('then', onFulfilled as AnyFn) : onFulfilled,
        typeof onRejected === 'function' ? timed('catch', onRejected as AnyFn) : onRejected);
    };
    // oxlint-disable-next-line unicorn/no-thenable -- Promise's own then, wrapped in place (a debug slot); every promise stays a promise
    Object.defineProperty(promise, 'then', { configurable: true, writable: true, enumerable: false, value: stampedThen });
  }
  // the probe: due every PROBE_EVERY_MS on the page's own timer; how late it ran says whether the main thread was held
  if (typeof ownTimeout === 'function') {
    // a fresh object behind a WeakRef each probe: gone at the next probe means a collection ran between the two (an eden
    // collection takes it as well as a full one), so a held frame can say it was the collector
    const Weak = g['WeakRef'] as (new (target: object) => { deref: () => object | undefined }) | undefined;
    let due = now() + PROBE_EVERY_MS, last = now(), sentinel = Weak === undefined ? null : new Weak({});
    const probe = (): void => {
      const at = now(), late = at - due; if (late >= PROBE_LATE_MS) log.late(due, late);
      if (sentinel !== null && Weak !== undefined) { if (sentinel.deref() === undefined) log.collected(last, at); sentinel = new Weak({}); }
      last = at; due = at + PROBE_EVERY_MS; ownTimeout.call(scope, probe, PROBE_EVERY_MS);
    };
    ownTimeout.call(scope, probe, PROBE_EVERY_MS);
  }
  return log;
}

/** The slot: `true` stamps everything but promise reactions (their wrappers allocate a closure a call, which feeds the
 *  collector the bench is looking for); `"all"` adds them; anything else is off. Storage blocked: off. */
export function taskStampMode(): 'off' | 'on' | 'all' {
  try { const saved = jsonSlot(TASK_STAMP_SLOT, 'device').read(); return saved === true ? 'on' : saved === 'all' ? 'all' : 'off'; } catch { return 'off'; }
}

/** client/app/identity.ts: install once when the slot is on, as `window.__wsTaskStamp`. */
export function startTaskStamp(): void {
  const mode = typeof window === 'undefined' ? 'off' : taskStampMode();
  if (mode === 'off') return;
  const held = window as unknown as { __wsTaskStamp?: TaskStampLog };
  held.__wsTaskStamp ??= installTaskStamp(window, diagnosticNow, mode === 'all');
}
