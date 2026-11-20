import { afterEach, expect, test, vi } from 'vitest';
import { builtIndexHash } from '@wildshard/format/builtIndexes';
import { checkBuiltIndex, type FolderOptions } from './folder';
import { releaseInlineCandidate } from './preparedCandidate';

const PINNED = 'a'.repeat(64), CANDIDATE = 'b'.repeat(64), OTHER = 'c'.repeat(64);
const saved: unknown = Reflect.get(globalThis, '__WS_SHARDFILE_VERDICTS__');
afterEach(() => { Reflect.set(globalThis, '__WS_SHARDFILE_VERDICTS__', saved); Reflect.deleteProperty(globalThis, '__SHARDFILE_VERDICTS__'); });

/** A preparation-only build's table: it pins Pine at its engine-pinned revision beside another product. */
function table(): unknown[] {
  const rows = [{ path: '/shardfiles/pine-hollow/shard.json', indexHash: PINNED }, { path: '/shardfiles/driftwood/shard.json', indexHash: OTHER }];
  // a build's define reads `__SHARDFILE_VERDICTS__` as `globalThis.__WS_SHARDFILE_VERDICTS__`: one array under both names
  Reflect.set(globalThis, '__WS_SHARDFILE_VERDICTS__', rows); Reflect.set(globalThis, '__SHARDFILE_VERDICTS__', rows);
  return rows;
}
const inline = (slug: string): string => JSON.stringify({ identity: { slug, name: 'Pine Hollow' }, files: [] });
const options = (stale: () => Promise<void>): FolderOptions =>
  ({ base: 'http://127.0.0.1/shardfiles/pine-hollow/shard.json', built: { indexes: new Set([PINNED, OTHER]), stale } }) as unknown as FolderOptions;

test('OF23a: a pinned product\'s new candidate reads as a stale client until the page releases it', async () => {
  table();
  const stale = vi.fn(() => Promise.resolve());
  await expect(checkBuiltIndex(CANDIDATE, options(stale))).rejects.toThrow(/older than the shard/u);
  expect(stale).toHaveBeenCalledOnce();
});

test('OF23a: the inline candidate leaves the verdict table, so its own index admits it', async () => {
  const rows = table();
  expect(releaseInlineCandidate(inline('pine-hollow'))).toBe(1);
  expect(rows).toEqual([{ path: '/shardfiles/driftwood/shard.json', indexHash: OTHER }]);
  expect(builtIndexHash('/shardfiles/pine-hollow/shard.json')).toBeNull();
  expect(builtIndexHash('/shardfiles/driftwood/shard.json')).toBe(OTHER);
  const stale = vi.fn(() => Promise.resolve());
  await expect(checkBuiltIndex(CANDIDATE, options(stale))).resolves.toBeUndefined();
  expect(stale).not.toHaveBeenCalled();
});

test('OF23a: no inline shard, an unlisted slug or an unreadable one leaves the table whole', () => {
  const rows = table();
  expect(releaseInlineCandidate(null)).toBe(0);
  expect(releaseInlineCandidate(inline('sky-reach'))).toBe(0);
  expect(releaseInlineCandidate('{not json')).toBe(0);
  expect(releaseInlineCandidate(inline('../pine-hollow'))).toBe(0);
  expect(rows).toHaveLength(2);
});
