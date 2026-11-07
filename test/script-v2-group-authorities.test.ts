import {beforeAll,expect,expectTypeOf,test,vi} from 'vitest';
import {Vector3} from 'three';
import {Scope} from '../src/shared/engine/app/scope';
import {AnimalSim} from '../src/shared/engine/entities/AnimalSim';
import type {Animal} from '../src/client/engine/entities/AnimalView';
import {Rng} from '../src/shared/engine/core/rng';
import {StalkerBrain,type CirclingPackContext,type CirclingPackPorts} from '../src/shared/engine/ai/stalker';
import {GrazerBrain,type GuardedHerdContext,type GuardedHerdPorts} from '../src/server/engine/ai/grazer';
import {GroupBrain} from '../src/shared/engine/ai/GroupBrain';
import {AggressionDirector} from '../src/shared/engine/ai/director';
import {GroupStepV2,prepareGroupNativeV2,type GroupStepNativeOwnersV2,type GroupStepReferenceV2} from '../src/shared/engine/script/groupStepV2';
import type {V2ColumnOwners} from '../src/shared/engine/script/observationColumnsV2';
import {parseGroupStepV2,groupStepLayoutV2,GroupStepV2Schema} from '@wildshard/format/scriptGroupStepV2';
import {compileScriptV2} from '../src/sharddev/bake/compileScriptV2';
import {v2CoreSource} from '../src/sharddev/as/wsV2';
import {namedJsonSchema} from '../src/shared/host/formatJsonSchema';
import {validateNamedJsonSchema} from '../src/shared/game/shardfile/customSchema';

const rows=parseGroupStepV2({bank:[{name:'calls',kind:'number'}],columns:[],members:1,signals:['pack','herd','bad','prefix','environment','notifications','groupClaim','badFlight','badMask','senses','nearest','sharedInit','twoStreams'],actions:[
 {id:1,words:2,member:0,native:{kind:'start-attack'}},{id:2,words:1,member:0,native:{kind:'cancel-attack'}},
 {id:3,words:2,member:0,native:{kind:'sound',cues:['call']}},{id:4,words:2,member:0,native:{kind:'contact'}},
 {id:5,words:3,native:{kind:'event',events:['notice']}},{id:6,words:1,member:0,native:{kind:'claim',channel:'claim'}},
 {id:7,words:2,member:0,native:{kind:'pass-through'}},{id:8,words:2,member:0,native:{kind:'hurt'}},
 {id:9,words:3,native:{kind:'knockdown'}},{id:10,words:0,native:{kind:'environment',field:'playerMounted',channel:'mounted'}},
 {id:11,words:1,native:{kind:'notify-state',states:['beaten']}},{id:12,words:1,native:{kind:'notify-flight'}},
 {id:13,words:1,reference:{word:0},native:{kind:'notify-beaten'}},{id:14,words:1,reference:{word:0},native:{kind:'append-member'}},
 {id:15,words:2,reference:{word:0},native:{kind:'scare',channel:'scare'}},{id:16,words:3,native:{kind:'nearest-group',channel:'nearest'}},
 {id:17,words:3,member:0,native:{kind:'group-claim',channel:'claimed'}},
 {id:18,words:1,member:0,native:{kind:'visibility',channel:'visible'}},{id:19,words:1,member:0,native:{kind:'hearing',channel:'heard',radii:[1,2,3,4]}},
 {id:20,words:1,member:0,native:{kind:'downwind',channel:'downwind'}},
],outputs:8,pages:1,fuel:400000,randomStreams:2});
let bytes:Uint8Array;
// This real fixture compiles twice (IO discovery/reservation), then instruments
// fuel/finite checks and admits the module; give compilation its 30 s budget.
beforeAll(async()=>{bytes=await compileScriptV2(`import * as core from './sdk/as/wsV2';
 export function ws_abi():i32{return 2;}export function ws_io():i32{return 0;}
 export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return fuel;}
 export function ws_project(fuel:i32):i32{core.beginState();assert(core.beginBinding(0));const signal=i32(core.parameter(0));core.setState(0,core.state(0)+1);
 if(signal==6){core.pageOutput(11,0);core.pageOutput(12,1);core.pageOutput(13,33);core.pageOutput(14,34);core.pageOutput(15,33,5);core.pageOutput(16,0,0,10);core.endBinding();return fuel;}
 if(signal==7||signal==9){core.pageOutput(17,0,2,signal==9?65536:1);core.endBinding();return fuel;}
 if(signal==8){core.pageOutput(14,34);core.pageOutput(12,2);core.endBinding();return fuel;}
 if(signal==10){core.pageOutput(18,0);core.pageOutput(19,0);core.pageOutput(20,0);core.endBinding();return fuel;}
 if(signal==11){core.pageOutput(16,0,0,10);core.endBinding();return fuel;}
 if(signal==12||signal==13){core.setState(0,core.random(1)+(signal==13?core.random(2):0));core.endBinding();return fuel;}
 core.pageOutput(1,0,.7);core.pageOutput(3,0,0);core.pageOutput(4,0,1.5);
 if(signal==2){core.pageOutput(7,0,1);core.pageOutput(8,0,6);core.pageOutput(9,2,3,.4);}
 if(signal==5)core.pageOutput(10);core.pageOutput(5,signal==3?99:0,2,3);if(signal==1)core.pageOutput(6,0);core.pageOutput(2,0);core.endBinding();return fuel;}`,
 {lane:'project',ioBytes:groupStepLayoutV2(rows).bytes,sources:{'sdk/as/wsV2.ts':v2CoreSource(0)}});},30_000);
function actor(id='body'):AnimalSim{return new AnimalSim({kind:'sample',label:'Sample',variant:'leader',rarity:'common',hp:20,aggressive:false,
 dims:{bodyY:.6,bodyHalfLen:.5,bodyRadius:.3,headRadius:.2,legLen:.5,feet:[],halfWidth:.3},mods:{speed:1,chargeDist:1,damageTaken:1,chargeDamage:5,relentless:false}},1,1,id,{heightAt:()=>0,random:()=>.5});}
function fixture(id='body',declarations=rows){
 const parent=new Scope('group-native-parent'),scope=parent.child('entered'),body=actor(id),random=new Rng(31),player=new Vector3(1,2,3),log:unknown[]=[],hooks:{contact?:()=>void}={};
 const director=new AggressionDirector<AnimalSim>(1),tokens=new WeakMap<AnimalSim,AggressionDirector<AnimalSim>>();
 const packContext:CirclingPackContext<AnimalSim>={dt:.1,t:2,player,playerSpeed:0,calm:false,rng:random,
 sound(cue){log.push(['sound',cue,this===packContext]);},claim(a){log.push(['claim',a.entityId,this===packContext]);return tokens.get(a)?.take(a)??true;},steer:()=>undefined,pathYaw:()=>0};
 const herdContext:GuardedHerdContext<AnimalSim>={dt:.1,t:2,player,playerSpeed:0,calm:false,rng:random,
 sound(cue){log.push(['sound',cue,this===herdContext]);},hurt(amount){log.push(['hurt',amount,this===herdContext]);},steer:()=>undefined,pathYaw:()=>0,confine:()=>undefined};
 const packPorts:CirclingPackPorts<AnimalSim>={sharedRng:()=>random,environment:()=>({playerFwdX:0,playerFwdZ:1,playerMounted:false,playerHealth01:1,grassHeightAt:()=>0}),
 visibility:()=>0,hearing:()=>0,downwind:()=>false,inBounds:()=>true,normalY:()=>1,
 register(a,d){log.push(['register',a.entityId,this===packPorts]);tokens.set(a,d);},
 bite(a,c,radius){log.push(['bite',a.entityId,c===packContext,radius,this===packPorts]);hooks.contact?.();},
 onEvent(name,x,z){log.push(['event',name,x,z,this===packPorts]);}};
 const pack=new StalkerBrain({pattern:'pack',members:[body],home:{x:0,z:0},spec:{trotSpeed:3,runSpeed:7,shadowMinRadius:10,shadowMaxRadius:20,ringMinRadius:10,ringMaxRadius:15,
 biteRadius:2,sightRadius:50,coneAngle:1,smellRadius:15,hearing:[1,2,3,4],telegraphSeconds:.4,dashSeconds:1,breakoffSeconds:1,attackSeconds:.7,leaderVariant:'leader',yipCue:'yip',howlCue:'howl',snarlCue:'snarl',biteCue:'bite'},ports:packPorts});
 const herdPorts:GuardedHerdPorts<AnimalSim>={sharedRng:()=>random,environment:()=>({playerMounted:false,playerCrouched:false}),visibility:()=>0,hearing:()=>0,downwind:()=>false,inBounds:()=>true,normalY:()=>1,
 passThrough(a,on){log.push(['pass',a.entityId,on,this===herdPorts]);},chargeContact(a,c,radius){log.push(['charge',a.entityId,c===herdContext,radius,this===herdPorts]);hooks.contact?.();},scarePack:()=>false,
 onKnockdown(x,z,strength){log.push(['knock',x,z,strength,this===herdPorts]);},onEvent(name,x,z){log.push(['event',name,x,z,this===herdPorts]);}};
 const herd=new GrazerBrain([body],{pattern:'herd',spec:{walkSpeed:2,trotSpeed:4,gallopSpeed:7,chargeSpeed:8,sightRadius:40,grazingSightRadius:20,coneAngle:1,hearing:[1,2,3,4],alertThreshold:.5,
 flightMinDistance:20,flightMaxDistance:40,stallionVariant:'leader',foalPrefix:'young',snortCue:'snort',neighCue:'neigh',squealCue:'squeal'},ports:herdPorts});
 const selected:{context:CirclingPackContext<AnimalSim>|GuardedHerdContext<AnimalSim>}={context:packContext};
 const member:V2ColumnOwners={scope,self:{group:'sample',slot:0,identity:body.entityId,actor:body},player:{position:player},observed:new Map(),t:2,dt:.1,get context(){return selected.context;}};
 const members=[member],state=Float64Array.of(0),runner=new GroupStepV2(bytes,declarations,scope),input={group:'sample',handle:1,signal:'pack',tick:1,state,members,references:[],random};
 const native:GroupStepNativeOwnersV2={scope,members,contexts:[packContext],group:{kind:'pack',owner:pack},aggression:{kind:'tokens',owners:tokens,director}};
 const enterHerd=()=>{selected.context=herdContext;return{...native,group:{kind:'herd',owner:herd} as const,contexts:[herdContext]};};
 return{parent,scope,body,random,log,hooks,director,tokens,pack,packPorts,packContext,herd,herdPorts,herdContext,member,members,state,runner,input,native,enterHerd};
}
test('original pack contact, context sound/claim and body attack methods retain receiver and synchronous order',()=>{
 const f=fixture(),oracle=fixture();
 try{
  expect(f.pack.groupPorts).toBe(f.packPorts);const before=f.body.snapshot(),ready=f.runner.prepare(f.input).prepareNative(f.native);expect(f.log).toStrictEqual([]);expect(f.body.snapshot()).toStrictEqual(before);
  oracle.body.startAttack(.7);oracle.packContext.sound('call');oracle.packPorts.bite(oracle.body,oracle.packContext,1.5);oracle.packPorts.onEvent?.('notice',2,3);oracle.packPorts.register(oracle.body,oracle.director);
  const claimed=oracle.packContext.claim(oracle.body);oracle.body.cancelAttack();
  expect(ready.accept()).toStrictEqual([{channel:'claim',value:Number(claimed),member:f.member.self}]);expect(f.log).toStrictEqual(oracle.log);expect(f.body.snapshot()).toStrictEqual(oracle.body.snapshot());expect(f.director.holds(f.body)).toBe(true);
 }finally{f.parent.dispose();oracle.parent.dispose();}
});
test('original herd contact/pass-through/context hurt and knockdown preserve original native owners',()=>{
 const f=fixture(),oracle=fixture();
 try{
  expect(f.herd.groupPorts).toBe(f.herdPorts);const native=f.enterHerd(),ready=f.runner.prepare({...f.input,signal:'herd'}).prepareNative(native);
  oracle.body.startAttack(.7);oracle.herdContext.sound('call');oracle.herdPorts.chargeContact(oracle.body,oracle.herdContext,1.5);oracle.herdPorts.passThrough(oracle.body,true);oracle.herdContext.hurt(6);
  oracle.herdPorts.onKnockdown?.(2,3,.4);oracle.herdPorts.onEvent?.('notice',2,3);oracle.body.cancelAttack();
  ready.accept();expect(f.log).toStrictEqual(oracle.log);expect(f.body.snapshot()).toStrictEqual(oracle.body.snapshot());
 }finally{f.parent.dispose();oracle.parent.dispose();}
});
test('a malformed suffix or foreign concrete group rejects all contact, attack and context prefixes',()=>{
 const f=fixture(),other=fixture();
 try{
  const before=f.body.snapshot(),rng=f.random.snapshot();
  expect(()=>f.runner.prepare({...f.input,signal:'bad'}).prepareNative(f.native)).toThrow('event');
  expect(()=>f.runner.prepare(f.input).prepareNative({...f.native,group:{kind:'pack',owner:other.pack}})).toThrow('group actor');expect(f.log).toStrictEqual([]);expect(f.body.snapshot()).toStrictEqual(before);expect(f.random.snapshot()).toStrictEqual(rng);expect(f.state[0]).toBe(0);
 }finally{f.parent.dispose();other.parent.dispose();}
});
test('contact reentry cannot retarget body effects and ancestor retirement fences the remaining suffix',()=>{
 const f=fixture();let disposal:ReturnType<Scope['disposeSteps']>|undefined;
 try{
  const ready=f.runner.prepare(f.input).prepareNative(f.native);f.packPorts.bite=()=>undefined;expect(()=>ready.accept()).toThrow('replaced');expect(f.state[0]).toBe(0);
  f.packPorts.bite=()=>{disposal=f.parent.disposeSteps();disposal.next();};
  expect(()=>f.runner.prepare(f.input).prepareNative(f.native).accept()).toThrow('Retired');
  expect(f.log).toStrictEqual([['sound','call',true]]);expect(f.body.attackPhase).toBeGreaterThanOrEqual(0);
  if(disposal!==undefined)for(const _step of disposal){/* Complete original retirement. */}
 }finally{f.parent.dispose();}
});
test('strict native names and attack/contact arities admit without executable selectors',()=>{
 const encode=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)),schema=namedJsonSchema(GroupStepV2Schema);
 expect(validateNamedJsonSchema(schema,encode(rows))).toStrictEqual(rows);
 for(const action of [{id:1,words:2,member:0,native:{kind:'sound',cues:['call','call']}},{id:1,words:1,member:0,native:{kind:'start-attack'}},
 {id:1,words:3,native:{kind:'event',events:['notice'],callback:'apply'}}])expect(()=>parseGroupStepV2({...rows,actions:[action]})).toThrow();
});

test('earlier contact adoption retains emitted body and optional original notification stays optional',()=>{
 const f=fixture(),other=fixture();
 try{
  const untouched=other.body.snapshot();f.hooks.contact=()=>{f.pack.members[0]=other.body;};
  f.runner.prepare(f.input).prepareNative(f.native).accept();
  expect(f.pack.members[0]).toBe(other.body);expect(other.body.snapshot()).toStrictEqual(untouched);expect(f.body.attackPhase).toBe(-1);
  expect(f.log).toStrictEqual([['sound','call',true],['bite','body',true,1.5,true],['event','notice',2,3,true],['register','body',true],['claim','body',true]]);
  f.pack.members[0]=f.body;delete f.hooks.contact;delete f.packPorts.onEvent;f.log.length=0;
  f.runner.prepare({...f.input,signal:'prefix'}).prepareNative(f.native).accept();expect(f.log).toStrictEqual([['sound','call',true],['bite','body',true,1.5,true]]);
 }finally{f.parent.dispose();other.parent.dispose();}
});

test('environment result reads the same original ports only at its post-contact native slot',()=>{
 const f=fixture();
 try{
  let mounted=false,reads=0;const native=f.enterHerd();
  f.herdPorts.environment=()=>{reads++;return{playerMounted:mounted,playerCrouched:false};};
  f.hooks.contact=()=>{mounted=true;};
  const ready=f.runner.prepare({...f.input,signal:'environment'}).prepareNative(native);expect(reads).toBe(0);
  expect(ready.accept()).toStrictEqual([{channel:'mounted',value:1}]);expect(reads).toBe(1);
  const replaced=f.runner.prepare({...f.input,signal:'environment'}).prepareNative(native),before=f.log.length;
  f.herdPorts.environment=()=>({playerMounted:false,playerCrouched:false});expect(()=>replaced.accept()).toThrow('replaced');expect(f.log.length).toBe(before);
 }finally{f.parent.dispose();}
});

test('concrete page Animal callback owners remain typed without widening or wrapping',()=>{
 interface PageLoan {scope:Scope;members:readonly V2ColumnOwners<Animal>[];contexts:readonly GuardedHerdContext<Animal>[];group:{kind:'herd';owner:GrazerBrain<Animal>}};
 expectTypeOf<PageLoan>().toExtend<GroupStepNativeOwnersV2<Animal>>();
 interface PackLoan {scope:Scope;members:readonly V2ColumnOwners<Animal>[];contexts:readonly CirclingPackContext<Animal>[];group:{kind:'pack';owner:StalkerBrain<Animal>}};
 expectTypeOf<PackLoan>().toExtend<GroupStepNativeOwnersV2<Animal>>();
});

test('retirement inside original token registration prevents the subsequent context claim',()=>{
 const f=fixture();let disposal:ReturnType<Scope['disposeSteps']>|undefined;
 try{
  f.packPorts.register=()=>{disposal=f.parent.disposeSteps();disposal.next();};
  expect(()=>f.runner.prepare(f.input).prepareNative(f.native).accept()).toThrow('Retired');
  expect(f.director.count).toBe(0);expect(f.log).not.toContainEqual(['claim','body',true]);
  if(disposal!==undefined)for(const _step of disposal){/* Complete original retirement. */}
 }finally{f.parent.dispose();}
});

test('original herd notifications and adoption keep captured old leader and original members order',()=>{
 const f=fixture(),other=fixture('added');
 try{
  const native=f.enterHerd(),old=f.body;
  const refs:GroupStepReferenceV2[]=[{group:'sample',slot:0,identity:old.entityId,wire:'old',handle:33,body:old},
   {group:'outside',slot:0,identity:other.body.entityId,wire:'added',handle:34,body:other.body}];
  f.herd.onStallionState=function onStallionState(state,owner){f.log.push(['state',state,this===f.herd,owner===f.herd]);this.releaseStallion();};
  f.herd.onFlight=function onFlight(stampede,owner){f.log.push(['flight',stampede,this===owner]);};
  f.herd.onBeaten=function onBeaten(body,owner){f.log.push(['beaten',body===old,this===owner,this.stallion===null]);};
  f.herdPorts.scarePack=function scarePack(body,radius){f.log.push(['scare',body===old,radius,this===f.herdPorts]);return true;};
  f.herd.findThreat=function findThreat(x,z,radius){f.log.push(['nearest',x,z,radius,this===f.herd]);return other.body;};
  const ready=f.runner.prepare({...f.input,signal:'notifications',references:refs}),prepared=prepareGroupNativeV2(ready.operations,{...native,references:refs});
  ready.validate();prepared.validate();ready.accept();f.herd.stallionState='beaten';
  expect(prepared.run()).toStrictEqual([{channel:'scare',value:1},{channel:'nearest',value:34}]);
  expect(f.log).toStrictEqual([['state','beaten',true,true],['flight',true,true],['beaten',true,true,true],['scare',true,5,true],['nearest',0,0,10,true]]);
  expect(f.herd.members).toStrictEqual([old,other.body]);expect(old.mem['ridden']).toBe(1);
 }finally{f.parent.dispose();other.parent.dispose();}
});
test('native token selection reuses the original per-cap cache and rejects masks without a token mutation',()=>{
 const f=fixture(),oracle=fixture();
 try{
  const expected=oracle.pack.borrowGroupDirector(2,[oracle.body]);oracle.packPorts.register(oracle.body,expected);const claimed=oracle.packContext.claim(oracle.body);
  const ready=f.runner.prepare({...f.input,signal:'groupClaim'}).prepareNative(f.native);expect(f.log).toStrictEqual([]);
  expect(ready.accept()).toStrictEqual([{channel:'claimed',value:Number(claimed),member:f.member.self}]);
  expect(f.pack.snapshotPack()).toBe(oracle.pack.snapshotPack());const same=f.pack.borrowGroupDirector(2,[f.body]);expect(same.holds(f.body)).toBe(true);
  expect(f.pack.borrowGroupDirector(2,[f.body])).toBe(same);expect(f.pack.borrowGroupDirector(1,[])).not.toBe(same);
  const saved=f.pack.snapshotPack(),state=f.state.slice();expect(()=>f.runner.prepare({...f.input,signal:'badMask'}).prepareNative(f.native)).toThrow('token operands');
  expect(f.pack.snapshotPack()).toBe(saved);expect(f.state).toStrictEqual(state);
 }finally{f.parent.dispose();oracle.parent.dispose();}
});
test('group sensing uses unchanged original ports and current context without an augmented senses object',()=>{
 const f=fixture();
 try{
  f.packPorts.visibility=function visibility(x,z,player,speed,time){f.log.push(['visibility',this===f.packPorts,x,z,player===f.packContext.player,speed,time]);return .7;};
  f.packPorts.hearing=function hearing(radii,player,speed){f.log.push(['hearing',this===f.packPorts,...radii,player===f.packContext.player,speed]);return .3;};
  f.packPorts.downwind=function downwind(x,z,player){f.log.push(['downwind',this===f.packPorts,x,z,player===f.packContext.player]);return true;};
  expect(f.member.senses).toBeUndefined();expect(Object.hasOwn(f.packPorts,'player')).toBe(false);
  const ready=f.runner.prepare({...f.input,signal:'senses'}).prepareNative(f.native);expect(f.log).toStrictEqual([]);
  expect(ready.accept().map(row=>[row.channel,row.value])).toStrictEqual([['visible',.7],['heard',.3],['downwind',1]]);
  expect(f.log).toStrictEqual([['visibility',true,0,0,true,0,2],['hearing',true,1,2,3,4,true,0],['downwind',true,0,0,true]]);
  expect(Object.hasOwn(f.packPorts,'player')).toBe(false);
 }finally{f.parent.dispose();}
});
test('malformed notification suffix prevents native adoption and wrong nearest callable fails before query',()=>{
 const f=fixture(),other=fixture();
 try{
  const refs:GroupStepReferenceV2[]=[{group:'outside',slot:0,identity:other.body.entityId,wire:'added',handle:34,body:other.body}],native={...f.enterHerd(),references:refs};
  const state=f.state.slice(),saved=f.herd.snapshotHerd();expect(()=>f.runner.prepare({...f.input,signal:'badFlight',references:refs}).prepareNative(native)).toThrow('flight');
  expect(f.herd.members).toStrictEqual([f.body]);expect(f.state).toStrictEqual(state);expect(f.herd.snapshotHerd()).toBe(saved);
  f.herd.findThreat=()=>other.body;const ready=f.runner.prepare({...f.input,signal:'nearest',references:refs}).prepareNative(native);
  f.herd.findThreat=()=>null;expect(()=>ready.accept()).toThrow('replaced');expect(f.state).toStrictEqual(state);
 }finally{f.parent.dispose();other.parent.dispose();}
});
test('the existing two-stream capacity admits shared-only initialization and later both original owners',()=>{
 const f=fixture();
 try{
  const shared=new Rng(31),initial=shared.next();f.runner.prepare({...f.input,signal:'sharedInit'}).accept();expect(f.state[0]).toBe(initial);expect(f.random.snapshot()).toStrictEqual(shared.snapshot());
  const local=new Rng(53),oracle=new Rng(53),expected=shared.next()+oracle.next();
  f.runner.prepare({...f.input,signal:'twoStreams',contextRandom:local}).accept();expect(f.state[0]).toBe(expected);expect(f.random.snapshot()).toStrictEqual(shared.snapshot());expect(local.snapshot()).toStrictEqual(oracle.snapshot());
  const state=f.state.slice(),rng=f.random.snapshot();expect(()=>f.runner.prepare({...f.input,signal:'twoStreams'})).toThrow();expect(f.state).toStrictEqual(state);expect(f.random.snapshot()).toStrictEqual(rng);
 }finally{f.parent.dispose();}
});

test('token loans preserve the legacy minimal-member group and exact original per-cap continuation',()=>{
 interface Member {alive:boolean;id:string}
 class OriginalGroup extends GroupBrain<Member>{
  direct(cap:number,held:readonly Member[]){return this.groupDirector(cap,member=>member.alive&&held.includes(member));}
  snapshot(){return this.snapshotGroup(member=>member.id);}
 }
 const a={alive:true,id:'a'},b={alive:true,id:'b'},left=new OriginalGroup([a,b]),right=new OriginalGroup([a,b]);
 for(const cap of [1,2,3]){
  const actual=left.borrowGroupDirector(cap,[a]),expected=right.direct(cap,[a]);expect(actual.take(b)).toBe(expected.take(b));expect(left.snapshot()).toBe(right.snapshot());
 }
 a.alive=false;left.borrowGroupDirector(2,[a]);right.direct(2,[a]);expect(left.snapshot()).toBe(right.snapshot());
 const before=left.snapshot();expect(()=>left.borrowGroupDirector(2,[{alive:true,id:'foreign'}])).toThrow('token loan');expect(()=>left.borrowGroupDirector(2,[b,b])).toThrow('token loan');expect(left.snapshot()).toBe(before);
});

test('compiled native declarations stay detached and frozen without per-operation cloning',()=>{
 const declarations=structuredClone(rows),f=fixture('body',declarations);
 const source=declarations.actions.find(row=>row.id===19)?.native;
 if(source?.kind!=='hearing')throw new Error('Missing original hearing declaration');
 Object.defineProperty(source.radii,'0',{value:99});
 const clone=vi.spyOn(globalThis,'structuredClone');
 try{
  const random=f.random.snapshot();
  for(let frame=0;frame<2;frame++){
   const prepared=f.runner.prepare({...f.input,signal:'senses'}),native=prepared.operations.find(row=>row.id===19)?.native;
   if(native?.kind!=='hearing')throw new Error('Missing compiled hearing declaration');
   expect(native.radii).toStrictEqual([1,2,3,4]);expect(Object.isFrozen(native)).toBe(true);expect(Object.isFrozen(native.radii)).toBe(true);
   expect(Reflect.set(native.radii,'0',88)).toBe(false);prepared.accept();
  }
  expect(f.state[0]).toBe(2);expect(f.random.snapshot()).toEqual(random);expect(clone).not.toHaveBeenCalled();
 }finally{clone.mockRestore();f.parent.dispose();}
});
