import type { NativeProgramSpec } from './native-program';

/** One source/tool/host-fenced constructor for the parent loan and worker's
 * independent typed comparison. Neither caller may narrow its input inventory. */
const PINE_NATIVE_ORACLE: NativeProgramSpec = {
  id: 'pine-native-oracle', script: 'test/fixtures/pine-native-oracle.mjs',
  inputs: ['src/engine', 'src/game', 'src/sdk', 'src/sharddev', 'src/commons',
    'src/shards/pine-hollow', 'test/fixtures', 'package.json', 'pnpm-lock.yaml',
    'scripts/native-recorder-cache.mjs', 'scripts/bake-input-hashes.mjs'],
  transformTypes: true, loader: 'simulation',
};

/** Only this exact Pine construction may borrow the required CI input bundle. */
export function pineNativeOracleSpec(): NativeProgramSpec {
  const cacheDir = process.env['WS_PINE_NATIVE_CACHE'];
  return {...PINE_NATIVE_ORACLE, ...(cacheDir === undefined || cacheDir === '' ? {} : {cacheDir})};
}
