// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { Vector3 } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { ShardRuntime } from '../src/shared/game/shard/runtime';
import { CLIENT_FEATURES } from '../src/client/game/shardfile/clientPlan';
import * as population from '../src/shared/game/population/wildlifeOwner';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

const row = parseClientPlan({version:1,features:[{kind:'population.wildlife',publish:'wildlife',file:'actors/wildlife.json',
  crowd:{json:'actors/crowd.json',binary:'actors/crowd.bin'},navSteer:true,frame:{id:'orchard.wildlife',after:[],before:[]}}]}).features[0];
function context(runtime: ShardRuntime | undefined) {
  const scope = new Scope('declared wildlife prerequisite');
  const game = legacyDouble<ShardContext['game']>({});
  Object.defineProperty(game, 'runtime', { get: () => runtime });
  const json = vi.fn(() => Promise.reject(new Error('No content read before world admission')));
  const species = vi.fn<ShardContext['rows']['species']>(), speciesLook = vi.fn<ShardContext['rows']['speciesLook']>();
  const ctx = legacyDouble<ShardContext>({ scope, game,
    product: legacyDouble<ShardContext['product']>({ json }), rows: legacyDouble<ShardContext['rows']>({ species, speciesLook }) });
  return { scope, ctx, json, species, speciesLook };
}
function makeRuntime(world: ShardRuntime['world'], step: ShardRuntime['step'], play: ShardRuntime['play']): ShardRuntime {
  return { world, step, play, interactables: [], overhead: [], hooks: {}, objects: {}, viewer: () => new Vector3(), horizonVeil: null };
}

test('declared publication refuses missing entered prerequisites before reads or wildlife lookup', async () => {
  if(row?.kind!=='population.wildlife')throw new Error('Missing wildlife row');
  const install=CLIENT_FEATURES['population.wildlife'].play?.install;if(install===undefined)throw new Error('Missing publication slot');
  const stepped=vi.fn(),step:NonNullable<ShardRuntime['step']>=()=>{stepped();return Promise.reject(new Error('Unexpected boot step'));};
  const world=legacyDouble<NonNullable<ShardRuntime['world']>>({}),play=legacyDouble<NonNullable<ShardRuntime['play']>>({});
  const capture=vi.spyOn(population,'clientWildlife');
  try{for(const owner of [undefined,makeRuntime(null,step,play),makeRuntime(world,null,play),makeRuntime(world,step,null)]){
    const f=context(owner);try{
      await expect(install(f.ctx,row,f.scope)).rejects.toThrow('entered world and play owner');
      expect(f.json).not.toHaveBeenCalled();expect(f.species).not.toHaveBeenCalled();expect(f.speciesLook).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();expect(stepped).not.toHaveBeenCalled();
    }finally{f.scope.dispose();}
  }}finally{capture.mockRestore();}
});

test('publication keeps the original wildlife identity after chapter view and retires only its alias', async () => {
  if(row?.kind!=='population.wildlife')throw new Error('Missing wildlife row');
  const feature=CLIENT_FEATURES['population.wildlife'].play;if(feature===undefined)throw new Error('Missing publication slot');
  const runtime=makeRuntime(legacyDouble<NonNullable<ShardRuntime['world']>>({}),()=>Promise.reject(new Error('Unexpected boot step')),legacyDouble<NonNullable<ShardRuntime['play']>>({}));
  const f=context(runtime),wildlife=legacyDouble<NonNullable<ReturnType<typeof population.clientWildlife>>>({}),capture=vi.spyOn(population,'clientWildlife').mockReturnValue(null);
  try{
    expect(feature.rank).toBeGreaterThan(CLIENT_FEATURES['quest.chapter-view'].rank);
    await expect(feature.install(f.ctx,row,f.scope)).rejects.toThrow('not been built');expect(runtime.objects).toEqual({});
    capture.mockReturnValue(wildlife);await feature.install(f.ctx,row,f.scope);
    expect(capture.mock.calls.at(-1)?.[0]).toBe(f.ctx);expect(runtime.objects['wildlife']).toBe(wildlife);
    f.scope.dispose();expect(runtime.objects['wildlife']).toBeUndefined();
    capture.mockClear();await expect(feature.install(f.ctx,row,f.scope)).rejects.toThrow('entered world and play owner');expect(capture).not.toHaveBeenCalled();
  }finally{capture.mockRestore();f.scope.dispose();}
});
