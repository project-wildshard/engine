import type { Object3D } from 'three';
import { withOwner, withOwnerCall } from './ownership';
import { scopeEnvironment, type ScopeEnvironment } from './scopeEnvironment';
import { scopedProperty } from './scopedProperty';
import { diagnosticNow } from '../core/clock';

// Keep the frame timestamp out of a newly captured owner closure on every RAF.
function runFrame(fn: FrameRequestCallback | undefined, time: number): void {
  if (fn === undefined) throw new TypeError('fn is not a function');
  fn(time);
}

export interface Disposable3 { dispose: () => void }
export interface PhysicsHandle { remove: () => void }
export interface SoundHandle { stop: () => void; disconnect?: () => void }
export interface ScopeCensus {
  geometries: number;
  materials: number;
  textures: number;
  renderTargets: number;
  meshes: number;
  resources: number;
  bodies: number;
  sounds: number;
  listeners: number;
  timers: number;
  rafs: number;
  disposers: number;
  systems: number;
  colliders: number;
  nodes: number;
}
type Kind = keyof ScopeCensus;
interface Cleanup { kind: Kind; run: () => void; readonly child?: Scope; readonly parts?: () => Generator<undefined, void> }
/** One cleanup `Scope.disposeSteps` has just run: its scope and kind (a caller times its steps and yields between them). */
export interface DisposeStep { readonly scope: string; readonly kind: Kind }
export interface NativeCensus {
  listeners: { window: number; document: number; canvas: number; other: number };
  timers: { timeouts: number; intervals: number; raf: number };
}
interface Registration { scope: Scope; target?: EventTarget; timer?: ReturnType<typeof setTimeout>; activity?: TimerActivity; kind: 'listeners' | 'timeouts' | 'intervals' | 'raf' }
interface FrameRecord {
  id: number | undefined; fn: FrameRequestCallback | undefined; native: ScopeEnvironment | undefined;
  readonly owner: Scope; readonly cleanup: Cleanup; readonly registration: Registration;
  run: FrameRequestCallback; readonly cancel: () => void;
  readonly beforeId: () => void; readonly begin: () => void; readonly finish: () => void;
}
// A retained Error can keep its frame's function alive. The native driver owns
// only a weak record reference; user code runs outside the record's closures.
function frameDriver(ref: WeakRef<FrameRecord>): FrameRequestCallback {
  return (time) => { dispatchFrame(ref, time); };
}
// Native identifiers use Map's SameValueZero equality, including injected NaN.
function sameFrameId(a: number | undefined, b: number): boolean { return a === b || Number.isNaN(a) && Number.isNaN(b); }
function dispatchFrame(ref: WeakRef<FrameRecord>, time: number): void {
  const record = ref.deref(); if (record === undefined) return; // retired native request
  const fn = record.fn, owner = record.owner;
  if (record.id === undefined) {
    record.beforeId();
    if (!owner.disposed) withOwnerCall(owner, runFrame, fn, time);
    return;
  }
  record.begin();
  if (!owner.disposed) withOwnerCall(owner, runFrame, fn, time);
  record.finish();
}
// Declaration consumers can have Node timer overloads; zero remains the closed-scope sentinel there too.
type ScopedTimer<T> = T | 0;
const registrations = new Set<Registration>();
let timersActive = true;

/** A browser host parks owned timers while hidden. Deadlines retain wall time;
 * intervals resume without a catch-up burst, and public cancellation ids stay stable. */
export function setScopeTimersActive(active: boolean): void {
  if (timersActive === active) return;
  timersActive = active;
  for (const registration of registrations) {
    if (active) registration.activity?.resume(); else registration.activity?.pause();
  }
}

class TimerActivity {
  readonly id: ReturnType<typeof setTimeout>;
  private native: ReturnType<typeof setTimeout>;
  private enabled = true;
  private done = false;
  private epoch = 0;
  private action: (() => void) | undefined;
  private readonly deadline: number;
  private readonly ms: number;
  private readonly repeating: boolean;
  constructor(ms: number, action: () => void, repeating: boolean) {
    this.ms=ms;this.repeating=repeating;
    this.action = action; this.deadline = diagnosticNow() + Math.max(0, ms);
    this.native = this.schedule(ms); this.id = this.native;
    if (!timersActive) this.pause();
  }
  get running(): boolean { return this.enabled && !this.done; }
  get nativeTimer(): ReturnType<typeof setTimeout> | undefined { return this.running ? this.native : undefined; }
  private schedule(delay: number): ReturnType<typeof setTimeout> {
    const epoch = this.epoch;
    const run = (): void => {
      if (epoch !== this.epoch || !this.running) return;
      const action = this.action;
      if (!this.repeating) { this.done = true; this.enabled = false; this.action = undefined; }
      action?.();
    };
    return this.repeating ? setInterval(run, delay) : setTimeout(run, delay);
  }
  pause(): void {
    if (!this.running) return;
    this.enabled = false; this.epoch++;
    if (this.repeating) clearInterval(this.native); else clearTimeout(this.native);
  }
  resume(): void {
    if (this.done || this.enabled) return;
    this.enabled = true;
    this.native = this.schedule(this.repeating ? this.ms : Math.max(0, this.deadline - diagnosticNow()));
  }
  cancel(): void { this.pause(); this.done = true; this.action = undefined; }
}
const nodeOwners = new WeakMap<Element, Scope>();
export function nodeOwner(node: Element): Scope | null { return nodeOwners.get(node) ?? null; }
/** Explicit registrations, compared with the independent harness's native counters. */
export function scopeRegistrations(include: (scope: Scope) => boolean): NativeCensus {
  const result: NativeCensus = { listeners: { window: 0, document: 0, canvas: 0, other: 0 }, timers: { timeouts: 0, intervals: 0, raf: 0 } };
  for (const r of registrations) {
    if (!include(r.scope)) continue;
    if (r.activity !== undefined && !r.activity.running) continue;
    if (r.kind !== 'listeners') result.timers[r.kind]++;
    else if (r.target !== undefined) result.listeners[scopeEnvironment().targetKind(r.target)]++;
  }
  const native=scopeEnvironment();
  if(native.sharedFrames&&result.timers.raf>0)result.timers.raf=native.framePending?.()===false?0:1;
  return result;
}
export function registrationTimerIds(): { timeouts: number[]; intervals: number[] } {
  const ids = { timeouts: [] as number[], intervals: [] as number[] };
  for (const r of registrations) {
    if (r.activity !== undefined && !r.activity.running) continue;
    const timer = r.activity?.nativeTimer ?? r.timer;
    if (timer !== undefined && (r.kind === 'timeouts' || r.kind === 'intervals')) ids[r.kind].push(timer as unknown as number); // oxlint-disable-line typescript/no-unnecessary-type-assertion -- DOM's types say number already, Node's don't.
  }
  return ids;
}
/** Resources whose `dispose` event is being sent only to drop their GPU bindings (`rebindGeometry`), not to retire them. */
const rebinding = new WeakSet();
/** Send `resource` a binding-only `dispose`: its owners keep it, memos keep their value (cachedAssets.ts). */
export function dispatchRebind(resource: Disposable3): void {
  rebinding.add(resource);
  try { resource.dispose(); } finally { rebinding.delete(resource); }
}
/** True while `dispatchRebind` sends `resource` its binding-only `dispose`. */
export function isRebinding(resource: object): boolean { return rebinding.has(resource); }
/** Preserve nested disposal failures across browser/JSON error boundaries. */
export function disposalErrorMessages(error: unknown): string[] {
  if (error instanceof AggregateError && error.errors.length > 0) return error.errors.flatMap((inner: unknown) => disposalErrorMessages(inner));
  return [error instanceof Error ? error.message : String(error)];
}
function emptyCensus(): ScopeCensus {
  return { geometries: 0, materials: 0, textures: 0, renderTargets: 0, meshes: 0, resources: 0,
    bodies: 0, sounds: 0, listeners: 0, timers: 0, rafs: 0, disposers: 0, systems: 0, colliders: 0, nodes: 0 };
}
function resourceKind(resource: Disposable3): Kind {
  if ('isBufferGeometry' in resource && resource.isBufferGeometry === true) return 'geometries';
  if ('isMaterial' in resource && resource.isMaterial === true) return 'materials';
  if ('isTexture' in resource && resource.isTexture === true) return 'textures';
  if ('isWebGLRenderTarget' in resource && resource.isWebGLRenderTarget === true) return 'renderTargets';
  if ('isInstancedMesh' in resource && resource.isInstancedMesh === true) return 'meshes';
  return 'resources';
}

export class Scope {
  private closed = false;
  private cleanups = new Set<Cleanup>();
  // Construction slices usually own only cleanup callbacks; allocate other indexes on first use.
  private children: Set<Scope> | undefined;
  private owned: Set<object> | undefined;
  private detach: (() => void) | undefined;
  readonly name: string;
  private readonly parent: Scope | undefined;

  constructor(name: string, parent?: Scope) {
    this.name = name;
    this.parent = parent;
    if (parent) {
      (parent.children ??= new Set()).add(this);
      const forget = parent.track('disposers', () => this.dispose(), this);
      this.detach = () => { parent.children?.delete(this); forget(); };
      if (parent.disposed) this.detach();
    }
  }

  get disposed(): boolean { return this.closed; }
  /** true only while `dispose()` runs this scope's cleanups, or while it or an ancestor retires through `disposeSteps()`
   *  (SF57: a lookup then is the teardown, not a new use) */
  get disposing(): boolean {
    if (this.tearing || this.retiring) return true;
    for (let scope = this.parent; scope !== undefined; scope = scope.parent) if (scope.retiring) return true;
    return false;
  }
  private tearing = false;
  /** O20: set for the whole of a `disposeSteps()` retirement, across the slices between its steps */
  private retiring = false;
  belongsTo(scope: Scope): boolean { return this === scope || (this.parent?.belongsTo(scope) ?? false); }
  /** Both owners are retiring within the same active disposal (synchronous, or sliced by `disposeSteps()`); each keeps its
   *  own final cleanups. */
  sharesTeardown(other: Scope): boolean {
    if ((this.tearing || this.retiring) && other.belongsTo(this)) return true;
    for (let ancestor = this.parent; ancestor !== undefined; ancestor = ancestor.parent) {
      if ((ancestor.tearing || ancestor.retiring) && other.belongsTo(ancestor)) return true;
    }
    return false;
  }
  get census(): ScopeCensus {
    const counts = emptyCensus();
    for (const cleanup of this.cleanups) counts[cleanup.kind]++;
    if (this.children !== undefined) {
      for (const child of this.children) {
        const childCounts = child.census;
        for (const kind of Object.keys(counts) as Kind[]) counts[kind] += childCounts[kind];
      }
    }
    return counts;
  }
  child(name: string): Scope { return new Scope(name, this); }

  /** Publish a borrowed property until this owner retires. Nested/out-of-order owners never resurrect retired values. */
  expose(target: object, key: PropertyKey, value: unknown): () => void {
    if (this.closed) return () => undefined;
    const release = scopedProperty(target, key, value);
    let forget = () => { /* Assigned after the cleanup is registered. */ };
    const remove = (): void => { release(); forget(); };
    forget = this.track('disposers', remove);
    return remove;
  }

  private track(kind: Kind, run: () => void, child?: Scope): () => void {
    if (this.closed) { run(); return () => { /* Already released. */ }; }
    const cleanup: Cleanup = child === undefined ? { kind, run } : { kind, run, child };
    this.cleanups.add(cleanup);
    return () => { this.cleanups.delete(cleanup); };
  }
  /** Bridge for legacy registrations; forget when a one-shot ends or a handle is removed early. */
  capture(kind: Kind, cleanup: () => void): () => void { return this.track(kind, cleanup); }
  /** G598: end `child` (a scope another owner parents) with this one: `dispose()` ends it whole, a sliced `disposeSteps()`
   *  steps into its cleanups in its place, as for an own child. Forget when it ends first. */
  captureScope(child: Scope): () => void { return this.track('disposers', () => { child.dispose(); }, child); }

  private ownHandle(resource: object, kind: Kind, dispose: () => void): (() => void) | undefined {
    if (this.owned?.has(resource)) return undefined;
    if (this.closed) { dispose(); return undefined; }
    const owned = this.owned ??= new Set();
    owned.add(resource);
    return this.track(kind, dispose);
  }
  /** True while this scope still owns `resource` (a resource disposed by anyone else is forgotten, see `own`). */
  owns(resource: object): boolean { return this.owned?.has(resource) ?? false; }
  own<T extends Disposable3>(resource: T): T {
    let releaseListener: (() => void) | undefined;
    const forget = this.ownHandle(resource, resourceKind(resource), () => { try { releaseListener?.(); } finally { resource.dispose(); } });
    if (forget !== undefined) releaseListener = this.forgetOnDispose(resource, forget);
    return resource;
  }
  /** O18: a resource disposed by anyone (its own view, three, a cache) leaves this scope at once. A long-lived owner (the
   *  page level) kept every adopted resource it ever saw, disposed or not, with its CPU arrays and uniforms: ~100 MB of
   *  geometry and ~600 materials after six grid cells. A binding-only rebind (`dispatchRebind`) is not a retirement. */
  private forgetOnDispose(resource: Disposable3, forget: () => void): (() => void) | undefined {
    const add: unknown = Reflect.get(resource, 'addEventListener'), remove: unknown = Reflect.get(resource, 'removeEventListener');
    if (typeof add !== 'function' || typeof remove !== 'function') return undefined;
    const released = (): void => {
      if (rebinding.has(resource)) return;
      Reflect.apply(remove, resource, ['dispose', released]);
      this.owned?.delete(resource); forget();
    };
    Reflect.apply(add, resource, ['dispose', released]);
    // Owner retirement must detach even inside a binding-only dispose event.
    return () => {
      Reflect.apply(remove, resource, ['dispose', released]);
      this.owned?.delete(resource); forget();
    };
  }
  /** Own a code-built tree's buffers/materials and detach it on disposal. Instanced meshes are optional; textures and delegated scene ownership stay separate. */
  ownPrimitives(root: Object3D, options: { readonly instances?: boolean } = {}): void {
    const capture = scopeEnvironment().primitives;
    if (capture === undefined) throw new Error('Primitive ownership requires the presentation host');
    capture(root, resource => { this.own(resource); }, options.instances === true);
    this.onDispose(() => { root.removeFromParent(); });
  }
  ownBody<T extends PhysicsHandle>(body: T): T {
    this.ownHandle(body, 'bodies', () => body.remove());
    return body;
  }
  ownSound<T extends SoundHandle>(sound: T): T {
    this.ownHandle(sound, 'sounds', () => {
      try { sound.stop(); } finally { sound.disconnect?.(); }
    });
    return sound;
  }

  ownNode<T extends Element>(node: T): T {
    nodeOwners.set(node, this);
    this.capture('nodes', () => { nodeOwners.delete(node); node.remove(); });
    return node;
  }

  private registration(r: Omit<Registration, 'scope'>, kind: Kind, cleanup: () => void): () => void {
    const record = { ...r, scope: this }; registrations.add(record);
    const forget = this.track(kind, () => { registrations.delete(record); cleanup(); });
    return () => { registrations.delete(record); forget(); };
  }

  private domListeners: WeakMap<EventTarget, Map<string, Map<object, () => void>>> | undefined;
  unlisten(target: EventTarget, type: string, fn: object, options?: boolean | EventListenerOptions): void {
    const capture = typeof options === 'boolean' ? options : options?.capture === true;
    this.domListeners?.get(target)?.get(`${type}|${String(capture)}`)?.get(fn)?.();
  }

  listen<K extends string>(target: EventTarget, type: K,
    fn: (event: K extends keyof (GlobalEventHandlersEventMap & WindowEventMap) ? (GlobalEventHandlersEventMap & WindowEventMap)[K] : Event) => void,
    opts?: AddEventListenerOptions): () => void {
    if (this.closed || opts?.signal?.aborted) return () => undefined;
    const key = `${type}|${String(opts?.capture === true)}`;
    const domListeners = this.domListeners ??= new WeakMap();
    let targetListeners = domListeners.get(target);
    if (!targetListeners) { targetListeners = new Map(); domListeners.set(target, targetListeners); }
    let listeners = targetListeners.get(key);
    if (!listeners) { listeners = new Map(); targetListeners.set(key, listeners); }
    const existing = listeners.get(fn); if (existing) return existing;
    const entries = listeners;
    const signalRegistration: Registration | undefined = opts?.signal ? { scope: this, target: opts.signal, kind: 'listeners' } : undefined;
    const clearSignal = (): void => {
      opts?.signal?.removeEventListener('abort', abort);
      if (signalRegistration) registrations.delete(signalRegistration);
    };
    let forget = () => { /* Filled after the listener is registered. */ };
    const listener: EventListener = (event) => {
      if (opts?.once) { forget(); entries.delete(fn); clearSignal(); }
      withOwner(this, () => fn(event as K extends keyof (GlobalEventHandlersEventMap & WindowEventMap) ? (GlobalEventHandlersEventMap & WindowEventMap)[K] : Event));
    };
    function abort(): void {
      target.removeEventListener(type, listener, opts?.capture);
      clearSignal();
      entries.delete(fn); forget();
    }
    target.addEventListener(type, listener, opts);
    if (signalRegistration) registrations.add(signalRegistration);
    opts?.signal?.addEventListener('abort', abort, { once: true });
    forget = this.registration({ target, kind: 'listeners' }, 'listeners', () => {
      target.removeEventListener(type, listener, opts?.capture);
      clearSignal(); entries.delete(fn);
    });
    entries.set(fn, abort);
    return abort;
  }

  private timerCancels: Map<ReturnType<typeof setTimeout>, () => void> | undefined;
  cancelTimer(id: ScopedTimer<ReturnType<typeof setTimeout>> | undefined): void { if (id !== 0 && id !== undefined) this.timerCancels?.get(id)?.(); }

  /** THREE-style subscription, released by its owner or the returned unsubscribe. */
  listenEmitter<K extends string, E>(target: {
    addEventListener: (type: K, fn: (event: E) => void) => void;
    removeEventListener: (type: K, fn: (event: E) => void) => void;
  }, type: K, fn: (event: E) => void): () => void {
    if (this.closed) return () => undefined;
    const listener = (event: E): void => { withOwner(this, () => fn(event)); };
    target.addEventListener(type, listener);
    const forget = this.track('listeners', () => { target.removeEventListener(type, listener); });
    return () => { target.removeEventListener(type, listener); forget(); };
  }

  /** One emitter event, released on delivery or owner disposal (including renderer resource events). */
  listenOnceEmitter<K extends string>(target: {
    addEventListener: (type: K, fn: () => void) => void;
    removeEventListener: (type: K, fn: () => void) => void;
  }, type: K, fn: () => void): void {
    if (this.closed) return;
    let forget = () => { /* Filled after registration. */ };
    const listener = (): void => { target.removeEventListener(type, listener); forget(); withOwner(this, fn); };
    target.addEventListener(type, listener);
    forget = this.track('listeners', () => { target.removeEventListener(type, listener); forget(); });
  }

  timeout(ms: number, fn: () => void): ScopedTimer<ReturnType<typeof setTimeout>> {
    if (this.closed) return 0;
    let forget = () => { /* Filled before the timer can fire. */ };
    const activity = new TimerActivity(ms, () => { forget(); this.timerCancels?.delete(activity.id); if (!this.closed) withOwner(this, fn); }, false);
    const id = activity.id;
    const cancel = (): void => { activity.cancel(); this.timerCancels?.delete(id); forget(); };
    forget = this.registration({ kind: 'timeouts', timer: id, activity }, 'timers', cancel); (this.timerCancels ??= new Map()).set(id, cancel);
    return id;
  }
  interval(ms: number, fn: () => void): ScopedTimer<ReturnType<typeof setInterval>> {
    if (this.closed) return 0;
    const activity = new TimerActivity(ms, () => { if (!this.closed) withOwner(this, fn); }, true);
    const id = activity.id;
    let forget = () => { /* Assigned after registration. */ };
    const cancel = (): void => { activity.cancel(); this.timerCancels?.delete(id); forget(); };
    forget = this.registration({ kind: 'intervals', timer: id, activity }, 'timers', cancel); (this.timerCancels ??= new Map()).set(id, cancel);
    return id;
  }
  private rafCancels: Map<number, () => void> | undefined;
  private directRaf: FrameRecord | undefined;
  private rafIndexInitialized = false;
  private freeFrames: (FrameRecord | undefined)[] | undefined;
  private freeFrameCount = 0;
  cancelRaf(id: number): void {
    const direct = this.directRaf;
    if (direct !== undefined && sameFrameId(direct.id, id)) direct.cancel();
    else this.rafCancels?.get(id)?.();
  }
  private forgetRaf(id: number): void {
    const direct = this.directRaf;
    if (direct !== undefined && sameFrameId(direct.id, id)) this.directRaf = undefined;
    this.rafCancels?.delete(id);
  }
  /** Created outside raf(fn)'s activation: an empty record never keeps the
   * first callback's closure alive. Only completed callbacks return a record
   * to the empty cache; a cancelled request keeps its own fn/id until then. */
  private newFrameRecord(): FrameRecord {
    const registration: Registration = { scope: this, kind: 'raf' };
    const record: FrameRecord = {
      id: undefined, fn: undefined, native: undefined, owner: this, registration,
      cleanup: { kind: 'rafs', run: () => { registrations.delete(registration); record.cancel(); } },
      cancel: () => {
        const id = record.id;
        if (id !== undefined) record.native?.cancelFrame(id);
        if (id !== undefined) this.forgetRaf(id);
        registrations.delete(registration); this.cleanups.delete(record.cleanup);
        // Keep this request's values for an already-dispatched callback.
        // A cancelled request is not returned to the empty cache.
      },
      beforeId: () => {
        // Match the old optional-map/id ordering for injected synchronous
        // schedulers. Native RAF always calls after its identifier returns.
        if (this.rafIndexInitialized) throw new ReferenceError("Cannot access 'id' before initialization");
      },
      begin: () => {
        const id = record.id;
        registrations.delete(registration); this.cleanups.delete(record.cleanup);
        if (id !== undefined) this.forgetRaf(id);
        record.fn = undefined;
        // Sliced teardown may already hold this cleanup. Keep its original
        // native cancellation after a callback fires during retirement.
        if (!this.closed) { record.id = undefined; record.native = undefined; }
      },
      finish: () => {
        if (!this.closed && this.freeFrameCount < 4) {
          const free = this.freeFrames ??= [undefined, undefined, undefined, undefined];
          free[this.freeFrameCount++] = record;
        }
      },
      run: () => undefined, // replaced before the record can reach a scheduler
    };
    record.run = frameDriver(new WeakRef(record));
    return record;
  }

  raf(fn: FrameRequestCallback): number {
    if (this.closed) return 0;
    const index = this.freeFrameCount - 1;
    let record = index < 0 ? undefined : this.freeFrames?.[index];
    if (record === undefined) record = this.newFrameRecord();
    else { this.freeFrameCount = index; if (this.freeFrames !== undefined) this.freeFrames[index] = undefined; }
    const native = scopeEnvironment(); record.fn = fn; record.native = native;
    let id: number;
    try { id = native.frame(record.run); } catch (error) { record.fn = undefined; record.native = undefined; throw error; }
    record.id = id;
    // A conforming native scheduler cannot close the scope inside frame().
    // Keep the original immediate cleanup for injected hosts that do so.
    if (this.closed) record.cancel();
    else { registrations.add(record.registration); this.cleanups.add(record.cleanup); }
    // One pending request is the ordinary recursive frame chain. A direct
    // slot avoids deleting/reinserting unique ids into a Map every vsync.
    // Independent concurrent requests retain the full native identifier map.
    this.rafIndexInitialized = true;
    if (this.directRaf === undefined || sameFrameId(this.directRaf.id, id)) {
      this.rafCancels?.delete(id); this.directRaf = record;
    } else (this.rafCancels ??= new Map()).set(id, record.cancel);
    return id;
  }

  onDispose(fn: () => void): void { this.track('disposers', fn); }
  /** O20: a cleanup in parts (a cache's evictions, one per part): `dispose()` runs it whole, `disposeSteps()` yields after
   *  each part, so one big cleanup never holds a sliced retirement's frame. */
  onDisposeSteps(parts: () => Generator<undefined, void>): void {
    const whole = (): void => { const run = parts(); while (run.next().done !== true) { /* each part runs here */ } };
    if (this.closed) { whole(); return; }
    this.cleanups.add({ kind: 'disposers', run: whole, parts });
  }
  /** Run `fn` now with this scope as the construction owner (`withOwner`): what it registers ends with this scope. For code
   *  after an `await`, where the owner has fallen back to the page's ambient one (SF57). */
  run<T>(fn: () => T): T { return withOwner(this, fn); }

  dispose(): void {
    if (this.closed) return;
    this.closed = true; this.freeFrames = undefined; this.freeFrameCount = 0;
    const cleanups = [...this.cleanups].reverse();
    this.cleanups.clear();
    const errors: unknown[] = [];
    this.tearing = true;
    try {
      for (const cleanup of cleanups) {
        try { cleanup.run(); } catch (error) { errors.push(error); }
      }
    } finally { this.tearing = false; }
    this.children?.clear();
    this.owned?.clear();
    this.detach?.();
    this.detach = undefined;
    if (errors.length > 0) throw new AggregateError(errors,
      `Scope ${this.name} disposal failed: ${errors.flatMap(disposalErrorMessages).join('; ')}`);
  }

  /**
   * O20: `dispose()` spread over a caller's frames. The scope closes at once (no new registrations; `disposed` reads
   * true), then the same cleanups run in the same order, a child scope's own cleanups step by step in its place, each
   * followed by a `yield` naming it, so the caller can time steps and yield to the browser under its budget. While the
   * steps last, the scope and its descendants report `disposing` and share one teardown. Errors are collected and thrown
   * at the end, as `dispose()` does. The caller must drain the steps to the end (synchronously, when its own owner closes
   * first): `dispose()` on the closed scope does nothing more.
   */
  *disposeSteps(): Generator<DisposeStep, void> {
    if (this.closed) return;
    this.closed = true; this.freeFrames = undefined; this.freeFrameCount = 0;
    const cleanups = [...this.cleanups].reverse();
    this.cleanups.clear();
    const errors: unknown[] = [];
    this.retiring = true;
    try {
      for (const cleanup of cleanups) {
        if (cleanup.child !== undefined) {
          try { yield* cleanup.child.disposeSteps(); } catch (error) { errors.push(error); }
          continue;
        }
        if (cleanup.parts !== undefined) {
          const run = cleanup.parts();
          for (let done = false; !done;) {
            this.tearing = true;
            try { done = run.next().done === true; } catch (error) { errors.push(error); done = true; } finally { this.tearing = false; }
            yield { scope: this.name, kind: cleanup.kind };
          }
          continue;
        }
        this.tearing = true;
        try { cleanup.run(); } catch (error) { errors.push(error); } finally { this.tearing = false; }
        yield { scope: this.name, kind: cleanup.kind };
      }
    } finally { this.retiring = false; }
    this.children?.clear();
    this.owned?.clear();
    this.detach?.();
    this.detach = undefined;
    if (errors.length > 0) throw new AggregateError(errors,
      `Scope ${this.name} disposal failed: ${errors.flatMap(disposalErrorMessages).join('; ')}`);
  }
}
