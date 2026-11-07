import assembly from '../../src/shards/nine-dragon-stack/data/headlessAssembly.json' with { type: 'json' };

/** Original typed native oracle facts, independent of the shipping inventory. */
export function nineNativeOracleInputs(): typeof assembly { return structuredClone(assembly); }
