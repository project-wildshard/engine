import {expect,test,vi} from 'vitest';
import {Scope} from '../src/shared/engine/app/scope';
import type {SystemSpec} from '../src/client/engine/app/systems';
import {Events} from '../src/shared/engine/events/events';
import {practiceRoom} from '../src/client/engine/core/practiceRoom';
import type {DeclaredEliteEntry} from '../src/client/engine/ai/view/eliteEntry';
import type {Animal} from '../src/client/engine/entities/AnimalView';
import type {ArenaRoomEncounter} from '../src/client/game/boss/arenaRoom';
import type {TimedEncounters} from '../src/client/game/boss/timedEncounters';
import type {ShardContext} from '../src/client/game/plugin/context';
import type {ShardWorld} from '../src/server/game/shard/world';
import type {ShardRuntime} from '../src/shared/game/shard/runtime';
import {admitClientPlan} from '../src/client/game/shardfile/clientPlan';
import {createShardFolder,type ShardFolder} from '../src/shared/game/shardfile/shardFolder';
import {emptyShardfile} from '../src/shared/host/author';
import {installWorldUpdates} from '../src/client/game/shardfile/worldUpdates';
import {publishEntryOwner,type EliteEntryConstruction} from '../src/shared/game/shardfile/entryOwners';
import * as population from '../src/shared/game/population/wildlifeOwner';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';

const rows=[
 {kind:'arena-room',system:'fixture.titan',owner:'titan',riders:'night',before:[]},
 {kind:'elite-entry',system:'fixture.elites',owner:'elites',arena:'titan',night:'night',riding:'riding',hideHeadBars:true,before:[]},
 {kind:'arena-room',system:'fixture.room',owner:'room',indoors:true,before:[]},
 {kind:'timed-encounters',system:'fixture.night',owner:'night',pauseInPractice:true,before:[]},
];
function fixture(){
 const scope=new Scope('encounter-updates'),systems:SystemSpec[]=[],events=new Events(),calls:string[]=[],frames:unknown[]=[],receivers:unknown[]=[];
 const world=legacyDouble<ShardWorld>({game:legacyDouble<ShardWorld['game']>({})}),runtime=legacyDouble<ShardRuntime>({world});
 const ctx=legacyDouble<ShardContext>({scope,product:legacyDouble<ShardFolder>({}),game:legacyDouble<ShardContext['game']>({runtime}),
  system:spec=>{systems.push(spec);},answer:(key,run)=>{events.answer(key,run,scope);}});
 const titanState={engaged:false,riders:null as ArenaRoomEncounter['riders'],update(dt:number,t:number){receivers.push(this);calls.push(`titan:${dt}:${t}`);}},titan=legacyDouble<ArenaRoomEncounter>(titanState);
 const room=legacyDouble<ArenaRoomEncounter>({inside:true,update(dt,t){expect(this).toBe(room);calls.push(`room:${dt}:${t}`);}});
 const riders=legacyDouble<TimedEncounters['riders']>({killsTonight:7});
 const night=legacyDouble<TimedEncounters>({riders,update(dt,t){expect(this).toBe(night);calls.push(`night:${dt}:${t}`);}});
 const animal=legacyDouble<Animal>({mem:{}}),hide=vi.fn<()=>void>();
 const elite=legacyDouble<DeclaredEliteEntry>({bar:legacyDouble<NonNullable<DeclaredEliteEntry['bar']>>({hide}),scripts:[legacyDouble<DeclaredEliteEntry['scripts'][number]>({animal})],update(dt,t,frame){expect(this).toBe(elite);calls.push(`elites:${dt}:${t}`);frames.push(frame);}});
 publishEntryOwner(scope,'arena-room','titan',titan);publishEntryOwner(scope,'arena-room','room',room);publishEntryOwner(scope,'timed-encounters','night',night);
 publishEntryOwner(scope,'elite-entry','elites',legacyDouble<EliteEntryConstruction>({entry:elite}));
 const wildlife=vi.spyOn(population,'clientWildlife').mockReturnValue(null),originalPractice=practiceRoom.open;practiceRoom.open=false;
 return{scope,ctx,systems,events,calls,frames,receivers,titanState,titan,room,night,riders,animal,hide,close:()=>{wildlife.mockRestore();practiceRoom.open=originalPractice;scope.dispose();}};
}

test('encounter rows retain ordered receivers, late frame inputs, rider identity and indoor answers',()=>{
 const f=fixture();try{
  installWorldUpdates(f.ctx,rows);expect(f.titan.riders).toBe(f.riders);expect(f.events.ask('weather.indoors',.25)).toBe(1);
  for(const system of f.systems)system.run(.02,4);
  expect(f.systems.map(row=>row.id)).toEqual(['fixture.titan','fixture.elites','fixture.room','fixture.night']);
  expect(f.calls).toEqual(['titan:0.02:4','elites:0.02:4','room:0.02:4','night:0.02:4']);
  expect(f.receivers[0]).toBe(f.titan);expect(f.frames).toEqual([{patrolAvailable:true,herdAvailable:false,kills:7,bonded:false,mount:null}]);expect(f.animal.mem['noHeadBar']).toBe(1);
  f.titanState.engaged=true;f.systems[1]?.run(.1,5);expect(f.hide).toHaveBeenCalledTimes(1);expect(f.frames).toHaveLength(1);
  practiceRoom.open=true;f.systems[1]?.run(.1,6);f.systems[3]?.run(.1,6);expect(f.hide).toHaveBeenCalledTimes(2);expect(f.calls).toHaveLength(4);
 }finally{f.close();}
});

test('a missing suffix leaves rider linkage, indoor answers and registrations untouched',()=>{
 const f=fixture();try{
  expect(()=>installWorldUpdates(f.ctx,[...rows,{kind:'timed-encounters',owner:'missing',system:'missing',pauseInPractice:true,before:[]}])).toThrow('Missing live entry owner');
  expect(f.titan.riders).toBeNull();expect(f.events.ask('weather.indoors',.25)).toBe(.25);expect(f.systems).toEqual([]);
 }finally{f.close();}
});

test('retirement and method replacement refuse before another native frame',()=>{
 const f=fixture();try{
  installWorldUpdates(f.ctx,rows);f.titanState.update=()=>{throw new Error('Foreign frame');};
  expect(()=>f.systems[0]?.run(.1,1)).toThrow('Arena frame owner changed');expect(f.calls).toEqual([]);
  f.scope.dispose();expect(()=>f.systems[3]?.run(.1,2)).toThrow('owner left or changed');expect(f.calls).toEqual([]);
 }finally{f.close();}
});


test('non-toon update rows need no toon section while toon rows still require it',()=>{
 const source=emptyShardfile({slug:'orchard',name:'Orchard',author:'Fixture',revision:1,seed:1});
 const product=createShardFolder({slug:'orchard',revision:1,shardfile:source,sections:new Map(),files:new Map(),read:()=>Promise.reject(new Error('No reads'))});
 const plain={version:1,features:[{kind:'world.updates',rows:[{kind:'wind',system:'orchard.wind',before:[]}]}]};
 expect(admitClientPlan(plain,product).features).toEqual(plain.features);
 expect(()=>admitClientPlan({version:1,features:[{kind:'world.updates',rows:[{kind:'toon-look',system:'orchard.toon',look:'missing',before:[]}]}]},product)).toThrow('look/toon');
});
