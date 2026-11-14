// P1-E5.2 (J31, E5-REPLICATION §6.3): the page half of the standalone target. It composes the client with the server worker
// and owns what only a page can do: start the worker, keep the real storage, and pause on a hidden tab. Every page runs on it: build-app
// emits it under the build's folder. This file must never reach a `server`-tagged module (J2).
import { installedCatalogue } from '@wildshard/engine/game/grid/catalogueSlot';
import { bootMark } from '@wildshard/engine/boot/timing';
import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import { NetClient } from '@wildshard/engine/net/client';
import { deviceIdentity, type NetIdentity } from '@wildshard/engine/net/identity';
import { saveDocuments } from '@wildshard/engine/saves/indexed';
import type { SaveStorage } from '@wildshard/engine/saves/store';
import { ServerMessageSchema, ShellMessageSchema, type ProbedRow, type ServerMessage, type ShellMessage } from '@wildshard/format/standaloneControl';
import { answerHeldReads, type HeldRead } from '../../../shared/host/standalone/heldReads';
import type { HarnessFlag, HarnessGod, HarnessHits, HarnessJoin, HarnessMove, HarnessPlace } from '../../../shared/host/standalone/harnessPlace';
import type { DevBox, DevCollidersMessage, DevGround, DevGroundMessage } from '@wildshard/engine/game/devColliders';
import { isDevRestart, type DevGameplay, type DevPlace, type DevRestarted, type DevRestartMessage } from '@wildshard/engine/game/devGameplay';
import type { ServerWorkerStart } from '../../../server/host/standalone/serverRuntime';
import { WorkerLoopback } from '../../../shared/host/standalone/workerLoopback';

declare global { interface Window {
  /** SHARD-SOURCE AP18 (DEVSERVER): the dev hook's ground for the in-page server */ __workerClientDevGround?: (ground: DevGround) => void;
  /** SHARD-SOURCE AP19 (DEVSERVER): the dev hook's soft restart of the in-page server, on a new link this page's client rejoins */
  __workerClientDevRestart?: (gameplay: DevGameplay, at: DevPlace | null) => Promise<DevRestarted>;
} }

/** What the server should run and where the page keeps saves. */
export interface StandaloneConfig {
  readonly slug: string;
  /** The shard's built output directory. */
  readonly base: string;
  /** This engine build's id; empty where builds are not stamped. */
  readonly build: string;
  /** The build the server runs, when it isn't `build`: `hello` then refuses this page (J54). */
  readonly serverBuild?: string;
  /** The server refused this build (`reload`). `startStandalone` reloads into the pointer's newer build. */
  readonly refused?: () => void;
  /** Saves live under this prefix in `storage`, the page's durable storage. */
  readonly savePrefix: string; readonly storage: SaveStorage;
  /** Make one write durable, for a `storage` that only says so later. Absent, `storage`'s own answer stands. */
  readonly write?: (key: string, value: string | null) => Promise<boolean>;
  /** Who this player is (J111); absent, this device's own id. */
  readonly identity?: NetIdentity;
  /** MP2.4: the Name the page keeps (the Name prompt), sent with this device's own id. Solo shows it only on this page. */
  readonly name?: string;
  /** A one-shard page: the server runs this cell alone, with no road and no walls (GC36). */
  readonly lone?: true;
  /** J311: a grid page's Shard select pick (a cell instance): the server starts the session in that cell. */
  readonly goto?: string;
  /** A page with a download: what it holds, which the server asks for before it reads the network (DL25). */
  readonly held?: HeldRead;
}
/** A running standalone session. */
export interface StandaloneShell {
  readonly client: NetClient;
  readonly transport: WorkerLoopback;
  /** Resolves once the server has built its world, restored from a save or fresh. */
  readonly booted: Promise<{ readonly tick: number; readonly restored: boolean }>;
  /** The client finished loading: release the welcome and start the server's clock (§6.3.1). */
  ready: () => void;
  pause: () => void; resume: () => void;
  /** Ask the server to save, resolving once the save is durable in `storage`. */
  save: () => Promise<{ readonly tick: number; readonly ok: boolean }>;
  /** The server's exact creature state at its next frame tick. */
  probe: () => Promise<{ readonly tick: number; readonly tickMs: number; readonly rows: readonly ProbedRow[] }>;
  /** A harness's move of this player: the server's word, so the client snaps with it. */
  place: (x: number, y: number, z: number, yaw: number) => void;
  /** A harness's word on how hard this player's blows land. */
  hardHits: (by: number) => void;
  /** Stop the world until it's let go, whatever a tab's visibility says: a player in a page's own room left it standing. */
  hold: (on: boolean) => void;
  /** A Developer's `?bossGod`, for the server that lands a fight's blows. */
  bossGod: () => void;
  /** A harness's word that one of this player's flags is up. */
  raise: (flag: string) => void;
  /** A proof's second client, a real one on its own link: it stands at this point in this cell, and `move` puts its body elsewhere. */
  join: (id: string, x: number, y: number, z: number) => { readonly client: NetClient; readonly move: (x: number, y: number, z: number) => void };
  /** SHARD-SOURCE AP5: a watched part's solid boxes for the server's world (DEVSERVER pages only; elsewhere it does nothing). */
  devColliders: (name: string, boxes: readonly DevBox[]) => void;
  /** SHARD-SOURCE AP19: restart the in-page server's world on new gameplay rows, its player at `at`; this client rejoins it (DEVSERVER pages only). */
  devRestart: (gameplay: DevGameplay, at: DevPlace | null) => Promise<DevRestarted>;
  dispose: () => void;
}

function applyWrite(storage: SaveStorage, key: string, value: string | null): boolean {
  try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); return true; } catch { return false; }
}

/** AP19: how long the page waits for the in-page server's answer to a soft restart before it counts as refused. */
const DEV_RESTART_TIMEOUT_MS = 20_000;
const SaveDocument = v.object({ keys: v.record(v.string(), v.unknown()), reset: v.optional(v.number()) });
/** Apply only entries the worker changed since its last document. The page owns discovery and cosmetic wear;
 * a server pack/pending-drop write must leave those newer entries standing. Resets still replace the document. */
function changedEntries(before: string | null, after: string | null, current: string | null): string | null {
  if (after === null || current === null || before === current) return after;
  try {
    const base = v.parse(SaveDocument, JSON.parse(before ?? '{"keys":{}}'));
    const next = v.parse(SaveDocument, JSON.parse(after)), live = v.parse(SaveDocument, JSON.parse(current));
    if (base.reset !== next.reset) return after;
    if (base.reset !== live.reset) return current;
    const keys = { ...live.keys };
    for (const key of new Set([...Object.keys(base.keys), ...Object.keys(next.keys)])) {
      if (JSON.stringify(base.keys[key]) === JSON.stringify(next.keys[key])) continue;
      if (Object.hasOwn(next.keys, key)) keys[key] = next.keys[key]; else delete keys[key];
    }
    return JSON.stringify({ ...live, keys });
  } catch { return after; }
}

/** Run the page half over the two ports. `startStandalone` is this over a real worker; a Node test passes a MessageChannel. */
export function connectStandalone(config: StandaloneConfig, control: MessagePort, game: MessagePort, end: () => void, harness?: MessagePort): StandaloneShell {
  const documents = saveDocuments(config.storage, config.savePrefix), workerDocuments = new Map(Object.entries(documents));
  const transport = new WorkerLoopback(game), client = new NetClient(transport);
  transport.onClose(reason => { if (reason === 'reload') config.refused?.(); });
  const post = (message: ShellMessage): void => { control.postMessage(v.parse(ShellMessageSchema, message), []); };
  const waits = new Map<number, (message: ServerMessage) => void>();
  let held = false, disposed = false, requests = 0, booted: (value: { tick: number; restored: boolean }) => void = () => undefined, failed: (reason: Error) => void = () => undefined;
  const bootPromise = new Promise<{ tick: number; restored: boolean }>((resolve, reject) => { booted = resolve; failed = reject; });
  const request = <T>(send: (id: number) => ShellMessage, read: (message: ServerMessage) => T | null): Promise<T> => new Promise(resolve => {
    const id = ++requests;
    waits.set(id, message => { const out = read(message); if (out !== null) { waits.delete(id); resolve(out); } });
    post(send(id));
  });
  const write = async (seq: number, key: string, value: string | null): Promise<void> => {
    const merged = changedEntries(workerDocuments.get(key) ?? null, value, config.storage.getItem(key));
    if (value === null) workerDocuments.delete(key); else workerDocuments.set(key, value);
    post({ kind: 'written', seq, ok: await (config.write?.(key, merged) ?? applyWrite(config.storage, key, merged)) });
  };
  // EV5: a port can still hand over what the worker posted before `dispose`, such as a progress save's write. That session
  // is over: its write would land in storage the next session already read, beside saves that session can't see, and its
  // world's tick could outrank the next session's save. The page drops it, as a reload drops a terminated worker's.
  control.onmessage = (event: MessageEvent<unknown>): void => {
    if (disposed) return;
    const message = v.parse(ServerMessageSchema, event.data);
    if (message.kind === 'booted') { bootMark('server:booted-receive'); booted({ tick: message.tick, restored: message.restored }); bootMark('server:hello-send'); client.hello(config.build, config.identity ?? deviceIdentity(config.storage, config.savePrefix, config.name)); }
    else if (message.kind === 'write') void write(message.seq, message.key, message.value);
    else if (message.kind === 'failed') { failed(new Error(message.reason)); client.closed ??= message.reason; }
    else waits.get(message.id)?.(message);
  };
  // §6.3.2: a backgrounded tab throttles both sides, so the server stops with it, as today's paused state does.
  const visibility = (): void => { if (!held) post({ kind: document.visibilityState === 'hidden' ? 'pause' : 'resume' }); };
  const scope = new Scope('standalone.shell');
  if (typeof document !== 'undefined') scope.listen(document, 'visibilitychange', visibility);
  // SHARD-SOURCE AP18: `wildshard watch`'s ground for this server, from the page's dev hook (DEVSERVER pages only)
  if (typeof __DEVSERVER__ === 'boolean' && __DEVSERVER__ && harness !== undefined && typeof window !== 'undefined')
    scope.expose(window, '__workerClientDevGround', (ground: DevGround) => { harness.postMessage({ wildshardDevGround: ground } satisfies DevGroundMessage, []); });
  // SHARD-SOURCE AP19: the soft restart. The server takes a new link with the restart; this page's client rejoins on it at once
  // (its hello waits in the port until the new world listens), as an online page does when its server comes back.
  // One at a time, and only a message the worker takes: anything else answers `ok: false` before the client leaves its link, so
  // the page reloads instead of sitting on a link nothing serves. A worker that never answers counts as a refusal too.
  let restarting = false;
  const devRestart = (gameplay: DevGameplay, at: DevPlace | null): Promise<DevRestarted> => new Promise<DevRestarted>(resolve => {
    if (!(typeof __DEVSERVER__ === 'boolean' && __DEVSERVER__) || harness === undefined) { resolve({ ok: false, ms: 0, reason: 'not a DEVSERVER page with an in-page server' }); return; }
    const message: DevRestartMessage = { wildshardDevRestart: gameplay, at };
    if (!isDevRestart(message)) { resolve({ ok: false, ms: 0, reason: 'the worker takes only the dev gameplay sections and a finite place' }); return; }
    if (restarting) { resolve({ ok: false, ms: 0, reason: 'a restart is already running' }); return; }
    restarting = true;
    const line = new MessageChannel(), reply = new MessageChannel(), waiting: { timer?: ReturnType<typeof scope.timeout> } = {};
    const settle = (answer: DevRestarted): void => { if (!restarting) return; restarting = false; scope.cancelTimer(waiting.timer); reply.port1.close(); resolve(answer); };
    waiting.timer = scope.timeout(DEV_RESTART_TIMEOUT_MS, () => { settle({ ok: false, ms: DEV_RESTART_TIMEOUT_MS, reason: 'the in-page server did not answer the restart' }); });
    reply.port1.onmessage = (event: MessageEvent<DevRestarted>): void => { settle(event.data); };
    const link = new WorkerLoopback(line.port1);
    link.onClose(reason => { if (reason === 'reload') config.refused?.(); });
    client.rejoin(link);
    harness.postMessage(message, [line.port2, reply.port2]);
  });
  if (typeof __DEVSERVER__ === 'boolean' && __DEVSERVER__ && harness !== undefined && typeof window !== 'undefined') scope.expose(window, '__workerClientDevRestart', devRestart);
  post({ kind: 'boot', slug: config.slug, base: config.base, build: config.serverBuild ?? config.build, savePrefix: config.savePrefix, saves: documents, ...(config.lone === true ? { lone: true } : {}) });
  return { client, transport, booted: bootPromise,
    ready: () => { post({ kind: 'ready' }); }, pause: () => { post({ kind: 'pause' }); }, resume: () => { post({ kind: 'resume' }); },
    hold: on => { held = on; post({ kind: on ? 'pause' : 'resume' }); },
    save: () => request(id => ({ kind: 'save', id }), message => message.kind === 'saved' ? { tick: message.tick, ok: message.ok } : null),
    probe: () => request(id => ({ kind: 'probe', id }), message => message.kind === 'probed' ? { tick: message.tick, tickMs: message.tickMs, rows: message.rows } : null),
    place: (x, y, z, yaw) => { harness?.postMessage({ x, y, z, yaw } satisfies HarnessPlace, []); },
    hardHits: by => { harness?.postMessage({ hits: by } satisfies HarnessHits, []); },
    bossGod: () => { harness?.postMessage({ god: true } satisfies HarnessGod, []); },
    raise: flag => { harness?.postMessage({ flag } satisfies HarnessFlag, []); },
    devColliders: (name, boxes) => { if (typeof __DEVSERVER__ === 'boolean' && __DEVSERVER__) harness?.postMessage({ wildshardDevColliders: name, boxes } satisfies DevCollidersMessage, []); },
    devRestart,
    join: (id, x, y, z) => {
      const line = new MessageChannel(), second = new NetClient(new WorkerLoopback(line.port1));
      harness?.postMessage({ join: id, x, y, z } satisfies HarnessJoin, [line.port2]);
      second.hello(config.build, { player: id, name: id });
      return { client: second, move: (mx, my, mz) => { harness?.postMessage({ move: id, x: mx, y: my, z: mz, yaw: 0 } satisfies HarnessMove, []); } };
    },
    dispose: () => { disposed = true; scope.dispose(); client.dispose(); transport.close('disposed'); control.close(); end(); } };
}

/** Start the standalone target: the server always in a module worker, with no main-thread fallback (J49). */
export function startStandalone(config: StandaloneConfig): StandaloneShell {
  const worker = new Worker(new URL('../../../server/host/standalone/serverWorker.ts', import.meta.url), { type: 'module', name: 'standalone-server' });
  const bootstrapScope = new Scope('standalone.bootstrap');
  let failBoot: (error: Error) => void = () => undefined;
  const nativeFailure = new Promise<never>((_resolve, reject) => { failBoot = reject; });
  bootstrapScope.listen(worker, 'error', (event: ErrorEvent) => {
    const cause: unknown = event.error;
    failBoot(cause instanceof Error ? cause : new Error(event.message || 'Standalone server worker failed to load'));
  });
  bootstrapScope.listen(worker, 'message', (event: MessageEvent<unknown>) => {
    if (typeof event.data === 'object' && event.data !== null && '__engineWorkerBoot' in event.data) bootMark('server:worker-bootstrap-ready');
  });
  const control = new MessageChannel(), game = new MessageChannel(), harness = new MessageChannel(), reads = config.held === undefined ? undefined : new MessageChannel();
  // C3: the page's catalogue, read at boot, is the worker's too; it has no document to read it from. So are its build's
  // verdicts, which a worker's reads ask for as the page's do (they are stamped into the document, and into nothing else).
  bootMark('worker:configuration-send');
  worker.postMessage({ catalogue: installedCatalogue() ?? null, validator: Reflect.get(globalThis, '__WS_SHARDFILE_VALIDATOR__') ?? null, verdicts: Reflect.get(globalThis, '__WS_SHARDFILE_VERDICTS__') ?? null, goto: config.goto ?? null } satisfies ServerWorkerStart,
    [control.port2, game.port2, harness.port2, ...reads === undefined ? [] : [reads.port2]]);
  if (reads !== undefined && config.held !== undefined) answerHeldReads(reads.port1, config.held);
  // The worker sits beside this module, so an emitted module's `/b/<build>/` folder is the server's real build (J57).
  const served = /^\/b\/([\w.-]+)\//u.exec(new URL(import.meta.url).pathname)?.[1];
  const refused = (): void => { void import('@wildshard/engine/boot/browserChunkRecovery').then(recovery => recovery.reloadRefusedBuild()); };
  const shell = connectStandalone({ refused, ...served === undefined ? {} : { serverBuild: served }, ...config }, control.port1, game.port1, () => { bootstrapScope.dispose(); reads?.port1.close(); harness.port1.close(); worker.terminate(); }, harness.port1);
  return { ...shell, booted: Promise.race([shell.booted, nativeFailure]) };
}
