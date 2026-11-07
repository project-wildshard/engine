import { beforeAll, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { Rng } from '../src/shared/engine/core/rng';
import { HuntingStalkerCore, huntMemoryCodec, type HuntGround, type HuntNav } from '../src/shared/engine/ai/huntPattern';
import type { GuardedHerdContext } from '../src/server/engine/ai/grazer';
import { GroupStepV2 } from '../src/shared/engine/script/groupStepV2';
import type { V2ColumnOwners } from '../src/shared/engine/script/observationColumnsV2';
import { parseGroupStepV2, groupStepLayoutV2, GroupStepV2Schema } from '@wildshard/format/scriptGroupStepV2';
import { compileScriptV2 } from '../src/sharddev/bake/compileScriptV2';
import { v2CoreSource } from '../src/sharddev/as/wsV2';
import { namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';

const rows = parseGroupStepV2({bank:[{name:'calls',kind:'number'}],columns:[],members:1,signals:['step','bad'],actions:[
  {id:1,words:4,member:0,native:{kind:'steer'}},
  {id:2,words:4,member:0,native:{kind:'path',channel:'yaw'}},
  {id:3,words:1,member:0,native:{kind:'confine'}},
  {id:4,words:0},
],outputs:4,pages:1,fuel:400000});
let bytes:Uint8Array;
beforeAll(async()=>{
  bytes=await compileScriptV2(`import * as core from './sdk/as/wsV2';
    export function ws_abi():i32{return 2;}export function ws_io():i32{return 0;}
    export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return fuel;}
    export function ws_project(fuel:i32):i32{core.beginState();assert(core.beginBinding(0));
      core.setState(0,core.state(0)+1);core.pageOutput(1,0,1.2,3.5,2.5);core.pageOutput(2,0,8,12,.75);
      core.pageOutput(3,0);if(core.parameter(0)==2)core.pageOutput(4);core.endBinding();return fuel;}`,
  {lane:'project',ioBytes:groupStepLayoutV2(rows).bytes,sources:{'sdk/as/wsV2.ts':v2CoreSource(0)}});
});
function actor(id:string):AnimalSim {
  return new AnimalSim({kind:'sample',label:'Sample',variant:'plain',rarity:'common',hp:20,aggressive:false,
    dims:{bodyY:.6,bodyHalfLen:.5,bodyRadius:.3,headRadius:.2,legLen:.5,feet:[],halfWidth:.3},
    mods:{speed:1,chargeDist:1,damageTaken:1,chargeDamage:5,relentless:false}},1,1,id,{heightAt:()=>0,random:()=>.5});
}
function fixture(navigation:boolean){
  const parent=new Scope('context-parent'),scope=parent.child('group'),body=actor('body'),other=actor('other'),random=new Rng(71),player=new Vector3(0,2,4);
  body.position.set(50,0,0);
  const ground:HuntGround={heightAt:()=>0,normalY:()=>1,trailDistance:()=>100,cabinMask:()=>0,inChunk:(x,z,margin)=>Math.abs(x)<=24-margin&&Math.abs(z)<=24-margin,
    streamAt:()=>null,waterLevel:()=>-100,pond:()=>null,sea:()=>false,wetAt:()=>false,trees:()=>[{x:49,z:0,r:1}],treeless:()=>false,terrain:()=>true,chunkHalf:24};
  const paths:unknown[]=[];
  const nav:HuntNav={closestWalkable:point=>new Vector3(point.x,point.y,point.z),randomPointNear:()=>null,clearAhead:()=>({clear:1,normalX:0,normalZ:0}),
    findPath:(from,to,radius,out?:Vector3[])=>{const points=out??[];paths.push([new Vector3(from.x,from.y,from.z),new Vector3(to.x,to.y,to.z),radius]);points.length=0;points.push(new Vector3(45,0,3),new Vector3(to.x,to.y,to.z));return points;}};
  const hunt=new HuntingStalkerCore([body],{config:{rng:random,fight:{},faunaTuning:()=>undefined,species:()=>({aggressive:false})},
    ports:{ground,nav:()=>navigation?nav:null,reach:()=>true,wanderGoal:()=>null,unaware:()=>false,now:()=>0,sound:()=>undefined,charge:()=>undefined},
    player,sampleTerrain:()=>undefined});
  if(navigation)hunt.adopt(body,50,0);
  const log:unknown[]=[],hooks:{afterSteer?:()=>void}={},current={actor:body};
  const context:GuardedHerdContext<AnimalSim>={dt:.1,t:5,player,playerSpeed:2,calm:false,rng:random,sound:()=>undefined,hurt:()=>undefined,
    steer(a,yaw,speed,turn){log.push(['steer',a.entityId,yaw,speed,turn,this.t]);hunt.steerAny(a,yaw,speed,turn);hooks.afterSteer?.();},
    pathYaw(a,x,z,every=1){log.push(['path',a.entityId,x,z,every,this.t]);return hunt.pathYawFor(a,x,z,every);},
    confine(a){log.push(['confine',a.entityId,this.t]);hunt.confine(a);}};
  const member:V2ColumnOwners={scope,self:{group:'sample',slot:0,identity:body.entityId,actor:body},player:{position:player},observed:new Map(),context,t:5,dt:.1};
  const members=[member],contexts=[context],native={scope,members,contexts},state=Float64Array.of(0),runner=new GroupStepV2(bytes,rows,scope);
  const input={group:'sample',handle:1,signal:'step',tick:1,state,members,references:[],random};
  return{parent,scope,body,other,random,hunt,paths,log,hooks,current,context,member,members,contexts,native,state,runner,input};
}
test('real native Hunt steering, path cache and confinement match the original context in emitted order',()=>{
  for(const navigation of [false,true]){
    const f=fixture(navigation),oracle=fixture(navigation);
    try{
      const before=f.body.snapshot(),rng=f.random.snapshot();
      const prepared=f.runner.prepare(f.input).prepareNative(f.native);expect(f.body.snapshot()).toStrictEqual(before);expect(f.paths).toStrictEqual([]);expect(f.log).toStrictEqual([]);
      oracle.context.steer(oracle.body,1.2,3.5,2.5);const yaw=oracle.context.pathYaw(oracle.body,8,12,.75);oracle.context.confine(oracle.body);
      const result=prepared.accept();expect(result).toStrictEqual([{channel:'yaw',value:yaw,member:f.input.members[0]?.self}]);
      expect(f.body.snapshot()).toStrictEqual(oracle.body.snapshot());expect(f.paths).toStrictEqual(oracle.paths);expect(f.log).toStrictEqual(oracle.log);
      expect(f.random.snapshot()).toStrictEqual(rng);expect(f.state[0]).toBe(1);
      if(navigation){const actual=f.hunt.memory(f.body),expected=oracle.hunt.memory(oracle.body);if(actual===undefined||expected===undefined)throw new Error('Missing original hunt continuation');
        expect(huntMemoryCodec.save(actual)).toStrictEqual(huntMemoryCodec.save(expected));}
    }finally{f.parent.dispose();oracle.parent.dispose();}
  }
});
test('steering reentry changes current owner without retargeting the already-emitted actor',()=>{
  const f=fixture(false);
  try{
    const other=f.other.snapshot();f.hooks.afterSteer=()=>{f.current.actor=f.other;};
    const result=f.runner.prepare(f.input).prepareNative(f.native).accept();
    expect(f.current.actor).toBe(f.other);expect(f.log).toStrictEqual([['steer','body',1.2,3.5,2.5,5],['path','body',8,12,.75,5],['confine','body',5]]);
    expect(f.other.snapshot()).toStrictEqual(other);expect(result[0]?.member?.actor).toBe(f.body);
  }finally{f.parent.dispose();}
});
test('a missing/foreign context or malformed suffix refuses before any prefix and state/RNG publication',()=>{
  const f=fixture(true);
  try{
    const before=f.body.snapshot(),state=f.state.slice(),rng=f.random.snapshot(),{contexts:_contexts,...missing}=f.native;
    expect(()=>f.runner.prepare(f.input).prepareNative(missing)).toThrow('context');
    expect(()=>f.runner.prepare(f.input).prepareNative({...f.native,contexts:[{...f.context}]})).toThrow('context');
    expect(()=>f.runner.prepare({...f.input,signal:'bad'}).prepareNative(f.native)).toThrow('declaration');
    expect(f.body.snapshot()).toStrictEqual(before);expect(f.state).toStrictEqual(state);expect(f.random.snapshot()).toStrictEqual(rng);expect(f.log).toStrictEqual([]);expect(f.paths).toStrictEqual([]);
  }finally{f.parent.dispose();}
});
test('same-object method replacement and prefix ancestor retirement fence later context effects',()=>{
  const f=fixture(false);
  try{
    const state=f.state.slice(),before=f.body.snapshot(),prepared=f.runner.prepare(f.input).prepareNative(f.native);
    f.context.pathYaw=()=>0;expect(()=>prepared.accept()).toThrow('replaced');expect(f.state).toStrictEqual(state);expect(f.body.snapshot()).toStrictEqual(before);
    let disposal:ReturnType<Scope['disposeSteps']>|undefined;
    f.hooks.afterSteer=()=>{disposal=f.parent.disposeSteps();disposal.next();};
    const next=f.runner.prepare(f.input).prepareNative(f.native);expect(()=>next.accept()).toThrow('Retired');
    expect(f.log).toStrictEqual([['steer','body',1.2,3.5,2.5,5]]);
    if(disposal!==undefined)for(const _step of disposal){/* Finish original retirement. */}
  }finally{f.parent.dispose();}
});
test('context operation rows have strict named admission and fixed member operand arity',()=>{
  const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)),schema=namedJsonSchema(GroupStepV2Schema);
  expect(validateNamedJsonSchema(schema,encode(rows))).toStrictEqual(rows);
  for(const action of [{id:1,words:4,native:{kind:'steer'}},{id:1,words:3,member:0,native:{kind:'path',channel:'yaw'}},
    {id:1,words:1,member:0,native:{kind:'confine',call:'custom'}}]){
    expect(()=>parseGroupStepV2({...rows,actions:[action]})).toThrow();
  }
});
