/** Stateless ABI v2 sim/projection instance. Only the Developer-owned v2 lane
 * opts in; existing ScriptHost and DecisionModule never construct this class. */
import { admitScriptV2 } from '@wildshard/format/scriptAdmissionV2';
import { validateV2FloatColumns,type FloatColumnV2 } from '@wildshard/format/scriptMemoryV2';
import { observeWasmMemory } from '../core/memoryResources';
import type { Scope } from '../app/scope';
import { FixedMemory, prewarmFixedMemories, fixedMemoryCensus } from './fixedMemory';

/** Explicit loading-screen preparation: fixed sizes 1..4 and optional virgin
 * growable descriptors. Each memory stays isolated; growables are never reused. */
export async function prepareScriptMemoryBank(counts: readonly number[], yieldTask: () => Promise<void>, virgin?: Parameters<typeof prewarmFixedMemories>[2]): Promise<void> {
  await prewarmFixedMemories(counts, yieldTask, virgin);
}
/** Detached scalar hit/miss counters for the constructor diagnostic. */
export function scriptMemoryCensus(): ReturnType<typeof fixedMemoryCensus> { return fixedMemoryCensus(); }

/** A one-use native reservation, with no access to its fresh guest memory. */
export interface PreparedScriptMemory { readonly pages: number }
interface MemoryReservation { readonly scope: Scope; readonly bytes: Uint8Array; readonly storage: FixedMemory; forget: () => void }
const reservations = new WeakMap<PreparedScriptMemory, MemoryReservation>();
/** Allocate only after admission, for one exact module and its original owner.
 * Instantiation and guest initialization still occur at the consumer's slot. */
export function prepareScriptMemory(bytes: Uint8Array, scope: Scope): PreparedScriptMemory {
  if (scope.disposed || scope.disposing) throw new Error('Script memory owner has ended');
  const source = Uint8Array.from(bytes), admitted = admitScriptV2(source);
  const storage = scope.run(() => new FixedMemory(admitted.initialPages, true));
  const memory = storage.value;
  if (scope.disposed || scope.disposing) { storage.retire(); throw new Error('Script memory owner has ended'); }
  if (admitted.lane !== 'view') observeWasmMemory(memory, { owner: 'engine/script', asset: 'v2/module' });
  const token = Object.freeze({ pages: admitted.initialPages });
  const entry: MemoryReservation = { scope, bytes: source, storage, forget: () => undefined };
  reservations.set(token, entry);
  entry.forget = scope.capture('disposers', () => { reservations.delete(token); storage.retire(new WeakRef(scope)); });
  return token;
}
/** Consume once, after the consumer has repeated its own full admission. */
export function consumeScriptStorage(token: PreparedScriptMemory, bytes: Uint8Array, pages: number, scope: Scope): FixedMemory {
  const entry = reservations.get(token);
  if (entry === undefined || entry.scope !== scope || scope.disposed || scope.disposing || token.pages !== pages
    || entry.bytes.length !== bytes.length || !entry.bytes.every((value, index) => value === bytes[index])) throw new Error('Script memory reservation differs or has ended');
  reservations.delete(token); entry.forget();
  return entry.storage;
}

const callable = (value: unknown): value is (...args: number[]) => unknown => typeof value === 'function';
function budget(value: number): void { if (!Number.isInteger(value) || value < 0 || value > 0x7fffffff) throw new Error('Invalid v2 i32 fuel budget'); }
/** One fixed memory per module per lane. Initialized scratch and every mutable
 * state global rewind before each sim/project call, including retries after traps
 * and caller refusals. Durable columns and committed results belong to the host. */
export class ScriptModuleV2 {
  private readonly storage: FixedMemory;
  /** Access escapes the native lease permanently, including buffer/grow access. */
  get memory(): WebAssembly.Memory { if (this.closed) throw new Error('Script memory owner has ended'); return this.storage.expose(); }
  private ended = false;
  private get closed(): boolean {
    const owner = this.retirement?.deref(); return this.ended || owner?.disposed === true || owner?.disposing === true;
  }
  private readonly retirement: WeakRef<Scope> | undefined;
  private retire(): void {
    this.ended = true;
    if (this.busy) return;
    this.instance = undefined; this.globals = []; this.image = new Uint8Array(0);
    this.storage.retire(this.retirement);
  }
  readonly io: number;
  private instance: WebAssembly.Instance | undefined;
  private readonly source: Uint8Array;
  private readonly ioBytes: number;
  private image: Uint8Array;
  private imageOffset = 0;
  private globals: readonly { global: WebAssembly.Global; value: number | bigint }[];
  private readonly columns: readonly FloatColumnV2[];
  private busy = false;
  private readonly lane: 'sim' | 'project';
  constructor(bytes: Uint8Array,options: {
    readonly seed: readonly [number,number]; readonly initFuel: number;
    readonly output: readonly FloatColumnV2[]; readonly ioBytes?: number;
    /** Trusted native owner only: write/read must never retain borrowed views.
     * Public low-level users and arbitrary initializers keep fresh storage. */
    readonly owner?: Scope;
    readonly initialize?: (view: DataView,io: number) => void;
    readonly prepared?: { readonly memory: PreparedScriptMemory; readonly scope: Scope };
  }) {
    budget(options.initFuel);
    if (options.seed.some(value => !Number.isInteger(value) || value < 0 || value > 0xffffffff)) throw new Error('Invalid v2 seed words');
    const source = Uint8Array.from(bytes), admitted = admitScriptV2(source,options.ioBytes === undefined ? {} : { ioBytes: options.ioBytes });
    if (admitted.lane === 'view') throw new Error('Stateless v2 host refuses the persistent view lane');
    this.source=source;this.ioBytes=admitted.ioBytes;
    const owner = options.owner;
    this.retirement = owner === undefined ? undefined : new WeakRef(owner);
    if (owner?.disposed === true || owner?.disposing === true || (owner !== undefined && options.prepared !== undefined && owner !== options.prepared.scope)) throw new Error('Script memory owner has ended');
    this.lane = admitted.lane; this.io = admitted.io;
    this.storage = options.prepared === undefined
      ? new FixedMemory(admitted.initialPages, owner !== undefined && options.initialize === undefined)
      : consumeScriptStorage(options.prepared.memory, source, admitted.initialPages, options.prepared.scope);
    if (owner === undefined || options.initialize !== undefined) this.storage.expose();
    observeWasmMemory(this.storage.value,{ owner: 'engine/script',asset: 'v2/module' });
    try {
      this.instance = new WebAssembly.Instance(new WebAssembly.Module(source),{ env: { memory: this.storage.value } });
      this.columns = options.output.map(column => Object.freeze({ ...column }));
      options.initialize?.(new DataView(this.storage.value.buffer),this.io);
      this.invoke('ws_init',[options.seed[0],options.seed[1]],options.initFuel);
      validateV2FloatColumns(new DataView(this.storage.value.buffer),this.columns);
      const image = new Uint8Array(this.storage.value.buffer);
      let first = 0, end = image.length;
      while (first < end && image[first] === 0) first++;
      while (end > first && image[end - 1] === 0) end--;
      const sparse = end - first < image.length / 2;
      this.imageOffset = sparse ? first : 0;
      this.image = image.slice(this.imageOffset, sparse ? end : image.length);
      this.globals = admitted.globals.map(name => {
        const global = this.instance?.exports[name]; if (!(global instanceof WebAssembly.Global)) throw new Error('Missing v2 state global');
        const value: unknown = global.value;
        if ((typeof value !== 'number' && typeof value !== 'bigint') || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid v2 initialized global');
        return { global,value };
      });
    } catch (error) { this.instance = undefined; this.globals = []; this.image = new Uint8Array(0); this.storage.retire(); throw error; }
    owner?.onDispose(() => { this.retire(); });
  }
  /** Typed native loan of this exact admitted image and IO envelope. It does
   * not instantiate, initialize, cache or expose mutable guest memory. */
  owns(bytes: Uint8Array,io: number,ioBytes: number): boolean {
    return this.io===io&&this.ioBytes===ioBytes&&bytes.length===this.source.length
      &&bytes.every((value,index)=>value===this.source[index]);
  }
  private rewind(): void {
    const bytes = new Uint8Array(this.storage.value.buffer);
    // Zero is part of the immutable initialized image, never a dirty-range hint.
    // Dense images keep the single full copy; sparse ones still reset ALL bytes.
    // (the zeroes around the image only: the image's own span is written once, by the copy)
    if (this.image.length < bytes.length) { bytes.fill(0, 0, this.imageOffset); bytes.fill(0, this.imageOffset + this.image.length); }
    bytes.set(this.image, this.imageOffset);
    for (const entry of this.globals) entry.global.value = entry.value;
  }
  private invoke(name: string,args: number[],fuel: number): number {
    const fn = this.instance?.exports[name]; if (!callable(fn)) throw new Error('Missing v2 work entry');
    const remaining = fn(...args,fuel);
    if (typeof remaining !== 'number' || !Number.isInteger(remaining) || remaining < 0 || remaining > fuel) throw new Error('Invalid v2 fuel remainder'); return remaining;
  }
  private run<T>(name: string,args: number[],fuel: number,write: (view: DataView) => void,read: (view: DataView) => T): { value: T; remaining: number } {
    if (this.closed) throw new Error('Script memory owner has ended');
    if (name !== (this.lane === 'sim' ? 'ws_step' : 'ws_project')) throw new Error('V2 module does not admit this lane');
    budget(fuel); if (this.busy) throw new Error('V2 module re-entry'); this.busy = true;
    try {
      this.rewind(); const view = new DataView(this.storage.value.buffer); write(view);
      const remaining = this.invoke(name,args,fuel); validateV2FloatColumns(view,this.columns);
      return { value: read(view),remaining };
    } finally { this.busy = false; if (this.ended) this.retire(); }
  }
  /** `read` copies the validated candidate into host-owned storage. It must not
   * publish effects or return borrowed Wasm views; the next entry rewinds the image. */
  step<T>(tick: number,fuel: number,write: (view: DataView) => void,read: (view: DataView) => T): { value: T; remaining: number } {
    if (!Number.isInteger(tick) || tick < 0 || tick > 0x7fffffff) throw new Error('Invalid v2 relative tick');
    return this.run('ws_step',[tick],fuel,write,read);
  }
  /** Synchronous projections use exactly the same image/global rewind rule. */
  project<T>(fuel: number,write: (view: DataView) => void,read: (view: DataView) => T): { value: T; remaining: number } {
    return this.run('ws_project',[],fuel,write,read);
  }
}
