// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert only actual input outcomes and independent native replay.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the admitted named product and shipped physics binary.
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import * as v from 'valibot';
import {builtFolder} from '../builtFolder';
import {loadHeadlessFolder} from '../../../src/server/host/headlessFolder';
import {folderHeadlessSections} from '../../../src/shared/host/headlessSections';
import {outputDescriptor} from '../../../src/shared/game/shardfile/outputDescriptor';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {snapshotSimHostBytes,serializeSimSnapshot,decodeSimSnapshotBytes} from '../../../src/shared/engine/sim/snapshot';
import {canonicalSimDigest} from '../../fake/simState';
import {createNativeProofResident} from '../headless-native';
import {createNativeProofWorker} from '../headless-worker';
import {prepareHeadlessRuntime,nalatiTitanOf} from '../nalati-titan-native';
import {readArenaScriptData} from '../../../src/shared/game/boss/openArenaFight';
import {questObservation} from '../../../src/shared/game/quest/questObservation';
import {parseChapterStoryPresentation} from '@wildshard/format/questStory';
import {reachTitanCairn} from '../../proof/nalati-grasslands/titanTravel';
import {titanBowPilot,titanRidersPilot} from '../../proof/nalati-grasslands/titanCombat';
import {checkedReplayPipeline} from './checkedReplayPipeline';
import type {HeadlessTapeObservation} from '../../../src/shared/host/headlessTape';
import {TitanHandoffSchema,checkTitanLedger,titanWireHash,titanInputDigest,titanObservationDigest,type TitanHandoff,type TitanPart} from './titanHandoff';
import type {HeadlessCommand,HeadlessEffect} from '../../../src/shared/host/tickProtocol';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const [stage,handoffPath,handoffHash,outputPath]=process.argv.slice(2);
assert.ok(stage==='entry'||stage==='opening'||stage==='retry'||stage==='victory','name the bounded Titan case');assert.ok(handoffPath);
let inherited:TitanHandoff|undefined;
if(stage!=='entry'){
  assert.ok(handoffHash);assert.ok(statSync(handoffPath).size<=32_000_000);
  const wire=readFileSync(handoffPath,'utf8');assert.equal(titanWireHash(wire),handoffHash,'use only the preceding case\'s actual checked handoff');
  inherited=v.parse(TitanHandoffSchema,JSON.parse(wire));checkTitanLedger(inherited.parts,inherited.checkpointTick);
  assert.equal(inherited.stage,stage==='opening'?'storm':stage==='retry'?'fire':'retry','consume only the immediately preceding earned stage');
  if(stage==='opening'||stage==='retry')assert.ok(outputPath);
}
const directory=builtFolder('nalati-grasslands'),product=await loadHeadlessFolder(directory),shard=product.shardfile;
const descriptor=outputDescriptor(shard);assert.ok(descriptor);
const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const source=titanWireHash(JSON.stringify(shard));if(inherited!==undefined)assert.equal(inherited.source,source,'all stages use the same admitted product');
const resident=await createNativeProofResident({product,shard,assets,rapier},prepareHeadlessRuntime,inherited?.snapshot);
type Replay=Awaited<ReturnType<typeof createNativeProofWorker>>;
let pending:Promise<{ok:true;worker:Replay}|{ok:false;error:unknown}>|undefined,replay:Replay|undefined;
let pipeline:ReturnType<typeof checkedReplayPipeline<Part>>|undefined;
type Part=TitanPart;
const historyTick=(parts:readonly Part[]):number|undefined=>parts.at(-1)?.expected.observations[0]?.tick;
const started=performance.now();
try{
  const {host}=resident,titan=nalatiTitanOf(host);assert.ok(titan);
  const rows=await readArenaScriptData(product,{fight:'combat/titan-fight.json',geometry:'combat/titan-geometry.json'});
  const initial=titan.records.bosses.read()[rows.definition.id],initialKills=inherited?.initialKills??initial?.kills??0;
  if(inherited!==undefined){assert.equal(canonicalSimDigest(snapshotSimHostBytes(host)),inherited.digest,'the capture resident restores the exact earned checkpoint');
    assert.equal(host.state.tick,inherited.captureTicks);assert.equal(historyTick(inherited.parts)??inherited.checkpointTick,host.state.tick);
    assert.equal(titan.fight.phase,inherited.stage==='storm'?0:2);
    if(inherited.stage!=='retry')assert.equal(titan.fight.tied,inherited.stage==='fire');
    else{assert.ok(titan.boss.attempts>1);assert.ok(leadPlayer(host).health.attributes.health>0);assert.equal(titan.boss.state,'fight');assert.equal(titan.fight.body.visible,true);}
    if(inherited.stage==='storm'){assert.equal(titan.boss.state,'dormant');assert.equal(titan.storm(),true);}}
  assert.equal(initial?.defeated??false,false);assert.equal(initial?.rewardTaken??false,false);
  const deaths:{tick:number;phase:number;checkpoint:boolean}[]=structuredClone(inherited?.deaths??[]);
  host.events.on('player.died',event=>{deaths.push({tick:host.state.tick,phase:titan.fight.phase,checkpoint:event.checkpoint});},host.scope);
  const fireTick=inherited?.stage==='fire'?inherited.captureTicks:inherited?.stage==='retry'?inherited.fireTick:undefined;
  const fenceTick=fireTick??host.state.tick;
  const observed=['nalati.titan','nalati.weapons','nalati.chapter-records'];
  const history:Part[]=inherited?.parts??[];
  let captureTicks=inherited?.captureTicks??0,checkpointTick=inherited?.checkpointTick??0,partTicks=0,partNumber=history.length,replayedTicks=0,replayMs=0,peakY=leadPlayer(host).position.y;
  let captureStepMs=0,captureDigestMs=0,replayCheckMs=0;
  const phases:{id:string;tick:number;ms:number}[]=[];
  const mark=(id:string):void=>{phases.push({id,tick:host.state.tick,ms:performance.now()-started});};
  let frames:HeadlessCommand[][]=[],effects:HeadlessEffect[]=[];
  const flush=async():Promise<void>=>{
    if(frames.length===0)return;assert.ok(pipeline);
    const id=`titan-${partNumber++}`,p=leadPlayer(host).position;
    const expected:HeadlessTapeObservation={id,tick:host.state.tick,position:[p.x,p.y,p.z],peakY,grounded:leadPlayer(host).motor.snapshot().result.grounded,
      flags:[...host.flags.all],quests:host.quests.map(quest=>({id:quest.def.id,currentId:quest.current?.id??null,started:quest.snapshot().started,complete:quest.isComplete})),effects,
      adapters:observed.map(identity=>{const owner=host.adapters.get(identity);assert.ok(owner);const state=owner.snapshot();assert.equal(typeof state,'string');
        if(typeof state!=='string')throw new Error('Missing native Titan observation');return {id:identity,state};})};
    const beforeDigest=performance.now(),digest=canonicalSimDigest(snapshotSimHostBytes(host));captureDigestMs+=performance.now()-beforeDigest;
    const part:Part={plan:{version:1,observe:observed,segments:[{id,ticks:frames.length,commands:[],frames}]},expected:{version:1,ticks:frames.length,observations:[expected]},digest};
    history.push(part);checkTitanLedger(history,checkpointTick);
    frames=[];effects=[];peakY=p.y;await pipeline.offer(part);
  };
  const step=async(commands:readonly HeadlessCommand[]):Promise<void>=>{
    pipeline?.check();assert.ok(captureTicks++<89_400,'the real entry and fight retain a finite input prefix');
    const actual=commands.map(command=>{
      if(command.kind!=='player'||command.commandVersion===1)return command;
      const c=Math.cos(command.yaw),s=Math.sin(command.yaw),clamp=(n:number):number=>Math.max(-1,Math.min(1,n));
      return {...command,commandVersion:1 as const,steer:{keyX:0,keyY:0,stickX:clamp(command.moveX*c-command.moveZ*s),stickY:clamp(-command.moveX*s-command.moveZ*c)}};
    });
    const beforeStep=performance.now();resident.step(actual);captureStepMs+=performance.now()-beforeStep;
    if(pipeline!==undefined){frames.push(structuredClone(actual));effects.push(...structuredClone(resident.effects));partTicks++;peakY=Math.max(peakY,leadPlayer(host).position.y);
      if((host.state.tick-fenceTick)%512===0)await flush();}
  };
  if(inherited===undefined){
    await reachTitanCairn(host,step);mark('storm-entry');
    assert.equal(deaths.length,0,'the entry and borrowed-horse route must be earned without a checkpoint teleport');
    checkpointTick=host.state.tick;
  }
  const checkpoint=snapshotSimHostBytes(host),checkpointDigest=canonicalSimDigest(checkpoint);peakY=leadPlayer(host).position.y;
  pending=(async()=>{try{return {ok:true as const,worker:await createNativeProofWorker(shard,assets,'nalati-titan',serializeSimSnapshot(checkpoint),folderHeadlessSections(product),directory)};}
    catch(error){return {ok:false as const,error};}})();
  const ready=pending;
  const checkedWorker=async():Promise<Replay>=>{
    const result=await ready;if(!result.ok)throw result.error;replay=result.worker;
    if(replayedTicks===0){assert.ok(replay.checkpoint);assert.equal(replay.checkpoint.tick,host.state.tick-partTicks);
      assert.equal(canonicalSimDigest(replay.checkpoint.snapshot),checkpointDigest,'fresh worker restores this case\'s physically earned checkpoint');}
    return replay;
  };
  const publish=(next:'storm'|'fire'|'retry',path:string,cursor?:NonNullable<Awaited<ReturnType<typeof titanBowPilot>>>):void=>{
    const snapshot=snapshotSimHostBytes(host),digest=canonicalSimDigest(snapshot);
    assert.equal(next==='storm'?checkpointDigest:history.at(-1)?.digest,digest,'handoff is the checked commit, with no intervening tick');
    const handoff=v.parse(TitanHandoffSchema,{version:1,source,stage:next,snapshot:serializeSimSnapshot(snapshot),digest,checkpointTick,captureTicks,initialKills,parts:history,deaths,...(cursor===undefined?{}:{cursor,fireTick})});
    const wire=JSON.stringify(handoff);assert.ok(Buffer.byteLength(wire)<=32_000_000);
    writeFileSync(path,wire,{flag:'wx',mode:0o600});
    console.info(JSON.stringify({story:`titan-${stage}`,hash:titanWireHash(wire),tick:host.state.tick,parts:history.length,ms:performance.now()-started,phases}));
  };
  if(stage==='entry'){
    const worker=await checkedWorker();assert.ok(worker.checkpoint);assert.deepEqual(worker.checkpoint.effects,[]);
    assert.equal(worker.quarantined,false);assert.equal(deaths.length,0);publish('storm',handoffPath);
  }else{
    pipeline=checkedReplayPipeline<Part>(async part=>{
      const worker=await checkedWorker();
      const then=performance.now(),actual=await worker.verbTapePart(part.plan);replayMs+=performance.now()-then;
      const beforeCheck=performance.now();assert.deepEqual(actual.report,part.expected,'every real input part reproduces all ordered outcomes');
      assert.equal(canonicalSimDigest(decodeSimSnapshotBytes(actual.commit.snapshot)),part.digest,'every checked part reproduces the complete current native save');
      replayCheckMs+=performance.now()-beforeCheck;replayedTicks+=actual.report.ticks;
    });
    if(stage==='opening'){
      await step([{kind:'script',actorId:'nalati.titan.use',value:1}]);assert.equal(titan.fight.tied,true);
      await titanBowPilot(product,host,step,1);mark('rider-phase');
      await titanRidersPilot(product,host,step);mark('riders-defeated');
      await titanBowPilot(product,host,step,2);mark('fire-phase');
      assert.equal(deaths.length,0);assert.equal(titan.fight.phase,2);
      await flush();await pipeline.finish();assert.equal(replayedTicks,partTicks);assert.ok(replay);assert.equal(replay.quarantined,false);
      assert.ok(outputPath);publish('fire',outputPath);
    }else if(stage==='retry'){
      assert.ok(inherited);assert.equal(inherited.stage,'fire');assert.equal(deaths.length,0);
      const cursor=await titanBowPilot(product,host,step,3,{pauseAfterRetry:true});assert.ok(cursor);
      assert.ok(deaths.length>0);assert.ok(deaths.every(event=>event.checkpoint&&event.phase===2));
      assert.equal(titan.fight.phase,2);assert.ok(titan.boss.attempts>1);assert.ok(leadPlayer(host).health.attributes.health>0);
      assert.equal(titan.boss.state,'fight');assert.equal(titan.fight.body.visible,true);
      mark('earned-retry');await flush();await pipeline.finish();assert.equal(replayedTicks,partTicks);assert.ok(replay);assert.equal(replay.quarantined,false);
      assert.ok(outputPath);publish('retry',outputPath,cursor);
    }else{
      assert.ok(inherited);assert.equal(inherited.stage,'retry');
      if(inherited.stage!=='retry')throw new Error('Victory requires the actual earned retry');
      assert.equal(await titanBowPilot(product,host,step,3,{cursor:inherited.cursor}),null);
      mark('victory');
      for(let tick=0;tick<120;tick++)await step([]);
      assert.equal(titan.boss.state,'victory');assert.equal(titan.fight.dead,true);assert.equal(titan.fight.hp,0);
      assert.equal(titan.fight.tied,false,'the real arena clear must release the storm tie');
      assert.equal(titan.locked(),false);assert.equal(leadPlayer(host).moveScale,1);
      assert.ok(deaths.length>0,'the tape must exercise the real phase checkpoint, remount and refill');
      assert.ok(deaths.every(event=>event.checkpoint&&event.phase===2),'retry must retain the earned final phase');
      const saved=titan.records.bosses.read()[rows.definition.id];assert.ok(saved);
      assert.equal(saved.defeated,true);assert.equal(saved.kills,initialKills+1);assert.equal(saved.rewardTaken,false);
      const reward=titan.rewardPrompt();assert.ok(reward);assert.equal(reward.label,rows.reward.prompt);
      assert.ok(reward.position.toArray().every(Number.isFinite));assert.equal(titan.reward(),true);
      const presentation=parseChapterStoryPresentation(await product.json('quests/chapters.json'));
      const sources=Object.values(presentation.decision?.observations??{}).map(row=>row.source)
        .filter(ref=>'saved'in ref&&ref.saved.record==='bosses'&&ref.saved.id===rows.definition.id);
      assert.ok(sources.length>0);
      for(const reference of sources){assert.ok('saved'in reference);
        assert.equal(questObservation(reference,{flags:()=>host.flags,quest:()=>{throw new Error('No quest read was requested');},
          active:()=>{throw new Error('No chapter read was requested');},saved:()=>titan.records}),Number(saved[reference.saved.field]));}
      const readout=host.adapters.get('nalati.titan');assert.ok(readout);
      const readoutWire=readout.snapshot();assert.equal(typeof readoutWire,'string');if(typeof readoutWire!=='string')throw new Error('Missing actual Titan readouts');
      const text=v.parse(v.object({toasts:v.array(v.string()),feeds:v.array(v.string())}),JSON.parse(readoutWire));
      assert.ok(text.feeds.includes(rows.lines.grassFire),'the actual fire phase must publish its authored feed instruction');
      assert.equal(host.flags.has('tamed:horse'),false,'a borrowed camp horse cannot grant the taming chapter');
      await flush();await pipeline.finish();assert.equal(replayedTicks,partTicks);assert.ok(replay);assert.equal(replay.quarantined,false);
      const aggregateReplayedTicks=history.reduce((sum,part)=>sum+part.expected.ticks,0);assert.equal(aggregateReplayedTicks,host.state.tick-checkpointTick);
      assert.ok(fireTick);
      console.info(JSON.stringify({inputDigest:titanInputDigest(history,fireTick),observationDigest:titanObservationDigest(history,fireTick),finalDigest:history.at(-1)?.digest,story:'titan-victory',ticks:captureTicks,checkpointTick,replayedTicks,aggregateReplayedTicks,parts:partNumber,deaths,ms:performance.now()-started,replayMs,captureStepMs,captureDigestMs,replayCheckMs,phases}));
    }
  }
}finally{
  resident.dispose();await pipeline?.stop();
  const result=await pending;if(result?.ok)await result.worker.dispose();
}
