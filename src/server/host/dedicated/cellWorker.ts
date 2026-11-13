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
import { readPackGrid, readPackProduct, type PackReads } from './packReader';
import { runCells, type CellPort } from './cellHost';
import { placeCell, type PlacedCell } from './gridCells';

/** What the door boots a worker with. */
export interface CellWorkerData { readonly slugs: readonly string[]; readonly build: string; readonly origin: string; readonly cache: string; readonly holdMs?: number;readonly playtest?:boolean;
  /** GC15: `WORLD_CROSSING=worker`, this worker hosts the road between its cells. */
  readonly crossing?: boolean;
  /** SA33: the cells the door had placed when it booted this worker; a worker's module state is its own. */
  readonly placed?: readonly PlacedCell[] }

const { slugs, build, origin, cache, holdMs,playtest, crossing, placed } = workerData as CellWorkerData, port = parentPort;
if (port === null) throw new Error('A cell runs in a worker');
for (const row of placed ?? []) placeCell(row);
const reads: PackReads = { fetched: 0, fetchedBytes: 0, cached: 0, refused: 0 };
const rapier = await loadRapier(await readFile(new URL('rapier.wasm', import.meta.url)));
runCells(port as unknown as CellPort, { slugs, build, bootId: () => randomBytes(4).toString('hex'), memory: () => process.memoryUsage(), closed: () => { process.exit(0); }, ...(holdMs === undefined ? {} : { holdMs }),...(playtest===undefined?{}:{playtest}),...(crossing === true ? { road: async () => {
    // A build whose server book has no grid pack gives a road with no strips: this line says so before anyone falls through it.
    const strips = await readPackGrid(build, { origin, cache }, reads);
    console.info(JSON.stringify({ at: 'road.pack', strips: strips.length, ...reads }));
    return strips;
  } } : {}),
  load: async slug => {
    const input = await readPackProduct(slug, build, rapier, { origin, cache }, reads);
    console.info(JSON.stringify({ at: 'cell.pack', slug, ...reads }));
    return input;
  } });
