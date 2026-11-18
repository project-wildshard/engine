import { expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import type { ShardContext } from '../src/client/game/plugin/context';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { installClientPhase, admitClientPlan } from '../src/client/game/shardfile/clientPlan';
import * as places from '../src/client/game/shardfile/clientPlaceSets';
import * as continuation from '../src/client/game/quest/continuation';
import { emptyShardfile } from '../src/shared/host/author';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

const binding = { kind: 'world.bind-sets', placed: ['orchard.pier'], groups: [{ id: 'shore', placed: ['orchard.pier'] }] };
function fixture(tier?: 'small' | 'large') {
  const scope = new Scope('place-capability');
  const source = emptyShardfile({ slug: 'orchard', name: 'Orchard', author: 'Fixture', revision: 1, seed: 7 });
  if (tier !== undefined) source.budgets = { ...source.budgets, tier };
  const product = createShardFolder({ slug: source.identity.slug, revision: 1, shardfile: source,
    sections: new Map(), files: new Map(), read: () => Promise.reject(new Error('No fixture reads')) });
  return { scope, product, ctx: legacyDouble<ShardContext>({ scope, product }) };
}

test('finite binding rows refuse paths, callbacks and duplicate group identities', () => {
  for (const row of [{ ...binding, placed: [{ owner: 'world', path: ['pier'] }] },
    { ...binding, groups: [{ id: 'shore', placed: [] }, { id: 'shore', placed: [] }] },
    { ...binding, run: () => undefined }]) expect(() => parseClientPlan({ version: 1, features: [row] })).toThrow();
  const f = fixture();
  try {
    expect(() => admitClientPlan({ version: 1, features: [binding] }, f.product)).toThrow('declared sets');
    expect(() => admitClientPlan({ version: 1, features: [{ kind: 'world.sets', rows: [] }, { ...binding, quest: 'missing' }] }, f.product)).toThrow('declared quest');
  } finally { f.scope.dispose(); }
});

test('owned stages refuse oversized rows at the product tier before installing world state', () => {
  const small = fixture('small'), large = fixture('large');
  const rows = Array.from({ length: 128 }, (_, i) => ({
    place: 'orchard', id: 'spot-' + i, name: 'Spot', file: 'spots.json',
    pois: ['one', 'two', 'three'], x: 0, z: 0, r: 1,
  }));
  const input = { version: 1, features: [{ kind: 'world.sets', rows }] };
  try {
    expect(() => admitClientPlan(input, small.product)).toThrow(/world.sets.*tier limit of 1000/u);
    expect(admitClientPlan(input, large.product).features).toHaveLength(1);
  } finally { small.scope.dispose(); large.scope.dispose(); }
});

test('unordered declared play waits for the actual binding before continuation', async () => {
  const f = fixture(), order: string[] = [];
  let finish: (() => void) | undefined, signal: (() => void) | undefined;
  const reached = new Promise<void>(resolve => { signal = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const bind = vi.spyOn(places, 'bindEnteredClientPlaceSets').mockImplementation(async () => {
    order.push('bind:start'); if (signal === undefined) throw new Error('Missing bind signal'); signal();
    await pending; order.push('bind:complete');
  });
  const effects = vi.spyOn(continuation, 'installQuestContinuationFile').mockImplementation(() => { order.push('continue'); return Promise.resolve(); });
  try {
    const plan = parseClientPlan({ version: 1, features: [{ kind: 'quest.continuation', file: 'continuation.json' }, binding] });
    const running = installClientPhase(f.ctx, plan, 'play', f.scope, 'entered');
    await reached; expect(order).toEqual(['bind:start']);
    if (finish === undefined) throw new Error('Missing binding completion'); finish();
    await running; expect(order).toEqual(['bind:start', 'bind:complete', 'continue']);
  } finally { bind.mockRestore(); effects.mockRestore(); f.scope.dispose(); }
});
