// oxlint-disable-next-line import/no-unassigned-import -- The sim's Math goes in before any module body runs.
import '../../../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- The native proof reads the same shipped physics module.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Outcomes must come from actual mounted input and native events.
import assert from 'node:assert/strict';
import * as v from 'valibot';
import {builtFolder} from '../builtFolder';
import {loadHeadlessFolder} from '../../../src/server/host/headlessFolder';
import {outputDescriptor} from '../../../src/shared/game/shardfile/outputDescriptor';
import {folderHeadlessSections} from '../../../src/shared/host/headlessSections';
import {snapshotSimHostBytes,serializeSimSnapshot} from '../../../src/shared/engine/sim/snapshot';
import {canonicalSimDigest} from '../../fake/simState';
import {loadRapier} from '../../../src/shared/engine/physics/rapier';
import {mountedPlayerOf} from '../../../src/server/game/riding/native';
import {parseCarriedQuest} from '@wildshard/format/questSteps';
import {createNativeProofResident} from '../headless-native';
import {createNativeProofWorker} from '../headless-worker';
import {prepareHeadlessRuntime} from '../nalati-kokpar-native';
import {runTrustedHeadlessTape,type HeadlessTapeSegment} from '../../../src/shared/host/headlessTape';
import type {HeadlessCommand} from '../../../src/shared/host/tickProtocol';
import {nalatiCampTalkTape} from '../../proof/nalati-grasslands/verbTape';
import {SKY_ROAD} from '../../../src/shards/nalati-grasslands/generators/layout';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const directory=builtFolder('nalati-grasslands'),product=await loadHeadlessFolder(directory);
const descriptor=outputDescriptor(product.shardfile);assert.ok(descriptor);
const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,
  Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
console.error('Kokpar product session admitted');
let resident:Awaited<ReturnType<typeof createNativeProofResident>>|undefined;
let pending:Promise<{ok:true;worker:Awaited<ReturnType<typeof createNativeProofWorker>>}|{ok:false;error:unknown}>|undefined;
let checkpointTick=0,checkpointDigest='';
const frames:HeadlessCommand[][]=[],marks:{id:string;tick:number;state:string;flags:string[]}[]=[];
try{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  resident=await createNativeProofResident({shard:product.shardfile,assets,rapier,product},prepareHeadlessRuntime);
  console.error('Kokpar native resident ready');
  const active=resident,{host}=active,mount=mountedPlayerOf(host);assert.ok(mount);
  const rows=parseCarriedQuest(await product.json('quests/carried.json'));
  const state=()=>{const owner=host.adapters.get('nalati.kokpar');assert.ok(owner);return JSON.stringify(owner.snapshot());};
  const round=()=>v.parse(v.object({carrying:v.boolean(),events:v.array(v.number())}),JSON.parse(state()));
  const step=(commands:readonly HeadlessCommand[]):void=>{
    if(frames.length>=36_000)throw new Error('Kokpar input tape exhausted its finite route');
    const actual=commands.map(command=>{
      if(command.kind!=='player'||command.commandVersion===1)return command;
      const c=Math.cos(command.yaw),s=Math.sin(command.yaw),clamp=(n:number)=>Math.max(-1,Math.min(1,n));
      return {...command,commandVersion:1 as const,steer:{keyX:0,keyY:0,
        stickX:clamp(command.moveX*c-command.moveZ*s),stickY:clamp(-command.moveX*s-command.moveZ*c)}};
    });
    frames.push(structuredClone(actual));active.step(actual);
    if(frames.length-(marks.at(-1)?.tick??0)===18_000)mark(`slice-${frames.length}`);
  };
  const mark=(id:string):void=>{
    const previous=marks.at(-1);
    if(previous?.tick===frames.length){previous.id=id;return;}
    marks.push({id,tick:frames.length,state:state(),flags:[...host.flags.all]});
    console.error(JSON.stringify({mark:id,tick:frames.length,at:leadPlayer(host).position}));
  };
  step([]);assert.equal(round().carrying,false);assert.equal(host.flags.has('won:kokpar'),false);mark('unmounted-entry');
  const camp=nalatiCampTalkTape(product.shardfile.spawn),end=camp.segments.findIndex(row=>row.id==='walk-to-herderRail')+1;assert.ok(end>0);
  runTrustedHeadlessTape(host,step,()=>active.effects,{...camp,segments:camp.segments.slice(0,end)});
  runTrustedHeadlessTape(host,step,()=>active.effects,{version:1,observe:[],segments:[{
    id:'walk-west-of-camp-horse',ticks:1200,commands:[],route:[{x:72.4,z:212.9},{x:72,z:210},
      {x:68,z:210},{x:66,z:211.5},{x:66.8,z:213.4}],
  }]});
  step([{kind:'script',actorId:'nalati.ride',value:1}]);assert.equal(mount.mounted,true);
  const reins=(forward:number,turn:number,sprint=false,jump=false):HeadlessCommand=>({kind:'player',moveX:0,moveZ:0,
    yaw:leadPlayer(host).yaw,commandVersion:1,steer:{keyX:0,keyY:0,stickX:turn,stickY:forward},sprint,...(jump?{jump:true as const}:{})});
  for(let tick=0;tick<90;tick++)step([reins(-1,0)]);
  mark('mounted-clear-of-rail');
  const drive=(x:number,z:number,sprint=false,radius=2.5):void=>{
    for(let tick=0;tick<1800;tick++){
      const p=leadPlayer(host).position,dx=x-p.x,dz=z-p.z,distance=Math.hypot(dx,dz);
      if(distance<radius)return;
      assert.equal(mount.mounted,true,'ordinary rider must stay mounted');
      const target=Math.atan2(dx,dz),delta=Math.atan2(Math.sin(mount.body.heading-target),Math.cos(mount.body.heading-target));
      // Rein in only when the real motor stalls on a bank; ordinary roads
      // use canter rather than spending the whole trip at a walking gait.
      const brake=Math.abs(delta)>.7&&Math.abs(mount.body.speed)>1.5;
      const forward=brake?-.3:Math.abs(delta)>.7?0:!sprint&&tick>120&&mount.body.speed<1?.3:1;
      const jump=tick>120&&tick%60===0&&mount.body.speed<1;
      step([reins(forward,brake?0:Math.max(-1,Math.min(1,delta*2.5)),sprint&&!brake,jump)]);
    }
    throw new Error(`Native Kokpar reins stuck ${JSON.stringify({target:[x,z],at:leadPlayer(host).position,heading:mount.body.heading,
      speed:mount.body.speed,ground:host.groundHeightAt(x,z),motor:mount.body.motor?.snapshot().result})}`);
  };
  const goal=rows.goals[0];assert.ok(goal);
  for(const [x,z] of [[60,214],[40,218],[20,216],[0,216],[0,205],[0,200],[0,190],[0,183],[0,170],[0,158],[0,147],
    [1,146],[23,146],[27,142],[39,141],[53,139],[57,136],[57,134],[40,133],
    ...SKY_ROAD.slice(4),[95,65],[65,55],[20,40],[-20,54]] as const)drive(x,z);
  // Circle outside pickup reach so the actual run through the goat already
  // points toward the goal; turning around while carrying lets riders steal it.
  const dx=goal.x-rows.home.x,dz=goal.z-rows.home.z,length=Math.hypot(dx,dz),ux=dx/length,uz=dz/length;
  drive(rows.home.x-uz*18,rows.home.z+ux*18);
  drive(rows.home.x-ux*16-uz*12,rows.home.z-uz*16+ux*12);
  drive(rows.home.x-ux*12,rows.home.z-uz*12);
  // This checkpoint is earned by the entire real entry/ride above, never
  // supplied as a pose or fabricated save. Replay every pickup/delivery input.
  const saved=snapshotSimHostBytes(host);checkpointTick=frames.length;checkpointDigest=canonicalSimDigest(saved);
  pending=createNativeProofWorker(product.shardfile,assets,'nalati-kokpar',serializeSimSnapshot(saved),
    folderHeadlessSections(product),directory).then(worker=>({ok:true as const,worker}),(error:unknown)=>({ok:false as const,error}));
  drive(rows.home.x,rows.home.z,true,2.8);
  for(let tick=0;tick<12&&!round().carrying;tick++)step([reins(0,0)]);
  assert.equal(round().carrying,true,'actual mounted proximity must pick up the admitted goat');mark('goat-picked-up');
  drive(goal.x,goal.z,true,2.5);
  for(let tick=0;tick<12&&!host.flags.has('won:kokpar');tick++)step([reins(1,0,true)]);
  assert.ok(host.flags.has('won:kokpar'),'native round event must earn delivery');
  assert.equal(round().carrying,false);assert.ok(round().events.includes(1));assert.ok(round().events.includes(7));
  assert.equal(host.flags.has('tamed:horse'),false,'a borrowed camp horse cannot grant taming');mark('goat-delivered');
}catch(error){
  if(pending!==undefined){const ready=await pending;if(ready.ok)await ready.worker.dispose();}
  throw error;
}finally{resident?.dispose();}

assert.ok(pending);const ready=await pending;if(!ready.ok)throw ready.error;
const replay=ready.worker;
try{
  const checkpoint=replay.checkpoint;assert.ok(checkpoint);
  assert.equal(canonicalSimDigest(checkpoint.snapshot),checkpointDigest,'the earned field checkpoint restores exactly');
  let start=checkpointTick;const suffix=marks.filter(mark=>mark.tick>checkpointTick),segments:HeadlessTapeSegment[]=suffix.map(mark=>{
    const part={id:mark.id,ticks:mark.tick-start,commands:[],frames:frames.slice(start,mark.tick)};start=mark.tick;return part;
  });
  const report=await replay.verbTape({version:1,observe:['nalati.kokpar'],segments});
  for(const mark of suffix){
    const row=report.observations.find(value=>value.id===mark.id);assert.ok(row);
    assert.deepEqual(row.flags,mark.flags);const owner=row.adapters.find(value=>value.id==='nalati.kokpar');assert.ok(owner);
    assert.deepEqual(JSON.parse(owner.state),JSON.parse(mark.state),'fresh rein commands reproduce the admitted round');
  }
  assert.equal(report.ticks,frames.length-checkpointTick);assert.equal(replay.quarantined,false);
  console.info(JSON.stringify({story:'kokpar',ticks:frames.length,checkpointTick,replayedTicks:report.ticks,
    marks:marks.map(({id,tick})=>({id,tick}))}));
}finally{await replay.dispose();}
