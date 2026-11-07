import { sameRuntimeProfile } from '../src/shared/game/plugin/runtimeRows';
import { parseItems } from '@wildshard/format/items';
import { expect, test } from 'vitest';
import { encodeCanonicalJson } from '../src/shared/host/immutable';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardProduct } from '../src/shared/game/shardfile/shardProduct';
import { DRIFTWOOD as source } from './fixtures/driftwood-program';

const shardfile = emptyShardfile({ slug: 'sword-profiles-test', name: 'Sword', author: 'Wildshard', revision: 1, seed: 1 });
function context(items: unknown) {
  return { product: createShardProduct({ slug: shardfile.identity.slug, revision: 1, shardfile: { ...shardfile, items: parseItems(items) },
    sections: new Map([['combat/items', { items }]]), files: new Map(), check: true,
    read: () => Promise.reject(new Error('Sword profiles must already be admitted')) }) };
}

// The output writer sorts keys on the wire; item admission reconstructs schema order.
test('canonical section key order cannot change native sword admission', () => {
  const wire: unknown = JSON.parse(encodeCanonicalJson(source.items));
  const admitted = context(wire), profiles = admitted.product.shardfile.items.rows.flatMap(row => row.kind === 'weapon' && row.profile?.family === 'melee' ? [row.profile] : []);
  const installed = parseItems(wire).rows.filter(row => row.kind === 'weapon').map(row => row.profile);
  expect(profiles.map(profile => JSON.stringify(profile))).toEqual(installed.map(profile => JSON.stringify(profile)));
  const raw = admitted.product.section('combat/items').items.rows.filter(row => row.kind === 'weapon').map(row => row.profile);
  expect(raw).toEqual(profiles);
  expect(raw.map(profile => JSON.stringify(profile))).not.toEqual(installed.map(profile => JSON.stringify(profile)));
  expect(raw.every((profile, index) => sameRuntimeProfile(profile, installed[index]))).toBe(true);
  expect(profiles.map(profile => profile.damage)).toEqual([12, 28]);
  for (const profile of profiles) {
    expect(sameRuntimeProfile(profile, { ...profile, damage: profile.damage + 1 })).toBe(false);
    expect(sameRuntimeProfile(profile, { ...profile, moves: { ...profile.moves, combo: [...profile.moves.combo].reverse() } })).toBe(false);
  }
  expect(sameRuntimeProfile(undefined, profiles[0])).toBe(false);
});
