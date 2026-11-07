import { fencedNativeOracle } from './native-oracle';
import { nineNativeOracleInputs } from './nine-native-oracle-inputs';

/** The complete original oracle is checked against a fresh source constructor
 * before the direct native factory can install its original policies. */
export const NINE_NATIVE_ORACLE = {
  id: 'nine-native-oracle', script: 'test/fixtures/nine-native-oracle-compile.mjs',
  inputs: ['src/engine', 'src/game', 'src/sdk', 'src/sharddev', 'src/commons',
    'src/shards/nine-dragon-stack', 'package.json', 'pnpm-lock.yaml',
    'test/fixtures/nine-native-oracle.ts', 'test/fixtures/nine-native-oracle-inputs.ts'],
} as const;

export function nineNativeOracle(): Promise<ReturnType<typeof nineNativeOracleInputs>> {
  return fencedNativeOracle(NINE_NATIVE_ORACLE, nineNativeOracleInputs);
}
