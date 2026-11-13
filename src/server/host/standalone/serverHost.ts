// P1-E5.2 (J31, J49, E5-REPLICATION §6.3): the server half of the standalone target, written against two MessagePorts. The
// module worker is one line around this; the Node test runs the same code over a real MessageChannel.
import * as v from 'valibot';
import { installAppIdentity } from '@wildshard/engine/app/identity';
import { bootMark, bootTask } from '@wildshard/engine/boot/timing';
import { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { LedgerBook } from '@wildshard/engine/net/ledgerBook';
import type { ChatReports } from '@wildshard/engine/net/chat';
import { ServerClock } from '@wildshard/engine/net/serverClock';
import { installSaveEnvironment } from '@wildshard/engine/saves/environment';
import { ForwardedStorage } from '@wildshard/engine/saves/forwardedStorage';
import { saves } from '@wildshard/engine/saves/runtime';
import { allowDeveloperBoost } from '@wildshard/engine/sim/playerSim';
import type { SimHost } from '@wildshard/engine/sim';
import { ServerMessageSchema, ShellMessageSchema, type ProbedRow, type ServerMessage, type ShellMessage } from '@wildshard/format/standaloneControl';
import type { GridPoint } from '@wildshard/engine/game/grid/assembly';
import type { GridCollisionStrip } from '@wildshard/engine/game/grid/gridCollision';
import type { HeadlessRuntimeInput } from '../headlessRuntime';
import { StandaloneGrid } from './gridServer';
import { isHarnessFlag, isHarnessGod, isHarnessHits, isHarnessJoin, isHarnessMove, isHarnessPlace } from '../../../shared/host/standalone/harnessPlace';
import { WorkerLoopback } from '../../../shared/host/standalone/workerLoopback';
import { ProgressSaves, ProgressWatch } from './progressWatch';

type Boot = Extract<ShellMessage, { kind: 'boot' }>;
/** How the composition reaches what a worker and a Node test get differently. */
export interface StandaloneServerOptions {
  readonly control: MessagePort; readonly game: MessagePort;
  /** Read and verify a shard's server inputs: the home cell's, and each cell's as the grid admits it. */
  readonly load: (boot: Boot, slug: string) => Promise<HeadlessRuntimeInput>;
  /** The road's collision, read once a grid session boots. A lone cell has no road and never asks; a proof that stays in a cell needs none. */
  readonly strips?: (boot: Boot) => Promise<readonly GridCollisionStrip[]>;
  /** A save read back but would not restore, and boot moved to the one before it. */
  readonly onSaveRefused?: (error: unknown) => void;
  /** Where a Developer harness says to put this player: a lap's start, or a stuck walker moved on. */
  readonly harness?: MessagePort;
  /** Where chat reports go (J110). Where that ends up is still to be decided. */
  readonly reports?: ChatReports;
  /** A proof's ways in, which no product path passes: boot on the road at this world point, hold this many worlds, read each tick's cost and the running server. */
  readonly proof?: { readonly arrival?: Readonly<GridPoint>; readonly residents?: number; readonly ticked?: (ms: number) => void; readonly booted?: (server: StandaloneGrid) => void };
  /** J311: the grid cell (instance) a no-world build's Shard select chose; a grid session starts there. */
  readonly goto?: string;
}

/** A worker has no page, so no app identity: all it needs of one is the save prefix, which the page passes at boot. */
function installWorkerIdentity(savePrefix: string): void {
  installAppIdentity({ name: '', wordmark: '', tagline: '', savePrefix, saveFormat: '', fileSlug: '', exposeProbe: () => undefined, harness: () => undefined });
}

function probeRows(host: SimHost): ProbedRow[] {
  return [...host.entities].map(([id, sim]) => ({ id, x: sim.position.x, y: sim.position.y, z: sim.position.z, yaw: sim.yaw, hp: sim.hp }));
}

/** Run the server half until `dispose`. Anything that ends it reports `failed` on the control port. */
export function runStandaloneServer(options: StandaloneServerOptions): { dispose: () => void; /** Control messages refused. */ refused: () => number } {
  const { control, game } = options, scope = new Scope('standalone.server');
  const book = new LedgerBook(), watch = new ProgressWatch();
  let grid: StandaloneGrid | undefined, clock: ServerClock | undefined, storage: ForwardedStorage | undefined, probing: number | null = null, booting = false, refused = 0;
  const post = (message: ServerMessage): void => { control.postMessage(v.parse(ServerMessageSchema, message), []); };
  const fail = (error: unknown): void => { clock?.pause(); post({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) }); };
  const stepped = (host: SimHost, tickMs: number): void => {
    options.proof?.ticked?.(tickMs);
    if (probing !== null && host.state.tick % 2 === 0) { post({ kind: 'probed', id: probing, tick: host.state.tick, tickMs, rows: probeRows(host) }); probing = null; }
  };

  // One save at a time, whoever asks (the page, or progress): a capture, its writes, the page's answer and the slot that
  // answer makes good go together, so two saves never race for the alternating slots.
  let queue: Promise<unknown> = Promise.resolve();
  const saveWorld = (): Promise<{ readonly tick: number; readonly durable: boolean }> => {
    const run = queue.then(() => grid === undefined ? { tick: 0, durable: false } : grid.save());
    queue = run.catch(() => undefined);
    return run;
  };
  // TE-ENG8: progress is saved as it moves (a flag, a public field, a grant, a crossing), so a reload a moment later keeps
  // it. The save starts outside the tick, as the page's own `save` does.
  const changed = new ProgressSaves(async () => {
    await new Promise<void>(resolve => { scope.timeout(0, resolve); });
    try { return (await saveWorld()).durable; } catch (error) { fail(error); return false; }
  });
  const progress = (server: StandaloneGrid): void => {
    const now = diagnosticNow();
    changed.moved(now, watch.look(server.host, book.filed));
    changed.poll(now);
  };

  const boot = async (message: Boot): Promise<void> => {
    bootMark('server:boot-configuration');
    storage = new ForwardedStorage(message.saves, write => { post({ kind: 'write', ...write }); });
    const local = storage, { arrival, residents } = options.proof ?? {};
    installWorkerIdentity(message.savePrefix);
    allowDeveloperBoost(); // this server is the player's own device; a page only sends the button with Developer on
    installSaveEnvironment({ storage: saveScope => saveScope === 'session' ? null : local, persistent: () => true, persist: () => Promise.resolve(false) });
    const server = await bootTask('server:world-boot', () => StandaloneGrid.boot({ slug: message.slug, build: message.build, book, saves, storage: local, savePrefix: message.savePrefix, now: diagnosticNow, ...(message.lone === true ? { lone: true } : {}),
      load: slug => options.load(message, slug), strips: () => options.strips?.(message) ?? Promise.resolve([]), stepped, ...(options.onSaveRefused === undefined ? {} : { refused: options.onSaveRefused }), ...(options.reports === undefined ? {} : { reports: options.reports }),
      ...(arrival === undefined ? {} : { arrival }), ...(residents === undefined ? {} : { residents }), ...(options.goto === undefined ? {} : { goto: options.goto }) }));
    grid = server;
    const { restored } = server;
    if (restored?.ledger !== undefined) book.restore(restored.ledger);
    server.connect(new WorkerLoopback(game));
    watch.look(server.host, book.filed); // where the world stands before its first tick: what that tick moves is progress
    if (options.harness !== undefined) options.harness.onmessage = (event: MessageEvent<unknown>): void => { const [port] = event.ports; if (isHarnessJoin(event.data) && port !== undefined) server.join(event.data, new WorkerLoopback(port)); else if (isHarnessFlag(event.data)) server.raise(event.data.flag); else if (isHarnessMove(event.data)) server.place(event.data, event.data.move); else if (isHarnessPlace(event.data)) server.place(event.data); else if (isHarnessHits(event.data)) server.hardHits(event.data.hits); else if (isHarnessGod(event.data)) server.bossGod(); };
    clock = new ServerClock({ now: diagnosticNow, wait: (ms, run) => { const timer = scope.timeout(ms, run); return () => { scope.cancelTimer(timer); }; },
      step: () => { try { server.tick(); progress(server); } catch (error) { fail(error); } } });
    options.proof?.booted?.(server);
    bootMark('server:booted-send');
    post({ kind: 'booted', tick: server.host.state.tick, restored: restored !== undefined });
  };

  const save = async (id: number): Promise<void> => {
    if (grid === undefined) { refused++; post({ kind: 'saved', id, tick: 0, ok: false }); return; } // nothing is saved, and the asker hears so
    const { tick, durable } = await saveWorld(); // J-ledger rule: a save counts only once the real storage has it (§6.3.3)
    post({ kind: 'saved', id, tick, ok: durable });
  };

  const handle = (raw: unknown): void => {
    const parsed = v.safeParse(ShellMessageSchema, raw); // what crosses a port is input: a bad message is refused, and the server goes on
    if (!parsed.success) { refused++; return; }
    const message = parsed.output;
    if (message.kind === 'boot') {
      if (booting) { refused++; return; }
      booting = true; void boot(message).catch(fail);
    }
    else if (message.kind === 'ready') { bootMark('server:ready-received'); grid?.open(); clock?.start(); }
    else if (message.kind === 'pause') clock?.pause();
    else if (message.kind === 'resume') clock?.start();
    else if (message.kind === 'save') void save(message.id).catch(fail);
    else if (message.kind === 'probe') probing = message.id;
    else storage?.acked(message.seq, message.ok);
  };
  control.onmessage = (event: MessageEvent<unknown>): void => { try { handle(event.data); } catch (error) { fail(error); } };
  return { refused: () => refused, dispose: () => { clock?.pause(); watch.dispose(); scope.dispose(); grid?.dispose(); control.close(); } };
}
