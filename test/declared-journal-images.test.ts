import { beforeAll, expect, test } from 'vitest';
import { parse } from 'valibot';
import { outputSectionPayloads } from '@wildshard/format/outputFields';
import { JournalRowSchema } from '@wildshard/format/compendiumRows';
import { preflightAssetGraph } from '@wildshard/format/shardfileAssets';
import { parseSketchSvg } from '@wildshard/format/sketch';
import { declaredProductCompendium } from '../src/shared/game/shard/declaredRows';
import { carryOutputDescriptor, outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { createShardProduct, type ShardProduct } from '../src/shared/game/shardfile/shardProduct';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { builtProduct } from './fixtures/engine-lift/product';

let base: ShardProduct;
beforeAll(async () => { base = await loadHeadlessProduct(builtProduct('pine-hollow')); });
function product(icons: readonly unknown[]): ShardProduct {
  const shard = structuredClone(base.shardfile), descriptor = outputDescriptor(base.shardfile);
  if (descriptor === undefined) throw new Error('Missing real product descriptor');
  const row = parse(JournalRowSchema, { kind: 'journal', id: 'journal.custom', chunkId: 'icon-fixture', className: 'journal', title: 'Icons',
    tabs: [{ id: 'beasts', label: 'Beasts' }], stamp: { place: 'Seen', default: 'Taken' }, icons, stats: { place: [], default: [] }, entries: [] });
  shard.rows.compendiums = [row]; carryOutputDescriptor(base.shardfile, shard);
  const files = new Map(descriptor.index.files.flatMap(file => file.name === undefined ? [] : [[file.name, { hash: file.hash, url: base.url(file.name) }] as const]));
  return createShardProduct({ slug: base.slug, revision: base.revision, shardfile: shard, sections: outputSectionPayloads(shard), files,
    read: () => { throw new Error('Icon URLs must not eagerly read image bodies'); } });
}
function picture(): { hash: string; name: string } {
  const descriptor = outputDescriptor(base.shardfile), file = descriptor?.index.files.find(row => row.kind === 'image' && row.name !== undefined && base.shardfile.library.includes(row.hash));
  if (file?.name === undefined) throw new Error('Real Pine fixture needs a charged named image');
  return { hash: file.hash, name: file.name };
}
const entry = { id: 'trophy', kind: 'species' as const, tab: 'beasts', name: 'Moon trophy', notes: '', plate: { sketch: '/plate.webp' }, match: { kind: 'own.label' } };
test('the actual admitted product maps a custom icon hash to its logical image URL and keeps first-match selectors', () => {
  const file = picture(), selected = product([{ matchKind: 'own.label', image: file.hash }, { icon: 'deer' }]);
  expect(() => preflightAssetGraph(selected.shardfile)).not.toThrow();
  const journal = declaredProductCompendium(selected, 'journal.custom');
  expect(journal.skin.icon?.(entry)).toEqual({ image: base.url(file.name) });
  expect(journal.skin.icon?.({ ...entry, match: { kind: 'other.label' } })).toBe('deer');
});
test('a bounded inert SVG reaches the existing image resolver without an adjacent path guess', () => {
  const image = parseSketchSvg('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><path d="M1 1L7 7" stroke="currentColor"/></svg>').data;
  const selected = product([{ image }]);
  expect(() => preflightAssetGraph(selected.shardfile)).not.toThrow();
  expect(declaredProductCompendium(selected, 'journal.custom').skin.icon?.(entry)).toEqual({ image });
});
test('unknown and non-image references refuse at asset admission and eager journal installation', () => {
  const descriptor = outputDescriptor(base.shardfile), other = descriptor?.index.files.find(row => row.kind !== 'image' && row.name !== undefined);
  if (other === undefined) throw new Error('Real fixture needs a non-image file');
  for (const image of ['0'.repeat(64), other.hash]) {
    const selected = product([{ image }]);
    expect(() => preflightAssetGraph(selected.shardfile)).toThrow();
    expect(() => declaredProductCompendium(selected, 'journal.custom')).toThrow('Journal image has no admitted logical name');
  }
});
