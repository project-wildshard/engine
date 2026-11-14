import {GPU_FILES} from '../../src/client/engine/boot/ktx2.generated';
import {ASSET_CACHE_NAME} from '../../src/client/engine/pwa/cacheNames';
import {writeEntryBootstrap as cookBootstrap} from '../../src/cook/game/entryDownloads';
import {writeSpawnManifests as cookManifests, type BuildHalf} from '../../src/cook/game/entryTotals';
import {assetTableAddresses, readAssetTables} from './assetTables.mjs';
import {readGridSeams} from './gridSeams.mjs';
import {rendererRevision} from '../renderer-revision.mjs';
import {defaultCookTiers} from '../../src/cook/game/shardCook';
import {homedir} from 'node:os';
import {resolve} from 'node:path';

/** C1: the page's half of the cook's input, which the app build owns: its tables, seams and names. */
const {WILDSHARD_PREPARATION_ONLY, WILDSHARD_ASTC6_CACHE} = process.env;
/** S12d: the phone tier's 6×6 encodes, kept by input between builds. Beside the spawn parts' bodies, so CI's cache of
 *  `~/.cache/wildshard/gen/spawn-parts-br` keeps them too (a cold Pine is minutes of encode). */
const astc6Cache = WILDSHARD_ASTC6_CACHE ?? resolve(homedir(), '.cache/wildshard/gen/spawn-parts-br/astc6-1');
const build: BuildHalf = {cacheName: ASSET_CACHE_NAME, gpuFiles: GPU_FILES, tables: readAssetTables,
  preparationOnly: WILDSHARD_PREPARATION_ONLY === '1', rendererRevision: rendererRevision(), tiers: () => defaultCookTiers(astc6Cache),
  tableAddresses: root => assetTableAddresses(readAssetTables(root)), seams: root => readGridSeams(root).address};

export const writeSpawnManifests = (outDir: string, input: unknown, strips: Parameters<typeof cookManifests>[2], root: string, report?: Parameters<typeof cookManifests>[5]): ReturnType<typeof cookManifests> =>
  cookManifests(outDir, input, strips, root, build, report);
export const writeEntryBootstrap = (outDir: string, root: string, report?: Parameters<typeof cookBootstrap>[3]): Promise<void> =>
  cookBootstrap(outDir, root, build, report);
export {readPacksSet} from '../../src/cook/game/entryTotals';
