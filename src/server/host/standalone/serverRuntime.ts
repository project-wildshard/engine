// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '@wildshard/engine/core/portableMathFirst';
import { loadRapier, type Rapier } from '@wildshard/engine/physics/rapier';
import { installCatalogue } from '@wildshard/engine/game/grid/catalogueSlot';
import { RAPIER_WASM_URL } from '@wildshard/engine/physics/wasmUrl';
import { askHeldReads, type HeldRead } from '../../../shared/host/standalone/heldReads';
import { runStandaloneServer } from './serverHost';
import { fetchGridCollision, fetchServerProduct } from './serverProduct';
import { bootMark, bootTask } from '@wildshard/engine/boot/timing';

/** What a page hands its server's worker: what its document holds and a worker's realm has no way to read. */
export interface ServerWorkerStart { readonly catalogue: unknown; readonly validator: unknown; readonly verdicts: unknown }

/** Physics, once, from the page's own copy where it holds one (DL25). */
let physics: Promise<Rapier> | undefined;
const rapierOf = (held: HeldRead | undefined): Promise<Rapier> => {
  physics ??= (async () => {
    const bytes = await bootTask('server:rapier-held-bytes', async () => await held?.(new URL(RAPIER_WASM_URL, globalThis.location.href).href) ?? undefined);
    return bootTask('server:rapier-initialize', () => loadRapier(bytes));
  })();
  return physics;
};

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
  runStandaloneServer({ control, game, ...harness === undefined ? {} : { harness }, load: async (boot, slug) => fetchServerProduct(new URL(`../${slug}/`, new URL(boot.base, globalThis.location.href)).href, await rapierOf(held), held),
    strips: boot => fetchGridCollision(boot.base),
    onSaveRefused: error => { console.warn('Standalone save refused, falling back', error); } });
}
