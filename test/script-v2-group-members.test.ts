import { beforeAll, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { Rng } from '../src/shared/engine/core/rng';
import { GroupStepV2 } from '../src/shared/engine/script/groupStepV2';
import { ObservationColumnsV2, type V2ColumnOwners } from '../src/shared/engine/script/observationColumnsV2';
import { parseGroupStepV2, GroupStepV2Schema, groupStepLayoutV2 } from '@wildshard/format/scriptGroupStepV2';
import { ObservationColumnsV2Schema } from '@wildshard/format/scriptObservationColumnsV2';
import { compileScriptV2 } from '../src/sharddev/bake/compileScriptV2';
import { v2CoreSource } from '../src/sharddev/as/wsV2';
import { namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';

const columns = [
  {id:1,name:'value',source:{kind:'memory',key:'hit',default:{value:0},encoding:{kind:'negative-infinity',part:'value'}}},
  {id:2,name:'valid',source:{kind:'memory',key:'hit',default:{value:0},encoding:{kind:'negative-infinity',part:'valid'}}},
];
const rows = parseGroupStepV2({bank:[{name:'count',kind:'number'}],columns,members:1,signals:['step','badState','badFlag','retirePrefix'],
  actions:[
    {id:1,words:3,member:0,native:{kind:'memory',key:'hit',encoding:'negative-infinity'}},
    {id:2,words:2,member:0,native:{kind:'state',states:['idle','alert']}},
    {id:3,words:4,member:0,native:{kind:'motion'}},
    {id:4,words:4,member:0,native:{kind:'look-position'}},
    {id:5,words:2,member:0,native:{kind:'look-weight'}},
    {id:6,words:2,native:{kind:'grass',channel:'answer'}},
  ],outputs:6,pages:1,fuel:400000});
let bytes:Uint8Array;
beforeAll(async()=>{
  bytes=await compileScriptV2(`import * as core from './sdk/as/wsV2';
    export function ws_abi():i32{return 2;}export function ws_io():i32{return 0;}
    export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return fuel;}
    export function ws_project(fuel:i32):i32{core.beginState();assert(core.beginBinding(0));
      core.setState(0,core.state(0)+1);const signal=i32(core.parameter(0));
      if(signal==4){core.pageOutput(6,3,4);core.pageOutput(2,0,1);core.endBinding();return fuel;}
      core.pageOutput(1,0,core.field(1),signal==3?2:core.field(0));
      core.pageOutput(2,0,signal==2?99:1);core.pageOutput(3,0,1.2,2.3,3.4);
      core.pageOutput(4,0,6,7,8);core.pageOutput(5,0,.5);core.pageOutput(6,3,4);
      core.endBinding();return fuel;}`,{lane:'project',ioBytes:groupStepLayoutV2(rows).bytes,sources:{'sdk/as/wsV2.ts':v2CoreSource(0)}});
});
function actor():AnimalSim {
  return new AnimalSim({kind:'sample',label:'Sample',variant:'plain',rarity:'common',hp:20,aggressive:false,
    dims:{bodyY:.6,bodyHalfLen:.5,bodyRadius:.3,headRadius:.2,legLen:.5,feet:[],halfWidth:.3},
    mods:{speed:1,chargeDist:1,damageTaken:1,chargeDamage:5,relentless:false}},1,1,'original-body',{heightAt:()=>0,random:()=>.5});
}
function fixture(){
  const parent=new Scope('member-parent'),scope=parent.child('group'),body=actor(),random=new Rng(31),state=Float64Array.of(0);
  body.mem['hit']=-Infinity;
  const member:V2ColumnOwners={scope,self:{group:'sample',slot:0,identity:body.entityId,actor:body},player:{position:new Vector3()},observed:new Map(),t:1,dt:.1};
  const members=[member],samples:unknown[]=[];
  const grass={grassHeightAt(x:number,z:number):number{samples.push([x,z,body.mem['hit'],body.state,body.lookTarget.toArray(),body.lookWeight]);return x+z;}};
  const native={scope,members,grass},runner=new GroupStepV2(bytes,rows,scope);
  const input={group:'sample',handle:1,signal:'step',tick:1,state,members,references:[],random};
  return{parent,scope,body,random,state,member,members,samples,native,runner,input};
}
test('mixed finite member effects and native result run in original order after complete preflight',()=>{
  const f=fixture();
  try{
    const original=f.body.snapshot(),oracle=actor();oracle.restore(original);const rng=f.random.snapshot();
    const prepared=f.runner.prepare(f.input).prepareNative(f.native);
    expect(f.body.snapshot()).toStrictEqual(original);expect(f.samples).toStrictEqual([]);expect(f.state[0]).toBe(0);
    oracle.mem['hit']=-Infinity;oracle.state='alert';oracle.setMotion(1.2,2.3,3.4);oracle.lookTarget.set(6,7,8);oracle.lookWeight=.5;
    expect(prepared.accept()).toStrictEqual([{channel:'answer',value:7}]);
    expect(f.body.snapshot()).toStrictEqual(oracle.snapshot());expect(JSON.stringify(f.body.snapshot())).toBe(JSON.stringify(oracle.snapshot()));
    expect(f.samples).toStrictEqual([[3,4,-Infinity,'alert',[6,7,8],.5]]);expect(f.state[0]).toBe(1);expect(f.random.snapshot()).toStrictEqual(rng);
    expect(()=>prepared.accept()).toThrow('accepted');
  }finally{f.parent.dispose();}
});
test('memory value/valid columns preserve the original negative-infinity sentinel and signed zero',()=>{
  const f=fixture(),reader=new ObservationColumnsV2(columns,f.scope);
  try{
    const before=f.body.snapshot();expect(reader.capture(f.member).map(row=>row.value)).toStrictEqual([0,0]);expect(f.body.snapshot()).toStrictEqual(before);
    f.body.mem['hit']=-0;const finite=reader.capture(f.member);expect(Object.is(finite[0]?.value,-0)).toBe(true);expect(finite[1]?.value).toBe(1);
    f.runner.prepare(f.input).prepareNative(f.native).accept();expect(Object.is(f.body.mem['hit'],-0)).toBe(true);
    delete f.body.mem['hit'];expect(reader.capture(f.member).map(row=>row.value)).toStrictEqual([0,1]);
    for(const invalid of [Number.NaN,Infinity]){f.body.mem['hit']=invalid;expect(()=>reader.capture(f.member)).toThrow('memory value');}
  }finally{f.parent.dispose();}
});
test('invalid state or sentinel suffix prevents every native effect and group/RNG commit',()=>{
  const f=fixture();
  try{
    const before=f.body.snapshot(),state=f.state.slice(),rng=f.random.snapshot();
    for(const signal of ['badState','badFlag'])expect(()=>f.runner.prepare({...f.input,signal}).prepareNative(f.native)).toThrow();
    expect(f.body.snapshot()).toStrictEqual(before);expect(f.state).toStrictEqual(state);expect(f.random.snapshot()).toStrictEqual(rng);expect(f.samples).toStrictEqual([]);
  }finally{f.parent.dispose();}
});
test('member memory/pose/motion owner replacement and ancestor retirement refuse before effects',()=>{
  const f=fixture();
  try{
    const memory=f.runner.prepare(f.input).prepareNative(f.native);f.body.mem={...f.body.mem};expect(()=>memory.accept()).toThrow('replaced');
    const pose=f.runner.prepare(f.input).prepareNative(f.native);f.body.lookTarget=new Vector3();expect(()=>pose.accept()).toThrow('replaced');
    const motion=f.runner.prepare(f.input).prepareNative(f.native);f.body.setMotion=()=>undefined;expect(()=>motion.accept()).toThrow('replaced');
    const live=f.runner.prepare(f.input).prepareNative(f.native),disposal=f.parent.disposeSteps();disposal.next();
    expect(()=>live.accept()).toThrow('disposed');expect(f.samples).toStrictEqual([]);expect(f.state[0]).toBe(0);
    for(const _step of disposal){/* Finish original ancestor retirement. */}
  }finally{f.parent.dispose();}
});
test('member operation and sentinel rows emit strict named admission without executable selectors',()=>{
  const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
  expect(validateNamedJsonSchema(namedJsonSchema(GroupStepV2Schema),encode(rows))).toStrictEqual(rows);
  expect(validateNamedJsonSchema(namedJsonSchema(ObservationColumnsV2Schema),encode(columns))).toStrictEqual(columns);
  for(const native of [{kind:'memory',key:'__proto__'},{kind:'memory',key:'hit',encoding:'float'},{kind:'motion',call:'setMotion'}]){
    const invalid={...rows,actions:[{id:1,words:2,member:0,native}]};expect(()=>parseGroupStepV2(invalid)).toThrow();
    expect(()=>validateNamedJsonSchema(namedJsonSchema(GroupStepV2Schema),encode(invalid))).toThrow();
  }
});

test('native prefix retirement fences later member operations without retargeting the emitted actor',()=>{
  const f=fixture();
  let disposal:ReturnType<Scope['disposeSteps']>|undefined;
  try{
    const before=f.body.snapshot(),native={...f.native,grass:{grassHeightAt:()=>{disposal=f.parent.disposeSteps();disposal.next();return 1;}}};
    const prepared=f.runner.prepare({...f.input,signal:'retirePrefix'}).prepareNative(native);
    expect(()=>prepared.accept()).toThrow('Retired');expect(f.body.snapshot()).toStrictEqual(before);
    if(disposal!==undefined)for(const _step of disposal){/* Finish original retirement. */}
  }finally{f.parent.dispose();}
});
