import { defineConfig } from 'vitest/config';
import base from '../vitest.config';

// CI7: the fixtures CI job writes each expensive fixture's exact-run snapshot once (test/fixtures/runSnapshot.ts); the test shards
// read them. The wave's sequencer packs only its own inventory, so these writer files keep Vitest's default order.
const config = defineConfig({ ...base, test: { ...base.test, include: ['test/fixture-snapshots/*.snapshot.ts'], sequence: {} } });
// oxlint-disable-next-line import/no-default-export -- Vitest reads this config's default export.
export default config;
