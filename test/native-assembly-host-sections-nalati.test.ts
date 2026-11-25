// FORMAT-PRUNE FP16: one pinned shard's hostless, planless and folded proofs (test/fixtures/nativeHostSections.ts holds them and
// the helpers). QA 11-25 row 33 split native-assembly-host-sections.test.ts per pinned shard to keep each file under 60 s.
import { expect, test } from 'vitest';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { shipsPlanFile } from '../src/test/game/shippedPlan';
import { hostlessProof, hostRows, open, planless, rewritten, shipped, worldProof } from './fixtures/nativeHostSections';

// Nalati's fold runs in native-assembly-host-sections-nalati-folded.test.ts.
hostlessProof('nalati-grasslands');
worldProof('nalati-grasslands');

test('a plan file beside the server sections, or a section holding another family, is refused (FP21)', async () => {
  const fixture = await shipped('nalati-grasslands'), rows = hostRows(fixture), riding = rows.filter(row => row.host.startsWith('riding.'));
  await expect(open(fixture, rewritten(fixture, riding, new Map([['server/riding', riding]])))).rejects.toThrow('not both');
  const { product: written } = shipsPlanFile(fixture.product) ? { product: planless(fixture) } : fixture;
  const mixed = { ...written, section: (name: string): unknown => name === 'server/riding' ? { version: 1, hosts: [...riding, ...rows.filter(row => row.host === 'boss.arena')] } : written.section(name as never) } as ShardFolder;
  await expect(open(fixture, mixed)).rejects.toThrow('holds its own family');
});
