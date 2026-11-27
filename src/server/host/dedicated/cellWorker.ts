// Portable Math before anything: a worker has its own `Math`, and `NetRoom`'s install comes too late for module bodies (E7.2).
// oxlint-disable-next-line import/no-unassigned-import -- Its whole job is to run first.
import '@wildshard/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Each boot of a cell gets its own id.
import { randomBytes } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Rapier's wasm sits beside the bundle.
import { readFile } from 'node:fs/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- A worker is one row of the table (J182).
import { parentPort, workerData } from 'node:worker_threads';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { readPackGrid, readPackFolder, releaseCookedPack, type PackReads } from './packReader';
import { loadCookedFolder } from '../headlessFolder';
import { runCells, type CellPort } from './cellHost';
import { placeCell, placedUpload, type PlacedCell } from './gridCells';
import { loopLag } from './loopLag';
import { gcPauses } from './gcPauses';
import type { ReleaseFile } from '../../../shared/host/releaseRows';
import type { LedgerCatalogueItem } from '@wildshard/engine/game/ledger';

declare const __DEVSERVER__: boolean;

/** What the door boots a worker with. */
export interface CellWorkerData { readonly slugs: readonly string[]; readonly build: string; readonly origin: string; readonly cache: string; readonly holdMs?: number;readonly playtest?:boolean;
  readonly catalogue?: readonly LedgerCatalogueItem[];
  readonly release?: ReleaseFile;
  /** J107's start-over wait, a proof's override (`EMPTY_MS`): 5 minutes when absent. */
  readonly emptyMs?: number;
  /** Online grid cells host a road; an author's local world has one cell. */
  readonly crossing?: boolean;
  readonly authorProduct?: string;
  /** SA33: the cells the door had placed when it booted this worker; a worker's module state is its own. */
  readonly placed?: readonly PlacedCell[];
  /** SERVER-CELLS SC1: `METRICS_PORT` is set, so this worker measures its event-loop lag for `/metrics`. */
  readonly metrics?: boolean; readonly metricEvents?: boolean }

const { slugs, build, origin, cache, holdMs, emptyMs, playtest, crossing, placed, metrics, metricEvents, catalogue, authorProduct, release } = workerData as CellWorkerData, port = parentPort;
if (port === null) throw new Error('A cell runs in a worker');
for (const row of placed ?? []) placeCell(row);
const reads: PackReads = { fetched: 0, fetchedBytes: 0, cached: 0, refused: 0 };
const rapier = await loadRapier(await readFile(new URL('rapier.wasm', import.meta.url)));
runCells(port as unknown as CellPort, { slugs, build, developerBoost: process.env['WORLD_BOOST'] !== 'off', bootId: () => randomBytes(4).toString('hex'), memory: () => process.memoryUsage(), ...(metrics === true ? { lag: loopLag(), gc: gcPauses() } : {}), ...(metricEvents === true ? { metricEvents: true } : {}), closed: () => { process.exit(0); }, ...(holdMs === undefined ? {} : { holdMs }), ...(emptyMs === undefined ? {} : { emptyMs }),...(playtest===undefined?{}:{playtest}),...(crossing === true ? { road: async () => {
    // A build whose server book has no grid pack gives a road with no strips: this line says so before anyone falls through it.
    const versioned = release !== undefined;
    const strips = await readPackGrid(build, { origin, cache }, reads, versioned);
    console.info(JSON.stringify({ at: 'road.pack', source: versioned ? 'cooked' : 'legacy', strips: strips.length, ...reads }));
    return strips;
  } } : {}),
  load: async slug => {
    if (typeof __DEVSERVER__ === 'boolean' && __DEVSERVER__ && authorProduct !== undefined) {
      return loadCookedFolder(authorProduct, rapier, slug);
    }
    const upload = placedUpload(slug), hash = upload?.hash;
    const cooked = release === undefined ? undefined : releaseCookedPack(release, slug, upload);
    if (release !== undefined && cooked === undefined) throw new Error('A versioned room needs a signed cook address');
    const input = await readPackFolder(slug, build, rapier, { origin, cache, ...(cooked === undefined ? {} : {cooked}) }, reads, hash, catalogue, hash !== undefined);
    console.info(JSON.stringify({ at: 'cell.pack', slug, ...reads }));
    return input;
  } });
