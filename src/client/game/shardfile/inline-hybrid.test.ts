// @vitest-environment happy-dom
// NINE-DRAGON-BENCHMAX NB19 (mini QA 11-16 row 42): `wildshard prepare`'s page composes its inline candidate's declared
// runtime only through the candidate's own client-plan discovery entry, as a catalogue page does; nothing else admits one.
import { expect, test, vi } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { inlineHybridArrival } from './clientSource';
import type { ShardManifest } from '../shard/manifest';

const BASE = 'http://127.0.0.1:4173/';
const OWNER = { base: BASE, firstParty: true };
const candidate = (runtime: Shardfile['runtime'], slug = 'nine-dragon-stack'): Shardfile => ({ identity: { slug }, runtime }) as unknown as Shardfile;
const declared = { binds: [] } as unknown as Shardfile['runtime'];
const GRID = { gridShardfile: '/shardfiles/nine-dragon-stack/shard.json' };
const discovery = (load: unknown, data: Record<string, unknown>) => ({ version: 1, slug: 'nine-dragon-stack', data, rows: {}, native: { load } });
const PLAN_ENTRY = { $call: 'planEntry', args: [{ retainHomeRuntime: true, stagesOwner: 'declared' }, []] };
/** Stands in for discovery.ts `shardFromDiscovery`: the document's data as its manifest. */
const discover = (input: unknown): ShardManifest => {
  const row = input as { slug: string; data: Record<string, unknown> };
  return { slug: row.slug, ...row.data } as unknown as ShardManifest;
};

test('a candidate with no runtime keeps the inline path and reads nothing', async () => {
  const read = vi.fn();
  await expect(inlineHybridArrival(candidate(null), OWNER, read, discover)).resolves.toBeNull();
  expect(read).not.toHaveBeenCalled();
});

test('a page that does not own its inline candidate still refuses any runtime before a read', async () => {
  const read = vi.fn();
  await expect(inlineHybridArrival(candidate(declared), { base: BASE, firstParty: false }, read, discover))
    .rejects.toThrow('Custom runtime requires native hybrid composition');
  expect(read).not.toHaveBeenCalled();
});

test('the owner enters a native candidate by its own same-origin client-plan discovery, as the catalogue does', async () => {
  const read = vi.fn((_url: string) => Promise.resolve(discovery(PLAN_ENTRY, GRID)));
  const manifest = await inlineHybridArrival(candidate(declared), OWNER, read, discover);
  expect(read).toHaveBeenCalledWith('http://127.0.0.1:4173/shardfiles/nine-dragon-stack/discovery.json');
  expect(manifest).toMatchObject({ slug: 'nine-dragon-stack', ...GRID });
});

test('a discovery with no client-plan entry, another identity or another descriptor is refused', async () => {
  const refuse = async (document: unknown, message: string): Promise<void> => {
    await expect(inlineHybridArrival(candidate(declared), OWNER, () => Promise.resolve(document), discover)).rejects.toThrow(message);
  };
  await refuse(discovery(undefined, GRID), 'requires its discovery client-plan entry');
  await refuse(discovery({ $call: 'renderToon', args: [] }, GRID), 'requires its discovery client-plan entry');
  await refuse(null, 'requires its discovery client-plan entry');
  await refuse({ ...discovery(PLAN_ENTRY, GRID), slug: 'other-shard' }, 'discovery identity differs');
  await refuse(discovery(PLAN_ENTRY, {}), 'its own same-origin descriptor');
  await refuse(discovery(PLAN_ENTRY, { gridShardfile: 'https://elsewhere.example/shardfiles/nine-dragon-stack/shard.json' }), 'its own same-origin descriptor');
  await refuse(discovery(PLAN_ENTRY, { gridShardfile: '/shardfiles/other-shard/shard.json' }), 'its own same-origin descriptor');
  await refuse(discovery(PLAN_ENTRY, { gridShardfile: '/shardfiles/nine-dragon-stack/shard.json?v=1' }), 'its own same-origin descriptor');
  await refuse(discovery(PLAN_ENTRY, { ...GRID, shardfile: GRID.gridShardfile }), 'its own same-origin descriptor');
});

test('a candidate identity that is not a plain shard folder is refused before a read', async () => {
  const read = vi.fn();
  await expect(inlineHybridArrival(candidate(declared, '../admin'), OWNER, read, discover)).rejects.toThrow('not a shard folder');
  expect(read).not.toHaveBeenCalled();
});
