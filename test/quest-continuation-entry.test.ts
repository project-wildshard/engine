import { expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import type { ShardContext } from '../src/client/game/plugin/context';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { CLIENT_FEATURES, admitClientPlan, installClientPhase } from '../src/client/game/shardfile/clientPlan';
import * as continuation from '../src/client/game/quest/continuation';
import { emptyShardfile } from '../src/shared/host/author';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

function fixture(named = true) {
  const shardfile = emptyShardfile({ slug: 'continuation-fixture', name: 'Continuation', author: 'Fixture', revision: 1, seed: 1 });
  const files = new Map<string, { hash: string; url: string }>();
  if (named) files.set('continuation.json', { hash: 'continuation', url: '/continuation.json' });
  const product = createShardFolder({ slug: shardfile.identity.slug, revision: 1, shardfile, files, sections: new Map(), read: () => Promise.reject(new Error('No direct fixture read')) });
  const scope = new Scope('continuation-entry');
  return { scope, product, ctx: legacyDouble<ShardContext>({ scope, product }) };
}

test('continuation admission requires the named file before its compiled host can run', () => {
  const f = fixture(false), install = vi.spyOn(continuation, 'installQuestContinuationFile');
  try {
    expect(() => admitClientPlan({ version: 1, features: [{ kind: 'quest.continuation', file: 'continuation.json' }] }, f.product)).toThrow('admitted data file');
    expect(install).not.toHaveBeenCalled();
  } finally { f.scope.dispose(); install.mockRestore(); }
});

test('the finite continuation delegates its exact file before ordinary declared play rows', async () => {
  const f = fixture(), order: string[] = [];
  const install = vi.spyOn(continuation, 'installQuestContinuationFile').mockImplementation((ctx, file) => {
    expect(ctx).toBe(f.ctx); expect(file).toBe('continuation.json'); order.push('continuation'); return Promise.resolve();
  });
  const tail = vi.spyOn(CLIENT_FEATURES['debug.expose'], 'install').mockImplementation(() => { order.push('tail'); });
  try {
    const plan = admitClientPlan({ version: 1, features: [{ kind: 'debug.expose', name: 'fixture' }, { kind: 'quest.continuation', file: 'continuation.json' }] }, f.product);
    await installClientPhase(f.ctx, plan, 'play', f.scope);
    expect(order).toEqual(['continuation', 'tail']);
  } finally { f.scope.dispose(); install.mockRestore(); tail.mockRestore(); }
});
