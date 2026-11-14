// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Only actual native input and independent replay are compared.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- The existing checked-in native physics binary is immutable input.
import {readFileSync} from 'node:fs';
import * as v from 'valibot';
import {beginFolderSession} from './folderSession';
import {checkedReplayPipeline} from './checkedReplayPipeline';
import {createNativeProofResident} from '../headless-native';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {snapshotSimHostBytes,decodeSimSnapshot} from '../../../src/shared/engine/sim/snapshot';
import {castRay,floorBelow} from '../../../src/shared/engine/physics/query';
import {physicsState,sameBytes} from '../../fake/simState';
import {installWalkRopeBodies} from './ropeBodies';
import {installNativeWalkBounds} from './nativeBounds';
import {prepareHeadlessRuntime} from '../../proof/driftwood-isle/worker';
import {DRIFTWOOD_SPOTS} from '../../../src/shards/driftwood-isle/generators/spots';
import {readNativeQuestSpots} from '@wildshard/engine/game/quest/nativeComposition';
import {eyeReaches} from '../../../src/shared/game/quest/interactionRows';
import {REEF_TREASURE} from '../../../src/shards/driftwood-isle/generators/interactables';
import policy from '../../../src/shards/driftwood-isle/data/nativeQuest.json' with {type:'json'};
import type {HeadlessCommand,HeadlessEffect} from '../../../src/shared/host/tickProtocol';
import type {HeadlessTapeObservation,HeadlessTapeSegment} from '../../../src/shared/host/headlessTape';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const stage=process.argv[2]??'bench';
if(stage!=='bench'&&stage!=='reef')throw new Error('Unknown optional Driftwood tape');
const earned=stage==='bench'?'used:vista-bench':'open:reef-treasure';
const started=performance.now();
const trace=(phase:string):void=>{console.info(JSON.stringify({stage,phase,ms:performance.now()-started}));};
const session=await beginFolderSession('driftwood-isle','driftwood'),{product,assets}=session;
trace('product-started');
let stopReplay:(()=>Promise<void>)|undefined;
let negativeSession:Awaited<ReturnType<typeof beginFolderSession>>|undefined;
let resident:Awaited<ReturnType<typeof createNativeProofResident>>|undefined,releaseRopes=()=>{ /* No rope owner before installation. */ };
try{
  // Admit the independent counterfactual before recording, rather than after
  // the entire checked positive route has consumed the child budget.
  negativeSession=await beginFolderSession('driftwood-isle','driftwood');trace('negative-product-started');
  // Admission failure is observed even while the recorder is initializing.
  const negativeOwner=negativeSession;
  const negativeOutcome=(async()=>{
    try{const sim=await negativeOwner.ready();trace('negative-ready');return {ok:true as const,sim};}
    catch(error){return {ok:false as const,error};}
  })();
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  resident=await createNativeProofResident({shard:product.shardfile,assets,product,rapier},prepareHeadlessRuntime);
  const active=resident,{host}=active,sim=await session.ready();releaseRopes=installWalkRopeBodies(host,product);installNativeWalkBounds(host);
  trace('capture-ready');
  const spots=readNativeQuestSpots(DRIFTWOOD_SPOTS),index=spots.rows.findIndex(row=>row.id===(stage==='bench'?'vista-bench':'reef-treasure')),bench=spots.rows[index];assert.ok(bench);
  const use:HeadlessCommand={kind:'script',actorId:policy.actor,value:policy.actions.row+index};
  const schema=v.object({counts:v.record(v.string(),v.number())});
  const counts=()=>v.parse(schema,host.adapters.get(policy.step)?.snapshot()).counts;
  const parts:HeadlessTapeSegment[]=[],observations:HeadlessTapeObservation[]=[],encoder=new TextEncoder();
  let frames:HeadlessCommand[][]=[],effects:HeadlessEffect[]=[],peakY=leadPlayer(host).position.y,ticks=0,commandsCount=0,bytes=0,divingTicks=0,boardTicks=0,identicalPhysics=0,canonicalPhysics=0;
  let captureMs=0,replayMs=0,backpressureMs=0,negativeMs=0,omitted=0;
  const pipeline=checkedReplayPipeline<{segment:HeadlessTapeSegment;wanted:HeadlessTapeObservation;snapshot:ReturnType<typeof snapshotSimHostBytes>}>(async({segment,wanted,snapshot})=>{
    const positive=async():Promise<void>=>{
      const replayStarted=performance.now(),replay=await sim.verbTapePart({version:1,observe:[],segments:[segment]});replayMs+=performance.now()-replayStarted;
      assert.deepEqual(replay.report.observations,[wanted],'fresh inputs preserve every boundary observation and effect');
      const {physics:actualPhysics,...actual}=decodeSimSnapshot(replay.commit.snapshot),{physics:expectedPhysics,...expected}=snapshot;
      assert.deepEqual(actual,expected,'every native continuation field is exact');
      if(sameBytes(actualPhysics,expectedPhysics))identicalPhysics++;
      else{canonicalPhysics++;assert.deepEqual(physicsState(actualPhysics),physicsState(expectedPhysics),'every native physics value is exact');}
    };
    const counterfactual=async():Promise<void>=>{
      const ready=await negativeOutcome;if(!ready.ok)throw ready.error;
      const unarmed=segment.frames?.map(frame=>frame.flatMap(command=>{
        if(stage==='bench'&&command.kind==='script'&&command.actorId===use.actorId&&command.value===use.value){omitted++;return [];}
        if(stage==='reef'&&command.kind==='player'&&command.dive===true){const rest={...command};delete rest.dive;omitted++;return [rest];}
        return [command];
      }));assert.ok(unarmed);
      const negativeStarted=performance.now(),replay=await ready.sim.verbTapePart({version:1,observe:[],segments:[{...segment,frames:unarmed}]});
      negativeMs+=performance.now()-negativeStarted;
      const actual=replay.report.observations[0];assert.ok(actual);assert.equal(actual.flags.includes(earned),false);
      if(stage==='reef')assert.equal(actual.flags.includes('found:reef-treasure'),false);
      assert.equal(actual.effects.some(effect=>effect.kind==='fact'&&effect.name===(stage==='bench'?'driftwood.vista':'driftwood.treasure')),false);
      for(const flag of ['glass:1','glass:2'])assert.equal(actual.flags.includes(flag),wanted.flags.includes(flag),'only movement picks up sea glass');
    };
    // Drain BOTH independently owned replies before accepting the next part or
    // disposing either owner, including when one comparison refuses.
    const results=await Promise.allSettled([positive(),counterfactual()]);
    for(const result of results)if(result.status==='rejected')throw result.reason;
  });stopReplay=pipeline.stop;
  const flush=async(id:string):Promise<void>=>{
    if(frames.length===0)return;
    const segment:HeadlessTapeSegment={id,ticks:frames.length,commands:[],frames};frames=[];parts.push(segment);
    const wanted:HeadlessTapeObservation={id,tick:host.state.tick,position:leadPlayer(host).position.toArray(),peakY,
      grounded:leadPlayer(host).motor.snapshot().result.grounded,flags:[...host.flags.all],
      quests:host.quests.map(row=>({id:row.def.id,currentId:row.current?.id??null,started:row.snapshot().started,complete:row.isComplete})),effects,adapters:[]};
    effects=[];peakY=leadPlayer(host).position.y;observations.push(wanted);
    bytes+=encoder.encode(JSON.stringify(wanted)).byteLength;assert.ok(bytes<=8_000_000);assert.ok(parts.length<=128);
    const snapshot=snapshotSimHostBytes(host),offered=performance.now();
    await pipeline.offer({segment,wanted,snapshot});backpressureMs+=performance.now()-offered;
  };
  const step=async(commands:HeadlessCommand[]):Promise<void>=>{
    pipeline.check();ticks++;commandsCount+=commands.length;assert.ok(ticks<=30_000&&commandsCount<=60_000);
    const captureStarted=performance.now();active.step(commands);captureMs+=performance.now()-captureStarted;if(leadPlayer(host).swim.diving)divingTicks++;if(leadPlayer(host).board.on)boardTicks++;frames.push(structuredClone(commands));effects.push(...structuredClone(active.effects));peakY=Math.max(peakY,leadPlayer(host).position.y);
    if(frames.length===512)await flush(`walk-${parts.length}`);
  };
  const wait=async(n:number)=>{for(let i=0;i<n;i++)await step([]);};
  const go=async(x:number,z:number):Promise<void>=>{
    for(let i=0;i<3600;i++){
      const p=leadPlayer(host).position,dx=x-p.x,dz=z-p.z,d=Math.hypot(dx,dz);
      if(leadPlayer(host).board.on){
        const velocity=leadPlayer(host).velocity;if(d<.25&&Math.hypot(velocity.x,velocity.z)<.25)return;
        const speed=Math.min(9,d*1.2),length=Math.max(.01,d),ex=dx/length*speed-velocity.x,ez=dz/length*speed-velocity.z,k=Math.max(3,Math.hypot(ex,ez));
        await step([{kind:'player',moveX:ex/k,moveZ:ez/k,yaw:Math.atan2(-dx,-dz)}]);
      }else{
        if(d<.25)return;const k=Math.min(1,d/.8)/Math.max(.01,d);
        await step([{kind:'player',moveX:dx*k,moveZ:dz*k,yaw:Math.atan2(-dx,-dz)}]);
      }
    }
    const p=leadPlayer(host).position,dx=x-p.x,dz=z-p.z,d=Math.hypot(dx,dz);
    const hits=[.1,.5,1,1.6].map(height=>{const hit=castRay(host.physics,{x:p.x,y:p.y+height,z:p.z},{x:dx/d,y:0,z:dz/d},5,undefined,leadPlayer(host).motor.collider);
      return hit===null?null:{height,material:hit.material,distance:hit.distance,point:hit.point,normal:hit.normal,owner:typeof hit.owner==='object'&&hit.owner!==null?Reflect.get(hit.owner,'id'):hit.owner};});
    throw new Error(`Optional Driftwood walk stuck ${JSON.stringify({at:p.toArray(),target:[x,z],swim:leadPlayer(host).swim,motor:leadPlayer(host).motor.snapshot().result,
      ground:host.groundHeightAt(p.x,p.z),aheadGround:host.groundHeightAt(x,z),floor:floorBelow(host.physics,p.x,p.z,p.y+2,10,leadPlayer(host).motor.collider),hits})}`);
  };
  if(stage==='bench'){
  await step([use]);await flush('bench-out-of-reach');assert.equal(host.flags.has('used:vista-bench'),false);
  for(const [x,z] of [[0,-186.5],[-8,-172],[-17,-161],[-20,-150],[-20,-146]] as const)await go(x,z);
  await flush('glass-1');assert.ok(host.flags.has('glass:1'));assert.equal(counts()['glass'],1);
  await wait(120);await flush('glass-1-repeat');assert.equal(counts()['glass'],1);
  for(const [x,z] of [[-30,-142],[-30,-130],[-30,-126]] as const)await go(x,z);
  await flush('glass-2');assert.ok(host.flags.has('glass:2'));assert.equal(counts()['glass'],2);
  for(const [x,z] of [[-30,-118],[-30,-106],[-30,-104],[bench.x,bench.z+1]] as const)await go(x,z);
  await flush('bench-in-reach');assert.equal(host.flags.has('used:vista-bench'),false);
  await step([use]);await flush('bench-use');assert.ok(host.flags.has('used:vista-bench'));assert.equal(counts()['vista'],1);
  await wait(60);await step([use]);await flush('bench-repeat');assert.equal(counts()['vista'],1);assert.equal(counts()['glass'],2);
  for(const flag of ['talked:castaway','has:flint','quest:driftwood-done','open:reef-treasure'])assert.equal(host.flags.has(flag),false,flag);
  assert.equal(host.quests.some(row=>row.isComplete),false);assert.equal(sim.quarantined,false);
  const awarded=observations.flatMap(row=>row.effects);
  assert.equal(awarded.filter(effect=>effect.kind==='fact'&&effect.name==='driftwood.glass').length,2);
  assert.equal(awarded.filter(effect=>effect.kind==='fact'&&effect.name==='driftwood.vista').length,1);
  }else{
    const prompt=bench.prompt;assert.ok(prompt);
    const pack=()=>v.parse(v.object({pack:v.object({counts:v.record(v.string(),v.number())})}),host.adapters.get(policy.step)?.snapshot()).pack.counts;
    await step([use]);await flush('reef-out-of-reach');assert.equal(host.flags.has(earned),false);
    for(const [x,z] of [[0,-186.5],[-8,-172],[-17,-161],[-20,-150],[-30,-142],[-30,-130],[-30,-118],[-30,-106],[-30,-104],
      [-24,-80],[-22,-71.5],[-8,-50],[10.8,-27.8],[15.4,-8.6],[15.6,-7],[62,0],[80,-1.5],[100,-2],[124,1.5],
      [124,-15],[145,-25],[170,-25]] as const)await go(x,z);
    await step([{kind:'player',moveX:0,moveZ:0,yaw:leadPlayer(host).yaw,hover:true}]);assert.equal(leadPlayer(host).board.on,true);
    for(const [x,z] of [[200,-25],[235,-25],[235,20],[232.8,48]] as const)await go(x,z);
    await step([{kind:'player',moveX:0,moveZ:0,yaw:leadPlayer(host).yaw,hover:true}]);assert.equal(leadPlayer(host).board.on,false);
    await wait(120);await flush('reef-surface');assert.equal(leadPlayer(host).swim.on,true);assert.ok(boardTicks>0);
    await step([use]);await flush('reef-surface-use');assert.equal(host.flags.has(earned),false);assert.equal(host.flags.has('found:reef-treasure'),false);assert.equal(pack()['doubloon']??0,0);
    const range=v.parse(v.pipe(v.number(),v.minValue(0)),REEF_TREASURE.reach);
    const reach=()=>eyeReaches(leadPlayer(host).position,{...prompt,radius:range});
    for(let i=0;i<180&&!reach();i++)await step([{kind:'player',moveX:0,moveZ:0,yaw:leadPlayer(host).yaw,dive:true}]);
    await flush('reef-dived');assert.ok(reach(),'actual DIVE must bring the underwater chest within reach');assert.ok(divingTicks>0);
    assert.equal(host.flags.has(earned),false);
    await step([{kind:'player',moveX:0,moveZ:0,yaw:leadPlayer(host).yaw,dive:true},use]);await flush('reef-open');
    assert.ok(host.flags.has(earned));assert.ok(host.flags.has('found:reef-treasure'));assert.equal(pack()['doubloon'],8);
    await step([{kind:'player',moveX:0,moveZ:0,yaw:leadPlayer(host).yaw,dive:true},use]);await flush('reef-repeat');assert.equal(pack()['doubloon'],8);
    assert.equal(observations.flatMap(row=>row.effects).filter(effect=>effect.kind==='fact'&&effect.name==='driftwood.treasure').length,1);
    for(const flag of ['talked:castaway','has:flint','quest:driftwood-done','used:vista-bench'])assert.equal(host.flags.has(flag),false,flag);
    assert.equal(sim.quarantined,false);
  }
  await pipeline.finish();assert.equal(sim.quarantined,false);trace('positive-complete');
  const negative=await negativeOutcome;if(!negative.ok)throw negative.error;
  assert.ok(omitted>0);assert.equal(negative.sim.quarantined,false);trace('negative-complete');
  console.info(JSON.stringify({story:stage==='bench'?'driftwood-optional':'driftwood-reef',ticks,commands:commandsCount,parts:parts.length,glass:counts()['glass'],vista:counts()['vista'],doubloons:v.parse(v.object({pack:v.object({counts:v.record(v.string(),v.number())})}),host.adapters.get(policy.step)?.snapshot()).pack.counts['doubloon']??0,divingTicks,boardTicks,identicalPhysics,canonicalPhysics,captureMs,replayMs,backpressureMs,negativeMs,milliseconds:performance.now()-started}));
}finally{await stopReplay?.();releaseRopes();resident?.dispose();await Promise.all([session.ready().then(sim=>sim.dispose()),negativeSession?.ready().then(sim=>sim.dispose())]);}
