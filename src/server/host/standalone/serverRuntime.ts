// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '@wildshard/engine/core/portableMathFirst';
import type {CookedPartMember} from '@wildshard/engine/boot/tables';
import { loadRapier, type Rapier } from '@wildshard/engine/physics/rapier';
import { installCatalogue } from '@wildshard/engine/game/grid/catalogueSlot';
import { RAPIER_WASM_URL } from '@wildshard/engine/physics/wasmUrl';
import { isWasmModule } from '@wildshard/engine/physics/rapierModule';
import { askHeldReads, type HeldRead } from '../../../shared/host/standalone/heldReads';
import { runStandaloneServer } from './serverHost';
import { fetchGridCollision, fetchServerFolder, installWorkerCookedMembers, installWorkerCookedObjects } from './serverFolder';
import { bootMark, bootTask } from '@wildshard/engine/boot/timing';
import { warmRapier } from '@wildshard/engine/physics/rapierWarm';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import type { SimSnapshotBytes } from '@wildshard/engine/sim/snapshot';
import type { SaveCodecReply, SaveCodecRequest } from './saveCodecWorker';

/** What a page hands its server's worker: what its document holds and a worker's realm has no way to read. */
export interface ServerWorkerStart {
  /** EM21: the page's compiled Rapier, or null: the worker then compiles its own from the bytes the page holds */
  readonly rapier?: WebAssembly.Module | null;
  readonly catalogue: unknown; readonly validator: unknown; readonly verdicts: unknown;
  /** J311: the grid cell (instance) a no-world build's Shard select chose, or null. */
  readonly goto: string | null;
  /** ZE10b: where in `goto` a gate's zone entry arrives (the cell's own frame), or null */
  readonly enter?: { readonly x: number; readonly z: number; readonly yaw: number } | null;
  /** NB19: the page's own inline candidate, whose server files are read beside it (shell.ts `ownServer`), or null. */
  readonly ownServer?: string | null;
  readonly backgroundSaves?: boolean;
  /** Fix preview PV4: the page's cooked object table (page path, cooked URL), so the server reads a zone's files where the cook
   *  stored them, as the page does; empty on a page with no zone table. */
  readonly cooked?: readonly (readonly [string, string])[] | null;
  readonly cookedMembers?: readonly (readonly [string, CookedPartMember])[];
}

/** Launch only on the first save. Rapier's detached snapshot bytes cross the port by transfer. */
function backgroundSaveEncoder(): (snapshot: SimSnapshotBytes) => Promise<string> {
  const waiting = new Map<number, { resolve: (wire: string) => void; reject: (error: Error) => void }>();
  let worker: Worker | undefined, next = 0;
  const start = (): Worker => {
    const codec = new Worker(new URL('saveCodecWorker.ts', import.meta.url), { type: 'module', name: 'standalone-save-codec' });
    const fail = (message: string): void => {
      if (worker !== codec) return;
      codec.terminate();
      worker = undefined;
      for (const request of waiting.values()) request.reject(new Error(message));
      waiting.clear();
    };
    codec.onmessage = (event: MessageEvent<SaveCodecReply>): void => {
      const reply = event.data, request = waiting.get(reply.id);
      if (request === undefined) return;
      waiting.delete(reply.id);
      if ('wire' in reply) request.resolve(reply.wire); else request.reject(new Error(reply.error));
    };
    codec.onerror = event => { event.preventDefault(); fail(event.message || 'Save codec worker failed'); };
    codec.onmessageerror = () => { fail('Save codec reply could not be read'); };
    return codec;
  };
  return snapshot => new Promise((resolve, reject) => {
    const codec = worker ??= start(), id = ++next;
    waiting.set(id, { resolve, reject });
    const bytes = snapshot.physics.buffer;
    try { codec.postMessage({ id, snapshot } satisfies SaveCodecRequest, bytes instanceof ArrayBuffer ? [bytes] : []); }
    catch (error) { waiting.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
  });
}

/** Physics, once: from the page's compiled module where it posted one (EM21), else from the page's own copy of the bytes
 *  where it holds one (DL25). */
let physics: Promise<Rapier> | undefined;
const compiledOf = (data: unknown): WebAssembly.Module | undefined => {
  const rapier: unknown = typeof data === 'object' && data !== null ? Reflect.get(data, 'rapier') : undefined;
  return isWasmModule(rapier) ? rapier : undefined;
};
const rapierOf = (held: HeldRead | undefined, compiled?: WebAssembly.Module): Promise<Rapier> => {
  physics ??= (async () => {
    if (compiled !== undefined) return bootTask('server:rapier-instantiate-shared', () => loadRapier(compiled));
    const bytes = await bootTask('server:rapier-held-bytes', async () => await held?.(new URL(RAPIER_WASM_URL, globalThis.location.href).href) ?? undefined);
    return bootTask('server:rapier-initialize', () => loadRapier(bytes));
  })();
  return physics;
};

/**
 * MG10 (J410): a worker the page started early in its boot (`prespawnStandalone`) loads physics now, from the port the
 * page answers held reads on, and warms it (`warmRapier`): the wasm tier-up of its hot functions lands here, while the page
 * holds little, instead of on the first frame's loading peak. The start message that follows finds physics loaded.
 */
export function prewarmServerWorker(event: MessageEvent<unknown>): void {
  bootMark('worker:prewarm-received');
  const reads = event.ports[0];
  void (async () => {
    try {
      const R = await rapierOf(reads === undefined ? undefined : askHeldReads(reads), compiledOf(event.data));
      warmRapier(R, diagnosticNow); bootMark('server:rapier-warmed');
    } catch { physics = undefined; /* the start message's boot loads physics again and reports there */ }
  })();
}

/** NB19: whether `cell` is the page's own inline candidate, whose server files are read beside it (shell.ts `ownServer`). */
const ownsServer = (start: ServerWorkerStart, cell: string): boolean => typeof start.ownServer === 'string' && start.ownServer === cell;

// P1-E5.2 (J49): the module worker every standalone target boots. There is no main-thread path to this code. The page
// hands over the control port, the game port, the harness's and, on a page with a download, the port for what it holds, once;
// everything after that goes through them.
export function runServerWorker(event: MessageEvent<unknown>): void {
  bootMark('worker:configuration-received');
  const start = event.data as ServerWorkerStart;
  if (start.catalogue !== null) installCatalogue(start.catalogue);
  if (Array.isArray(start.cooked)) installWorkerCookedObjects(start.cooked);
  if (start.cookedMembers !== undefined) installWorkerCookedMembers(start.cookedMembers);
  // The bare names `@wildshard/format/validationReceipt` reads: this worker's bundle leaves them to its realm.
  if (typeof start.validator === 'string' && Array.isArray(start.verdicts)) Object.assign(globalThis, { __SHARDFILE_VALIDATOR__: start.validator, __SHARDFILE_VERDICTS__: start.verdicts });
  const [control, game, harness, reads] = event.ports;
  if (control === undefined || game === undefined) return;
  const held = reads === undefined ? undefined : askHeldReads(reads);
  runStandaloneServer({ control, game, ...harness === undefined ? {} : { harness }, ...typeof start.goto === 'string' ? { goto: start.goto } : {}, ...typeof start.goto === 'string' && start.enter !== undefined && start.enter !== null ? { enter: start.enter } : {}, load: async (boot, slug, patch) => fetchServerFolder(new URL(`../${slug}/`, new URL(boot.base, globalThis.location.href)).href, await rapierOf(held, compiledOf(start)), held, patch, ownsServer(start, slug)),
    ...start.backgroundSaves === true ? { encodeSave: backgroundSaveEncoder() } : {},
    strips: boot => fetchGridCollision(boot.base),
    onSaveRefused: error => { console.warn('Standalone save refused, falling back', error); } });
}
