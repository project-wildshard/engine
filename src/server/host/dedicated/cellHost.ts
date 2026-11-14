// J182: one worker's life: its cells, one 60 Hz clock over the awake ones, and the port it talks to the door on. `cellWorker.ts` is one line
// around this, so a Node test runs the same code over a real MessageChannel.
import { installAppIdentity } from '@wildshard/engine/app/identity';
import { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import { ServerClock } from '@wildshard/engine/net/serverClock';
import type { GridAssembly } from '@wildshard/engine/game/grid/assembly';
import type { GridCollisionStrip } from '@wildshard/engine/game/grid/gridCollision';
import type { Rapier } from '@wildshard/engine/physics/rapier';
import { DedicatedRoom, type DedicatedRoomRoad } from './dedicatedRoom';
import { cellShard, gridAssembly, gridCell, placeCell, roadName } from './gridCells';
import { RoadRoom } from './roadRoom';
import { applyMotion } from '@wildshard/engine/game/grid/simulation';
import { placedStrips } from '@wildshard/engine/game/grid/voidFloor';
import { openRoad } from '../standalone/roadWorld';
import type { HeadlessRuntimeInput } from '../headlessRuntime';
import type { CellOrder, WorkerNews, WorkerReading, WorkerResident } from './cellProtocol';
import { SeatTransport } from './socketPump';

/** How often a worker reads itself (E7.8). */
export const READING_MS = 10_000;
/** Enough ticks for a 10 s reading, at the worker's rate. */
const TICKS_KEPT = 720;
/** The save prefix a cell's stores share. Nothing outside a cell ever reads it. */
const SAVE_PREFIX = 'wildshard.room.';
/**
 * SERVER-CELLS SC4 (J328): the ticks a cell runs as it opens, with nobody in it, before the worker says `booted`. A world's first ticks
 * build what it builds lazily (each creature's animation channel programs, Rapier's first step, the JIT's first pass): 25 to 30 ms on an
 * idle Mac, and up to 668 ms on a loaded one, which every player on the worker felt when the cell's first player arrived. One second of
 * world time at boot pays it there instead.
 */
export const WARM_TICKS = 60;
/**
 * J107: a cell everyone left starts over once it has stood empty this long, on its own timer, before anyone comes back (J320). J328 (SC5)
 * retires it for grid cells: a grid cell's world is never rebuilt, and what players spend in it comes back through its own respawns. Only
 * a cell the grid doesn't place (a local run's `WORLD_CELLS`) still starts over.
 */
const EMPTY_MS = 300_000;
/** GC4: a road walker this near a cell's edge may be about to step in, so the cell does not start over under them; looked at again this often. */
const NEAR_M = 40, NEAR_RETRY_MS = 5000;

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
  readonly holdMs?: number; readonly emptyMs?: number; readonly roomNow?: () => number; readonly readingMs?: number;
  /** What this process has resident, and this thread's own heap and buffers, for the reading. */
  readonly memory: () => { readonly rss: number; readonly heapUsed: number; readonly external?: number; readonly arrayBuffers?: number };
  /** SC1: this thread's event-loop lag since the last reading (`loopLag`), for `/metrics`. */
  readonly lag?: () => { readonly p50: number; readonly p99: number; readonly max: number };
  /** The worker has closed: a worker exits here. */
  readonly closed?: () => void;
  /** A proof's look at each room it opens, and at its road. */
  readonly booted?: (slug: string, room: DedicatedRoom) => void;
  readonly roaded?: (road: RoadRoom) => void;
  readonly playtest?:boolean;
  /**
   * GC15 (`WORLD_CROSSING=worker`): the grid pack's road strips. Given, this worker hosts the road between its cells, each of its grid
   * cells opens onto it instead of standing in lone walls, and a seat walks cell, road, cell on one socket. Left out, or no strips, every cell is lone.
   */
  readonly road?: () => Promise<readonly GridCollisionStrip[]>;
}
/**
 * One cell, and when it last emptied. A cell with nobody in it takes no ticks: that is all sleep is (Q80). Its world, colliders and sim stay
 * in memory from the worker's boot (J320). `used`: someone stood in this world since it booted, so it has something to start over from.
 */
interface Cell { readonly slug: string; room: DedicatedRoom; emptySince: number; used: boolean; waking: Promise<void> | null }
const percentile = (sorted: readonly number[], at: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * at))] ?? 0;

/** A worker has no page, so no app identity: all it needs of one is the save prefix. */
function installCellIdentity(): void {
  installAppIdentity({ name: '', wordmark: '', tagline: '', savePrefix: SAVE_PREFIX, saveFormat: '', fileSlug: '', exposeProbe: () => undefined, harness: () => undefined });
}

/** Run one worker's cells until it is told to close. Anything that ends it says `failed`, and the process ends (Q77). */
export function runCells(port: CellPort, options: CellHostOptions): { dispose: () => void } {
  const scope = new Scope('dedicated.worker'), started = diagnosticNow(), cells = new Map<string, Cell>();
  let clock: ServerClock | undefined, disposed = false, ready = false, ticks: number[] = [], ticked = 0, readAt = started, dropsAt = 0;
  /** SC8: each awake cell's own tick time since the last reading (ms summed, ticks counted), so a bench can weigh cells by awake cost. */
  let spent = new Map<string, { ms: number; ticks: number }>();
  const post = (news: WorkerNews): void => { port.postMessage(news); };
  const fail = (error: unknown): void => { clock?.pause(); post({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) }); };
  // GC15: the road this worker hosts, once its cells are open, and what its cells need of it.
  // SA34a: `seams` are placed cells' own copies of the pack's strips beside them, which the pack baked with no row for a cell it never saw.
  let road: RoadRoom | undefined, rapier: Rapier | undefined, crossing: { readonly name: string; readonly assembly: GridAssembly; readonly strips: readonly GridCollisionStrip[]; readonly seams: readonly GridCollisionStrip['duplicates'][number][] } | undefined;
  const seams = (instance: string): DedicatedRoomRoad | undefined => {
    if (crossing === undefined || !crossing.assembly.cells.some(cell => cell.instance === instance)) return undefined;
    return { name: crossing.name, assembly: crossing.assembly, seams: [...crossing.strips.flatMap(strip => strip.duplicates), ...crossing.seams].filter(row => row.instance === instance).map(row => row.mesh) };
  };
  /**
   * GC30: a cell this worker hosts and whose entryways all have ground at road height. Any other (another worker's, or Far Reach's sky
   * islands) is walled on the road: a walker meets the wall and turns back, never falls in with no way out.
   */
  const enterable = (instance: string): boolean => { const room = cells.get(instance)?.room; return room !== undefined && room.entrywaysStand(); };
  /** A cell on this worker, or its road, by name. */
  const named = (name: string): Cell | RoadRoom | undefined => road !== undefined && road.name === name ? road : cells.get(name);
  const emptyMs = options.emptyMs ?? EMPTY_MS;
  /** GC15 (3): cells a seat from another worker's road is arriving in: none starts over meanwhile (review SHOULD). */
  const arrivals = new Set<Cell>();
  /** Set by `drain`: the worker is closing, so an arrival is refused (the client retries on the next one). */
  let drained = false;
  /** `startOver`, once it is made below: a start-over opens a cell, and a cell's room says when it emptied. */
  const later = { startOver: (_cell: Cell, _since: number): void => undefined };
  /** Someone stood in this world: it has something to start over from. A refused seat never got this far. */
  /** SC10 (J328): when each room last had nobody in it, from its boot or its last leave. */
  const asleep = new Map<DedicatedRoom, number>();
  /** SC10: a room's first seat after empty time: its world took no ticks meanwhile and is never rebuilt, so it spends the time now. */
  const woke = (room: DedicatedRoom): void => {
    const since = asleep.get(room); asleep.delete(room);
    const seconds = since === undefined ? 0 : (diagnosticNow() - since) / 1000;
    if (seconds >= 1) room.host.events.emit('world.slept', { seconds });
  };
  const used = (slug: string, room: DedicatedRoom): void => { const cell = cells.get(slug); if (cell !== undefined && cell.room === room) cell.used = true; };
  /** J107 on J320's terms: the last seat left this cell's world, so it starts over once it has stood empty `emptyMs`, nobody waiting on it.
   *  SC5 (J328): never a grid cell's. */
  const emptied = (slug: string, room: DedicatedRoom): void => {
    const cell = cells.get(slug);
    if (cell === undefined || cell.room !== room || disposed || gridCell(slug)) return;
    const since = cell.emptySince = diagnosticNow();
    if (cell.used) scope.timeout(emptyMs, () => { later.startOver(cell, since); });
  };
  // GO3: a row names cells by grid instance; each loads its shard's pack.
  const open = async (slug: string): Promise<DedicatedRoom> => {
    const shard = cellShard(slug), begun = diagnosticNow(), input = await options.load(shard), onto = seams(slug);
    rapier ??= input.rapier;
    const room: DedicatedRoom = await DedicatedRoom.boot({ slug: shard, cell: slug, build: options.build, bootId: options.bootId(), input, now: options.roomNow ?? diagnosticNow, ...(onto === undefined ? {} : { road: onto }),
      post: news => {
        if (news.kind === 'seated') { if (news.seats === 1) woke(room); used(slug, room); } else if (news.kind === 'left' && news.seats === 0) { asleep.set(room, diagnosticNow()); emptied(slug, room); }
        post({ ...news, slug });
      },
      reports: { file: report => { post({ kind: 'report', slug, report }); } }, ...(options.holdMs === undefined ? {} : { holdMs: options.holdMs }),...(options.playtest===true?{playtest:row=>{post({kind:'playtest',slug,row});}}:{}) });
    // SC4: its first ticks now, while nobody is in it, not on its first player's arrival.
    for (let tick = 0; tick < WARM_TICKS; tick++) room.tick();
    asleep.set(room, diagnosticNow());
    post({ kind: 'cell', slug, ms: diagnosticNow() - begun });
    options.booted?.(slug, room);
    return room;
  };
  const step = (): void => {
    const begun = diagnosticNow();
    try {
      for (const { slug, room } of cells.values()) {
        if (room.taken === 0) continue;
        const at = diagnosticNow();
        room.tick();
        const own = spent.get(slug) ?? { ms: 0, ticks: 0 };
        own.ms += diagnosticNow() - at; own.ticks++; spent.set(slug, own);
      }
      if (road !== undefined && road.taken > 0) road.tick();
    } catch (error) { fail(error); return; }
    ticks.push(diagnosticNow() - begun); ticked++;
    if (ticks.length > TICKS_KEPT) ticks.shift();
  };
  const reading = (): void => {
    const now = diagnosticNow(), sorted = ticks.slice().sort((a, b) => a - b), rooms = [...cells.values()].map(cell => cell.room), memory = options.memory();
    const sum = (read: (room: DedicatedRoom) => number): number => rooms.reduce((total, room) => total + read(room), 0);
    // SC1: a seat on this worker's road is a player too, though the road is no cell.
    const onRoad = road === undefined ? 0 : road.taken - road.holding, heldOnRoad = road?.holding ?? 0;
    const row: WorkerReading = { cells: rooms.length, awake: rooms.filter(room => room.taken > 0).length, players: sum(room => room.taken - room.holding) + onRoad, held: sum(room => room.holding) + heldOnRoad, ticks: ticked, ticksPerSecond: ticks.length / ((now - readAt) / 1000),
      p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), max: sorted.at(-1) ?? 0, drops: (clock?.drops ?? 0) - dropsAt, rss: memory.rss, heap: memory.heapUsed,
      refused: sum(room => room.net.stats.refused), dropped: sum(room => room.net.stats.dropped), frameBytes: sum(room => room.net.stats.frameBytes), eventBytes: sum(room => room.net.stats.eventBytes),
      ...(spent.size === 0 ? {} : { cellMs: Object.fromEntries([...spent].map(([slug, own]) => [slug, own.ms / own.ticks])) }),
      ...(memory.external === undefined ? {} : { external: memory.external }), ...(memory.arrayBuffers === undefined ? {} : { arrayBuffers: memory.arrayBuffers }), ...(options.lag === undefined ? {} : { lag: options.lag() }) };
    readAt = now; dropsAt = clock?.drops ?? 0; ticks = []; spent = new Map();
    post({ kind: 'reading', reading: row });
  };
  /** One start-over at a time on this worker: each boot stalls the clock of every other cell here, so they never pile up. */
  let overs: Promise<void> = Promise.resolve();
  /** The fresh world, swapped in while the cell is still empty. One that fails keeps the old world and says so; the worker plays on. */
  /** GC4: a walker on this worker's road near the cell's edge, or a seat arriving from another worker's road, may step in now. */
  const walkerNear = (cell: Cell): boolean => {
    const origin = crossing?.assembly.cells.find(row => [cell.slug].includes(row.instance))?.origin;
    return arrivals.has(cell) || (origin !== undefined && road?.near(origin, CHUNK_HALF + NEAR_M) === true);
  };
  const restart = async (cell: Cell): Promise<void> => {
    if (disposed || cell.room.taken > 0) return;
    // review SHOULD: a start-over queued behind others looks again when its turn comes, since a walker may have come near meanwhile
    if (walkerNear(cell)) { const since = cell.emptySince; scope.timeout(NEAR_RETRY_MS, () => { later.startOver(cell, since); }); return; }
    try {
      const old = cell.room, room = await open(cell.slug);
      if (disposed) { room.dispose(); return; }
      cell.room = room; old.dispose(); cell.used = false; cell.emptySince = diagnosticNow();
    } catch (error) { console.warn(JSON.stringify({ at: 'cell.start-over-failed', slug: cell.slug, error: error instanceof Error ? error.message : String(error) })); }
  };
  /** A cell everyone left starts over. An arrival meanwhile waits for it (`settled`). A timer can fire a little early by this clock, so it looks again. */
  later.startOver = (cell: Cell, since: number): void => {
    if (disposed || cell.waking !== null || !cell.used || cell.room.taken > 0 || cell.emptySince !== since) return;
    const left = emptyMs - (diagnosticNow() - since);
    if (left > 0) { scope.timeout(left, () => { later.startOver(cell, since); }); return; }
    // GC4: never boot a cell under a walker heading back to it: while someone on the road stands within NEAR_M of its edge, look again later
    if (walkerNear(cell)) { scope.timeout(NEAR_RETRY_MS, () => { later.startOver(cell, since); }); return; }
    const job = overs.then(() => restart(cell)).finally(() => { if (cell.waking === job) cell.waking = null; });
    cell.waking = job; overs = job;
  };
  /** J320: an arrival never boots a cell. It waits only for a start-over already under way, and false when the worker closed meanwhile. */
  const settled = async (...waiting: readonly Cell[]): Promise<boolean> => {
    for (let busy = waiting.find(cell => cell.waking !== null); busy?.waking; busy = waiting.find(cell => cell.waking !== null)) await busy.waking;
    return !disposed;
  };
  const dispose = (): void => { if (disposed) return; disposed = true; clock?.pause(); scope.dispose(); for (const { room } of cells.values()) room.dispose(); road?.dispose(); options.closed?.(); };
  const find = async (cell: Cell | RoadRoom, id: number, device: string): Promise<void> => {
    if (cell instanceof RoadRoom) { post({ kind: 'found', id, held: cell.holds(device), spawn: cell.spawn }); return; }
    if (await settled(cell)) post({ kind: 'found', id, held: cell.room.holds(device), spawn: cell.room.spawn });
  };
  const seat = async (cell: Cell | RoadRoom, order: Extract<CellOrder, { kind: 'seat' }>): Promise<void> => {
    // The transport starts its port: made before a wake, a close on the way would reach nobody.
    if (!(cell instanceof RoadRoom) && !await settled(cell)) return;
    const transport = new SeatTransport(order.port), hello = (): void => { transport.deliver('reliable', order.hello); };
    if (cell instanceof RoadRoom) cell.seat(order, transport, hello); else cell.room.seat(order, transport, hello);
  };
  /**
   * SA34a: cells placed on the running world, one order at a time. The road's grid grows first (a cell opened here builds its seams from
   * it), then this worker opens the ones it hosts, then its road lays the grown grid out, whatever opened. A failure is answered, never
   * thrown: the other cells and the road play on.
   */
  let placing: Promise<void> = Promise.resolve();
  /** RR2: what this worker holds, for the door's `/health`: a road counts its strips only once it is open */
  const resident = (): WorkerResident => ({ cells: cells.size, road: road !== undefined, strips: road === undefined ? 0 : crossing?.strips.length ?? 0 });
  const place = async (order: Extract<CellOrder, { kind: 'place' }>): Promise<void> => {
    const opened: string[] = [];
    let laid: (() => void) | undefined;
    try {
      for (const row of order.cells) placeCell(row);
      const was = crossing?.assembly, grown = gridAssembly();
      if (crossing !== undefined && was !== undefined && was !== grown) {
        const { strips, seams: more } = placedStrips(grown, was), fresh = grown.cells.slice(was.cells.length);
        crossing = { name: crossing.name, assembly: grown, strips: [...crossing.strips, ...strips], seams: [...crossing.seams, ...more] };
        laid = () => { road?.place(grown, strips, fresh.filter(cell => !enterable(cell.instance))); };
      }
      for (const slug of order.open) {
        if (cells.has(slug)) continue;
        const room = await open(slug);
        if (disposed) { room.dispose(); post({ kind: 'placed', id: order.id, opened, error: 'The worker closed' }); return; }
        cells.set(slug, { slug, room, emptySince: diagnosticNow(), used: false, waking: null }); opened.push(slug);
      }
      post({ kind: 'placed', id: order.id, opened, resident: resident() });
    // RR2: a place that failed partway still opened `opened` and grew the road's strips, so its answer says what is resident too
    } catch (error) { post({ kind: 'placed', id: order.id, opened, error: error instanceof Error ? error.message : String(error), resident: resident() }); }
    finally { if (!disposed) laid?.(); }
  };
  /** GC15: a seat walks from one of this worker's cells into another, or onto or off its road; a target starting over is waited for (J320). */
  const cross = async (order: Extract<CellOrder, { kind: 'cross' }>): Promise<void> => {
    const { kind: _kind, from: fromSlug, to: toSlug, at, ...entry } = order, from = named(fromSlug), to = named(toSlug);
    if (from === undefined || to === undefined) throw new Error(`${from === undefined ? fromSlug : toSlug} is not on this worker`);
    // Both settled in one look, then read and moved with no await between: a start-over can't begin under the seat (J320).
    if (!await settled(...[from, to].filter((cell): cell is Cell => !(cell instanceof RoadRoom)))) return;
    const source = from instanceof RoadRoom ? from : from.room, target = to instanceof RoadRoom ? to : to.room;
    const moved = source.handOver(entry.device, target, entry, at);
    post({ kind: 'crossed', device: entry.device, name: entry.name, from: fromSlug, to: toSlug, moved, stays: source.holds(entry.device), body: moved ? target.bodyId(entry.device) ?? entry.body : entry.body });
  };
  /**
   * GC15 (3): a seat another worker's road let go walks into cell `to` here, on the socket the door moved to `port`: its body first, at `at`
   * with the walker's motion, then the room hears the client's hello again and welcomes it (the client heard `travel` first).
   */
  const arrive = async (order: Extract<CellOrder, { kind: 'arrive' }>): Promise<void> => {
    const { kind: _kind, from, to: slug, at, port: seatPort, hello, motion, ...entry } = order, cell = cells.get(slug);
    // review MUST: the port's transport is made after the wait, as `seat`'s is: a close meanwhile stays queued on the port for it
    const refuse = (made?: SeatTransport): void => { (made ?? new SeatTransport(seatPort)).close('retry'); post({ kind: 'crossed', device: entry.device, name: entry.name, from, to: slug, moved: false, stays: false, body: entry.body }); };
    if (cell !== undefined) arrivals.add(cell);
    try {
      // review SHOULDs: a drained worker seats no one, and a cell that already holds this device keeps that body
      if (cell === undefined || drained || !await settled(cell) || drained || cell.room.holds(entry.device)) { refuse(); return; }
      const transport = new SeatTransport(seatPort), arrived = cell.room.admit(entry, transport, at);
      if (typeof arrived === 'string') { refuse(transport); return; }
      const player = cell.room.host.players.get(arrived.body);
      if (motion !== null && player !== undefined) applyMotion(motion, player);
      const client = cell.room.net.join(transport, cell.room.sim.playerOf(arrived.body));
      transport.deliver('reliable', hello);
      cell.room.net.travelled(client);
      const moved = arrived.land(cell.room.net.live(client) ? client : null);
      post({ kind: 'crossed', device: entry.device, name: entry.name, from, to: slug, moved, stays: false, body: cell.room.bodyId(entry.device) ?? entry.body });
    } finally { if (cell !== undefined) arrivals.delete(cell); }
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
    if (order.kind === 'drain') { drained = true; clock?.pause(); for (const { room } of cells.values()) room.drain(); road?.drain(); post({ kind: 'drained' }); return; }
    if (order.kind === 'cross') { cross(order).catch(fail); return; }
    // GC15 (3): crossings between workers, and which cells on the others a walker can stand in
    if (order.kind === 'open') { road?.open(order.cells); return; }
    if (order.kind === 'handOut') { const out = road !== undefined && road.name === order.from && road.handOut(order.device, order.to); if (!out) post({ kind: 'handedOut', device: order.device, from: order.from, out }); return; }
    if (order.kind === 'arrive') { arrive(order).catch(fail); return; }
    if (order.kind === 'place') { placing = placing.then(() => place(order)); return; }
    const cell = named(order.slug);
    if (cell === undefined) { fail(new Error(`${order.slug} is not on this worker`)); return; }
    (order.kind === 'find' ? find(cell, order.id, order.device) : seat(cell, order)).catch(fail);
  };
  const heard = (raw: unknown): void => { try { handle(raw as CellOrder); } catch (error) { fail(error); } };
  if (port.on === undefined) port.onmessage = (event): void => { heard(event.data); }; else port.on('message', heard);
  installCellIdentity();
  void (async (): Promise<void> => {
    const first = options.slugs[0];
    // SA34a: a worker booted after a placement (its `placed`) lays the placed cells out from the start.
    // ROAD-RESIDENT RR4 (Jake 11-13 ~10:35: crossing always on; replaces GC28's lone cells): a book with no grid pack reads no
    // strips, so there is no road to stand on. The worker refuses its boot: `/health` never comes up and `wildshard-config`'s
    // rollback keeps the last good server, instead of a server whose players can't leave their cell (the `road.pack` line says 0).
    if (options.road !== undefined && first !== undefined) {
      const assembly = gridAssembly(), strips = await options.road(), placed = placedStrips(assembly, gridAssembly(false));
      if (strips.length === 0) throw new Error('No road: the grid pack read 0 strips (a crossing worker needs its road)');
      crossing = { name: roadName(first), assembly, strips: [...strips, ...placed.strips], seams: placed.seams };
    }
    for (const slug of options.slugs) { const room = await open(slug); if (disposed) return; cells.set(slug, { slug, room, emptySince: diagnosticNow(), used: false, waking: null }); }
    if (crossing !== undefined && rapier !== undefined) {
      const { name, assembly, strips } = crossing, begun = diagnosticNow();
      road = new RoadRoom({ name, build: options.build, assembly, host: openRoad(rapier, assembly.cells.filter(cell => !enterable(cell.instance)), strips, assembly.cells), hosts: instance => cells.has(instance),
        now: options.roomNow ?? diagnosticNow, post: news => { post({ ...news, slug: name }); }, reports: { file: report => { post({ kind: 'report', slug: name, report }); } },
        ...(options.holdMs === undefined ? {} : { holdMs: options.holdMs }) });
      post({ kind: 'cell', slug: name, ms: diagnosticNow() - begun });
      options.roaded?.(road);
    }
    ready = true; readAt = diagnosticNow();
    clock = new ServerClock({ now: diagnosticNow, wait: (ms, run) => { const timer = scope.timeout(ms, run); return () => { scope.cancelTimer(timer); }; }, step });
    clock.start();
    scope.interval(options.readingMs ?? READING_MS, reading);
    // GC15 (3): this worker's grid cells a walker off another worker's road can stand in (GC30's entryway ground)
    post({ kind: 'booted', ms: diagnosticNow() - started, resident: resident(), ...(road === undefined ? {} : { stands: [...cells.keys()].filter(enterable) }) });
  })().catch(fail);
  return { dispose };
}
