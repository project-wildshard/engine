import { expect, test } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { clientRingCatalogue } from '../src/client/game/shardfile/tileContent';
import type { Shardfile } from '@wildshard/format/shardSchema';

function original(instances: ReadonlyMap<string, { readonly source: Shardfile }>): () => number {
  const observed = new Map<string, Shardfile['tiles']>(); let revision = 0;
  return () => {
    for (const [instance, entry] of instances) if (observed.get(instance) !== entry.source.tiles) {
      observed.set(instance, entry.source.tiles); revision++;
    }
    for (const instance of observed.keys()) if (!instances.has(instance)) { observed.delete(instance); revision++; }
    return revision;
  };
}
function source(seed: number): Shardfile { return emptyShardfile({ slug: 'revisions', name: 'Revisions', author: 'Test', seed, revision: 1 }); }

test('stationary, replaced, reordered and removed catalogues retain original content revisions', () => {
  const first = source(1), second = source(2), instances = new Map([['a', { source: first }], ['b', { source: second }]]);
  const expected = original(instances), actual = clientRingCatalogue(instances).revision;
  if (actual === undefined) throw new Error('Missing real catalogue revision');
  const compare = (): void => { expect(actual()).toBe(expected()); };
  compare(); compare();
  first.tiles = [...first.tiles]; compare(); compare();
  instances.delete('a'); instances.set('a', { source: first }); compare();
  instances.delete('b'); compare(); compare();
  instances.set('b', { source: source(3) }); compare();
  instances.clear(); compare(); compare();
});

test('live map mutation during a source read preserves visited order and original refusal recovery', () => {
  const run = (make: typeof original): { revisions: number[]; reads: string[] } => {
    const a = source(1), b = source(2), c = source(3), reads: string[] = [], revisions: number[] = [];
    const instances = new Map<string, { readonly source: Shardfile }>();
    let once = true, refuse = false;
    instances.set('a', { get source() {
      reads.push('a');
      if (once) { once = false; instances.delete('b'); instances.set('c', { get source() { reads.push('c'); return c; } }); }
      if (refuse) throw new Error('original source refusal');
      return a;
    } });
    instances.set('b', { source: b });
    const revision = make(instances);
    revisions.push(revision()); revisions.push(revision());
    refuse = true; expect(revision).toThrow('original source refusal');
    refuse = false; a.tiles = [...a.tiles]; revisions.push(revision());
    instances.delete('c'); revisions.push(revision());
    return { revisions, reads };
  };
  expect(run(instances => {
    const revision = clientRingCatalogue(instances).revision;
    if (revision === undefined) throw new Error('Missing real catalogue revision');
    return revision;
  })).toEqual(run(original));
});
