import type { PrepareHeadlessRuntime } from '../../../src/server/host/headlessRuntime';
import { prepareFolderPlan as prepareNalati } from '../../fixtures/headless-native';
import { nalatiNativeAssets } from './nativeAssets';

/** Worker proof transport for Nalati's still-path-addressed terrain grid (and its navigation row's bytes when the host
 * hands none over). No simulation, grants or restore law is replaced.
 * The terrain must eventually be a declared hash-addressed shardfile asset before the whole shard is compatible.
 */
export const prepareHeadlessRuntime: PrepareHeadlessRuntime = preparation => prepareNalati({ ...preparation, assets: nalatiNativeAssets(preparation.shard, preparation.assets) });
