// J182: one worker's life: its cells, one 60 Hz clock over the awake ones, and the port it talks to the door on. `cellWorker.ts` is one line
// around this, so a Node test runs the same code over a real MessageChannel.
import { installAppIdentity } from '@wildshard/engine/app/identity';
import { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { ServerClock } from '@wildshard/engine/net/serverClock';
import { DedicatedRoom } from './dedicatedRoom';
import type { HeadlessRuntimeInput } from '../headlessRuntime';
import type { CellOrder, WorkerNews, WorkerReading } from './cellProtocol';
import { SeatTransport } from './socketPump';

/** How often a worker reads itself (E7.8). */
const READING_MS = 10_000;
/** Enough ticks for a 10 s reading, at the worker's rate. */
const TICKS_KEPT = 720;
/** The save prefix a cell's stores share. Nothing outside a cell ever reads it. */
const SAVE_PREFIX = 'wildshard.room.';
/** J107: a cell left empty this long starts over when someone arrives. */
const EMPTY_MS = 300_000;

/** A port as `worker_threads` and a `MessageChannel` both give it. */
export interface CellPort { postMessage: (message: unknown, transfer?: readonly Transferable[]) => void; on?: (event: 'message', listener: (message: unknown) => void) => unknown; onmessage?: ((event: MessageEvent<unknown>) => void) | null }
/** What a worker needs from where it runs. */
export interface CellHostOptions {
  /** Its row of the table: fixed at startup, and a cell never moves (J182). */
  readonly slugs: readonly string[]; readonly build: string;
  /** A fresh id for each boot of a cell, so a restarted cell can't repeat a grant. */
  readonly bootId: () => string;
  readonly load: (slug: string) => Promise<HeadlessRuntimeInput>;
  /** A proof's overrides. */
  readonly holdMs?: number; readonly emptyMs?: number;
  /** What this process has resident, for the reading. */
  readonly memory: () => { readonly rss: number; readonly heapUsed: number };
  /** The worker has closed: a worker exits here. */
  readonly closed?: () => void;
  /** A proof's look at each room it opens. */
  readonly booted?: (slug: string, room: DedicatedRoom) => void;
}
/** One cell, and when it last emptied. A cell with nobody in it takes no ticks: that is all sleep is (Q80). */
interface Cell { readonly slug: string; room: DedicatedRoom; emptySince: number; waking: Promise<void> | null }
const percentile = (sorted: readonly number[], at: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * at))] ?? 0;

/** A worker has no page, so no app identity: all it needs of one is the save prefix. */
function installCellIdentity(): void {
  installAppIdentity({ name: '', wordmark: '', tagline: '', savePrefix: SAVE_PREFIX, saveFormat: '', fileSlug: '', exposeProbe: () => undefined, harness: () => undefined });
}

/** Run one worker's cells until it is told to close. Anything that ends it says `failed`, and the process ends (Q77). */
export function runCells(port: CellPort, options: CellHostOptions): { dispose: () => void } {
  const scope = new Scope('dedicated.worker'), started = diagnosticNow(), cells = new Map<string, Cell>();
  let clock: ServerClock | undefined, disposed = false, ready = false, ticks: number[] = [], ticked = 0, readAt = started, dropsAt = 0;
  const post = (news: WorkerNews): void => { port.postMessage(news); };
  const fail = (error: unknown): void => { clock?.pause(); post({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) }); };
  const open = async (slug: string): Promise<DedicatedRoom> => {
    const begun = diagnosticNow(), room = await DedicatedRoom.boot({ slug, build: options.build, bootId: options.bootId(), input: await options.load(slug), now: diagnosticNow,
      post: news => { if (news.kind === 'left' && news.seats === 0) { const cell = cells.get(slug); if (cell !== undefined) cell.emptySince = diagnosticNow(); } post({ ...news, slug }); },
      reports: { file: report => { post({ kind: 'report', slug, report }); } }, ...(options.holdMs === undefined ? {} : { holdMs: options.holdMs }) });
    post({ kind: 'cell', slug, ms: diagnosticNow() - begun });
    options.booted?.(slug, room);
    return room;
  };
  const step = (): void => {
    const begun = diagnosticNow();
    try { for (const { room } of cells.values()) if (room.taken > 0) room.tick(); } catch (error) { fail(error); return; }
    ticks.push(diagnosticNow() - begun); ticked++;
    if (ticks.length > TICKS_KEPT) ticks.shift();
  };
  const reading = (): void => {
    const now = diagnosticNow(), sorted = ticks.slice().sort((a, b) => a - b), rooms = [...cells.values()].map(cell => cell.room), memory = options.memory();
    const sum = (read: (room: DedicatedRoom) => number): number => rooms.reduce((total, room) => total + read(room), 0);
    const row: WorkerReading = { cells: rooms.length, awake: rooms.filter(room => room.taken > 0).length, players: sum(room => room.taken - room.holding), held: sum(room => room.holding), ticks: ticked, ticksPerSecond: ticks.length / ((now - readAt) / 1000),
      p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), max: sorted.at(-1) ?? 0, drops: (clock?.drops ?? 0) - dropsAt, rss: memory.rss, heap: memory.heapUsed,
      refused: sum(room => room.net.stats.refused), dropped: sum(room => room.net.stats.dropped), frameBytes: sum(room => room.net.stats.frameBytes), eventBytes: sum(room => room.net.stats.eventBytes) };
    readAt = now; dropsAt = clock?.drops ?? 0; ticks = [];
    post({ kind: 'reading', reading: row });
  };
  /** A cell left empty long enough starts over: only someone arriving pays for it, and the other cells on this worker wait while it does. */
  const wake = async (cell: Cell): Promise<void> => {
    if (cell.waking !== null) await cell.waking;
    if (cell.room.taken > 0 || diagnosticNow() - cell.emptySince < (options.emptyMs ?? EMPTY_MS)) return;
    const waking = (async (): Promise<void> => {
      try { const old = cell.room; cell.room = await open(cell.slug); old.dispose(); cell.emptySince = diagnosticNow(); } finally { cell.waking = null; }
    })();
    cell.waking = waking;
    await waking;
  };
  const dispose = (): void => { if (disposed) return; disposed = true; clock?.pause(); scope.dispose(); for (const { room } of cells.values()) room.dispose(); options.closed?.(); };
  const find = async (cell: Cell, id: number, device: string): Promise<void> => { await wake(cell); post({ kind: 'found', id, held: cell.room.holds(device), spawn: cell.room.spawn }); };
  const seat = async (cell: Cell, order: Extract<CellOrder, { kind: 'seat' }>): Promise<void> => {
    if (cell.waking !== null) await cell.waking;
    const transport = new SeatTransport(order.port);
    cell.room.seat(order, transport, () => { transport.deliver('reliable', order.hello); });
  };
  const handle = (order: CellOrder): void => {
    if (order.kind === 'close') { dispose(); return; }
    if (!ready) { fail(new Error('A worker was told something before it booted')); return; }
    if (order.kind === 'drain') { clock?.pause(); for (const { room } of cells.values()) room.drain(); post({ kind: 'drained' }); return; }
    const cell = cells.get(order.slug);
    if (cell === undefined) { fail(new Error(`${order.slug} is not on this worker`)); return; }
    (order.kind === 'find' ? find(cell, order.id, order.device) : seat(cell, order)).catch(fail);
  };
  const heard = (raw: unknown): void => { try { handle(raw as CellOrder); } catch (error) { fail(error); } };
  if (port.on === undefined) port.onmessage = (event): void => { heard(event.data); }; else port.on('message', heard);
  installCellIdentity();
  void (async (): Promise<void> => {
    for (const slug of options.slugs) { const room = await open(slug); if (disposed) return; cells.set(slug, { slug, room, emptySince: diagnosticNow(), waking: null }); }
    ready = true; readAt = diagnosticNow();
    clock = new ServerClock({ now: diagnosticNow, wait: (ms, run) => { const timer = scope.timeout(ms, run); return () => { scope.cancelTimer(timer); }; }, step });
    clock.start();
    scope.interval(READING_MS, reading);
    post({ kind: 'booted', ms: diagnosticNow() - started });
  })().catch(fail);
  return { dispose };
}
