import {expect,test,vi} from 'vitest';
import {zlibSync} from 'fflate';
import {Scope} from '../src/shared/engine/app/scope';
import {App} from '../src/client/engine/app/app';
import {app} from '../src/client/engine/app/runtime';
import {Vector3} from 'three';
import type {ShardContext} from '../src/client/game/plugin/context';
import type {ShardRuntime} from '../src/shared/game/shard/runtime';
import {createShardProduct} from '../src/shared/game/shardfile/shardProduct';
import {emptyShardfile} from '../src/shared/host/author';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';
import {parseClientPlan} from '@wildshard/format/clientPlan';
import {installClientWildlife} from '../src/client/game/population/wildlifeFeature';
import { pageAir } from '../src/client/game/population/pageAir';
import { NALATI_HEADLESS_ASSEMBLY as headlessAssembly } from './fixtures/nalati-headless-assembly';
import {lendNalatiPasture} from './fixtures/nalati-return-modules';
import {prepareNalatiPopulation} from './fixtures/nalati-world';
import {fixtureJsonCheck,fixtureProductFile} from './fixtures/productFile';
import * as population from '../src/server/game/population/environment';
import * as riding from '../src/server/game/riding/native';
import type {SimHost} from '../src/server/engine/sim';
import type {BakedGrid} from '@wildshard/format/bakedTerrainBytes';

const wetFile='world/wet.bin',wetBytes=zlibSync(new Uint8Array(Float32Array.from([0,.5,.6,1]).buffer));
const pond={type:'f32',count:4,data:{file:'data/geography-pond.bin'}};
const feature=parseClientPlan({version:1,features:[{kind:'population.wildlife',file:'actors/wildlife.json',
  crowd:{json:'actors/crowd.json',binary:'actors/crowd.bin'},navSteer:true,frame:{id:'wildlife',after:[],before:[]}}]}).features[0];

function wildlife(owner:Scope,read:()=>Promise<Uint8Array>){
  owner.expose(app,'levelScope',owner);lendNalatiPasture(owner);
  const worldRows={res:2,size:32,water:-1,wet:{type:'f32',count:4,data:{file:wetFile}},pond};
  const original=headlessAssembly.constants.pageWildlife,rows={...original,groups:{...original.groups,world:worldRows}};
  const reads:string[]=[],systems=vi.fn<ShardContext['system']>();
  const source=emptyShardfile({slug:'wet-loan',name:'Wet loan',author:'Fixture',revision:1,seed:7});
  const product=createShardProduct({slug:'wet-loan',revision:1,jsonCheck:fixtureJsonCheck,shardfile:source,sections:new Map(),
    files:new Map([['actors/wildlife.json',fixtureProductFile('actors/wildlife.json',{hash:'rows',url:'/rows'})],[wetFile,{hash:'wet',url:'/wet'}]]),read:hash=>{
      reads.push(hash);if(hash==='rows')return Promise.resolve(new TextEncoder().encode(JSON.stringify(rows)));if(hash==='wet')return read();throw new Error('Unexpected product read');
    }});
  const runtime=legacyDouble<ShardRuntime>({hooks:{},world:legacyDouble<NonNullable<ShardRuntime['world']>>({
    game:legacyDouble<NonNullable<ShardRuntime['world']>['game']>({levelScope:owner}),player:legacyDouble<NonNullable<ShardRuntime['world']>['player']>({position:new Vector3()})})});
  const context=legacyDouble<ShardContext>({scope:owner,app:new App(),product,system:systems,game:legacyDouble<ShardContext['game']>({runtime})});
  return {context,runtime,reads,systems};
}

test('wildlife lends its named wet block once before binding or publishing the animal stage',async()=>{
  if(feature===undefined)throw new Error('Missing wildlife feature');
  const scope=new Scope('wet.product'),f=wildlife(scope,()=>Promise.resolve(wetBytes)),stop=new Error('verified group boundary');
  const bind=vi.spyOn(pageAir,'enter').mockImplementation((_scope,_rows,block)=>{
    expect(block?.file).toBe(wetFile);expect(block?.bytes).toBe(wetBytes);throw stop;
  });
  try{
    await expect(installClientWildlife(f.context,feature)).rejects.toBe(stop);
    expect(f.reads).toEqual(['rows','wet']);expect(bind).toHaveBeenCalledOnce();expect(f.systems).not.toHaveBeenCalled();
    expect(f.runtime.hooks.animalsBuilt).toBeUndefined();
  }finally{scope.dispose();bind.mockRestore();}
});

for(const changed of ['ancestor','world','runtime'] as const){
  test(`wet product loan refuses ${changed} retirement before group binding`,async()=>{
    if(feature===undefined)throw new Error('Missing wildlife feature');
    const root=new Scope('wet.root'),owner=root.child('entered');let finish:(bytes:Uint8Array)=>void=()=>undefined,started:()=>void=()=>undefined;
    const pending=new Promise<Uint8Array>(resolve=>{finish=resolve;}),reading=new Promise<void>(resolve=>{started=resolve;});
    const f=wildlife(owner,()=>{started();return pending;}),bind=vi.spyOn(pageAir,'enter');
    try{
      const install=installClientWildlife(f.context,feature);await reading;
      if(changed==='ancestor')root.disposeSteps().next();else if(changed==='world')f.runtime.world=null;else Object.defineProperty(f.context.game,'runtime',{value:null});
      finish(wetBytes);await expect(install).rejects.toThrow('owner left during wet preparation');
      expect(f.reads).toEqual(['rows','wet']);expect(bind).not.toHaveBeenCalled();expect(f.systems).not.toHaveBeenCalled();expect(f.runtime.hooks.animalsBuilt).toBeUndefined();
    }finally{root.dispose();bind.mockRestore();}
  });
}

test('native preparation lends one verified wet block to both existing native owners',async()=>{
  const grid:BakedGrid={res:2,size:32,seed:7,landscapeHash:0,heights:new Float32Array(4),splat:new Uint8Array(16),undergrowth:null};
  const fieldRows={seed:7,world:{res:2,size:32,water:-1,wet:{type:'f32',count:4,data:{file:wetFile}},pond},trails:[],
    river:{from:-16,step:32,values:[[8,1],[8,1]]},meadow:{short:[],tall:[],bare:[],valley:.5,plateau:.6}};
  const reads:string[]=[],OriginalField=population.NativePopulationField;
  const field=vi.spyOn(population,'NativePopulationField').mockImplementation(class extends OriginalField{}),stop=new Error('native mounted boundary');
  const mount=vi.spyOn(riding,'installMountedPlayer').mockImplementation(()=>{throw stop;});
  try{
    const prepared=await prepareNalatiPopulation({file:name=>{reads.push(name);return Promise.resolve(wetBytes);}},grid,{nativeField:fieldRows},{trees:[],tops:[]});
    const host=legacyDouble<SimHost>({}),profile={world:fieldRows.world};expect(()=>prepared.installMounted(host,profile)).toThrow(stop);
    const loan=field.mock.calls[0]?.[5];expect(loan?.file).toBe(wetFile);expect(loan?.bytes).toBe(wetBytes);expect(mount.mock.calls[0]?.[3]).toBe(loan);
    expect(reads).toEqual(['data/geography-pond.bin',wetFile]);expect(prepared.field.hunt.wetAt(16,16)).toBe(true);
  }finally{field.mockRestore();mount.mockRestore();}
});

test('a failed named wet read publishes no group, frame or animal stage',async()=>{
  if(feature===undefined)throw new Error('Missing wildlife feature');
  const scope=new Scope('wet.unavailable'),error=new Error('wet product unavailable'),f=wildlife(scope,()=>Promise.reject(error));
  const bind=vi.spyOn(pageAir,'enter');
  try{
    await expect(installClientWildlife(f.context,feature)).rejects.toBe(error);
    expect(f.reads).toEqual(['rows','wet']);expect(bind).not.toHaveBeenCalled();expect(f.systems).not.toHaveBeenCalled();expect(f.runtime.hooks.animalsBuilt).toBeUndefined();
  }finally{scope.dispose();bind.mockRestore();}
});
