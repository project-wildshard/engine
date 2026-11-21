// OF31f2b: a grid page's Owned takes its home cell's kept rows from the cell's shard file; the old table is the fallback.
import { expect, test, vi } from 'vitest';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { outputSectionPayloads } from '@wildshard/format/outputFields';
import { encodeCanonicalJson, hashImmutableBytes } from '../src/shared/host/immutable';
import { readGridFolderKept } from '../src/client/game/grid/folders';
import { gridHomeKept } from '../src/client/game/grid/homeKept';
import { Owned, type KeptRow } from '../src/shared/game/loot/Owned';

const KEPT: KeptRow[] = [
  { id: 'warden-longbow', kind: 'gear', label: "The Warden's Longbow" },
  { id: 'lantern-hat', kind: 'cosmetic', label: 'Lantern hat' },
  { id: 'whetstone-1', kind: 'upgrade', label: 'Whetstone I', gauge: { name: 'sharpen', level: 1 } },
];

function fixture(slug: string, kept?: KeptRow[]) {
  const source = emptyShardfile({ slug, name: 'Kept', author: 'Test', revision: 1, seed: 3 });
  const declared = kept === undefined ? source : { ...source, items: { ...source.items, kept } };
  const encode = (value: unknown) => new TextEncoder().encode(encodeCanonicalJson(value));
  const url = `https://game.test/shardfiles/${slug}/shard.json`;
  const sectionBytes = new Map([...outputSectionPayloads(declared)].map(([name, value]) => [name, encode(value)]));
  const index = { format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version, identity: source.identity, requires: source.requires,
    build: { sourceHash: '0'.repeat(64), validator: 'test' }, admission: { budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library },
    sections: [...sectionBytes].map(([name, bytes]) => ({ name, path: `sections/${name}.json`, schema: `wildshard:${name}@1`, hash: hashImmutableBytes(bytes), bytes: bytes.length })), schemas: [], files: [], runtime: null };
  const items = sectionBytes.get('combat/items'); if (items === undefined) throw new Error('Missing combat/items');
  const wires = new Map([[url, encode(index)], [new URL('sections/combat/items.json', url).href, items]]);
  const fetch = vi.fn((path: string): Promise<Response> => {
    const bytes = wires.get(path); if (bytes === undefined) return Promise.reject(new Error(`Full admission attempted: ${path}`));
    return Promise.resolve(new Response(Uint8Array.from(bytes)));
  });
  return { url, slug, fetch, options: { base: new URL('.', url).href, offline: false, fetch, hash: (bytes: Uint8Array) => Promise.resolve(hashImmutableBytes(bytes)) } };
}

test('a grid cell\'s kept rows come from its index and combat/items alone, nothing admitted', async () => {
  const f = fixture('kept-cell', KEPT);
  expect(await readGridFolderKept(f.url, f.slug, f.options)).toEqual(KEPT);
  expect(f.fetch.mock.calls.map(([path]) => new URL(path).pathname)).toEqual(['/shardfiles/kept-cell/shard.json', '/shardfiles/kept-cell/sections/combat/items.json']);
  await expect(readGridFolderKept(f.url, 'another-cell', f.options)).rejects.toThrow('identity');
  const old = fixture('old-cell');
  expect(await readGridFolderKept(old.url, old.slug, old.options)).toBeNull();
});

test('the grid page\'s Owned keeps its home cell\'s rows; the old table stands for a cell with none or an unread one', async () => {
  const f = fixture('kept-home', KEPT);
  const kept = await gridHomeKept(f.slug, slug => readGridFolderKept(f.url, slug, f.options));
  expect(kept.ids).toEqual(KEPT.map(row => row.id));
  const saved = { owned: ['warden-longbow', 'lantern-hat', 'cape'], worn: ['lantern-hat', 'cape'] };
  const writes: unknown[] = [];
  const owned = new Owned('kept-home', { read: () => saved, write: (value: unknown) => { writes.push(value); return true; } }, kept);
  expect(owned.has('warden-longbow')).toBe(true); expect(owned.worn('lantern-hat')).toBe(true);
  expect(owned.has('cape')).toBe(false); // the old table's cape is not this cell's row: kept in the save, unread
  expect(owned.grant('whetstone-1')).toBe(true); expect(owned.sharpen).toBe(1);
  expect(writes.at(-1)).toEqual({ owned: ['warden-longbow', 'lantern-hat', 'whetstone-1', 'cape'], worn: ['lantern-hat', 'cape'] });

  const old = fixture('old-home');
  expect((await gridHomeKept(old.slug, slug => readGridFolderKept(old.url, slug, old.options))).has('cape')).toBe(true);
  expect((await gridHomeKept('no-descriptor', () => null)).has('captain-hat')).toBe(true);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try { expect((await gridHomeKept('broken', () => Promise.reject(new Error('offline')))).has('iron-sword')).toBe(true); expect(warn).toHaveBeenCalledOnce(); }
  finally { warn.mockRestore(); }
});
