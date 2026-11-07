import { expect,test } from 'vitest';
import { Box3,Group,Vector3 } from 'three';
import type { Placed } from '@wildshard/engine/models/place';
import { WorldRegistry } from '@wildshard/engine/world/registry';
import { Scope } from '@wildshard/engine/app/scope';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import type { ShardContext } from './context';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { bindClientPlaceSets,installClientPlaceSets } from '../shardfile/clientPlaceSets';

const placement=(model:string,xs:number[]):Placed=>({model,object:new Group(),colliders:[],copies:xs.length,drawnAs:'instanced',cull:()=>undefined,registered:Promise.resolve(),nearest:()=>-1,
  copyBox:(index,target)=>{const x=xs[index];if(x===undefined)throw new Error('Missing fixture copy');return target.set(new Vector3(x-.5,0,-.5),new Vector3(x+.5,1,.5));}});

test('orchard rows bind whole groups and loose spatial views once without double counting shared placements',async()=>{
  const scope=new Scope('orchard-sets'),registry=new WorldRegistry(),ctx={} as ShardContext;Object.assign(ctx,{scope,app:{registry},product:{},game:legacyDouble<ShardContext['game']>({runtime:legacyDouble<NonNullable<ShardContext['game']['runtime']>>({world:null})})});
  const gate=placement('orchard/gate',[20,30]),trees=placement('orchard/tree',[0,20]),stones=placement('orchard/stone',[1,40]);
  const row=parseClientPlan({version:1,features:[{kind:'world.sets',rows:[
    {id:'gate',name:'Gate',place:'orchard/gate',file:'fixture',pois:['entrance'],x:100,z:0,r:1},
    {id:'meadow',name:'Meadow',place:'orchard/meadow',file:'fixture',x:0,z:0,r:3},
    {id:'empty',name:'Empty',place:'orchard/empty',file:'fixture',x:-100,z:0,r:1},
  ]}]}).features[0];if(row===undefined)throw new Error('Missing fixture row');
  registry.addSet({id:'external',name:'External',file:'fixture',members:[],bounds:new Box3()});
  installClientPlaceSets(ctx,row);expect(()=>installClientPlaceSets(ctx,row)).toThrow('already installed');
  await bindClientPlaceSets(ctx,new Map([['entrance',[gate]],['unclaimed',[trees]]]),[gate,trees,stones]);
  expect(registry.sets.map(set=>[set.id,set.members])).toEqual([
    ['external',[]],['gate',[{model:'orchard/gate',copies:2}]],['meadow',[{model:'orchard/tree',copies:1},{model:'orchard/stone',copies:1}]],
  ]);
  expect(registry.pieces).toHaveLength(0);expect(gate.colliders).toHaveLength(0);
  await expect(bindClientPlaceSets(ctx,new Map(),[])).rejects.toThrow('unbound');
  scope.dispose();expect(registry.sets.map(set=>set.id)).toEqual(['external']);
});
