import { nineNativeOracleInputs } from './nine-native-oracle-inputs.ts';
import { encodeCanonicalJson } from '../../src/shared/host/immutable.ts';

console.log(encodeCanonicalJson(nineNativeOracleInputs()));
