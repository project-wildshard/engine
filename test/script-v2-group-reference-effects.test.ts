import { beforeAll, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { Rng } from '../src/shared/engine/core/rng';
import { FlockBrain } from '../src/shared/engine/ai/flock';
import { CrowdTargets } from '../src/shared/game/shardfile/crowdRuntime';
import { GroupStepV2, type GroupStepReferenceV2 } from '../src/shared/engine/script/groupStepV2';
import type { V2ColumnOwners } from '../src/shared/engine/script/observationColumnsV2';
import { parseGroupStepV2, groupStepLayoutV2, GroupStepV2Schema } from '@wildshard/format/scriptGroupStepV2';
import { compileScriptV2 } from '../src/sharddev/bake/compileScriptV2';
import { v2CoreSource } from '../src/sharddev/as/wsV2';
import { namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';

const rows=parseGroupStepV2({bank:[{name:'calls',kind:'number'}],columns:[],members:1,signals:['step','bad','damage','prefix','storage'],actions:[
  {id:1,words:2,member:0,native:{kind:'memory',key:'applied'}},
  {id:2,words:4,reference:{word:0},native:{kind:'damage'}},
  {id:3,words:4,reference:{word:0},native:{kind:'stagger'}},
  {id:4,words:2,reference:{word:0},native:{kind:'health'}},
  {id:5,words:2,native:{kind:'grass',channel:'prefix'}},
],outputs:5,pages:1,fuel:400000});
let bytes:Uint8Array;
beforeAll(async()=>{
  bytes=await compileScriptV2(`import * as core from './sdk/as/wsV2';
    export function ws_abi():i32{return 2;}export function ws_io():i32{return 0;}
    export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return fuel;}
    export function ws_project(fuel:i32):i32{core.beginState();assert(core.beginBinding(0));
      core.setState(0,core.state(0)+1+core.random(1));const signal=i32(core.parameter(0));
      if(signal==4)core.pageOutput(5,1,2);core.pageOutput(1,0,1);
      core.pageOutput(2,33,5,.6,-.8);
      if(signal!=3){core.pageOutput(3,33,.6,-.8,.4);core.pageOutput(4,signal==2?999:33,7);}
      core.endBinding();return fuel;}`,{lane:'project',ioBytes:groupStepLayoutV2(rows).bytes,sources:{'sdk/as/wsV2.ts':v2CoreSource(0)}});
});
function actor(id:string):AnimalSim {
  const body=new AnimalSim({kind:'sample',label:'Sample',variant:'plain',rarity:'common',hp:20,aggressive:false,
    dims:{bodyY:.6,bodyHalfLen:.5,bodyRadius:.3,headRadius:.2,legLen:.5,feet:[],halfWidth:.3},
    mods:{speed:1,chargeDist:1,damageTaken:1,chargeDamage:5,relentless:false}},1,1,id,{heightAt:()=>0,random:()=>.5});
  body.position.set(4,2,6);return body;
}
function fixture(){
  const parent=new Scope('reference-effects-parent'),scope=parent.child('group'),self=actor('self'),target=actor('target'),other=actor('other'),random=new Rng(19);
  const reference:GroupStepReferenceV2={group:'other',slot:0,identity:target.entityId,wire:'other/target',handle:33,body:target};
  const references:GroupStepReferenceV2[]=[reference];
  const member:V2ColumnOwners={scope,self:{group:'sample',slot:0,identity:self.entityId,actor:self},player:{position:new Vector3()},observed:new Map(),t:1,dt:.1};
  const members=[member],state=Float64Array.of(0),log:unknown[]=[],grass={grassHeightAt:(x:number,z:number)=>{log.push([x,z]);return 3;}};
  const native={scope,members,references,grass},runner=new GroupStepV2(bytes,rows,scope),input={group:'sample',handle:1,signal:'step',tick:1,state,members,references,random};
  return{parent,scope,self,target,other,random,reference,references,member,members,state,log,grass,native,runner,input};
}
test('actual AS reference effects match original native damage, stagger and health in emitted order',()=>{
  const f=fixture();
  try{
    const before=f.target.snapshot(),oracle=actor('target');oracle.restore(before);
    const prepared=f.runner.prepare(f.input).prepareNative(f.native);expect(f.target.snapshot()).toStrictEqual(before);expect(f.self.mem['applied']).toBeUndefined();
    oracle.applyDamage(5,oracle.position,new Vector3(.6,0,-.8));oracle.stagger(new Vector3(.6,0,-.8),.4);oracle.hp=7;
    expect(prepared.accept()).toStrictEqual([]);expect(f.target.snapshot()).toStrictEqual(oracle.snapshot());
    expect(JSON.stringify(f.target.snapshot())).toBe(JSON.stringify(oracle.snapshot()));expect(f.self.mem['applied']).toBe(1);expect(f.state[0]).toBeGreaterThan(1);
  }finally{f.parent.dispose();}
});
test('the original crowd prey damage authority is lent without AnimalSim storage',()=>{
  const f=fixture(),flock=new FlockBrain({heightAt:()=>0,normalY:()=>1,inBounds:()=>true,wetAt:()=>false,playerCrouched:()=>false,
    grassHeightAt:()=>.2,trample:()=>undefined,centre:()=>undefined},
  {x:20,z:-30,count:3,seed:9,range:25,runSpeed:6,walkSpeed:1.2,grazeStep:.3,bleatCue:'call'});
  flock.initialize();const targets=new CrowdTargets(flock,{preyY:1.4,hits:[[0,1.4,.65]]}),prey=targets.prey(1),before=flock.snapshot();
  try{
    f.references[0]={group:'crowd',slot:1,identity:'crowd/1',wire:'crowd/1',handle:33,body:prey,pose:true};
    prey.applyDamage();const expected=flock.snapshot();flock.restore(before);
    const prepared=f.runner.prepare({...f.input,signal:'damage'}).prepareNative(f.native);expect(flock.snapshot()).toBe(before);
    prepared.accept();expect(flock.snapshot()).toBe(expected);expect(prey.alive).toBe(false);
    flock.restore(before);const state=f.state.slice(),rng=f.random.snapshot();
    expect(()=>f.runner.prepare({...f.input,signal:'storage'}).prepareNative(f.native)).toThrow('actor storage');
    expect(flock.snapshot()).toBe(before);expect(f.state).toStrictEqual(state);expect(f.random.snapshot()).toStrictEqual(rng);
  }finally{f.parent.dispose();}
});
test('unknown or foreign reference and malformed suffix publish no member prefix, damage, state or RNG',()=>{
  const f=fixture();
  try{
    const target=f.target.snapshot(),self=f.self.snapshot(),state=f.state.slice(),rng=f.random.snapshot();
    expect(()=>f.runner.prepare({...f.input,signal:'bad'})).toThrow('reference');
    const ready=f.runner.prepare(f.input);
    expect(()=>ready.prepareNative({...f.native,references:[{...f.reference,body:f.other}]})).toThrow('scope');
    expect(f.target.snapshot()).toStrictEqual(target);expect(f.self.snapshot()).toStrictEqual(self);expect(f.state).toStrictEqual(state);expect(f.random.snapshot()).toStrictEqual(rng);
  }finally{f.parent.dispose();}
});
test('preflight pins original membership and callable but later adoption never retargets emitted actors',()=>{
  const f=fixture();
  try{
    const ready=f.runner.prepare(f.input).prepareNative(f.native),state=f.state.slice(),before=f.target.snapshot();
    f.references[0]={...f.reference,wire:'replaced'};expect(()=>ready.accept()).toThrow();expect(f.state).toStrictEqual(state);expect(f.target.snapshot()).toStrictEqual(before);
    f.references[0]=f.reference;
    const callable=f.runner.prepare(f.input).prepareNative(f.native);
    f.target.stagger=()=>undefined;expect(()=>callable.accept()).toThrow('replaced');expect(f.state).toStrictEqual(state);f.target.stagger=(direction,strength)=>AnimalSim.prototype.stagger.call(f.target,direction,strength);
    const other=f.other.snapshot(),oracle=actor('target');oracle.restore(before);
    f.grass.grassHeightAt=()=>{f.references[0]={...f.reference,body:f.other,identity:f.other.entityId,wire:'other/new'};return 3;};
    oracle.applyDamage(5,oracle.position,new Vector3(.6,0,-.8));oracle.stagger(new Vector3(.6,0,-.8),.4);oracle.hp=7;
    f.runner.prepare({...f.input,signal:'prefix'}).prepareNative(f.native).accept();
    expect(f.target.snapshot()).toStrictEqual(oracle.snapshot());expect(f.other.snapshot()).toStrictEqual(other);
  }finally{f.parent.dispose();}
});
test('ancestor retirement by an earlier native result prevents reference and member suffix effects',()=>{
  const f=fixture();let disposal:ReturnType<Scope['disposeSteps']>|undefined;
  try{
    const target=f.target.snapshot(),self=f.self.snapshot();
    f.grass.grassHeightAt=()=>{disposal=f.parent.disposeSteps();disposal.next();return 3;};
    expect(()=>f.runner.prepare({...f.input,signal:'prefix'}).prepareNative(f.native).accept()).toThrow('Retired');
    expect(f.target.snapshot()).toStrictEqual(target);expect(f.self.snapshot()).toStrictEqual(self);
    if(disposal!==undefined)for(const _step of disposal){/* Complete original scope retirement. */}
  }finally{f.parent.dispose();}
});
test('reference effect grammar is strict with fixed handles and no nullable or member target aliases',()=>{
  const schema=namedJsonSchema(GroupStepV2Schema),encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
  expect(validateNamedJsonSchema(schema,encode(rows))).toStrictEqual(rows);
  for(const action of [
    {id:1,words:4,member:0,native:{kind:'damage'}},
    {id:1,words:4,reference:{word:1},native:{kind:'damage'}},
    {id:1,words:4,reference:{word:0,nullable:true},native:{kind:'stagger'}},
    {id:1,words:2,reference:{word:0},native:{kind:'health',callback:'set'}},
  ])expect(()=>parseGroupStepV2({...rows,actions:[action]})).toThrow();
});
