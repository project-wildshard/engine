import {expect,test,vi} from 'vitest';
import {Vector3} from 'three';
import {ActorProjectionV2,type ActorProjectionContext} from '../src/server/game/population/actorProjectionV2';
import {ActorProjectionV2Schema,parseActorProjectionV2} from '@wildshard/format/actorProjectionV2';
import {createSimHost} from '../src/server/engine/sim';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import type {AnimalSim} from '../src/shared/engine/entities/AnimalSim';
import {fixtureBytes} from '@wildshard/engine/test/nativeBytes';
import {SIM_LEVEL} from './fixtures/sim-level/level';
import {namedJsonSchema} from '../src/shared/host/formatJsonSchema';
import {validateNamedJsonSchema} from '../src/shared/game/shardfile/customSchema';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';
import {titanPrograms as programme} from './fixtures/titanInlineWitness';

function rows(){return {program:programme.attack,step:{signal:'bossClamp',clock:'sampleAt',every:.2,
  columns:[{name:'fullHp',id:1,source:{kind:'memory',key:'capacity',default:{value:100}}},
    {name:'share',id:2,source:{kind:'memory',key:'share',default:{value:.3}}}],
  operations:[{kind:'memory',key:'strength',value:{kind:'channel',name:'hp'}},
    {kind:'memory',key:'sampleAt',value:{kind:'time'}}]}};}
async function fixture(){
  const rapier=await loadRapier(Uint8Array.from(fixtureBytes(new URL('../public/assets/physics/rapier.wasm',import.meta.url))));
  const first=SIM_LEVEL.entities[0];if(first===undefined)throw new Error('Missing fixture body');
  const host=createSimHost({...SIM_LEVEL,quests:[],entities:[first,{...first,id:'boar:2'}]},{rapier});
  const a=host.entities.get('boar:1'),b=host.entities.get('boar:2');if(a===undefined||b===undefined)throw new Error('Missing original bodies');
  const context=legacyDouble<ActorProjectionContext<AnimalSim>>({dt:.1,t:2,player:new Vector3(),calm:false});
  return {host,a,b,context};
}
test('independent rows run actual AS on ordered original native members without another continuation or clock',async()=>{
  const f=await fixture(),input=rows(),binding=new ActorProjectionV2('reed',input);
  const scope=f.host.scope;
  try{
    const source=input.step.columns[0];if(source===undefined)throw new Error('Missing column');source.source.default.value=999;
    for(const [slot,actor]of [f.a,f.b].entries()){
      const before=actor.snapshot();
      binding.step(actor,f.context,{scope,group:'reed.members',slot,identity:actor.entityId});
      expect(actor.snapshot()).toStrictEqual({...before,mem:{...before.mem,strength:30,sampleAt:2}});
      f.context.t=2.1;binding.step(actor,f.context,{scope,group:'reed.members',slot,identity:actor.entityId});
      expect(actor.mem['sampleAt']).toBe(2);f.context.t=2;
    }
    const snapshot=f.a.snapshot(),saved=JSON.stringify(snapshot);f.a.mem['strength']=0;f.a.restore(snapshot);
    expect(JSON.stringify(f.a.snapshot())).toBe(saved);
  }finally{scope.dispose();}
});
test('admission refuses executables, accessors, unknown selectors and missing declared outputs before native writes',async()=>{
  const input=rows();let reads=0;
  expect(()=>new ActorProjectionV2('reed',{...input,get step(){reads++;return input.step;}})).toThrow('JSON');expect(reads).toBe(0);
  expect(()=>parseActorProjectionV2({...input,extra:true})).toThrow();
  expect(()=>parseActorProjectionV2({...input,step:{...input.step,columns:[{id:1,name:'fullHp',source:()=>1}]}})).toThrow();
  expect(()=>parseActorProjectionV2({...input,step:{...input.step,operations:[{kind:'memory',key:'__proto__',value:{kind:'constant',value:1}}]}})).toThrow();
  const schema=namedJsonSchema(ActorProjectionV2Schema),bytes=new TextEncoder().encode(JSON.stringify(input));
  expect(validateNamedJsonSchema(schema,bytes)).toStrictEqual(input);
  const f=await fixture(),binding=new ActorProjectionV2('reed',input),before=f.a.snapshot();
  const nativeProgramme=binding.program(f.host.scope);if(nativeProgramme.prepare===undefined)throw new Error('Missing ABI2 preparation');
  const project=vi.spyOn(nativeProgramme,'prepare').mockReturnValue({values:{},accept:()=>undefined});
  try{expect(()=>binding.step(f.a,f.context,{scope:f.host.scope,group:'reeds',slot:0,identity:f.a.entityId})).toThrow('scalar');expect(f.a.snapshot()).toStrictEqual(before);}
  finally{project.mockRestore();f.host.scope.dispose();}
});
test('foreign identity, non-finite memory and sliced retirement refuse without changing native state',async()=>{
  const f=await fixture(),binding=new ActorProjectionV2('reed',rows()),owner={scope:f.host.scope,group:'reeds',slot:0,identity:f.a.entityId};
  try{
    const before=f.a.snapshot();expect(()=>binding.step(f.a,f.context,{...owner,identity:f.b.entityId})).toThrow('slot');expect(f.a.snapshot()).toStrictEqual(before);
    f.a.mem['capacity']=Number.NaN;expect(()=>binding.step(f.a,f.context,owner)).toThrow('Non-finite');expect(f.a.mem['strength']).toBeUndefined();delete f.a.mem['capacity'];
    const steps=f.host.scope.disposeSteps();steps.next();expect(()=>binding.step(f.a,f.context,owner)).toThrow('disposed');expect(f.a.snapshot()).toStrictEqual(before);for(const _step of steps){/* Complete original retirement. */}
  }finally{f.host.scope.dispose();}
});
