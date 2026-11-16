// @vitest-environment happy-dom
import {expect,test,vi} from 'vitest';
import {Vector3} from 'three';
import {Scope} from '../src/shared/engine/app/scope';
import {Events} from '../src/shared/engine/events/events';
import {CLIENT_FEATURES} from '../src/client/game/shardfile/clientPlan';
import {parseClientPlan} from '@wildshard/format/clientPlan';
import {installCombatTargets} from '../src/client/game/shardfile/clientTargets';
import {publishEntryOwner} from '../src/shared/game/shardfile/entryOwners';
import type {ShardContext} from '../src/client/game/plugin/context';
import type {ShardRuntime} from '../src/shared/game/shard/runtime';
import type {TimedEncounters} from '../src/client/game/boss/timedEncounters';
import type {ArenaRoomEncounter} from '../src/client/game/boss/arenaRoom';
import type {ForestWeatherRig} from '../src/client/game/weather/forest';
import {SceneDressing} from '../src/client/game/shardfile/sceneDressing';
import * as population from '../src/shared/game/population/wildlifeOwner';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';
import {emptyShardfile} from '../src/shared/host/author';
import {createShardFolder} from '../src/shared/game/shardfile/shardFolder';

function fixture(){
 const scope=new Scope('declared-targets'),events=new Events(),calls:string[]=[],objects:Record<string,unknown>={};
 const runtime=legacyDouble<ShardRuntime>({objects}),expose=vi.fn<ShardContext['debug']['expose']>();
 const source=emptyShardfile({slug:'debug-fixture',name:'Debug fixture',author:'Fixture',revision:1,seed:7});
 const product=createShardFolder({slug:source.identity.slug,revision:1,shardfile:source,sections:new Map(),files:new Map(),read:()=>Promise.reject(new Error('No debug read expected'))});
 const ctx=legacyDouble<ShardContext>({scope,product,app:legacyDouble<ShardContext['app']>({events}),game:legacyDouble<ShardContext['game']>({runtime}),debug:{expose}});
 const heart={alive:true,position:new Vector3(2,3,4)},riders=legacyDouble<TimedEncounters['riders']>({});
 const night=legacyDouble<TimedEncounters>({riders,target(_o,_d,_m,hit){expect(this).toBe(night);calls.push('night');return hit;}});
 const arena=legacyDouble<ArenaRoomEncounter>({target(_o,_d,_m,hit){expect(this).toBe(arena);calls.push('arena');return hit;},lockTarget(){expect(this).toBe(arena);return heart;}});
 publishEntryOwner(scope,'timed-encounters','orchard.night',night);publishEntryOwner(scope,'arena-room','orchard.arena',arena);
 return{scope,events,calls,ctx,objects,expose,heart,riders,night,arena};
}
const targetRows={kind:'combat.targets',rows:{ray:{result:'copy',sources:['night','arena']},aim:{exclude:[{field:'hidden',equals:1}],append:['arena']}},bindings:[{id:'night',kind:'timed-encounters',owner:'orchard.night'},{id:'arena',kind:'arena-room',owner:'orchard.arena'}]} as const;

test('declared target bindings keep native receiver/order and aim identity on the existing reducer',()=>{
 const f=fixture();try{
  f.events.answer('combat.targets.ray',request=>{f.calls.push('prior');return request;},f.scope);
  installCombatTargets(f.ctx,targetRows.rows,targetRows.bindings);
  const request={origin:new Vector3(),dir:new Vector3(0,0,1),maxDist:20,hit:null},reply=f.events.ask('combat.targets.ray',request);
  expect(f.calls).toEqual(['prior','night','arena']);expect(reply).not.toBe(request);expect(f.events.ask('combat.aimTargets',[])).toEqual([f.heart]);
  expect(CLIENT_FEATURES['combat.targets']).toMatchObject({phase:'world-bindings',rank:0,lifetime:'entered'});
 }finally{f.scope.dispose();}
});

test('missing suffix bindings refuse before the native reducer or any registration',()=>{
 const f=fixture();try{
  expect(()=>installCombatTargets(f.ctx,targetRows.rows,[...targetRows.bindings,{id:'missing',kind:'arena-room',owner:'missing'}])).toThrow('Missing live entry owner');
  expect(f.events.census().answerers).toBe(0);expect(f.calls).toEqual([]);
  const getter=vi.fn(()=>'orchard.night');expect(()=>installCombatTargets(f.ctx,targetRows.rows,[{id:'night',kind:'timed-encounters',get owner(){return getter();}}])).toThrow('plain JSON');expect(getter).not.toHaveBeenCalled();
  expect(()=>installCombatTargets(f.ctx,targetRows.rows,[targetRows.bindings[0],targetRows.bindings[0]])).toThrow();
 }finally{f.scope.dispose();}
});

test('readiness borrows the original mutable population book before invoking targets',()=>{
 const f=fixture(),book={wildlife:null},borrow=vi.spyOn(population,'clientWildlifeState').mockReturnValue(book);try{
  installCombatTargets(f.ctx,{...targetRows.rows,ray:{...targetRows.rows.ray,requires:'population.wildlife'}},targetRows.bindings);
  f.events.ask('combat.targets.ray',{origin:new Vector3(),dir:new Vector3(0,0,1),maxDist:20,hit:null});expect(f.calls).toEqual([]);expect(borrow).toHaveBeenCalledOnce();expect(borrow.mock.calls[0]?.[0]).toBe(f.ctx);
 }finally{borrow.mockRestore();f.scope.dispose();}
});

test('declared debug sources expose the original native owners without a facade or another resource owner',async()=>{
 const f=fixture(),dressing=legacyDouble<SceneDressing>({}),weather=legacyDouble<ForestWeatherRig>({}),current=vi.spyOn(SceneDressing,'current').mockReturnValue(dressing),state={ready:true};
 f.objects['state']=state;publishEntryOwner(f.scope,'world-weather','orchard.weather',weather);
 const cases=[{source:{kind:'arena-room',owner:'orchard.arena'},value:f.arena},{source:{kind:'runtime-object',id:'state'},value:state},{source:{kind:'timed-riders',owner:'orchard.night'},value:f.riders},{source:{kind:'dressing'},value:dressing},{source:{kind:'world-weather',owner:'orchard.weather'},value:weather}];
 try{for(const entry of cases){
  const row=parseClientPlan({version:1,features:[{kind:'debug.expose',name:'fixture',source:entry.source}]}).features[0];if(row?.kind!=='debug.expose')throw new Error('Missing debug row');
  expect(CLIENT_FEATURES['debug.expose'].phaseFor?.(row)).toBe(entry.source.kind==='world-weather'?'play':'world-bindings');
  await CLIENT_FEATURES['debug.expose'].install(f.ctx,row,f.scope);expect(f.expose.mock.calls.at(-1)?.[1]).toBe(entry.value);
 }
 expect(()=>parseClientPlan({version:1,features:[{kind:'debug.expose',name:'invalid',objects:['state'],source:{kind:'dressing'}}]})).toThrow('one concrete source');
 f.scope.dispose();const row=parseClientPlan({version:1,features:[{kind:'debug.expose',name:'retired',source:{kind:'dressing'}}]}).features[0];if(row===undefined)throw new Error('Missing row');
 expect(()=>CLIENT_FEATURES['debug.expose'].install(f.ctx,row,f.scope)).toThrow('requires its runtime');
 }finally{current.mockRestore();f.scope.dispose();}
});
