import { admitScript } from '@wildshard/format/scriptAdmission';
import { SCRIPT_ABI } from '@wildshard/format/scriptAbi';
import { SCRIPT_V1_LAYOUT } from '@wildshard/format/scriptAbiV1';
import { SCRIPT_LIMITS } from '@wildshard/format/scriptLimits';
import { observeWasmMemory } from '../core/memoryResources';
import { constructionOwner, currentOwner, ownerOr } from '../app/ownership';
import { pageScope } from '../app/resources';
import type { Scope } from '../app/scope';
import { nextDrawnFrame, presenting } from '../core/framePacing';
import { yieldTask } from '../core/workSlice';
import { freshScriptMemory } from './fixedMemory';

interface PreparedMemories { pages: readonly number[]; available: WebAssembly.Memory[]; ready: Promise<void> }
const prepared = new Map<Scope, PreparedMemories>();

/** Prepare fresh fixed-size v1 memories, one per drawn frame, without executing a guest.
 * The admitted page counts are data. Only this owner and its descendants may consume them;
 * each allocation is consumed once, and unused allocations leave with the owner. Node/loading
 * preparation uses ordinary tasks. Repeated identical preparation shares its pending result. */
export function prepareDecisionMemories(pages: readonly number[], owner: Scope): Promise<void> {
  if (owner.disposed) return Promise.reject(new Error('Decision memory owner disposed'));
  if (pages.some(value => !Number.isSafeInteger(value) || value < 1 || value > SCRIPT_V1_LAYOUT.maximumPages)
    || pages.reduce((sum, value) => sum + value * 65536, 0) > SCRIPT_LIMITS.memoryBytes)
    return Promise.reject(new Error('Decision memory preparation allowance'));
  const previous = prepared.get(owner);
  if (previous !== undefined) return previous.pages.length === pages.length && previous.pages.every((value, i) => value === pages[i])
    ? previous.ready : Promise.reject(new Error('Decision memory preparation changed'));
  if (pages.length === 0) return Promise.resolve();
  const plan = [...pages], available: WebAssembly.Memory[] = [];
  let cancel = (): void => undefined;
  const stopped = new Promise<never>((_resolve, reject) => { cancel = () => { reject(new Error('Decision memory owner disposed')); }; });
  const check = (): void => { if (owner.disposed) throw new Error('Decision memory owner disposed'); };
  const pause = async (): Promise<void> => {
    check(); await Promise.race([presenting() ? nextDrawnFrame(pageScope) : yieldTask(pageScope), stopped]); check();
  };
  const ready = (async () => {
    for (const initial of plan) {
      await pause();
      available.push(owner.run(() => {
        const memory = freshScriptMemory(initial, initial);
        observeWasmMemory(memory, { owner: owner.name, asset: 'decision/prepared' });
        return memory;
      }));
    }
    await pause();
  })();
  const entry = { pages: plan, available, ready }; prepared.set(owner, entry);
  const clear = (): void => { if (prepared.get(owner) === entry) prepared.delete(owner); available.length = 0; cancel(); };
  const forget = owner.capture('disposers', clear);
  void ready.catch(() => { clear(); forget(); });
  return ready;
}

function preparedMemory(initial: number, maximum: number): WebAssembly.Memory | undefined {
  if (initial !== maximum) return undefined;
  const construction = constructionOwner(), owner = construction === null ? currentOwner() : ownerOr(construction);
  if (owner === null || owner.disposed) return undefined;
  for (const [scope, entry] of prepared) {
    if (!owner.belongsTo(scope)) continue;
    const index = entry.available.findIndex(memory => memory.buffer.byteLength === initial * 65536);
    if (index !== -1) return entry.available.splice(index, 1)[0];
  }
  return undefined;
}

/** Fixed-size memories that stateless modules take turns in, one per page count, for the page's life. iOS JSC runs a
 *  synchronous full GC for each new Memory past its fast-memory cap (40-80 ms a Nalati entry paid per return program);
 *  a stateless module rewinds its own image before and after every call, so sharing changes no output. */
const sharedMemories = new Map<number, WebAssembly.Memory>();
function sharedMemory(pages: number): WebAssembly.Memory {
  let memory = sharedMemories.get(pages);
  if (memory === undefined) {
    const created = pageScope.run(() => freshScriptMemory(pages, pages));
    observeWasmMemory(created, { owner: 'engine/script', asset: 'decision/shared' });
    sharedMemories.set(pages, created); memory = created;
  }
  // A fresh memory is zeroed: the next module instantiates exactly as it would alone.
  new Uint8Array(memory.buffer).fill(0);
  return memory;
}

/** One shared, admitted instance. Durable binding state never lives in this memory. */
export class DecisionModule {
  readonly memory: WebAssembly.Memory;
  readonly instance: WebAssembly.Instance;
  readonly io: number;
  readonly view: DataView;
  fuel = 0;
  private remaining = 0;
  private depth = 0;
  private readonly image: Uint8Array;
  private readonly bytes: Uint8Array;
  private readonly globals: { global: WebAssembly.Global; value: number | bigint }[];
  /** `stateless`: the caller rewinds before and after every call and keeps no state in memory between calls (a return
   *  program), so a fixed-size module takes its turn in the page's shared memory for its page count. */
  constructor(bytes: Uint8Array, seed: readonly [number, number], ports: {
    read: (op: number, a: number, b: number) => number;
    list: (op: number, a: number, b: number, out: number, cap: number) => number;
  }, stateless = false) {
    const admission = admitScript(bytes, 1);
    if (stateless && admission.initialPages === admission.maximumPages) this.memory = sharedMemory(admission.initialPages);
    else {
      this.memory = preparedMemory(admission.initialPages, admission.maximumPages)
        ?? freshScriptMemory(admission.initialPages, admission.maximumPages);
      observeWasmMemory(this.memory, { owner: 'engine/script', asset: 'decision/module' });
    }
    this.begin(2_000_000);
    this.instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(bytes)), { env: {
      memory: this.memory,
      enter: () => { this.charge(1); if (++this.depth > SCRIPT_ABI.callDepth) throw new Error('Decision depth limit'); },
      leave: () => { if (--this.depth < 0) throw new Error('Decision depth underflow'); },
      fuel: (cost: number) => { this.charge(cost); },
      finite32: (value: number) => this.finite(value),
      finite64: (value: number) => this.finite(value),
      abort: () => { throw new Error('Decision abort'); },
      ws_read: (op: number, a: number, b: number) => { this.charge(256); return ports.read(op, a, b); },
      ws_list: (op: number, a: number, b: number, out: number, cap: number) => { this.charge(256); return ports.list(op, a, b, out, cap); },
    } });
    if (typeof this.instance.exports['__start'] === 'function') this.invoke('__start');
    if (this.invoke('ws_abi') !== 1) throw new Error('Decision ABI major mismatch');
    this.invoke('ws_init', seed[0], seed[1]);
    this.io = this.invoke('ws_io');
    if (!Number.isSafeInteger(this.io) || this.io < 0 || this.io % 8 !== 0 || this.io >= this.memory.buffer.byteLength) throw new Error('Decision IO outside memory');
    this.bytes = new Uint8Array(this.memory.buffer);
    this.view = new DataView(this.memory.buffer);
    this.image = this.bytes.slice();
    this.globals = admission.globals.map(name => {
      const global = this.instance.exports[name];
      if (!(global instanceof WebAssembly.Global)) throw new Error('Decision global snapshot missing');
      const value: unknown = global.value;
      if (typeof value !== 'number' && typeof value !== 'bigint') throw new Error('Decision global is not numeric');
      return { global, value };
    });
  }
  begin(limit: number): void { this.remaining = limit; this.fuel = 0; this.depth = 0; }
  private charge(cost: number): void {
    if (!Number.isSafeInteger(cost) || cost < 1) throw new Error('Invalid decision fuel charge');
    this.fuel += cost; this.remaining -= cost;
    if (this.remaining < 0) throw new Error('Decision fuel exhausted');
  }
  private finite(value: number): number {
    this.charge(1); if (!Number.isFinite(value)) throw new Error('Non-finite decision value'); return value;
  }
  invoke(name: string, a?: number, b?: number): number {
    const fn = this.instance.exports[name];
    if (typeof fn !== 'function') throw new Error(`Missing decision function ${name}`);
    const call = fn as (a?: number, b?: number) => unknown;
    const value = a === undefined ? call() : call(a, b);
    if (value === undefined) return 0;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid decision result');
    return value;
  }
  /** Reset scratch and every mutable global before each binding call, including after a trap. */
  rewind(): void {
    this.bytes.set(this.image);
    for (const entry of this.globals) entry.global.value = entry.value;
  }
}
