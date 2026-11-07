import base from '../vitest.config';
import { defineConfig } from 'vitest/config';

// These source guards use their own small fixtures. Loading every shard's
// runtime/species setup would make them depend on unrelated product bytes.
const config = defineConfig({ ...base, test: { ...base.test,
  setupFiles: [],
  include: ['test/schema-reference.test.ts', 'test/host-callbacks.test.ts',
    'test/shardfile-boundaries.test.ts', 'test/platform-chargebacks.test.ts',
    'test/manifest-declarations.test.ts'],
} });
// oxlint-disable-next-line import/no-default-export -- Vitest reads this config's default export.
export default config;
