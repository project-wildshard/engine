// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert only earned native combat and independent replay.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Admit the named product and unchanged repository physics bytes.
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import * as v from 'valibot';
import {Vector3} from 'three';
import {builtProduct} from '../builtProduct';
import {loadHeadlessProduct} from '../../../src/server/host/headlessProduct';
import {outputDescriptor} from '../../../src/shared/game/shardfile/outputDescriptor';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {canonicalSimDigest} from '../../fake/simState';
import {decodeSimSnapshot,snapshotSimHost,serializeSimSnapshot} from '../../../src/shared/engine/sim/snapshot';
import {HeldBowFileSchema} from '@wildshard/format/weaponProfiles';
import {parseHeldSlots} from '@wildshard/format/heldArms';
import {heldBowBase} from '../../../src/shared/game/weapons/heldBowBase';
import {bowLaunchSpeed} from '../../../src/shared/engine/combat/bowLaw';
import {runTrustedHeadlessTape,type HeadlessTapeObservation} from '../../../src/shared/host/headlessTape';
import type {HeadlessCommand,HeadlessEffect,HeadlessTickCommit} from '../../../src/shared/host/tickProtocol';
import {createNativeProofResident} from '../headless-native';
import {prepareHeadlessRuntime,nalatiQaraOf} from '../nalati-qara-native';
import {nalatiPatrolOf} from '../nalati-patrol-native';
import {beginProductSession} from './productSession';
import {checkedReplayPipeline} from './checkedReplayPipeline';
import {QaraHandoffSchema,checkQaraLedger,qaraWireHash,qaraObservationHash,qaraCommandHash,type QaraHandoff,type QaraPart} from './qaraHandoff';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const [stage,inputPath,outputPath,inputHash]=process.argv.slice(2);
assert.ok(stage==='night'||stage==='patrol'||stage==='bow'||stage==='victory');assert.ok(inputPath);assert.ok(outputPath);
let inherited:QaraHandoff|undefined;
if(stage!=='night'){
  assert.ok(inputHash);assert.ok(statSync(inputPath).size<=32_000_000);
  const wire=readFileSync(inputPath,'utf8');assert.equal(qaraWireHash(wire),inputHash,"use the preceding case's checked handoff");
  inherited=v.parse(QaraHandoffSchema,JSON.parse(wire));checkQaraLedger(inherited.parts,inherited.nightTick,inherited.ticks);
}
const started=performance.now(),phases:{id:string;tick:number;ms:number}[]=[];
const trace=(id:string,tick:number):void=>{console.info(JSON.stringify({stage,id,tick,ms:performance.now()-started}));};
const mark=(id:string,tick:number):void=>{phases.push({id,tick,ms:performance.now()-started});trace(id,tick);};
const directory=builtProduct('nalati-grasslands'),product=await loadHeadlessProduct(directory),shard=product.shardfile;
const descriptor=outputDescriptor(shard);assert.ok(descriptor);
const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
if(inherited!==undefined)assert.equal(canonicalSimDigest(decodeSimSnapshot(inherited.snapshot)),inherited.digest);
assert.ok(descriptor.indexHash,'the handoff requires its independently verified product index');
const sourceHash=descriptor.indexHash;if(inherited!==undefined)assert.equal(inherited.source,sourceHash);
const resident=await createNativeProofResident({shard,assets,rapier,product},prepareHeadlessRuntime,inherited?.snapshot);
let session:Awaited<ReturnType<typeof beginProductSession>>|undefined;
let replay:Awaited<ReturnType<Awaited<ReturnType<typeof beginProductSession>>['ready']>>|undefined;
let failed=false;
let pipeline:ReturnType<typeof checkedReplayPipeline<QaraPart>>|undefined;
const dispose=async():Promise<void>=>{await pipeline?.stop();resident.dispose();const worker=replay??await session?.ready();await worker?.dispose();};
try{
  const host=resident.host,patrol=nalatiPatrolOf(host),qara=nalatiQaraOf(host);assert.ok(patrol);assert.ok(qara);
  const idle:HeadlessCommand[]=[{kind:'player',moveX:0,moveZ:0,yaw:0,commandVersion:1,crouch:true,steer:{keyX:0,keyY:0,stickX:0,stickY:0}}];
  if(stage==='night'){
    assert.equal(patrol.law.riders.length,0);assert.equal(patrol.readiness.eligible,false);assert.equal(qara.captain(),null);
    runTrustedHeadlessTape(host,commands=>resident.step(commands),()=>resident.effects,{version:1,observe:[],segments:[{
      id:'camp-road',ticks:3600,commands:[],route:[{x:0,z:216},{x:20,z:216},{x:40,z:218},{x:60,z:214}],
    }]});
    for(let tick=0;tick<60_000&&patrol.law.riders.length===0;tick++){
      resident.step(idle);assert.equal(leadPlayer(host).health.alive,true);assert.equal(patrol.readiness.eligible,false);assert.equal(qara.captain(),null);
    }
    assert.ok(patrol.law.riders.length>0);assert.equal(host.dayClock?.dayPhase,'night');assert.equal(patrol.law.killsTonight,0);
  }else{assert.ok(inherited);assert.equal(canonicalSimDigest(snapshotSimHost(host)),inherited.digest,'the recorder restores the exact earned state');}
  const nightTick=inherited?.nightTick??host.state.tick,checkpoint=serializeSimSnapshot(snapshotSimHost(host));
  const motion=new Map<string,{x:number;z:number;vx:number;vz:number}>(inherited?.motion);
  const TRAIL_TICKS=12,trail=new Map<string,[number,number,number][]>();
  if(inherited===undefined)for(const rider of patrol.law.riders)motion.set(rider.a.entityId,{x:rider.a.position.x,z:rider.a.position.z,vx:0,vz:0});
  const history:QaraPart[]=inherited?.parts??[];
  let ticks=inherited?.ticks??0;
  const save=():void=>{
    trace('handoff-snapshot',host.state.tick);checkQaraLedger(history,nightTick,ticks);const snapshot=snapshotSimHost(host);
    const handoff:QaraHandoff={version:1,source:sourceHash,snapshot:serializeSimSnapshot(snapshot),digest:canonicalSimDigest(snapshot),nightTick,ticks,parts:history,motion:[...motion]};
    trace('handoff-codec',host.state.tick);const wire=JSON.stringify(v.parse(QaraHandoffSchema,handoff));assert.ok(Buffer.byteLength(wire)<=32_000_000);
    assert.equal(qaraCommandHash(v.parse(QaraHandoffSchema,JSON.parse(wire)).parts),qaraCommandHash(history),
      'handoff retains every original command value, including signed zero');
    trace('handoff-write',host.state.tick);writeFileSync(outputPath,wire,{flag:'wx',mode:0o600});
    console.info(JSON.stringify({story:`qara-${stage}`,hash:qaraWireHash(wire),tick:host.state.tick,ticks,parts:history.length,ms:performance.now()-started,phases}));
  };
  if(stage==='night'){mark('earned-night',host.state.tick);save();}
  else{
  session=await beginProductSession('nalati-grasslands','nalati-qara',checkpoint);
  const source=v.parse(HeldBowFileSchema,await product.json('weapons/bow-page.json')),bow=heldBowBase({bow:source.bow,base:source.base});
  const head=new Vector3(),observed=['nalati.patrol','nalati.qara','nalati.weapons'];
  const ready=session.ready();
  let final:HeadlessTickCommit|undefined,replayedTicks=0,replayMs=0,captureMs=0;
  pipeline=checkedReplayPipeline<QaraPart>(async part=>{
    const expected=part.expected.observations[0];assert.ok(expected);
    trace('worker-ready-await',expected.tick);const worker=await ready;replay=worker;trace('worker-request',expected.tick);
    const before=performance.now(),repeated=await worker.verbTapePart(part.plan);replayMs+=performance.now()-before;
    trace('worker-reply',repeated.commit.tick);assert.deepEqual(repeated.report,part.expected,'fresh worker must reproduce all native observations and ordered effects');
    trace('report-compared',expected.tick);final=repeated.commit;replayedTicks+=repeated.report.ticks;
  });
  let frames:HeadlessCommand[][]=[],effects:HeadlessEffect[]=[],peakY=leadPlayer(host).position.y;
  const firstTick=ticks;
  const flush=async():Promise<void>=>{
    if(frames.length===0)return;assert.ok(pipeline);
    const id=`fight-${history.length}`;
    const expected:HeadlessTapeObservation={id,tick:host.state.tick,position:leadPlayer(host).position.toArray(),peakY,grounded:leadPlayer(host).motor.snapshot().result.grounded,
      flags:[...host.flags.all],quests:host.quests.map(quest=>({id:quest.def.id,currentId:quest.current?.id??null,started:quest.snapshot().started,complete:quest.isComplete})),
      effects,adapters:observed.map(identity=>{const adapter=host.adapters.get(identity);assert.ok(adapter);const state=adapter.snapshot();assert.equal(typeof state,'string');
        if(typeof state!=='string')throw new Error('Missing native fight observation');return {id:identity,state};})};
    const part:QaraPart={plan:{version:1,observe:observed,segments:[{id,ticks:frames.length,commands:[],frames}]},expected:{version:1,ticks:frames.length,observations:[expected]}};
    history.push(part);checkQaraLedger(history,nightTick,ticks);
    frames=[];effects=[];peakY=leadPlayer(host).position.y;
    trace('offer-part',host.state.tick);await pipeline.offer(part);trace('offered-part',host.state.tick);
  };
  const complete=async():Promise<void>=>{
    trace('complete-flush',host.state.tick);await flush();assert.ok(pipeline);trace('complete-drain',host.state.tick);await pipeline.finish();assert.ok(final);assert.ok(replay);trace('complete-canonical',host.state.tick);
    assert.equal(replayedTicks,ticks-firstTick);
    assert.equal(canonicalSimDigest(decodeSimSnapshot(final.snapshot)),canonicalSimDigest(snapshotSimHost(host)),
      'the complete native fight retains its canonical continuation');
    assert.equal(replay.quarantined,false);
    mark('checked-replay',host.state.tick);
    console.info(JSON.stringify({stage,phases,captureMs,replayMs,ticks,parts:history.length}));
  };
  const step=async(commands:readonly HeadlessCommand[]):Promise<void>=>{
    pipeline?.check();frames.push(structuredClone([...commands]));const before=performance.now();resident.step(commands);captureMs+=performance.now()-before;effects.push(...resident.effects);ticks++;peakY=Math.max(peakY,leadPlayer(host).position.y);
    for(const rider of patrol.law.riders){
      const p=rider.a.position,old=motion.get(rider.a.entityId);
      motion.set(rider.a.entityId,{x:p.x,z:p.z,vx:old===undefined?0:(p.x-old.x)*60,vz:old===undefined?0:(p.z-old.z)*60});
      const past=trail.get(rider.a.entityId)??[];past.push([p.x,p.y,p.z]);if(past.length>TRAIL_TICKS*2+1)past.shift();trail.set(rider.a.entityId,past);
    }
    assert.equal(leadPlayer(host).health.alive,true,'ordinary combat must keep the player alive');assert.ok(ticks<=60_000,'one fight retains the original tape tick budget');
    if(ticks%512===0)await flush();
  };
  const nearest=()=>patrol.law.riders.filter(row=>row.a.alive&&!row.a.hidden&&row.a!==qara.captain())
    .sort((a,b)=>a.a.position.distanceToSquared(leadPlayer(host).position)-b.a.position.distanceToSquared(leadPlayer(host).position))[0]?.a;
  const approach=async(captain:boolean):Promise<void>=>{
    const target=captain?qara.captain():patrol.law.riders.find(row=>row.a.alive&&!row.a.hidden&&row.a!==qara.captain())?.a;
    assert.ok(target,'the approach must select a real living body');
    if(!leadPlayer(host).board.on)await step([{kind:'player',moveX:0,moveZ:0,yaw:0,hover:true}]);
    let arrived=false;
    for(let tick=0;tick<3600;tick++){
      if(!target.alive)break;
      const p=leadPlayer(host).position,dx=target.position.x-p.x,dz=target.position.z-p.z,d=Math.hypot(dx,dz);
      if(d<20){arrived=true;break;}
      await step([{kind:'player',moveX:dx/d,moveZ:dz/d,yaw:Math.atan2(-dx,-dz),...(tick%90===60?{jump:true}:{})}]);
    }
    if(leadPlayer(host).board.on)await step([{kind:'player',moveX:0,moveZ:0,yaw:0,hover:true}]);
    for(let tick=0;tick<90;tick++)await step(idle);
    assert.ok(arrived,'actual hover inputs must approach the live target');
  };
  const aim=(held:boolean,captain:boolean):HeadlessCommand[]=>{
    const target=captain?qara.captain():nearest();if(target===undefined||target===null)return idle;
    const feet=leadPlayer(host).position;patrol.aimPoint(target,head);
    const time=Math.hypot(head.x-feet.x,head.z-feet.z)/bowLaunchSpeed(bow.base,1);
    // A rider curves and climbs: lead what the last ticks show, because 0.5 s of arc is wider than the body row.
    const lead=(axis:0|1|2,flat:number):number=>{
      const past=trail.get(target.entityId),[a,b,c]=past?.length===TRAIL_TICKS*2+1?[past[0],past[TRAIL_TICKS],past[TRAIL_TICKS*2]]:[];
      if(a===undefined||b===undefined||c===undefined)return flat*time;
      const span=TRAIL_TICKS/60,acceleration=(c[axis]-2*b[axis]+a[axis])/(span*span);
      return ((c[axis]-b[axis])/span+acceleration*span/2)*time+.5*acceleration*time*time;
    };
    const velocity=motion.get(target.entityId);
    head.x+=lead(0,velocity?.vx??0);head.y+=lead(1,0)+.5*bow.rows.arrow.gravity*time*time;head.z+=lead(2,velocity?.vz??0);
    const dx=head.x-feet.x,dz=head.z-feet.z;
    return [{kind:'player',moveX:0,moveZ:0,yaw:Math.atan2(-dx,-dz),commandVersion:1,steer:{keyX:0,keyY:0,stickX:0,stickY:0},...(held?{heavy:{}}:{})},
      {kind:'script',actorId:'nalati.weapon.aim',value:1},{kind:'script',actorId:'nalati.weapon.pitch',value:Math.atan2(head.y-feet.y-1.68,Math.hypot(dx,dz))}];
  };
  const hold=Math.ceil((bow.base.draw?.drawTime??.75)*60)+15;
  const weaponState=()=>{
    const owner=host.adapters.get('nalati.weapons');assert.ok(owner);
    const saved=owner.snapshot();assert.equal(typeof saved,'string');if(typeof saved!=='string')throw new Error('Missing actual weapon observation');
    return v.parse(v.object({slot:v.string(),bolts:v.number(),blade:v.object({contacts:v.number()})}),JSON.parse(saved));
  };
  if(stage==='patrol'){
  for(let shot=0;shot<bow.base.quiver&&patrol.law.killsTonight<5;shot++){
    if(nearest()===undefined){for(let tick=0;tick<4200&&nearest()===undefined;tick++)await step(idle);}
    const target=nearest();assert.ok(target,'the next ordinary patrol must materialize its own riders');
    if(target.position.distanceTo(leadPlayer(host).position)>60)await approach(false);
    for(let tick=0;tick<hold;tick++)await step(aim(true,false));await step(aim(false,false));for(let tick=0;tick<75;tick++)await step(idle);
    console.error(JSON.stringify({stage:'rider-shot',shot,kills:patrol.law.killsTonight,tick:host.state.tick,feet:leadPlayer(host).position.toArray(),
      riders:patrol.law.riders.map(row=>({id:row.a.entityId,hp:row.a.hp,distance:row.a.position.distanceTo(leadPlayer(host).position)}))}));
  }
  assert.ok(patrol.law.killsTonight>=5,'five actual rider deaths must open the gate');
  for(let tick=0;tick<12;tick++)await step(idle);
  assert.equal(patrol.readiness.eligible,true);const captain=qara.captain();assert.ok(captain?.alive,'the original lair must spawn its own eligible captain');
  mark('earned-unlock',host.state.tick);await complete();save();
  }else if(stage==='bow'){
  assert.equal(patrol.readiness.eligible,true);assert.ok(patrol.law.killsTonight>=5);
  const captain=qara.captain();assert.ok(captain?.alive,'the preceding five actual kills earned a living captain');
  await approach(true);
  for(let shot=0;shot<bow.base.quiver&&captain.alive;shot++){
    if(weaponState().bolts===0)break;
    for(let tick=0;tick<hold;tick++)await step(aim(true,true));await step(aim(false,true));for(let tick=0;tick<75;tick++)await step(idle);
    console.error(JSON.stringify({stage:'captain-shot',shot,hp:qara.captain()?.hp,tick:host.state.tick}));
  }
  mark('quiver-exhausted',host.state.tick);await complete();save();
  }else{
  assert.equal(patrol.readiness.eligible,true);assert.ok(patrol.law.killsTonight>=5);
  const captain=qara.captain();assert.ok(captain);
  assert.equal(weaponState().bolts,0,'the preceding real fight exhausted the quiver');
  if(captain.alive){
    const slots=parseHeldSlots(await product.json('held/slots.json')),blade=slots.slots.find(row=>row.kind==='blade');assert.ok(blade);
    for(let swaps=0;swaps<slots.registration.length&&weaponState().slot!==blade.id;swaps++)
      await step([...idle,{kind:'script',actorId:'nalati.weapon.swap',value:1}]);
    assert.equal(weaponState().slot,blade.id,'empty arrows require a real weapon swap, not an ammo grant');
    for(let tick=0;tick<3600&&captain.alive;tick++){
      const p=leadPlayer(host).position,dx=captain.position.x-p.x,dz=captain.position.z-p.z,d=Math.max(.01,Math.hypot(dx,dz));
      patrol.aimPoint(captain,head);
      // Version-one movement is the real local stick, resolved against this
      // facing. World move fields cannot substitute for a released stick.
      await step([{kind:'player',moveX:0,moveZ:0,yaw:Math.atan2(-dx,-dz),commandVersion:1,
        steer:{keyX:0,keyY:0,stickX:d>2?0:.3,stickY:d>2?1:0}},
        {kind:'script',actorId:'nalati.weapon.pitch',value:Math.atan2(head.y-p.y-1.68,d)},
        ...(tick%24===0?[{kind:'script' as const,actorId:'nalati.weapon.attack',value:1}]:[])]);
      if(tick%120===0)console.error(JSON.stringify({stage:'captain-sabre',hp:captain.hp,health:leadPlayer(host).health.attributes.health,
        distance:d,tick:host.state.tick,weapon:weaponState()}));
    }
  }
  await step(idle);assert.equal(captain.alive,false,'actual weapon contacts must fell Qara');
  assert.equal(qara.core.entry('qara-batyr')?.phase2,true,'real damage must enter the original second phase');
  const owner=host.adapters.get('nalati.qara');assert.ok(owner);const state=owner.snapshot();assert.equal(typeof state,'string');
  if(typeof state!=='string')throw new Error('Missing complete captain observation');
  const fight=v.parse(v.object({supports:v.number(),signatures:v.number()}),JSON.parse(state));
  assert.ok(fight.supports>=3,'actual engagement must call the original support line');
  assert.ok(fight.signatures>0,'the admitted charge must execute its signature');
  assert.equal(qara.core.record('qara-batyr')?.kills,1);assert.equal(qara.core.entry('qara-batyr')?.state,'dead');
  await complete();
  console.info(JSON.stringify({story:'nalati-qara-full-fight',nightTick,kills:patrol.law.killsTonight,ticks,segments:history.length,ms:performance.now()-started,phases,
    inputHash:qaraCommandHash(history),observationHash:qaraObservationHash(history.flatMap(part=>part.expected.observations),nightTick),saveHash:canonicalSimDigest(snapshotSimHost(host))}));
  }
  }
}catch(error){failed=true;throw error;}finally{
  if(failed){try{await dispose();}catch(error){console.error('Secondary native worker cleanup failure',error);}}
  else await dispose();
}
