// FORMAT-PRUNE FP16: one pinned shard's hostless, planless and folded proofs (test/fixtures/nativeHostSections.ts holds them and
// the helpers). QA 11-25 row 33 split native-assembly-host-sections.test.ts per pinned shard to keep each file under 60 s.
import { expect, test } from 'vitest';
import { NATIVE_ASSEMBLY_FILE } from '@wildshard/format/nativeAssembly';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { shipsPlanFile } from '../src/test/game/shippedPlan';
import { hostSectionsSuite, open, planless, shipped } from './fixtures/nativeHostSections';

hostSectionsSuite('pine-hollow');

test('a plan file beside server/world is refused', async () => {
  const fixture = await shipped('pine-hollow'), world = shipsPlanFile(fixture.product) ? planless(fixture) : fixture.product;
  const bytes = new TextEncoder().encode(JSON.stringify(fixture.plan));
  const both: ShardFolder = Object.assign(Object.create(world) as ShardFolder, {
    hasFile: (name: string): boolean => name === NATIVE_ASSEMBLY_FILE || world.hasFile(name),
    file: (name: string) => name === NATIVE_ASSEMBLY_FILE ? Promise.resolve(bytes) : world.file(name),
  });
  await expect(open(fixture, both)).rejects.toThrow('not both');
});
