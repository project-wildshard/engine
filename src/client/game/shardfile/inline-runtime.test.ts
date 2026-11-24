// @vitest-environment happy-dom
// NINE-DRAGON-BENCHMAX NB19 (mini QA 11-16 row 42): `wildshard prepare`'s page composes its inline candidate's declared
// runtime through the candidate's own client-plan discovery entry, as a catalogue page does.
import { expect, test, vi } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { inlineRuntimeArrival } from './clientSource';
import type { ShardManifest } from '../shard/manifest';

const BASE = 'http://127.0.0.1:4173/';
const LOCATION = { base: BASE };
const candidate = (runtime: Shardfile['runtime'], slug = 'nine-dragon-stack'): Shardfile => ({ identity: { slug }, runtime }) as unknown as Shardfile;
const declared = { binds: [] } as unknown as Shardfile['runtime'];
const GRID = { shardfile: '/shardfiles/nine-dragon-stack/shard.json' };
const discovery = (load: unknown, data: Record<string, unknown>) => ({ version: 1, slug: 'nine-dragon-stack', data, rows: {}, native: { load } });
const PLAN_ENTRY = { $call: 'planEntry', args: [{ retainHomeRuntime: true, stagesOwner: 'declared' }, []] };
/** Stands in for discovery.ts `shardFromDiscovery`: the document's data as its manifest. */
const discover = (input: unknown): ShardManifest => {
  const row = input as { slug: string; data: Record<string, unknown> };
  return { slug: row.slug, ...row.data } as unknown as ShardManifest;
};

test('a candidate with no runtime keeps the inline path and reads nothing', async () => {
  const read = vi.fn();
  await expect(inlineRuntimeArrival(candidate(null), LOCATION, read, discover)).resolves.toBeNull();
  expect(read).not.toHaveBeenCalled();
});

test('an inline runtime enters by its own same-origin client-plan discovery, as the catalogue does', async () => {
  const read = vi.fn((_url: string) => Promise.resolve(discovery(PLAN_ENTRY, GRID)));
  const manifest = await inlineRuntimeArrival(candidate(declared), LOCATION, read, discover);
  expect(read).toHaveBeenCalledWith('http://127.0.0.1:4173/shardfiles/nine-dragon-stack/discovery.json');
  expect(manifest).toMatchObject({ slug: 'nine-dragon-stack', ...GRID });
});

test('a discovery with no client-plan entry, another identity or another descriptor is refused', async () => {
  const refuse = async (document: unknown, message: string): Promise<void> => {
    await expect(inlineRuntimeArrival(candidate(declared), LOCATION, () => Promise.resolve(document), discover)).rejects.toThrow(message);
  };
  await refuse(discovery(undefined, GRID), 'requires its discovery client-plan entry');
  await refuse(discovery({ $call: 'renderToon', args: [] }, GRID), 'requires its discovery client-plan entry');
  await refuse(null, 'requires its discovery client-plan entry');
  await refuse({ ...discovery(PLAN_ENTRY, GRID), slug: 'other-shard' }, 'discovery identity differs');
  await refuse(discovery(PLAN_ENTRY, {}), 'its own same-origin descriptor');
  await refuse(discovery(PLAN_ENTRY, { shardfile: 'https://elsewhere.example/shardfiles/nine-dragon-stack/shard.json' }), 'its own same-origin descriptor');
  await refuse(discovery(PLAN_ENTRY, { shardfile: '/shardfiles/other-shard/shard.json' }), 'its own same-origin descriptor');
  await refuse(discovery(PLAN_ENTRY, { shardfile: '/shardfiles/nine-dragon-stack/shard.json?v=1' }), 'its own same-origin descriptor');
});

test('a candidate identity that is not a plain shard folder is refused before a read', async () => {
  const read = vi.fn();
  await expect(inlineRuntimeArrival(candidate(declared, '../admin'), LOCATION, read, discover)).rejects.toThrow('not a shard folder');
  expect(read).not.toHaveBeenCalled();
});
