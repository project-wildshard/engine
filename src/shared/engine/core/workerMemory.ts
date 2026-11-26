import { diagnosticNow } from './clock';
import { memoryAttribution } from './memoryAttribution';
import { Scope } from '../app/scope';

/** ENGINE-MEMORY EM7: workers report in. A worker is a thread inside the page's WebContent process on the phone, so its
 * ArrayBuffers and wasm memories count against the same limit as the page. Each worker isolate posts its own RAM ledger
 * (by kind) on a BroadcastChannel, a slow channel beside its message port so no worker's protocol changes: once a second
 * when it changed, and every five seconds regardless. The page keeps one row per worker isolate, named by the worker's
 * name (its purpose when it has none), and drops a row it has not heard from in 30 s (a terminated worker cannot say so).
 * `installWorkerBootTiming` starts the report in every engine worker. */
export const WORKER_MEMORY_CHANNEL = 'wildshard-memory';
const EVERY_MS = 1000, HEARTBEAT_MS = 5000, STALE_MS = 30_000;

export interface WorkerMemoryReport { readonly __wildshardWorkerMemory: 1; readonly id: string; readonly name: string; readonly purpose: string; readonly ram: Readonly<Record<string, number>> }
export interface WorkerMemoryRow { readonly id: string; readonly name: string; readonly purpose: string; readonly ram: Readonly<Record<string, number>>; readonly seen: number }
interface Channel { postMessage: (value: unknown) => void; close: () => void; onmessage: ((event: MessageEvent<unknown>) => void) | null }
export type MakeChannel = (name: string) => Channel;
const broadcast: MakeChannel | null = typeof BroadcastChannel === 'function' ? (name) => new BroadcastChannel(name) : null;

/** In a worker: report this isolate's RAM ledger until the returned stop is called. */
export function reportWorkerMemory(purpose: string, make: MakeChannel | null = broadcast, read: () => Record<string, number> = () => memoryAttribution.kinds('ram')): () => void {
  if (make === null) return () => undefined;
  // a probe can ask each isolate's ledger who owns a buffer, as it asks the page's (glCounters.ts)
  if (Reflect.get(globalThis, '__wildshardMemory') === undefined) Reflect.set(globalThis, '__wildshardMemory', Object.freeze({ owner: (buffer: object) => memoryAttribution.ownerOf(buffer, 'ram') }));
  const channel = make(WORKER_MEMORY_CHANNEL);
  const named: unknown = Reflect.get(globalThis, 'name');
  const name = typeof named === 'string' && named.length > 0 ? named : purpose;
  const id = `${name}@${performance.timeOrigin}`;
  let last = '', quiet = 0;
  const tick = (): void => {
    const ram = read(), key = JSON.stringify(ram);
    quiet += EVERY_MS;
    if (key === last && quiet < HEARTBEAT_MS) return;
    last = key; quiet = 0;
    const report: WorkerMemoryReport = { __wildshardWorkerMemory: 1, id, name, purpose, ram };
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel takes no target origin
    channel.postMessage(report);
  };
  tick();
  const owner = new Scope('worker memory report');
  owner.interval(EVERY_MS, tick);
  return () => { owner.dispose(); channel.close(); };
}

function isReport(value: unknown): value is WorkerMemoryReport {
  if (typeof value !== 'object' || value === null || Reflect.get(value, '__wildshardWorkerMemory') !== 1) return false;
  const ram: unknown = Reflect.get(value, 'ram');
  return typeof Reflect.get(value, 'id') === 'string' && typeof Reflect.get(value, 'name') === 'string' && typeof Reflect.get(value, 'purpose') === 'string'
    && typeof ram === 'object' && ram !== null && Object.values(ram).every((bytes) => Number.isSafeInteger(bytes) && bytes >= 0);
}

/** The page's rows, one per worker isolate. */
export class WorkerMemoryRows {
  private readonly rows = new Map<string, WorkerMemoryRow>();
  private stop: (() => void) | null = null;
  /** Start listening (once). */
  listen(make: MakeChannel | null = broadcast): void {
    if (this.stop !== null || make === null) return;
    const channel = make(WORKER_MEMORY_CHANNEL);
    channel.onmessage = (event) => { this.accept(event.data); };
    this.stop = () => { channel.close(); };
  }
  accept(value: unknown, at: number = diagnosticNow()): void {
    if (!isReport(value)) return;
    this.rows.set(value.id, { id: value.id, name: value.name, purpose: value.purpose, ram: { ...value.ram }, seen: at });
  }
  /** The live rows, stale ones dropped. */
  read(at: number = diagnosticNow()): WorkerMemoryRow[] {
    for (const [id, row] of this.rows) if (at - row.seen > STALE_MS) this.rows.delete(id);
    return [...this.rows.values()];
  }
  /** Bytes by `<worker name>/<kind>`; two isolates with one name add up. A worker whose ledger is empty is listed as
   * `<worker name>/isolate` at 0 bytes, so every reporting isolate has a row. */
  kinds(at: number = diagnosticNow()): Record<string, number> {
    const out: Record<string, number> = {};
    for (const row of this.read(at)) if (Object.keys(row.ram).length === 0) out[`${row.name}/isolate`] ??= 0;
    for (const row of this.read(at)) for (const [kind, bytes] of Object.entries(row.ram)) out[`${row.name}/${kind}`] = (out[`${row.name}/${kind}`] ?? 0) + bytes;
    return out;
  }
  close(): void { this.stop?.(); this.stop = null; this.rows.clear(); }
}

/** The page's worker rows. */
export const workerMemory: WorkerMemoryRows = new WorkerMemoryRows();
