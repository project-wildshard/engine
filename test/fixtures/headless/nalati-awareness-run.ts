// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Assert actual wildlife awareness and fresh native replay.
import assert from 'node:assert/strict';
// oxlint-disable-next-line import/no-nodejs-modules -- Use the shipped physics binary.
import {readFileSync} from 'node:fs';
import * as v from 'valibot';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {snapshotSimHostBytes,serializeSimSnapshot} from '../../../src/shared/engine/sim/snapshot';
import {runTrustedHeadlessTape,type HeadlessTapeObservation} from '../../../src/shared/host/headlessTape';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import {createNativeProofResident} from '../headless-native';
import {prepareHeadlessRuntime} from '../nalati-stealth-native';
import {nalatiHorsePlainsInputs} from '../../proof/nalati-grasslands/horsePlainsWalk';
import {beginProductSession} from './productSession';
import {checkedReplayPipeline} from './checkedReplayPipeline';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

console.info(JSON.stringify({phase:'prepare-start'}));
const session=await beginProductSession('nalati-grasslands','nalati-stealth'),{product,assets}=session;
let replay:Awaited<ReturnType<typeof session.ready>>|undefined;
const resident=await createNativeProofResident({product,assets,shard:product.shardfile,
  rapier:await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))},prepareHeadlessRuntime).catch(async(error:unknown)=>{
  const worker=await session.ready();await worker.dispose();throw error;
});
const State=v.object({law:v.object({state:v.string(),threat:v.number(),observation:v.object({threats:v.array(v.object({awareness:v.number(),alert:v.number(),hunting:v.number()}))})}),
  label:v.string(),hints:v.number()});
const frames:HeadlessCommand[][]=[],marks:{id:string;tick:number;state:string}[]=[],seen=new Set<string>();
let checkpoint:string|undefined,checkpointTick=0;
let stopReplay:(()=>Promise<void>)|undefined;
try{
  console.info(JSON.stringify({phase:'startup'}));
  replay=await session.ready();const worker=replay;
  const owner=resident.host.adapters.get('nalati.stealth');assert.ok(owner);
  const read=()=>{const saved=owner.snapshot();assert.equal(typeof saved,'string');if(typeof saved!=='string')throw new Error('Missing actual awareness state');return saved;};
  interface Part {id:string;start:number;tick:number;state:string;position:number[];flags:string[]}
  const parts:Part[]=[];
  let offset=0,replayed=0,maxPartMs=0,backpressureMs=0;
  const captureStarted=performance.now();
  const check=(observation:HeadlessTapeObservation|undefined,expected:Part):void=>{
    assert.ok(observation);assert.equal(observation.id,expected.id);assert.equal(observation.tick,expected.tick);
    assert.deepEqual(observation.position,expected.position);assert.deepEqual(observation.flags,expected.flags);
    const state=observation.adapters.find(row=>row.id==='nalati.stealth');assert.ok(state);
    assert.deepEqual(JSON.parse(state.state),JSON.parse(expected.state),'fresh inputs reproduce each actual awareness transition and original threat order');
  };
  const pipeline=checkedReplayPipeline<Part>(async expected=>{
    const chunk=frames.slice(expected.start,expected.tick),started=performance.now();
    const result=await worker.verbTapePart({version:1,observe:['nalati.stealth'],segments:[
      {id:expected.id,ticks:chunk.length,commands:[],frames:chunk},
    ]});
    const milliseconds=performance.now()-started;maxPartMs=Math.max(maxPartMs,milliseconds);
    assert.equal(result.report.ticks,chunk.length);assert.equal(result.commit.tick,expected.tick);
    check(result.report.observations[0],expected);replayed+=result.report.ticks;
    console.info(JSON.stringify({phase:'fresh-replay-part',id:expected.id,tick:expected.tick,ticks:chunk.length,milliseconds}));
  });
  stopReplay=pipeline.stop;
  const flush=async(id:string):Promise<void>=>{
    if(offset===frames.length)return;
    assert.equal(resident.host.adapters.get('nalati.stealth'),owner,'capture retains its original awareness owner');
    const part={id,start:offset,tick:frames.length,state:read(),position:leadPlayer(resident.host).position.toArray(),flags:[...resident.host.flags.all]};
    assert.ok(part.tick-part.start>0&&part.tick-part.start<=512);
    parts.push(part);
    const started=performance.now();await pipeline.offer(part);backpressureMs+=performance.now()-started;
    offset=frames.length;
  };
  const step=async(commands:readonly HeadlessCommand[]):Promise<void>=>{
    pipeline.check();
    assert.ok(frames.length<18_000,'the real approach retains its finite input allowance');
    frames.push(structuredClone([...commands]));resident.step(commands);
    const saved=read(),state=v.parse(State,JSON.parse(saved));
    if(!seen.has(state.law.state)){
      seen.add(state.law.state);marks.push({id:`awareness-${state.law.state}`,tick:frames.length,state:saved});
      if(state.law.state==='noticed'){
        assert.equal(state.label,'Noticed');assert.ok(state.law.threat>0&&state.law.threat<1);
        assert.ok(state.law.observation.threats.some(threat=>threat.awareness>0),'live animals supply the actual rising awareness');
        checkpoint=serializeSimSnapshot(snapshotSimHostBytes(resident.host));checkpointTick=frames.length;
      }
      if(state.law.state==='detected'){assert.equal(state.label,'Detected');assert.equal(state.law.threat,1);}
      await flush(`awareness-${state.law.state}`);
    }
    if(frames.length-offset>=512)await flush(`awareness-part-${parts.length}`);
  };
  // The same physical bridge and bowl shelves as the earned field-taming
  // proof. Running past real herds changes their own senses; no threat input
  // or population mutation is exposed to this pilot.
  for(const commands of nalatiHorsePlainsInputs(resident.host))await step(commands);
  for(let tick=0;tick<120;tick++)await step([]);
  assert.ok(seen.has('visible'));assert.ok(seen.has('noticed'));assert.ok(seen.has('detected'));assert.ok(checkpoint);
  assert.equal(leadPlayer(resident.host).health.alive,true);
  const final=read();marks.push({id:'after-real-awareness',tick:frames.length,state:final});
  await flush('after-real-awareness');await pipeline.finish();
  assert.equal(replayed,frames.length,'every original input is replayed once');
  for(const mark of marks){const part=parts.find(row=>row.tick===mark.tick);assert.ok(part);assert.equal(part.state,mark.state);}
  console.info(JSON.stringify({phase:'capture-replay-done',ticks:frames.length,parts:parts.length,captureWallMs:performance.now()-captureStarted,backpressureMs,maxPartMs}));
  await replay.dispose();replay=undefined;
  console.info(JSON.stringify({phase:'restore-start',checkpointTick}));
  const restored=await beginProductSession('nalati-grasslands','nalati-stealth',checkpoint);replay=await restored.ready();
  const report=runTrustedHeadlessTape(resident.host,commands=>resident.step(commands),()=>resident.effects,
    {version:1,observe:['nalati.stealth'],segments:[{id:'after-awareness-restore',ticks:1,commands:[]}]});
  let restoredTicks=0;
  for(const expected of parts.filter(part=>part.tick>checkpointTick)){
    assert.equal(expected.start,checkpointTick+restoredTicks,'the earned checkpoint starts at the next original input');
    const chunk=frames.slice(expected.start,expected.tick),started=performance.now();
    const result=await replay.verbTapePart({version:1,observe:['nalati.stealth'],segments:[
      {id:expected.id,ticks:chunk.length,commands:[],frames:chunk},
    ]});
    assert.equal(result.report.ticks,chunk.length);assert.equal(result.commit.tick,expected.tick);check(result.report.observations[0],expected);
    restoredTicks+=result.report.ticks;
    console.info(JSON.stringify({phase:'restored-replay-part',id:expected.id,tick:expected.tick,ticks:chunk.length,milliseconds:performance.now()-started}));
  }
  assert.equal(restoredTicks,frames.length-checkpointTick);
  const continuation=await replay.verbTapePart({version:1,observe:['nalati.stealth'],segments:[{id:'after-awareness-restore',ticks:1,commands:[]}]});
  assert.deepEqual(continuation.report.observations[0],report.observations[0],'an earned Noticed checkpoint continues the real herd senses and detection state');
  assert.equal(replay.quarantined,false);
  console.info(JSON.stringify({story:'native-awareness',inputs:frames.length,checkpointTick,states:[...seen],hints:v.parse(State,JSON.parse(final)).hints}));
}finally{await stopReplay?.();resident.dispose();replay??=await session.ready();await replay.dispose();}
