// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '@wildshard/engine/core/portableMathFirst';
import { loadRapier, type Rapier } from '@wildshard/engine/physics/rapier';
import { installCatalogue } from '@wildshard/engine/game/grid/catalogueSlot';
import { RAPIER_WASM_URL } from '@wildshard/engine/physics/wasmUrl';
import { askHeldReads, type HeldRead } from '../../../shared/host/standalone/heldReads';
import { runStandaloneServer } from './serverHost';
import { fetchGridCollision, fetchServerFolder } from './serverFolder';
import { bootMark, bootTask } from '@wildshard/engine/boot/timing';
import { warmRapier } from '@wildshard/engine/physics/rapierWarm';
import { diagnosticNow } from '@wildshard/engine/core/clock';

/** What a page hands its server's worker: what its document holds and a worker's realm has no way to read. */
export interface ServerWorkerStart {
  readonly catalogue: unknown; readonly validator: unknown; readonly verdicts: unknown;
  /** J311: the grid cell (instance) a no-world build's Shard select chose, or null. */
  readonly goto: string | null;
  /** ZE10b: where in `goto` a gate's zone entry arrives (the cell's own frame), or null */
  readonly enter?: { readonly x: number; readonly z: number; readonly yaw: number } | null;
  /** NB19: the page's own inline candidate, whose server files are read beside it (shell.ts `ownServer`), or null. */
  readonly ownServer?: string | null;
}

/** Physics, once, from the page's own copy where it holds one (DL25). */
let physics: Promise<Rapier> | undefined;
const rapierOf = (held: HeldRead | undefined): Promise<Rapier> => {
  physics ??= (async () => {
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
      const R = await rapierOf(reads === undefined ? undefined : askHeldReads(reads));
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
  // The bare names `@wildshard/format/validationReceipt` reads: this worker's bundle leaves them to its realm.
  if (typeof start.validator === 'string' && Array.isArray(start.verdicts)) Object.assign(globalThis, { __SHARDFILE_VALIDATOR__: start.validator, __SHARDFILE_VERDICTS__: start.verdicts });
  const [control, game, harness, reads] = event.ports;
  if (control === undefined || game === undefined) return;
  const held = reads === undefined ? undefined : askHeldReads(reads);
  runStandaloneServer({ control, game, ...harness === undefined ? {} : { harness }, ...typeof start.goto === 'string' ? { goto: start.goto } : {}, ...typeof start.goto === 'string' && start.enter !== undefined && start.enter !== null ? { enter: start.enter } : {}, load: async (boot, slug, patch) => fetchServerFolder(new URL(`../${slug}/`, new URL(boot.base, globalThis.location.href)).href, await rapierOf(held), held, patch, ownsServer(start, slug)),
    strips: boot => fetchGridCollision(boot.base),
    onSaveRefused: error => { console.warn('Standalone save refused, falling back', error); } });
}
