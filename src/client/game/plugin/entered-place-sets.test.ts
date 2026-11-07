import { expect,test,vi } from 'vitest';
import { Group,Vector3 } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import type { Placed } from '@wildshard/engine/models/place';
import { WorldRegistry } from '@wildshard/engine/world/registry';
import type { ShardContext } from './context';
import type { QuestPageComposition } from '../quest/pageComposition';
import { bindEnteredClientPlaceSets,installClientPlaceSets,requireClientPlaceSetsBound } from '../shardfile/clientPlaceSets';
import { lendEntryOwner,publishEntryOwner } from '../../../shared/game/shardfile/entryOwners';
import * as workSlice from '@wildshard/engine/core/workSlice';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

const placed=(model:string):Placed=>({model,object:new Group(),colliders:[],copies:1,drawnAs:'single',cull:()=>undefined,registered:Promise.resolve(),nearest:()=>-1,
  copyBox:(_index,target)=>target.set(new Vector3(-.5,0,-.5),new Vector3(.5,1,.5))});
function fixture(){
  const scope=new Scope('entered-sets'),registry=new WorldRegistry(),ctx=legacyDouble<ShardContext>({scope,game:legacyDouble<ShardContext['game']>({runtime:legacyDouble<NonNullable<ShardContext['game']['runtime']>>({world:null})}),product:legacyDouble<ShardContext['product']>({}),app:legacyDouble<ShardContext['app']>({registry})});
  installClientPlaceSets(ctx,{kind:'world.sets',rows:[
    {id:'wreck',name:'Wreck',place:'wreck',file:'fixture',pois:['wreck'],x:100,z:0,r:1},
    {id:'nearby',name:'Nearby',place:'nearby',file:'fixture',pois:[],x:0,z:0,r:10},
  ]});
  return {scope,registry,ctx};
}

test('entered bindings borrow declared arrays in order, then quest zipline and kit',async()=>{
  const {scope,registry,ctx}=fixture();
  try{
    const wreck=placed('wreck'),cove=placed('cove');
    publishEntryOwner(scope,'placed','pier',[placed('pier')]);
    publishEntryOwner(scope,'placed','wreck',[wreck]);publishEntryOwner(scope,'placed','cove',[cove]);
    publishEntryOwner(scope,'quest','adventure',legacyDouble<QuestPageComposition>({zipline:legacyDouble<NonNullable<QuestPageComposition['zipline']>>({placed:placed('zipline')}),kit:legacyDouble<QuestPageComposition['kit']>({placed:[placed('kit-0'),placed('kit-1')]})}));
    await bindEnteredClientPlaceSets(ctx,{placed:['pier','wreck','cove'],groups:[{id:'wreck',placed:['wreck','cove']}],quest:'adventure'});
    expect(registry.sets.map(row=>row.members.map(member=>member.model))).toEqual([['wreck','cove'],['pier','zipline','kit-0','kit-1']]);
    expect(registry.pieces).toHaveLength(0);expect(()=>requireClientPlaceSetsBound(ctx)).not.toThrow();
    await expect(bindEnteredClientPlaceSets(ctx,{placed:[],groups:[]})).rejects.toThrow('unbound');
  }finally{scope.dispose();}
});

test('all group and quest loans preflight before the first bind effect',async()=>{
  const {scope,registry,ctx}=fixture();
  try{
    publishEntryOwner(scope,'placed','pier',[placed('pier')]);
    await expect(bindEnteredClientPlaceSets(ctx,{placed:['pier'],groups:[{id:'wreck',placed:['missing']}]})).rejects.toThrow('Missing live entry owner');
    await expect(bindEnteredClientPlaceSets(ctx,{placed:['pier'],groups:[],quest:'missing'})).rejects.toThrow('Missing live entry owner');
    await expect(bindEnteredClientPlaceSets(ctx,{placed:[],groups:[{id:'repeat',placed:[]},{id:'repeat',placed:[]}]})).rejects.toThrow('Repeated named-place group');
    expect(registry.sets).toHaveLength(0);expect(()=>requireClientPlaceSetsBound(ctx)).toThrow('not finished');
    await bindEnteredClientPlaceSets(ctx,{placed:['pier'],groups:[]});
    expect(()=>requireClientPlaceSetsBound(ctx)).not.toThrow();
  }finally{scope.dispose();}
});

test.each([false,true])('a lost placement loan or entered retirement stops the next sliced bind (entered: %s)',async retireEntered=>{
  const {scope,registry,ctx}=fixture(),construction=new Scope('construction');
  let resume:(()=>void)|undefined;
  const yieldSpy=vi.spyOn(workSlice,'buildYield').mockImplementationOnce(()=>new Promise<void>(resolve=>{resume=resolve;}));
  try{
    // A scoped entered owner can also hold a loan from its construction ancestor.
    // Use its actual child scope rather than a detached resource cache.
    const entered=construction.child('entered');
    const childCtx={...ctx,scope:entered};
    installClientPlaceSets(childCtx,{kind:'world.sets',rows:[
      {id:'first',name:'First',place:'first',file:'fixture',pois:[],x:0,z:0,r:10},
      {id:'second',name:'Second',place:'second',file:'fixture',pois:[],x:0,z:0,r:10},
    ]});
    publishEntryOwner(construction,'placed','pier',[placed('pier')]);lendEntryOwner(entered,construction,'placed','pier');
    const running=bindEnteredClientPlaceSets(childCtx,{placed:['pier'],groups:[]});
    expect(registry.sets).toHaveLength(1);expect(()=>requireClientPlaceSetsBound(childCtx)).toThrow('not finished');
    if(retireEntered)entered.dispose();else construction.dispose();
    if(resume===undefined)throw new Error('Binding did not yield');resume();
    await expect(running).rejects.toThrow('ended');
    expect(registry.sets).toHaveLength(0);expect(yieldSpy).toHaveBeenCalledTimes(1);
    expect(()=>requireClientPlaceSetsBound(childCtx)).toThrow('not finished');
  }finally{yieldSpy.mockRestore();scope.dispose();construction.dispose();}
});


test.each(['scope','product','registry','world'] as const)('a redirected %s stops the next place-set effect and cleans the original registry', async changed => {
  const { scope, registry, ctx } = fixture(), foreign = new Scope('foreign-bind');
  const replacement = new WorldRegistry();
  publishEntryOwner(scope, 'placed', 'wreck', [placed('wreck')]);
  publishEntryOwner(scope, 'placed', 'pier', [placed('pier')]);
  let resume: (() => void) | undefined;
  const held = vi.spyOn(workSlice, 'buildYield').mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
  try {
    const binding = bindEnteredClientPlaceSets(ctx, { placed: ['wreck','pier'], groups: [{ id: 'wreck', placed: ['wreck'] }] });
    expect(registry.sets).toHaveLength(1);
    if (changed === 'scope') Object.assign(ctx, { scope: foreign });
    if (changed === 'product') Object.assign(ctx, { product: legacyDouble<ShardContext['product']>({}) });
    if (changed === 'registry') Object.assign(ctx.app, { registry: replacement });
    if (changed === 'world') {
      const runtime = ctx.game.runtime;
      if (runtime === undefined) throw new Error('Missing fixture runtime');
      runtime.world = legacyDouble<NonNullable<typeof runtime.world>>({});
    }
    if (resume === undefined) throw new Error('Missing held bind');
    resume(); await expect(binding).rejects.toThrow();
    expect(registry.sets).toHaveLength(1); expect(replacement.sets).toHaveLength(0);
    scope.dispose(); expect(registry.sets).toHaveLength(0);
  } finally { held.mockRestore(); scope.dispose(); foreign.dispose(); }
});
