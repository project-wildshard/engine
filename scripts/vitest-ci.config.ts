import { configDefaults, defineConfig } from 'vitest/config';
import base from '../vitest.config';
import { PURE_TESTS } from './vitest-shard';
import { CI_SERIAL_TESTS } from './vitest-ci-files';

// Explicit project configs avoid array-concatenation inheriting the ordinary
// global setup into pure workers. The root sequencer packs both projects together.
const config = defineConfig({ ...base, test: { ...base.test, projects: [
  { ...base, extends: false, test: { ...base.test, name: 'pure',
    include: [...PURE_TESTS], setupFiles: [], isolate: false, pool: 'forks' } },
  { ...base, extends: false, test: { ...base.test, name: 'isolated', isolate: true,
    exclude: [...(base.test?.exclude ?? configDefaults.exclude), ...PURE_TESTS, ...CI_SERIAL_TESTS] } },
] } });
// oxlint-disable-next-line import/no-default-export -- Vitest reads this config's default export.
export default config;
