// J182: one worker's life: its cells, one 60 Hz clock over the awake ones, and the port it talks to the door on. `cellWorker.ts` is one line
// around this, so a Node test runs the same code over a real MessageChannel.
import { installAppIdentity } from '@wildshard/engine/app/identity';
import { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { ServerClock } from '@wildshard/engine/net/serverClock';
import { GridAssembly } from '@wildshard/engine/game/grid/assembly';
import type { GridCollisionStrip } from '@wildshard/engine/game/grid/gridCollision';
import type { Rapier } from '@wildshard/engine/physics/rapier';
import { DedicatedRoom, type DedicatedRoomRoad } from './dedicatedRoom';
import { cellShard, roadName } from './gridCells';
import { RoadRoom } from './roadRoom';
import { openRoad } from '../standalone/roadWorld';
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
  /** Its row of the table, by grid instance: fixed at startup, and a cell never moves (J182). */
  readonly slugs: readonly string[]; readonly build: string;
  /** A fresh id for each boot of a cell, so a restarted cell can't repeat a grant. */
  readonly bootId: () => string;
  /** A shard's server inputs, by its slug. */
  readonly load: (slug: string) => Promise<HeadlessRuntimeInput>;
  /** A proof's overrides. `roomNow` is the rooms' hold and checkpoint clock; ticks keep real time. */
  readonly holdMs?: number; readonly emptyMs?: number; readonly roomNow?: () => number;
  /** What this process has resident, for the reading. */
  readonly memory: () => { readonly rss: number; readonly heapUsed: number };
  /** The worker has closed: a worker exits here. */
  readonly closed?: () => void;
  /** A proof's look at each room it opens, and at its road. */
  readonly booted?: (slug: string, room: DedicatedRoom) => void;
  readonly roaded?: (road: RoadRoom) => void;
  readonly playtest?:boolean;
  /**
   * GC15 (`WORLD_CROSSING=worker`): the grid pack's road strips. Given, this worker hosts the road between its cells, each of its grid
   * cells opens onto it instead of standing in lone walls, and a seat walks cell, road, cell on one socket. Left out, every cell is lone.
   */
  readonly road?: () => Promise<readonly GridCollisionStrip[]>;
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
  // GC15: the road this worker hosts, once its cells are open, and what its cells need of it.
  let road: RoadRoom | undefined, rapier: Rapier | undefined, crossing: { readonly name: string; readonly assembly: GridAssembly; readonly strips: readonly GridCollisionStrip[] } | undefined;
  const seams = (instance: string): DedicatedRoomRoad | undefined => {
    if (crossing === undefined || !crossing.assembly.cells.some(cell => cell.instance === instance)) return undefined;
    return { name: crossing.name, assembly: crossing.assembly, seams: crossing.strips.flatMap(strip => strip.duplicates.filter(row => row.instance === instance).map(row => row.mesh)) };
  };
  /** A cell on this worker, or its road, by name. */
  const named = (name: string): Cell | RoadRoom | undefined => road !== undefined && road.name === name ? road : cells.get(name);
  // GO3: a row names cells by grid instance; each loads its shard's pack.
  const open = async (slug: string): Promise<DedicatedRoom> => {
    const shard = cellShard(slug), begun = diagnosticNow(), input = await options.load(shard), onto = seams(slug);
    rapier ??= input.rapier;
    const room = await DedicatedRoom.boot({ slug: shard, cell: slug, build: options.build, bootId: options.bootId(), input, now: options.roomNow ?? diagnosticNow, ...(onto === undefined ? {} : { road: onto }),
      post: news => { if (news.kind === 'left' && news.seats === 0) { const cell = cells.get(slug); if (cell !== undefined) cell.emptySince = diagnosticNow(); } post({ ...news, slug }); },
      reports: { file: report => { post({ kind: 'report', slug, report }); } }, ...(options.holdMs === undefined ? {} : { holdMs: options.holdMs }),...(options.playtest===true?{playtest:row=>{post({kind:'playtest',slug,row});}}:{}) });
    post({ kind: 'cell', slug, ms: diagnosticNow() - begun });
    options.booted?.(slug, room);
    return room;
  };
  const step = (): void => {
    const begun = diagnosticNow();
    try { for (const { room } of cells.values()) if (room.taken > 0) room.tick(); if (road !== undefined && road.taken > 0) road.tick(); } catch (error) { fail(error); return; }
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
  const dispose = (): void => { if (disposed) return; disposed = true; clock?.pause(); scope.dispose(); for (const { room } of cells.values()) room.dispose(); road?.dispose(); options.closed?.(); };
  const find = async (cell: Cell | RoadRoom, id: number, device: string): Promise<void> => {
    if (cell instanceof RoadRoom) { post({ kind: 'found', id, held: cell.holds(device), spawn: cell.spawn }); return; }
    await wake(cell); post({ kind: 'found', id, held: cell.room.holds(device), spawn: cell.room.spawn });
  };
  const seat = async (cell: Cell | RoadRoom, order: Extract<CellOrder, { kind: 'seat' }>): Promise<void> => {
    // The transport starts its port: made before a wake, a close on the way would reach nobody.
    if (!(cell instanceof RoadRoom) && cell.waking !== null) await cell.waking;
    const transport = new SeatTransport(order.port), hello = (): void => { transport.deliver('reliable', order.hello); };
    if (cell instanceof RoadRoom) cell.seat(order, transport, hello); else cell.room.seat(order, transport, hello);
  };
  /** GC15: a seat walks from one of this worker's cells into another, or onto or off its road, the target woken first if it slept long enough to start over. */
  const cross = async (order: Extract<CellOrder, { kind: 'cross' }>): Promise<void> => {
    const { kind: _kind, from: fromSlug, to: toSlug, at, ...entry } = order, from = named(fromSlug), to = named(toSlug);
    if (from === undefined || to === undefined) throw new Error(`${from === undefined ? fromSlug : toSlug} is not on this worker`);
    if (!(to instanceof RoadRoom)) await wake(to);
    if (!(from instanceof RoadRoom) && from.waking !== null) await from.waking;
    const source = from instanceof RoadRoom ? from : from.room, target = to instanceof RoadRoom ? to : to.room;
    const moved = source.handOver(entry.device, target, entry, at);
    post({ kind: 'crossed', device: entry.device, name: entry.name, from: fromSlug, to: toSlug, moved, stays: source.holds(entry.device), body: moved ? target.bodyId(entry.device) ?? entry.body : entry.body });
  };
  const handle = (order: CellOrder): void => {
    if (order.kind === 'close') { dispose(); return; }
    // MP4.1: a line from the world reaches each awake cell here but the one that said it. A cell asleep or starting over hears nothing.
    if (order.kind === 'chat') {
      const source = cells.get(order.from);
      if (ready) for (const cell of cells.values()) if (cell !== source && cell.waking === null && cell.room.taken > 0) cell.room.net.hear(order.line);
      if (ready && road !== undefined && road.name !== order.from && road.taken > 0) road.net.hear(order.line);
      return;
    }
    if (!ready) { fail(new Error('A worker was told something before it booted')); return; }
    if (order.kind === 'drain') { clock?.pause(); for (const { room } of cells.values()) room.drain(); road?.drain(); post({ kind: 'drained' }); return; }
    if (order.kind === 'cross') { cross(order).catch(fail); return; }
    const cell = named(order.slug);
    if (cell === undefined) { fail(new Error(`${order.slug} is not on this worker`)); return; }
    (order.kind === 'find' ? find(cell, order.id, order.device) : seat(cell, order)).catch(fail);
  };
  const heard = (raw: unknown): void => { try { handle(raw as CellOrder); } catch (error) { fail(error); } };
  if (port.on === undefined) port.onmessage = (event): void => { heard(event.data); }; else port.on('message', heard);
  installCellIdentity();
  void (async (): Promise<void> => {
    const first = options.slugs[0];
    if (options.road !== undefined && first !== undefined) crossing = { name: roadName(first), assembly: new GridAssembly({ developer: false, devserver: false }), strips: await options.road() };
    for (const slug of options.slugs) { const room = await open(slug); if (disposed) return; cells.set(slug, { slug, room, emptySince: diagnosticNow(), waking: null }); }
    if (crossing !== undefined && rapier !== undefined) {
      const { name, assembly, strips } = crossing, begun = diagnosticNow();
      road = new RoadRoom({ name, build: options.build, assembly, host: openRoad(rapier, assembly.cells.filter(cell => !cells.has(cell.instance)), strips, assembly.cells), hosts: instance => cells.has(instance),
        now: options.roomNow ?? diagnosticNow, post: news => { post({ ...news, slug: name }); }, reports: { file: report => { post({ kind: 'report', slug: name, report }); } },
        ...(options.holdMs === undefined ? {} : { holdMs: options.holdMs }) });
      post({ kind: 'cell', slug: name, ms: diagnosticNow() - begun });
      options.roaded?.(road);
    }
    ready = true; readAt = diagnosticNow();
    clock = new ServerClock({ now: diagnosticNow, wait: (ms, run) => { const timer = scope.timeout(ms, run); return () => { scope.cancelTimer(timer); }; }, step });
    clock.start();
    scope.interval(READING_MS, reading);
    post({ kind: 'booted', ms: diagnosticNow() - started });
  })().catch(fail);
  return { dispose };
}
