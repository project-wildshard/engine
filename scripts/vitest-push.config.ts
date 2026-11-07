import { relative } from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import base from '../vitest.config';
import { readDurations } from './test-shard-plan';
import { defineConfig } from 'vitest/config';

/** Finish the cheapest related files before the shared push deadline. */
export class PushSequencer extends BaseSequencer {
  override sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const root = this.ctx.config.root, durations = readDurations(root);
    const name = (spec: TestSpecification): string => relative(root, spec.moduleId);
    return Promise.resolve([...files].sort((a, b) =>
      (durations?.get(name(a)) ?? 1) - (durations?.get(name(b)) ?? 1) || name(a).localeCompare(name(b))));
  }
}

const config = defineConfig({ ...base, test: { ...base.test, sequence: { sequencer: PushSequencer } } });
// oxlint-disable-next-line import/no-default-export -- Vitest reads this config's default export.
export default config;
