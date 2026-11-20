import { beforeAll, expect, test } from 'vitest';
import { parse } from 'valibot';
import { outputSectionPayloads } from '@wildshard/format/outputFields';
import { JournalRowSchema } from '@wildshard/format/compendiumRows';
import { preflightAssetGraph } from '@wildshard/format/shardfileAssets';
import { parseSketchSvg } from '@wildshard/format/sketch';
import { declaredFolderCompendium } from '../src/shared/game/shard/declaredRows';
import { carryOutputDescriptor, outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { createShardFolder, type ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { builtFolder } from './fixtures/engine-lift/folder';

let base: ShardFolder;
beforeAll(async () => { base = await loadHeadlessFolder(builtFolder('pine-hollow')); });
function product(icons: readonly unknown[]): ShardFolder {
  const shard = structuredClone(base.shardfile), descriptor = outputDescriptor(base.shardfile);
  if (descriptor === undefined) throw new Error('Missing real product descriptor');
  const row = parse(JournalRowSchema, { kind: 'journal', id: 'journal.custom', chunkId: 'icon-fixture', className: 'journal', title: 'Icons',
    tabs: [{ id: 'beasts', label: 'Beasts' }], stamp: { place: 'Seen', default: 'Taken' }, icons, stats: { place: [], default: [] }, entries: [] });
  shard.rows.compendiums = [row]; carryOutputDescriptor(base.shardfile, shard);
  const files = new Map(descriptor.index.files.flatMap(file => file.name === undefined ? [] : [[file.name, { hash: file.hash, url: base.url(file.name) }] as const]));
  return createShardFolder({ slug: base.slug, revision: base.revision, shardfile: shard, sections: outputSectionPayloads(shard), files,
    read: () => { throw new Error('Icon URLs must not eagerly read image bodies'); } });
}
function picture(): { hash: string; name: string } {
  const descriptor = outputDescriptor(base.shardfile), file = descriptor?.index.files.find(row => row.kind === 'image' && row.name !== undefined && base.shardfile.library.includes(row.hash));
  if (file?.name === undefined) throw new Error('Real Pine fixture needs a charged named image');
  return { hash: file.hash, name: file.name };
}
const entry = { id: 'trophy', kind: 'species' as const, tab: 'beasts', name: 'Moon trophy', notes: '', plate: { sketch: '/plate.webp' }, match: { kind: 'own.label' } };
test('the actual admitted product maps a custom icon hash to its logical image URL and keeps first-match selectors', () => {
  // format 0.56 retired glyph selectors (codex-ci21): the fallback selector is an inert SVG of its own
  const fallback = parseSketchSvg('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>').data;
  const file = picture(), selected = product([{ matchKind: 'own.label', image: file.hash }, { image: fallback }]);
  expect(() => preflightAssetGraph(selected.shardfile)).not.toThrow();
  const journal = declaredFolderCompendium(selected, 'journal.custom');
  expect(journal.skin.icon?.(entry)).toEqual({ image: base.url(file.name) });
  expect(journal.skin.icon?.({ ...entry, match: { kind: 'other.label' } })).toEqual({ image: fallback });
});
test('a bounded inert SVG reaches the existing image resolver without an adjacent path guess', () => {
  const image = parseSketchSvg('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><path d="M1 1L7 7" stroke="currentColor"/></svg>').data;
  const selected = product([{ image }]);
  expect(() => preflightAssetGraph(selected.shardfile)).not.toThrow();
  expect(declaredFolderCompendium(selected, 'journal.custom').skin.icon?.(entry)).toEqual({ image });
});
test('declared alpha tint survives the real admitted product resolver', () => {
  const file = picture(), selected = product([{ image: file.hash, tint: 'currentColor' }]);
  expect(() => preflightAssetGraph(selected.shardfile)).not.toThrow();
  expect(declaredFolderCompendium(selected, 'journal.custom').skin.icon?.(entry)).toEqual({ image: base.url(file.name), tint: 'currentColor' });
});
test('unknown and non-image references refuse at asset admission and eager journal installation', () => {
  const descriptor = outputDescriptor(base.shardfile), other = descriptor?.index.files.find(row => row.kind !== 'image' && row.name !== undefined);
  if (other === undefined) throw new Error('Real fixture needs a non-image file');
  for (const image of ['0'.repeat(64), other.hash]) {
    const selected = product([{ image }]);
    expect(() => preflightAssetGraph(selected.shardfile)).toThrow();
    expect(() => declaredFolderCompendium(selected, 'journal.custom')).toThrow('Journal image has no admitted logical name');
  }
});
