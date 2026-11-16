import {expect,test,vi} from 'vitest';
import * as v from 'valibot';
import {WorldAssemblySchema} from '@wildshard/format/worldAssembly';
import {Scene,Group} from 'three';
import {Scope} from '../src/shared/engine/app/scope';
import type {Game} from '../src/client/engine/core/Game';
import type {StepRunner} from '../src/client/engine/boot/plan';
import {parseClientPlan} from '@wildshard/format/clientPlan';
import type {ShardContext} from '../src/client/game/plugin/context';
import type {ShardWorld} from '../src/server/game/shard/world';
import type {ShardRuntime} from '../src/shared/game/shard/runtime';
import {createShardFolder} from '../src/shared/game/shardfile/shardFolder';
import {installClientWorldAssembly} from '../src/client/game/shardfile/clientWorldAssembly';
import {preflightIslandBook} from '../src/client/game/shardfile/islandBook';
import {WorldAssembly} from '../src/client/game/shardfile/worldAssembly';
import {entryOwner} from '../src/shared/game/shardfile/entryOwners';
import type {FixedDraws} from '../src/client/game/models/fixedDraws';
import {emptyShardfile} from '../src/shared/host/author';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';

const rows={construction:{prelude:{draws:'models/book.json'},seed:1,progress:{kind:'checkpoints',total:1,finish:'Assembly',budgetMs:0},checkpoints:[]},stages:[{kind:'fixed-draws',id:'shapes'}]};
function fixture(){
  const parent=new Scope('native-assembly'),scope=parent.child('entered'),construction=parent.child('world');
  const source=emptyShardfile({slug:'orchard',name:'Orchard',author:'Fixture',revision:1,seed:1});
  const product=createShardFolder({slug:'orchard',revision:1,shardfile:source,sections:new Map(),files:new Map([['models/book.json',{hash:'book',url:'/book'}]]),read:()=>Promise.reject(new Error('Unexpected read'))});
  const steps:string[]=[],progress={set:vi.fn(),detail:vi.fn()};
  const step:StepRunner=(key,work)=>{steps.push(key);return Promise.resolve(work(progress));};
  const game=legacyDouble<Game>({levelScope:construction,scene:new Scene()});
  const world=legacyDouble<ShardWorld>({game}),surface={world,step},runtime=legacyDouble<ShardRuntime>(surface);
  const context={scope,product,game:legacyDouble<ShardContext['game']>({runtime})},ctx=legacyDouble<ShardContext>(context);
  const row=parseClientPlan({version:1,features:[{kind:'world.assembly',native:{groups:'orchard.world'},rows}]}).features[0];
  if(row?.kind!=='world.assembly')throw new Error('Missing fixture assembly');
  const draws:FixedDraws={ready:true,load:()=>Promise.resolve(),handle:()=>{throw new Error('Unexpected draw');}},groups={garden:new Group()};
  const prepare=vi.spyOn(WorldAssembly,'prepareNative').mockResolvedValue(draws),construct=vi.spyOn(WorldAssembly,'construct').mockResolvedValue(groups);
  return{parent,scope,construction,product,ctx,context,surface,runtime,steps,progress,row,draws,groups,prepare,construct,close:()=>{prepare.mockRestore();construct.mockRestore();parent.dispose();}};
}

test('native assembly runs its counted steps once and publishes the original group bank',async()=>{
  const f=fixture();try{
    await installClientWorldAssembly(f.ctx,f.row);
    expect(f.steps).toEqual(['cabins','props']);
    expect(f.prepare).toHaveBeenCalledOnce();expect(f.prepare.mock.calls[0]?.[0]).toBe(f.row.rows);expect(f.prepare.mock.calls[0]?.[1]).toBe(f.ctx);
    expect(f.construct).toHaveBeenCalledOnce();const call=f.construct.mock.calls[0];if(call===undefined)throw new Error('Missing assembly call');
    expect(call[0]).toBe(f.row.rows);const ports=call[1];expect(ports.runtime).toBe(f.runtime);expect(ports.native).toBe(f.ctx);expect(ports.product).toBe(f.product);expect(ports.scope).toBe(f.scope);expect(ports.draws).toBe(f.draws);expect(ports.baked.size).toBe(0);expect(ports.progress).toBe(f.progress);
    expect(entryOwner(f.scope,'world-groups','orchard.world')).toBe(f.groups);
    await expect(installClientWorldAssembly(f.ctx,f.row)).rejects.toThrow('already constructed');
    expect(f.steps).toEqual(['cabins','props']);expect(f.construct).toHaveBeenCalledTimes(1);
  }finally{f.close();}
});

test.each(['world','scope','product'] as const)('native assembly refuses a changed %s after its prelude',async change=>{
  const f=fixture();try{
    f.prepare.mockImplementation(()=>{if(change==='world')f.surface.world=legacyDouble<ShardWorld>({});else if(change==='scope')f.construction.dispose();else f.context.product=legacyDouble<typeof f.product>({});return Promise.resolve(f.draws);});
    await expect(installClientWorldAssembly(f.ctx,f.row)).rejects.toThrow('owner left or changed');
    expect(f.construct).not.toHaveBeenCalled();expect(()=>entryOwner(f.scope,'world-groups','orchard.world')).toThrow();
  }finally{f.close();}
});

test('native assembly admits only its original prelude and distinct resource route',()=>{
  const f=fixture();try{
    expect(()=>parseClientPlan({version:1,features:[{...f.row,library:'other',catalogue:'other'}]})).toThrow('original context');
    const missing={...f.row,rows:v.parse(WorldAssemblySchema,{...rows,construction:{...rows.construction,prelude:{draws:'models/absent.json'}}})};
    expect(()=>preflightIslandBook(f.product,missing)).toThrow('admitted product file');
    expect(f.prepare).not.toHaveBeenCalled();expect(f.steps).toEqual([]);
  }finally{f.close();}
});
