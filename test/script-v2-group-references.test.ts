import { beforeAll, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { Rng } from '../src/shared/engine/core/rng';
import { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { FlockBrain } from '../src/shared/engine/ai/flock';
import { CrowdRoster, CrowdTargets } from '../src/shared/game/shardfile/crowdRuntime';
import { GroupStepV2, type GroupStepReferenceV2 } from '../src/shared/engine/script/groupStepV2';
import { ObservationColumnsV2, type V2ColumnOwners, type V2ReferenceColumn } from '../src/shared/engine/script/observationColumnsV2';
import { GroupBankV2 } from '../src/shared/engine/script/groupBankV2';
import { parseGroupStepV2, groupStepLayoutV2, GroupStepV2Schema } from '@wildshard/format/scriptGroupStepV2';
import { ObservationColumnsV2Schema, parseObservationColumnsV2 } from '@wildshard/format/scriptObservationColumnsV2';
import { compileScriptV2 } from '../src/sharddev/bake/compileScriptV2';
import { v2CoreSource } from '../src/sharddev/as/wsV2';
import { namedJsonSchema } from '../src/shared/host/formatJsonSchema';
import { validateNamedJsonSchema } from '../src/shared/game/shardfile/customSchema';

const columns = ['present','handle','x','y','z','yaw','alive'].map((field,index) => ({name:field,id:index+1,source:{kind:'reference',binding:'target',field}}));
const rows = parseGroupStepV2({bank:[{name:'target',kind:'reference'},{name:'x',kind:'number'}],columns,members:1,
  signals:['read','nearest'],actions:[{id:1,words:1,reference:{word:0}},{id:2,words:3,native:{kind:'nearest',roster:'targets',channel:'found'}}],outputs:1,pages:1,fuel:400000});
let bytes: Uint8Array;
beforeAll(async () => {
  bytes=await compileScriptV2(`import * as core from './sdk/as/wsV2';
    export function ws_abi():i32{return 2;}export function ws_io():i32{return 0;}
    export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return fuel;}
    export function ws_project(fuel:i32):i32{core.beginState();assert(core.beginBinding(0));
      core.setState(1,core.field(3));if(core.parameter(0)==2)core.pageOutput(2,0,0,10);else core.pageOutput(1,core.state(0));core.endBinding();return fuel;}`,
  {lane:'project',ioBytes:groupStepLayoutV2(rows).bytes,sources:{'sdk/as/wsV2.ts':v2CoreSource(0)}});
});
function fixture() {
  const parent=new Scope('reference-parent'),scope=parent.child('group'),random=new Rng(20);
  const flock=new FlockBrain({heightAt:()=>0,normalY:()=>1,inBounds:()=>true,wetAt:()=>false,playerCrouched:()=>false,
    grassHeightAt:()=>.2,trample:()=>undefined,centre:()=>undefined},
  {x:20,z:-30,count:24,seed:9,range:25,runSpeed:6,walkSpeed:1.2,grazeStep:.3,bleatCue:'call'});
  flock.initialize();const targets=new CrowdTargets(flock,{preyY:1.4,hits:[[0,1.4,.65]]}),roster=new CrowdRoster([],[targets],'crowd');
  const prey=targets.prey(23),identity=roster.identity(prey);
  const reference: GroupStepReferenceV2={group:'crowd',slot:23,identity,wire:identity,handle:33,body:prey,pose:true};
  const references=[reference],borrowed: V2ReferenceColumn={identity,handle:33,body:prey};
  const named=new Map<string,V2ReferenceColumn|null>([['target',borrowed]]);
  const member: V2ColumnOwners={scope,self:{group:'original',slot:0,identity:'',actor:null},player:{position:new Vector3()},observed:new Map(),references:named,t:1,dt:.1};
  const members=[member],bank=new GroupBankV2(rows.bank),state=bank.encode({target:identity,x:0},'original',references);
  const runner=new GroupStepV2(bytes,rows,scope),input={group:'original',handle:1,signal:'read',tick:1,state,members,references,random};
  return {parent,scope,flock,targets,roster,prey,identity,reference,references,borrowed,named,member,members,bank,state,runner,input,random};
}
function values(captured: ReturnType<ObservationColumnsV2['capture']>): Record<string,number> {return Object.fromEntries(captured.map(row=>[row.name,row.value]));}

test('real native crowd prey supplies detached pose columns, stable wire and original damage authority', () => {
  const f=fixture();
  try {
    const reader=new ObservationColumnsV2(columns,f.scope),before=f.flock.snapshot(),rng=f.random.snapshot(),point=f.prey.position.clone();
    const captured=reader.capture(f.member);
    expect(values(captured)).toStrictEqual({present:1,handle:33,x:point.x,y:point.y,z:point.z,yaw:f.prey.yaw,alive:1});
    const prepared=f.runner.prepare(f.input);expect(f.state[1]).toBe(0);expect(prepared.operations[0]?.reference?.body).toBe(f.prey);
    prepared.accept();expect(f.state[1]).toBe(point.x);expect(f.bank.decode(f.state,'original',f.references)['target']).toBe(f.identity);
    expect(f.flock.snapshot()).toBe(before);expect(f.random.snapshot()).toStrictEqual(rng);expect(f.roster.resolve(f.identity)).toBe(f.prey);
    f.prey.applyDamage();expect(values(reader.capture(f.member))['alive']).toBe(0);expect(values(captured)['alive']).toBe(1);
    f.flock.restore(before);expect(f.prey.alive).toBe(true);expect(f.flock.snapshot()).toBe(before);
    f.named.set('target',null);expect(values(reader.capture(f.member))).toStrictEqual({present:0,handle:0,x:0,y:0,z:0,yaw:0,alive:0});
  } finally {f.parent.dispose();}
});
test('foreign, removed or replaced reference loans refuse before group bank or RNG publication', () => {
  const f=fixture();
  try {
    const state=f.state.slice(),rng=f.random.snapshot(),prepared=f.runner.prepare(f.input);
    f.named.set('target',{...f.borrowed,handle:44});expect(()=>prepared.accept()).toThrow('body loan');
    expect(()=>f.runner.prepare(f.input)).toThrow('Foreign observed');expect(f.state).toStrictEqual(state);expect(f.random.snapshot()).toStrictEqual(rng);
    f.named.set('target',f.borrowed);const added=f.runner.prepare(f.input);
    f.named.set('another',null);expect(()=>added.accept()).toThrow('body loan');f.named.delete('another');
    const next=f.runner.prepare(f.input);
    f.references[0]={...f.reference,wire:'changed'};expect(()=>next.accept()).toThrow();expect(f.state).toStrictEqual(state);
    f.references[0]=f.reference;f.named.delete('target');expect(()=>f.runner.prepare(f.input)).toThrow('reference binding');
    f.named.set('target',f.borrowed);
    expect(()=>f.runner.prepare({...f.input,references:[{...f.reference,group:'original'}]})).toThrow('member reference');
  } finally {f.parent.dispose();}
});
test('pose capture admission is strict, absent bindings refuse, and ancestor retirement fences the original owner', () => {
  const f=fixture();
  try {
    const schema=namedJsonSchema(ObservationColumnsV2Schema),encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value));
    expect(validateNamedJsonSchema(schema,encode(columns))).toStrictEqual(columns);
    expect(validateNamedJsonSchema(namedJsonSchema(GroupStepV2Schema),encode(rows))).toStrictEqual(rows);
    for (const native of [{kind:'nearest',roster:'targets',channel:'found',callback:'scan'},{kind:'nearest',channel:'found'}]) {
      const invalid={...rows,actions:[{id:2,words:3,native}]};
      expect(()=>parseGroupStepV2(invalid)).toThrow();expect(()=>validateNamedJsonSchema(namedJsonSchema(GroupStepV2Schema),encode(invalid))).toThrow();
    }
    for(const source of [{kind:'reference',binding:'target',field:'applyDamage'},{kind:'reference',binding:'target',field:'x',call:'position'}]) {
      const invalid=[{name:'field',id:1,source}];expect(()=>parseObservationColumnsV2(invalid)).toThrow();expect(()=>validateNamedJsonSchema(schema,encode(invalid))).toThrow();
    }
    const prepared=f.runner.prepare(f.input),state=f.state.slice(),rng=f.random.snapshot(),disposal=f.parent.disposeSteps();disposal.next();
    expect(()=>prepared.accept()).toThrow('disposed');expect(f.state).toStrictEqual(state);expect(f.random.snapshot()).toStrictEqual(rng);
    for(const _step of disposal){/* Finish original retirement. */}
  } finally {f.parent.dispose();}
});

function actor(id: string,x:number,z:number): AnimalSim {
  const body=new AnimalSim({kind:'sample',label:'Sample',variant:'plain',rarity:'common',hp:20,aggressive:false,
    dims:{bodyY:.6,bodyHalfLen:.5,bodyRadius:.3,headRadius:.2,legLen:.5,feet:[],halfWidth:.3},
    mods:{speed:1,chargeDist:1,damageTaken:1,chargeDamage:5,relentless:false}},1,1,id,{heightAt:()=>0,random:()=>.5});
  body.position.set(x,500,z);return body;
}
test('native nearest uses the declared actual roster, horizontal strict range and first live tie', () => {
  const f=fixture();
  try {
    const first=actor('a',3,4),second=actor('b',-3,-4),boundary=actor('c',0,10);
    const loans=[first,second,boundary].map((body,index)=>({group:'another',slot:index,identity:body.entityId,wire:body.entityId,handle:40+index,body}));
    const references=[...f.references,...loans],rosters=new Map([['targets',loans]]);
    const input={...f.input,signal:'nearest',references};
    const owners={scope:f.scope,members:f.members,references,rosters};
    const before=[f.state.slice(),f.random.snapshot(),first.snapshot(),second.snapshot()];
    const prepared=f.runner.prepare(input).prepareNative(owners);expect([f.state,f.random.snapshot(),first.snapshot(),second.snapshot()]).toStrictEqual(before);
    expect(prepared.accept()).toStrictEqual([{channel:'found',value:40}]);
    first.alive=false;expect(f.runner.prepare(input).prepareNative(owners).accept()[0]?.value).toBe(41);
    second.alive=false;expect(f.runner.prepare(input).prepareNative(owners).accept()[0]?.value).toBe(0);
    const candidate=f.runner.prepare(input).prepareNative(owners);rosters.set('targets',[...loans]);
    expect(()=>candidate.accept()).toThrow('replaced');
    expect(()=>f.runner.prepare(input).prepareNative({...owners,references:[...references]})).toThrow('scope');
    rosters.set('targets',[{group:'foreign',slot:0,identity:'missing',wire:'missing',handle:9,body:first}]);
    expect(()=>f.runner.prepare(input).prepareNative(owners)).toThrow('reference');
  } finally {f.parent.dispose();}
});
