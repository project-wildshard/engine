// Run the original typed constructor in a fresh source-fenced Node realm.
import { pineNativeOracleInputs } from './pine-native-oracle-inputs.ts';
import { encodeCanonicalJson } from '../../src/shared/host/immutable.ts';
process.stdout.write(encodeCanonicalJson(pineNativeOracleInputs()));
