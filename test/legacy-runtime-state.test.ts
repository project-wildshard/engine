import { afterEach, beforeEach, expect, test } from 'vitest';
import { SaveStore } from '../src/shared/engine/saves/store';
import { Scope } from '../src/shared/engine/app/scope';
import { installRuntimeState } from '../src/shared/game/shardfile/runtimeState';
import { bindRuntimeState } from '../src/shared/game/plugin/runtimeRows';
import { installShards, shards } from '../src/client/game/shard/list';
import { sourceManifest, type ShardContext } from '../src/client/game/plugin/context';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { emptyShardfile } from '@wildshard/engine/host/author';
import { FIXTURE_RUNTIME_COST } from './fixtures/clientPlanRuntime';
// A five-field state source versus a twenty-field one: an explicit state-law fixture (LD6 retired the frozen Nine config
// it was copied from, and with it the copy's content-identity remap).
const base = emptyShardfile({ slug: 'state-fixture', name: 'State fixture', author: 'Test', revision: 1, seed: 1 });
const source = { ...base, runtime: { kind: 'client-plan' as const, cost: FIXTURE_RUNTIME_COST, binds: ['items' as const, 'state' as const] },
  state: { ...base.state, shared: Array.from({length:5},(_,id)=>({
  id:id+1,name:`native.fixture.${id}`,type:'string' as const,privacy:'host' as const,default:'{}',
})) } };
const addedFields = Array.from({length:15},(_,id)=>({
  id:id+100,name:`native.extra.${id}`,type:'f64' as const,privacy:'public' as const,default:0,min:-10000,max:10000,
}));

const modern = { ...source, identity: { ...source.identity, slug: 'nine-dragon-stack' },
  state: { ...source.state, shared: [...source.state.shared, ...addedFields] } };
let previous: ReturnType<typeof shards>;
beforeEach(() => {
  try { previous = shards(); } catch { previous = []; }
  installShards([sourceManifest(modern)]);
});
afterEach(() => { installShards(previous); });

function fixture() {
  const store = new SaveStore({ local: null, session: null });
  const scope = new Scope('legacy-state');
  const field = installRuntimeState(store, scope, modern, 'nine-dragon-stack', 'native.fixture.2', () => '{"modern":true}');
  return { store, scope, field };
}

test('the strict guard still refuses the observed twenty-to-five field change', () => {
  const { store, scope } = fixture();
  try {
    const before = JSON.stringify(store.inspectShard({ id: 'nine-dragon-stack' }));
    expect(() => installRuntimeState(store, scope, source, 'nine-dragon-stack', 'native.fixture.2', () => null))
      .toThrow('State change requires an explicit valid migration');
    expect(JSON.stringify(store.inspectShard({ id: 'nine-dragon-stack' }))).toBe(before);
  } finally { scope.dispose(); }
});

test('ordinary and unregistered suffix sources retain the strict refusal', () => {
  const { store, scope } = fixture();
  try {
    for (const slug of ['nine-dragon-stack', 'unregistered-legacy']) {
      const other = { ...source, identity: { ...source.identity, slug } };
      expect(() => bindRuntimeState({ app: legacyDouble<ShardContext['app']>({ saves: store }), scope }, other, 'native.fixture.2', () => null, 'nine-dragon-stack'))
        .toThrow('State change requires an explicit valid migration');
    }
    const region = bindRuntimeState({ app: legacyDouble<ShardContext['app']>({ saves: store }), scope }, source, 'native.fixture.2', () => null, 'native-region');
    region.write('{"region":true}');
    expect(bindRuntimeState({ app: legacyDouble<ShardContext['app']>({ saves: store }), scope }, source, 'native.fixture.2', () => null).read()).toBe('{}');
    expect(region.read()).toBe('{"region":true}');
  } finally { scope.dispose(); }
});
