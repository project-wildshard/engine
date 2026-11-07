import { expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { WorldRegistry } from '@wildshard/engine/world/registry';
import type { ShardContext } from './context';
import { bindClientPlaceSets, installClientPlaceSets, requireClientPlaceSetsBound } from '../shardfile/clientPlaceSets';
import * as workSlice from '@wildshard/engine/core/workSlice';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

function fixture() {
  const scope = new Scope('place-bind'), ctx = legacyDouble<ShardContext>({ scope, game: legacyDouble<ShardContext['game']>({ runtime: legacyDouble<NonNullable<ShardContext['game']['runtime']>>({ world: null }) }), product: legacyDouble<ShardContext['product']>({}), app: legacyDouble<ShardContext['app']>({ registry: new WorldRegistry() }) });
  return { scope, ctx };
}

test('registered rows are not a completed placement bind, including an empty set', async () => {
  const { scope, ctx } = fixture();
  try {
    expect(() => requireClientPlaceSetsBound(ctx)).toThrow('not finished');
    installClientPlaceSets(ctx, { kind: 'world.sets', rows: [] });
    expect(() => requireClientPlaceSetsBound(ctx)).toThrow('not finished');
    await bindClientPlaceSets(ctx, new Map(), []);
    expect(() => requireClientPlaceSetsBound(ctx)).not.toThrow();
  } finally { scope.dispose(); }
  expect(() => requireClientPlaceSetsBound(ctx)).toThrow('not finished');
});

test.each([false, true])('the final sliced registration must finish on its original live owner (retire: %s)', async retire => {
  const { scope, ctx } = fixture();
  let resume: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { resume = resolve; });
  const yielded = vi.spyOn(workSlice, 'buildYield').mockReturnValue(pending);
  try {
    installClientPlaceSets(ctx, { kind: 'world.sets', rows: [{ id: 'orchard', name: 'Orchard', place: 'orchard', file: 'fixture', pois: [], x: 0, z: 0, r: 5 }] });
    const running = bindClientPlaceSets(ctx, new Map(), []);
    expect(yielded).toHaveBeenCalledTimes(1);
    expect(() => requireClientPlaceSetsBound(ctx)).toThrow('not finished');
    if (retire) scope.dispose();
    if (resume === undefined) throw new Error('Missing yield resolver');
    resume();
    if (retire) { await expect(running).rejects.toThrow('owner ended'); expect(() => requireClientPlaceSetsBound(ctx)).toThrow('not finished'); }
    else { await running; expect(() => requireClientPlaceSetsBound(ctx)).not.toThrow(); }
  } finally { yielded.mockRestore(); scope.dispose(); }
});
